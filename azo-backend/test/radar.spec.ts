import {
  buildRadar,
  describeRadius,
  haversineKm,
  isRideExpired,
  rideAgeMinutes,
} from "../src/rides/radar";

/**
 * Tests du radar des demandes — logique pure (temps + proximité), sans base de données.
 *
 * Le filtrage par véhicule (`PricingService.rideVisibleFor`) est testé dans
 * `test/pricing.spec.ts` ; ici on vérifie ce que le radar fait ensuite : expiration des
 * demandes trop anciennes, rayon de recherche autour du chauffeur, classement, et les
 * informations affichées dans l'application (âge, temps restant, distance).
 */

type Ride = {
  id: string;
  createdAt: string;
  originLat: number;
  originLng: number;
  vehicleType: string;
};

const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60000).toISOString();

// Cotonou : Étoile Rouge, Dantokpa, Aéroport — points réels, écarts de quelques km.
const ETOILE = { latitude: 6.3725, longitude: 2.4061 };
const DANTOKPA = { latitude: 6.3728, longitude: 2.4339 };
const AEROPORT = { latitude: 6.3572, longitude: 2.3844 };

const ride = (id: string, ageMinutes: number, position = ETOILE): Ride => ({
  id,
  createdAt: minutesAgo(ageMinutes),
  originLat: position.latitude,
  originLng: position.longitude,
  vehicleType: "ZEM_ESSENCE",
});

describe("Radar — calculs de base", () => {
  it("mesure l'âge d'une demande en minutes", () => {
    expect(Math.round(rideAgeMinutes(minutesAgo(7), NOW))).toBe(7);
    expect(rideAgeMinutes(NOW, NOW)).toBe(0);
    // Une horloge serveur en avance ne doit jamais produire un âge négatif.
    expect(rideAgeMinutes(new Date(NOW + 60000).toISOString(), NOW)).toBe(0);
  });

  it("considère une demande expirée à partir du délai configuré", () => {
    expect(isRideExpired(minutesAgo(19.9), 20, NOW)).toBe(false);
    expect(isRideExpired(minutesAgo(20), 20, NOW)).toBe(true);
    expect(isRideExpired(minutesAgo(45), 20, NOW)).toBe(true);
  });

  it("calcule la distance à vol d'oiseau (Haversine) entre deux points de Cotonou", () => {
    // Étoile Rouge → Dantokpa : environ 3,1 km ; Étoile Rouge → Aéroport : environ 3,0 km.
    const versDantokpa = haversineKm(ETOILE, DANTOKPA);
    const versAeroport = haversineKm(ETOILE, AEROPORT);
    expect(versDantokpa).toBeGreaterThan(2.8);
    expect(versDantokpa).toBeLessThan(3.4);
    expect(versAeroport).toBeGreaterThan(2.6);
    expect(versAeroport).toBeLessThan(3.4);
    // Distance nulle pour un même point.
    expect(haversineKm(ETOILE, ETOILE)).toBe(0);
  });
});

describe("Radar — expiration des demandes", () => {
  it("écarte les demandes trop anciennes et les rend à annuler", () => {
    const rides = [ride("jeune", 3), ride("limite", 19), ride("vieille", 25), ride("très-vieille", 90)];
    const { rides: visibles, expired } = buildRadar(rides, {
      now: NOW,
      expiryMinutes: 20,
      radiusKm: 0,
    });
    // Sans position connue, le classement va du plus ancien au plus récent.
    expect(visibles.map((r) => r.id)).toEqual(["limite", "jeune"]);
    expect(expired.map((r) => r.id)).toEqual(["vieille", "très-vieille"]);
  });

  it("indique le temps restant avant expiration", () => {
    const { rides: visibles } = buildRadar([ride("a", 5), ride("b", 19)], {
      now: NOW,
      expiryMinutes: 20,
      radiusKm: 0,
    });
    const parId = Object.fromEntries(visibles.map((r) => [r.id, r]));
    expect(parId.a.ageMinutes).toBe(5);
    expect(parId.a.expiresInMinutes).toBe(15);
    expect(parId.b.ageMinutes).toBe(19);
    expect(parId.b.expiresInMinutes).toBe(1);
    expect(visibles.every((r) => r.expiresInMinutes >= 0)).toBe(true);
  });
});

describe("Radar — proximité du chauffeur", () => {
  it("classe les demandes de la plus proche à la plus lointaine", () => {
    const rides = [ride("aeroport", 1, AEROPORT), ride("dantokpa", 2, DANTOKPA)];
    const { rides: visibles } = buildRadar(rides, {
      now: NOW,
      expiryMinutes: 20,
      radiusKm: 0,
      driver: ETOILE,
    });
    // L'ordre attendu est recalculé ici indépendamment, à partir de la même formule.
    const attendu = ["aeroport", "dantokpa"].sort(
      (a, b) =>
        haversineKm(ETOILE, a === "aeroport" ? AEROPORT : DANTOKPA) -
        haversineKm(ETOILE, b === "aeroport" ? AEROPORT : DANTOKPA)
    );
    expect(visibles.map((r) => r.id)).toEqual(attendu);
    // Les distances affichées sont bien croissantes.
    const distances = visibles.map((r) => r.distanceKm ?? 0);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  it("écarte les demandes hors du rayon de recherche", () => {
    const rides = [ride("proche", 1, DANTOKPA), ride("loin", 2, AEROPORT)];
    const { rides: visibles } = buildRadar(rides, {
      now: NOW,
      expiryMinutes: 20,
      radiusKm: 3.05, // coupe entre Dantokpa (~3,06 km) et l'Aéroport (~3,00 km)
      driver: ETOILE,
    });
    // Une seule des deux doit rester, et c'est bien la plus proche des deux.
    expect(visibles).toHaveLength(1);
    expect(visibles[0].distanceKm).toBeLessThanOrEqual(3.05);
  });

  it("rayon à 0 = aucune limite (démonstration sur une grande ville)", () => {
    const rides = [ride("cotonou", 1, ETOILE), ride("porto-novo", 2, { latitude: 6.497, longitude: 2.605 })];
    const { rides: visibles } = buildRadar(rides, {
      now: NOW,
      expiryMinutes: 20,
      radiusKm: 0,
      driver: ETOILE,
    });
    expect(visibles).toHaveLength(2);
    expect(visibles[0].distanceKm).toBe(0);
    expect(visibles[1].distanceKm).toBeGreaterThan(20);
  });

  it("sans position connue : aucune demande écartée, classement du plus ancien au plus récent", () => {
    const rides = [ride("recente", 1, DANTOKPA), ride("ancienne", 10, AEROPORT)];
    const { rides: visibles } = buildRadar(rides, {
      now: NOW,
      expiryMinutes: 20,
      radiusKm: 5,
    });
    expect(visibles.map((r) => r.id)).toEqual(["ancienne", "recente"]);
    expect(visibles.every((r) => r.distanceKm === null)).toBe(true);
  });

  it("à distance égale, la demande la plus ancienne passe devant", () => {
    const rides = [ride("recente", 1), ride("ancienne", 5)];
    const { rides: visibles } = buildRadar(rides, {
      now: NOW,
      expiryMinutes: 20,
      radiusKm: 0,
      driver: ETOILE,
    });
    expect(visibles.map((r) => r.id)).toEqual(["ancienne", "recente"]);
  });

  it("arrondit la distance au dixième de kilomètre (affichage « à 3,1 km »)", () => {
    const { rides: visibles } = buildRadar([ride("dantokpa", 1, DANTOKPA)], {
      now: NOW,
      expiryMinutes: 20,
      radiusKm: 0,
      driver: ETOILE,
    });
    expect(visibles[0].distanceKm).toBe(Math.round(haversineKm(ETOILE, DANTOKPA) * 10) / 10);
  });
});

describe("Radar — garde-fous", () => {
  it("ne modifie pas les demandes d'origine (aucun effet de bord)", () => {
    const origine = ride("a", 2);
    const copie = { ...origine };
    buildRadar([origine], { now: NOW, expiryMinutes: 20, radiusKm: 0, driver: ETOILE });
    expect(origine).toEqual(copie);
  });

  it("supporte un radar vide", () => {
    const { rides: visibles, expired } = buildRadar([], { now: NOW, expiryMinutes: 20, radiusKm: 5 });
    expect(visibles).toEqual([]);
    expect(expired).toEqual([]);
  });

  it("applique un délai d'expiration au minimum de 1 minute", () => {
    // Une valeur aberrante (0 ou négative) ne doit pas vider le radar instantanément.
    const { rides: visibles } = buildRadar([ride("a", 0.5)], {
      now: NOW,
      expiryMinutes: 0,
      radiusKm: 0,
    });
    expect(visibles).toHaveLength(1);
  });

  it("décrit le rayon de recherche pour l'interface", () => {
    expect(describeRadius(8)).toBe("dans un rayon de 8 km");
    expect(describeRadius(0)).toBe("autour de toi");
  });
});
