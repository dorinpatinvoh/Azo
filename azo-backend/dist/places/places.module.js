"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlacesModule = exports.PlacesController = exports.PlacesService = void 0;
const common_1 = require("@nestjs/common");
const class_validator_1 = require("class-validator");
const jwt_auth_guard_1 = require("../common/guards/jwt-auth.guard");
class ReverseGeocodeDto {
}
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-90),
    (0, class_validator_1.Max)(90),
    __metadata("design:type", Number)
], ReverseGeocodeDto.prototype, "latitude", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.Min)(-180),
    (0, class_validator_1.Max)(180),
    __metadata("design:type", Number)
], ReverseGeocodeDto.prototype, "longitude", void 0);
let PlacesService = class PlacesService {
    constructor() {
        this.base = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";
        // ⚠️ Nominatim bloque les User-Agent génériques : mets un vrai email dans .env (NOMINATIM_USER_AGENT)
        this.ua = process.env.NOMINATIM_USER_AGENT ?? "azo-mobility/1.0 (contact@example.com)";
        this.countries = process.env.PLACES_COUNTRY_CODES ?? "bj"; // Bénin
        // [AJOUT] Cache mémoire des recherches (10 min)
        this.cache = new Map();
    }
    // Nominatim : gratuit mais limité à 1 requête/s. En production → Google Places / Mapbox.
    async getJson(url) {
        try {
            const res = await fetch(url, { headers: { "User-Agent": this.ua }, signal: AbortSignal.timeout(8000) });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`); // [CHANGÉ]
            return await res.json();
        }
        catch (e) {
            console.error("[places] échec :", url, "→", e?.message ?? e); // vraie cause dans le terminal du backend
            throw new common_1.BadGatewayException("Service d'adresses indisponible");
        }
    }
    async reverseGeocode(latitude, longitude) {
        const data = await this.getJson(`${this.base}/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=fr&lat=${latitude}&lon=${longitude}`);
        if (data.error)
            throw new common_1.NotFoundException("Aucune adresse trouvée pour ces coordonnées");
        const a = data.address ?? {};
        const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.village ?? a.road;
        const city = a.city ?? a.town ?? a.municipality ?? a.county ?? a.state;
        const parts = [area, city].filter((p, i, arr) => p && arr.indexOf(p) === i);
        const address = parts.length ? parts.join(", ") : String(data.display_name ?? "Position actuelle");
        return { address, fullAddress: data.display_name ?? address, latitude, longitude };
    }
    // Recherche : Photon d'abord (fait de l'autocomplétion, comprend les mots incomplets et
    // se cale sur la position du client), puis Nominatim en complément si peu de résultats.
    async search(q, lat, lng) {
        const query = (q ?? "").trim();
        if (query.length < 3)
            return { results: [] };
        const key = `${query.toLowerCase()}|${lat ?? ""}|${lng ?? ""}`;
        const hit = this.cache.get(key);
        if (hit && Date.now() - hit.at < 10 * 60_000)
            return hit.data;
        let failures = 0;
        let results = await this.searchPhoton(query, lat, lng).catch(() => { failures++; return []; });
        if (results.length < 3) {
            const more = await this.searchNominatim(query, lat, lng).catch(() => { failures++; return []; });
            results = this.dedupe([...results, ...more]).slice(0, 8);
        }
        // Les deux services ont échoué : on le dit à l'app (sinon elle croit qu'il n'y a « aucun résultat »)
        if (results.length === 0 && failures === 2) {
            throw new common_1.BadGatewayException("Service d'adresses indisponible. Réessaie dans un instant.");
        }
        const data = { results };
        if (results.length > 0)
            this.cache.set(key, { at: Date.now(), data });
        return data;
    }
    dedupe(items) {
        const seen = new Set();
        return items.filter((it) => {
            const k = `${String(it.title).toLowerCase()}|${it.latitude.toFixed(3)}|${it.longitude.toFixed(3)}`;
            if (seen.has(k))
                return false;
            seen.add(k);
            return true;
        });
    }
    // Nominatim (OpenStreetMap) : complément quand Photon trouve peu de résultats
    async searchNominatim(query, lat, lng) {
        let url = `${this.base}/search?format=jsonv2&addressdetails=1&limit=6&accept-language=fr` +
            `&countrycodes=${this.countries}&q=${encodeURIComponent(query)}`;
        const la = Number(lat), lo = Number(lng);
        if (lat && lng && Number.isFinite(la) && Number.isFinite(lo)) {
            url += `&viewbox=${lo - 0.4},${la + 0.4},${lo + 0.4},${la - 0.4}&bounded=0`; // biais non bloquant
        }
        const items = await this.getJson(url);
        return items.map((it) => {
            const parts = String(it.display_name ?? "").split(",").map((s) => s.trim());
            return {
                id: String(it.place_id),
                title: it.name || parts[0] || "Lieu",
                subtitle: parts.slice(1, 4).join(", "),
                latitude: Number(it.lat),
                longitude: Number(it.lon),
            };
        });
    }
    // Photon (OpenStreetMap) : bon pour les noms partiels ("cadj" → Cadjèhoun) et les quartiers
    async searchPhoton(query, lat, lng) {
        const p = new URLSearchParams({ q: query, limit: "10", lang: "fr", bbox: "0.77,6.23,3.85,12.42" });
        const la = Number(lat), lo = Number(lng);
        if (lat && lng && Number.isFinite(la) && Number.isFinite(lo)) {
            p.set("lat", String(la));
            p.set("lon", String(lo));
        }
        const data = await this.getJson(`https://photon.komoot.io/api/?${p}`);
        return (data.features ?? [])
            // la zone de recherche déborde sur le Togo, le Nigeria… on ne garde que le Bénin
            .filter((f) => !f.properties?.countrycode || f.properties.countrycode === "BJ")
            .map((f, i) => {
            const pr = f.properties ?? {};
            const title = pr.name ?? ([pr.housenumber, pr.street].filter(Boolean).join(" ") || query);
            return {
                id: `${pr.osm_type ?? ""}${pr.osm_id ?? i}`,
                title,
                subtitle: [pr.name ? pr.street : null, pr.district ?? pr.locality, pr.city ?? pr.county].filter(Boolean).join(", "),
                latitude: f.geometry.coordinates[1],
                longitude: f.geometry.coordinates[0],
            };
        });
    }
};
exports.PlacesService = PlacesService;
exports.PlacesService = PlacesService = __decorate([
    (0, common_1.Injectable)()
], PlacesService);
let PlacesController = class PlacesController {
    constructor(places) {
        this.places = places;
    }
    // POST /places/reverse-geocode  { "latitude": 6.37, "longitude": 2.39 }
    reverse(dto) {
        return this.places.reverseGeocode(dto.latitude, dto.longitude);
    }
    // GET /places/search?q=marche&lat=..&lng=..
    search(q, lat, lng) {
        return this.places.search(q, lat, lng);
    }
};
exports.PlacesController = PlacesController;
__decorate([
    (0, common_1.Post)("reverse-geocode"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ReverseGeocodeDto]),
    __metadata("design:returntype", void 0)
], PlacesController.prototype, "reverse", null);
__decorate([
    (0, common_1.Get)("search"),
    __param(0, (0, common_1.Query)("q")),
    __param(1, (0, common_1.Query)("lat")),
    __param(2, (0, common_1.Query)("lng")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], PlacesController.prototype, "search", null);
exports.PlacesController = PlacesController = __decorate([
    (0, common_1.Controller)("places"),
    (0, common_1.UseGuards)(jwt_auth_guard_1.JwtAuthGuard),
    __metadata("design:paramtypes", [PlacesService])
], PlacesController);
let PlacesModule = class PlacesModule {
};
exports.PlacesModule = PlacesModule;
exports.PlacesModule = PlacesModule = __decorate([
    (0, common_1.Module)({
        controllers: [PlacesController],
        providers: [PlacesService],
        exports: [PlacesService],
    })
], PlacesModule);
//# sourceMappingURL=places.module.js.map