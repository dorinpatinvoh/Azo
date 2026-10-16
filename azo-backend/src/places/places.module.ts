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
import gazetteerData from "./benin-gazetteer.json";

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

// Villes et communes du Bénin (repli hors ligne, position approximative du centre) : un lieu éloigné reste trouvable même sans réponse des services de cartes.
const BENIN_TOWNS = [
  { id: "t_portonovo", title: "Porto-Novo", subtitle: "Ouémé", latitude: 6.4969, longitude: 2.6289 },
  { id: "t_semekpodji", title: "Sèmè-Podji", subtitle: "Ouémé", latitude: 6.3833, longitude: 2.6167 },
  { id: "t_ouidah", title: "Ouidah", subtitle: "Atlantique", latitude: 6.363, longitude: 2.085 },
  { id: "t_allada", title: "Allada", subtitle: "Atlantique", latitude: 6.665, longitude: 2.151 },
  { id: "t_toffo", title: "Toffo", subtitle: "Atlantique", latitude: 6.8497, longitude: 2.0828 },
  { id: "t_sosava", title: "Sô-Ava (Ganvié)", subtitle: "Atlantique", latitude: 6.4667, longitude: 2.4167 },
  { id: "t_gdpopo", title: "Grand-Popo", subtitle: "Mono", latitude: 6.2833, longitude: 1.8167 },
  { id: "t_lokossa", title: "Lokossa", subtitle: "Mono", latitude: 6.6386, longitude: 1.7167 },
  { id: "t_pobe", title: "Pobè", subtitle: "Plateau", latitude: 6.9833, longitude: 2.6667 },
  { id: "t_sakete", title: "Sakété", subtitle: "Plateau", latitude: 6.7333, longitude: 2.6583 },
  { id: "t_ketou", title: "Kétou", subtitle: "Plateau", latitude: 7.3583, longitude: 2.6 },
  { id: "t_abomey", title: "Abomey", subtitle: "Zou", latitude: 7.1829, longitude: 1.9912 },
  { id: "t_bohicon", title: "Bohicon", subtitle: "Zou", latitude: 7.1782, longitude: 2.0667 },
  { id: "t_dassa", title: "Dassa-Zoumè", subtitle: "Collines", latitude: 7.75, longitude: 2.1833 },
  { id: "t_savalou", title: "Savalou", subtitle: "Collines", latitude: 7.9283, longitude: 1.9753 },
  { id: "t_parakou", title: "Parakou", subtitle: "Borgou", latitude: 9.337, longitude: 2.6303 },
  { id: "t_djougou", title: "Djougou", subtitle: "Donga", latitude: 9.7085, longitude: 1.666 },
  { id: "t_natitingou", title: "Natitingou", subtitle: "Atacora", latitude: 10.3042, longitude: 1.3796 },
  { id: "t_kandi", title: "Kandi", subtitle: "Alibori", latitude: 11.1342, longitude: 2.9386 },
  { id: "t_malanville", title: "Malanville", subtitle: "Alibori", latitude: 11.8683, longitude: 3.3833 },
];

/**
 * Quartiers et villages de Cotonou (13 arrondissements) et d'Abomey-Calavi (9 arrondissements), avec leur arrondissement.
 * Données OpenStreetMap du 16/10/2026 (voir PROJECT_SUMMARY/QUARTIERS_VILLAGES_ELOIGNES_*.pdf) : ils restent trouvables
 * même quand les services de cartes en ligne ne connaissent pas le lieu ou ne répondent pas.
 * À Abomey-Calavi, l'arrondissement est rattaché par proximité du chef-lieu (limites absentes d'OSM).
 */
type GazetteerEntry = { title: string; type: string; arr: string; commune: string; latitude: number; longitude: number };
const GAZETTEER = gazetteerData as GazetteerEntry[];
const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const gazetteerPlace = (g: GazetteerEntry, i: number) => ({
  id: `gaz${i}`,
  title: g.title,
  subtitle: g.commune === "Cotonou" ? `${g.type}, ${g.arr}, Cotonou` : `${g.type}, arrondissement de ${g.arr}, Abomey-Calavi`,
  latitude: g.latitude,
  longitude: g.longitude,
});

const distanceKm = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

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

  /** Quartier ou village connu le plus proche d'un point (distance maximale en km). */
  nearestKnownPlace(latitude: number, longitude: number, maxKm = 0.7) {
    let best: { g: GazetteerEntry; d: number } | null = null;
    for (const g of GAZETTEER) {
      const d = distanceKm(latitude, longitude, g.latitude, g.longitude);
      if (d <= maxKm && (!best || d < best.d)) best = { g, d };
    }
    return best?.g ?? null;
  }

  async reverseGeocode(latitude: number, longitude: number) {
    const known = this.nearestKnownPlace(latitude, longitude);
    if (known) {
      const where = known.commune === "Cotonou" ? `${known.arr}, Cotonou` : `${known.arr}, Abomey-Calavi`;
      const address = `${known.title}, ${where}`;
      return { address, fullAddress: address, latitude, longitude };
    }
    // On essaie le niveau le plus précis (rue, quartier), puis des niveaux plus larges (village, arrondissement, commune)
    // pour les zones reculées où OpenStreetMap n'a pas de détail à l'échelle de la rue.
    for (const zoom of [18, 14, 10]) {
      try {
        const data = await this.getJson(
          `${this.base}/reverse?format=jsonv2&zoom=${zoom}&addressdetails=1&accept-language=fr&lat=${latitude}&lon=${longitude}`
        );
        if (data?.error) continue;
        const a = data.address ?? {};
        const area = a.neighbourhood ?? a.suburb ?? a.quarter ?? a.hamlet ?? a.village ?? a.locality ?? a.city_district ?? a.road;
        const arrondissement = a.city_district ?? a.suburb;
        const city = a.city ?? a.town ?? a.municipality ?? a.county ?? a.state_district ?? a.state;
        const parts = [area, arrondissement, city].filter((p, i, arr) => p && arr.indexOf(p) === i);
        if (!parts.length && !data.display_name) continue;
        const address = parts.length ? parts.join(", ") : String(data.display_name).split(",").slice(0, 3).join(",").trim();
        return { address, fullAddress: data.display_name ?? address, latitude, longitude };
      } catch {
        // service de cartes lent ou indisponible : on essaie le niveau suivant, puis le repli ci-dessous
      }
    }

    // Repli : la ville connue la plus proche, pour que l'adresse reste lisible même sans réponse du service
    const near = [...BENIN_TOWNS, ...BENIN_DEFAULT_PLACES].map((p) => ({ p, d: distanceKm(latitude, longitude, p.latitude, p.longitude) })).sort((x, y) => x.d - y.d)[0];
    const label = near && near.d < 40 ? `Près de ${near.p.title}` : "Position sur la carte";
    return {
      address: label,
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

    // Quartiers et villages peu référencés : on relance avec le pays dans la requête, puis avec le dernier mot seul
    if (onlineResults.length < 3) {
      const variants = [`${query}, Bénin`];
      const words = query.split(/\s+/).filter(Boolean);
      if (words.length > 1) variants.push(words[words.length - 1]);
      for (const v of variants) {
        try {
          const more = await this.searchNominatim(v, lat, lng);
          onlineResults = this.dedupe([...onlineResults, ...more]);
          if (onlineResults.length >= 3) break;
        } catch (e) {
          // variante sans résultat : on passe à la suivante
        }
      }
    }

    // Recherche locale de fallback (Bénin) si résultats en ligne faibles ou indisponibles
    const normalizedQ = query.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const localMatches = [...BENIN_DEFAULT_PLACES, ...BENIN_TOWNS].filter((p) => {
      const titleNorm = p.title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const subNorm = p.subtitle.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return titleNorm.includes(normalizedQ) || subNorm.includes(normalizedQ);
    });

    // Quartiers / villages connus : le nom, ou le nom de l'arrondissement (ex. « Togba » liste ses quartiers)
    const words = normalizedQ.split(/[^a-z0-9]+/).filter(Boolean);
    const known = GAZETTEER.map((g, i) => ({ g, i, t: norm(g.title), a: norm(g.arr) }))
      .filter(({ t, a }) => words.length > 0 && words.every((w) => t.includes(w) || a.includes(w)))
      .sort((x, y) => Number(y.t.startsWith(words[0] ?? "")) - Number(x.t.startsWith(words[0] ?? "")) || x.t.length - y.t.length)
      .slice(0, 8)
      .map(({ g, i }) => gazetteerPlace(g, i));

    // Ordre : quartiers/villages dont le nom commence par la saisie, puis TOUS les résultats en ligne (pharmacies, commerces,
    // écoles… dans l'ordre de pertinence des services de cartes), puis le reste des quartiers connus, puis la liste de secours.
    const la0 = Number(lat);
    const lo0 = Number(lng);
    const hasPos = !!lat && !!lng && Number.isFinite(la0) && Number.isFinite(lo0);
    const byDistance = (arr: any[]) =>
      hasPos ? [...arr].sort((x, y) => distanceKm(la0, lo0, Number(x.latitude), Number(x.longitude)) - distanceKm(la0, lo0, Number(y.latitude), Number(y.longitude))) : arr;
    const knownSorted = byDistance(known);
    const q0 = words[0] ?? "";
    const knownFirst = knownSorted.filter((k) => norm(k.title).startsWith(q0)).slice(0, 4);
    const knownRest = knownSorted.filter((k) => !knownFirst.includes(k));
    const combined = this.dedupe([...knownFirst, ...onlineResults, ...knownRest, ...byDistance(localMatches)]).slice(0, 16);
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
      `${this.base}/search?format=jsonv2&addressdetails=1&limit=10&dedupe=1&accept-language=fr` +
      `&countrycodes=${this.countries}&q=${encodeURIComponent(query)}`;
    const la = Number(lat),
      lo = Number(lng);
    if (lat && lng && Number.isFinite(la) && Number.isFinite(lo)) {
      // fenêtre élargie (≈ 100 km) : les quartiers et villages éloignés de la personne restent trouvés
      url += `&viewbox=${lo - 1},${la + 1},${lo + 1},${la - 1}&bounded=0`;
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
      limit: "15",
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