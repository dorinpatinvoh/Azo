import {
  BadGatewayException, Body, Controller, Get, Injectable, Module, NotFoundException, Post, Query, UseGuards,
} from "@nestjs/common";
import { IsNumber, Max, Min } from "class-validator";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";

class ReverseGeocodeDto {
  @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsNumber() @Min(-180) @Max(180) longitude: number;
}

@Injectable()
export class PlacesService {
  private readonly base = process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org";
  // ⚠️ Nominatim bloque les User-Agent génériques : mets un vrai email dans .env (NOMINATIM_USER_AGENT)
  private readonly ua = process.env.NOMINATIM_USER_AGENT ?? "azo-mobility/1.0 (contact@example.com)";
  private readonly countries = process.env.PLACES_COUNTRY_CODES ?? "bj"; // Bénin

  // [AJOUT] Cache mémoire des recherches (10 min)
  private cache = new Map<string, { at: number; data: any }>();

  // Nominatim : gratuit mais limité à 1 requête/s. En production → Google Places / Mapbox.
  private async getJson(url: string): Promise<any> {
    try {
      const res = await fetch(url, { headers: { "User-Agent": this.ua }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`); // [CHANGÉ]
      return await res.json();
    } catch (e) {
      console.error("[places] échec :", url, "→", (e as Error)?.message ?? e); // vraie cause dans le terminal du backend
      throw new BadGatewayException("Service d'adresses indisponible");
    }
  }

  async reverseGeocode(latitude: number, longitude: number) {
    const data = await this.getJson(
      `${this.base}/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=fr&lat=${latitude}&lon=${longitude}`
    );
    if (data.error) throw new NotFoundException("Aucune adresse trouvée pour ces coordonnées");

    const a = data.address ?? {};
    const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.village ?? a.road;
    const city = a.city ?? a.town ?? a.municipality ?? a.county ?? a.state;
    const parts = [area, city].filter((p, i, arr) => p && arr.indexOf(p) === i);
    const address = parts.length ? parts.join(", ") : String(data.display_name ?? "Position actuelle");
    return { address, fullAddress: data.display_name ?? address, latitude, longitude };
  }

  // Recherche : Photon d'abord (fait de l'autocomplétion, comprend les mots incomplets et
  // se cale sur la position du client), puis Nominatim en complément si peu de résultats.
  async search(q: string, lat?: string, lng?: string) {
    const query = (q ?? "").trim();
    if (query.length < 3) return { results: [] };

    const key = `${query.toLowerCase()}|${lat ?? ""}|${lng ?? ""}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;

    let failures = 0;
    let results: any[] = await this.searchPhoton(query, lat, lng).catch(() => { failures++; return []; });

    if (results.length < 3) {
      const more = await this.searchNominatim(query, lat, lng).catch(() => { failures++; return []; });
      results = this.dedupe([...results, ...more]).slice(0, 8);
    }

    // Les deux services ont échoué : on le dit à l'app (sinon elle croit qu'il n'y a « aucun résultat »)
    if (results.length === 0 && failures === 2) {
      throw new BadGatewayException("Service d'adresses indisponible. Réessaie dans un instant.");
    }

    const data = { results };
    if (results.length > 0) this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  private dedupe(items: any[]) {
    const seen = new Set<string>();
    return items.filter((it) => {
      const k = `${String(it.title).toLowerCase()}|${it.latitude.toFixed(3)}|${it.longitude.toFixed(3)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  // Nominatim (OpenStreetMap) : complément quand Photon trouve peu de résultats
  private async searchNominatim(query: string, lat?: string, lng?: string) {
    let url =
      `${this.base}/search?format=jsonv2&addressdetails=1&limit=6&accept-language=fr` +
      `&countrycodes=${this.countries}&q=${encodeURIComponent(query)}`;
    const la = Number(lat), lo = Number(lng);
    if (lat && lng && Number.isFinite(la) && Number.isFinite(lo)) {
      url += `&viewbox=${lo - 0.4},${la + 0.4},${lo + 0.4},${la - 0.4}&bounded=0`; // biais non bloquant
    }

    const items: any[] = await this.getJson(url);
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
  private async searchPhoton(query: string, lat?: string, lng?: string) {
    const p = new URLSearchParams({ q: query, limit: "10", lang: "fr", bbox: "0.77,6.23,3.85,12.42" });
    const la = Number(lat), lo = Number(lng);
    if (lat && lng && Number.isFinite(la) && Number.isFinite(lo)) { p.set("lat", String(la)); p.set("lon", String(lo)); }
    const data = await this.getJson(`https://photon.komoot.io/api/?${p}`);
    return (data.features ?? [])
      // la zone de recherche déborde sur le Togo, le Nigeria… on ne garde que le Bénin
      .filter((f: any) => !f.properties?.countrycode || f.properties.countrycode === "BJ")
      .map((f: any, i: number) => {
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
}

@Controller("places")
@UseGuards(JwtAuthGuard)
export class PlacesController {
  constructor(private places: PlacesService) {}

  // POST /places/reverse-geocode  { "latitude": 6.37, "longitude": 2.39 }
  @Post("reverse-geocode")
  reverse(@Body() dto: ReverseGeocodeDto) {
    return this.places.reverseGeocode(dto.latitude, dto.longitude);
  }

  // GET /places/search?q=marche&lat=..&lng=..
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