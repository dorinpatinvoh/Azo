import {
  BadGatewayException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { IsNumber, Max, Min } from "class-validator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

class ReverseGeocodeDto {
  @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsNumber() @Min(-180) @Max(180) longitude: number;
}

// Base de données de secours locale pour le Bénin (Cotonou, Calavi, Porto-Novo, etc.)
const BENIN_DEFAULT_PLACES = [
  // Universités & Écoles
  { id: "uac_calavi", title: "Université d'Abomey-Calavi (UAC)", subtitle: "Campus d'Abomey-Calavi", latitude: 6.4474, longitude: 2.3533 },
  { id: "uac_eneam", title: "ENEAM (Université de Cotonou)", subtitle: "Gbegamey, Cotonou", latitude: 6.3664, longitude: 2.4116 },
  { id: "uac_fss", title: "Faculté des Sciences de la Santé (FSS)", subtitle: "Champ de Foire, Cotonou", latitude: 6.3638, longitude: 2.4287 },
  { id: "uac_epac", title: "EPAC Calavi", subtitle: "Abomey-Calavi", latitude: 6.4491, longitude: 2.3552 },
  { id: "uac_fasahs", title: "Université / FASAHS", subtitle: "Calavi, Bénin", latitude: 6.4468, longitude: 2.3541 },

  // Cotonou - Points majeurs
  { id: "etoile", title: "Place de l'Étoile Rouge", subtitle: "Cotonou Centre", latitude: 6.3725, longitude: 2.4061 },
  { id: "dantokpa", title: "Marché Dantokpa", subtitle: "St Michel, Cotonou", latitude: 6.3728, longitude: 2.4339 },
  { id: "aeroport", title: "Aéroport International Cardinal Bernadin Gantin", subtitle: "Cadjèhoun, Cotonou", latitude: 6.3572, longitude: 2.3844 },
  { id: "ganhi", title: "Ganhi Quartier des Affaires", subtitle: "Cotonou", latitude: 6.3556, longitude: 2.4398 },
  { id: "haievive", title: "Les Cocotiers / Haie Vive", subtitle: "Cotonou", latitude: 6.3589, longitude: 2.3976 },
  { id: "stade_gm_kerekou", title: "Stade Général Mathieu Kérékou (Stade de l'Amitié)", subtitle: "Kouhounou, Cotonou", latitude: 6.3883, longitude: 2.3847 },
  { id: "port_cotonou", title: "Port Autonome de Cotonou", subtitle: "Zone Portuaire, Cotonou", latitude: 6.3581, longitude: 2.4328 },
  { id: "plage_fidjrosse", title: "Plage de Fidjrossè (Route des Pêches)", subtitle: "Fidjrossè, Cotonou", latitude: 6.3522, longitude: 2.3575 },
  { id: "cadjehoun", title: "Cadjèhoun", subtitle: "Cotonou", latitude: 6.3601, longitude: 2.3934 },
  { id: "st_michel", title: "Carrefour Saint Michel", subtitle: "Cotonou", latitude: 6.3702, longitude: 2.4276 },
  { id: "stade_charles_de_gaulle", title: "Stade Charles de Gaulle", subtitle: "Porto-Novo", latitude: 6.4969, longitude: 2.6288 },
  { id: "iita_calavi", title: "Carrefour IITA Calavi", subtitle: "Abomey-Calavi", latitude: 6.4225, longitude: 2.3397 },
  { id: "arconville", title: "Arconville", subtitle: "Abomey-Calavi", latitude: 6.4485, longitude: 2.3481 },
  { id: "godomey", title: "Échangeur de Godomey", subtitle: "Godomey, Abomey-Calavi", latitude: 6.3989, longitude: 2.3364 },
  { id: "kpota", title: "Carrefour Kpota", subtitle: "Abomey-Calavi", latitude: 6.4523, longitude: 2.3458 },
  { id: "akpakpa", title: "Akpakpa Centre", subtitle: "Cotonou", latitude: 6.3739, longitude: 2.4533 },
];

@Injectable()
export class PlacesService {
  private readonly base = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";
  private readonly ua = process.env.NOMINATIM_USER_AGENT ?? "AzoApp/1.0 (contact@azo-mobility.com)";
  private readonly countries = process.env.PLACES_COUNTRY_CODES ?? "bj";

  private cache = new Map<string, { at: number; data: any }>();

  private async getJson(url: string): Promise<any> {
    const res = await fetch(url, {
      headers: { "User-Agent": this.ua, "Accept-Language": "fr" },
      signal: AbortSignal.timeout(5000), // Timeout plus court (5s) pour basculer vite en fallback si nécessaire
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  async reverseGeocode(latitude: number, longitude: number) {
    try {
      const data = await this.getJson(
        `${this.base}/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=fr&lat=${latitude}&lon=${longitude}`
      );
      if (!data?.error) {
        const a = data.address ?? {};
        const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.village ?? a.road;
        const city = a.city ?? a.town ?? a.municipality ?? a.county ?? a.state;
        const parts = [area, city].filter((p, i, arr) => p && arr.indexOf(p) === i);
        const address = parts.length ? parts.join(", ") : String(data.display_name ?? "Position sélectionnée");
        return { address, fullAddress: data.display_name ?? address, latitude, longitude };
      }
    } catch {
      // Fallback gracieux si Nominatim timeout
    }

    return {
      address: "Position sur la carte",
      fullAddress: `Lat: ${latitude.toFixed(4)}, Lng: ${longitude.toFixed(4)}`,
      latitude,
      longitude,
    };
  }

  async search(q: string, lat?: string, lng?: string) {
    const query = (q ?? "").trim();
    if (query.length < 2) return { results: [] };

    const key = `${query.toLowerCase()}|${lat ?? ""}|${lng ?? ""}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;

    let onlineResults: any[] = [];

    try {
      onlineResults = await this.searchPhoton(query, lat, lng);
    } catch (e) {
      // console.warn("Photon lookup failed:", e);
    }

    if (onlineResults.length < 3) {
      try {
        const more = await this.searchNominatim(query, lat, lng);
        onlineResults = this.dedupe([...onlineResults, ...more]);
      } catch (e) {
        // console.warn("Nominatim lookup failed:", e);
      }
    }

    // Recherche locale de fallback (Bénin) si résultats en ligne faibles ou indisponibles
    const normalizedQ = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const localMatches = BENIN_DEFAULT_PLACES.filter((p) => {
      const titleNorm = p.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const subNorm = p.subtitle.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return titleNorm.includes(normalizedQ) || subNorm.includes(normalizedQ);
    });

    const combined = this.dedupe([...onlineResults, ...localMatches]).slice(0, 10);

    const data = { results: combined };
    if (combined.length > 0) {
      this.cache.set(key, { at: Date.now(), data });
    }

    return data;
  }

  private dedupe(items: any[]) {
    const seen = new Set<string>();
    return items.filter((it) => {
      const k = `${String(it.title).toLowerCase()}|${Number(it.latitude).toFixed(3)}|${Number(it.longitude).toFixed(3)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  private async searchNominatim(query: string, lat?: string, lng?: string) {
    let url =
      `${this.base}/search?format=jsonv2&addressdetails=1&limit=6&accept-language=fr` +
      `&countrycodes=${this.countries}&q=${encodeURIComponent(query)}`;
    const la = Number(lat),
      lo = Number(lng);
    if (lat && lng && Number.isFinite(la) && Number.isFinite(lo)) {
      url += `&viewbox=${lo - 0.4},${la + 0.4},${lo + 0.4},${la - 0.4}&bounded=0`;
    }

    const items: any[] = await this.getJson(url);
    return (items || []).map((it) => {
      const parts = String(it.display_name ?? "")
        .split(",")
        .map((s) => s.trim());
      return {
        id: String(it.place_id),
        title: it.name || parts[0] || "Lieu",
        subtitle: parts.slice(1, 4).join(", "),
        latitude: Number(it.lat),
        longitude: Number(it.lon),
      };
    });
  }

  private async searchPhoton(query: string, lat?: string, lng?: string) {
    const p = new URLSearchParams({
      q: query,
      limit: "10",
      lang: "fr",
      bbox: "0.77,6.23,3.85,12.42",
    });
    const la = Number(lat),
      lo = Number(lng);
    if (lat && lng && Number.isFinite(la) && Number.isFinite(lo)) {
      p.set("lat", String(la));
      p.set("lon", String(lo));
    }
    const data = await this.getJson(`https://photon.komoot.io/api/?${p}`);
    return (data.features ?? [])
      .filter((f: any) => !f.properties?.countrycode || f.properties.countrycode === "BJ")
      .map((f: any, i: number) => {
        const pr = f.properties ?? {};
        const title = pr.name ?? ([pr.housenumber, pr.street].filter(Boolean).join(" ") || query);
        return {
          id: `${pr.osm_type ?? ""}${pr.osm_id ?? i}`,
          title,
          subtitle: [pr.name ? pr.street : null, pr.district ?? pr.locality, pr.city ?? pr.county]
            .filter(Boolean)
            .join(", "),
          latitude: f.geometry.coordinates[1],
          longitude: f.geometry.coordinates[0],
        };
      });
  }
}

@Controller("places")
@UseGuards(JwtAuthGuard)
export class PlacesController {
  constructor(private places: PlacesService) {}

  @Post("reverse-geocode")
  reverse(@Body() dto: ReverseGeocodeDto) {
    return this.places.reverseGeocode(dto.latitude, dto.longitude);
  }

  @Get("search")
  search(@Query("q") q: string, @Query("lat") lat?: string, @Query("lng") lng?: string) {
    return this.places.search(q, lat, lng);
  }
}

@Module({
  controllers: [PlacesController],
  providers: [PlacesService],
  exports: [PlacesService],
})
export class PlacesModule {}