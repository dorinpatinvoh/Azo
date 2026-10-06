import { PricingService } from "../src/pricing/pricing.service";
import {
  provisionalRules,
  loadTarificationConfig,
  valueAtPath,
} from "../src/pricing/tarification.config";

/**
 * Tests unitaires de la tarification AZƆ̀ (spécification « Tarifs et profils »).
 *
 * Deux filières distinctes :
 *   - les MOTOS-TAXIS (Zem) : ZEM_ESSENCE et ZEM_ELECTRIC — **mêmes paliers kilométriques**
 *     (70 F/km de 0 à 15 km, 60 F/km de 16 à 25 km, 50 F/km à partir du 26e km, dernier
 *     palier) ; **seule la base diffère** : 150 F à essence, 100 F en électrique ;
 *   - les VOITURES : GAZELLE (800 + 200/km), KOALA (1 200 + 375/km),
 *     LEOPARD (2 500 + 900/km), avec le palier à 15 km et sans remise de base.
 *
 * Exemples voitures de la spécification repris tels quels :
 *   - 10 km : 800 + 10 × 200 = 2 800
 *   - 20 km : 800 + 15 × 200 + 5 × 150 = 4 550
 *   - LEOPARD 20 km : 2 500 + 15 × 900 + 5 × 800 = 20 000
 */
describe("PricingService — prix d'une course (point 1 de la spec)", () => {
  const pricing = new PricingService(loadTarificationConfig());

  it("GAZELLE 10 km = 2 800 FCFA", () => {
    expect(pricing.ridePrice(10, "GAZELLE")).toBe(2800);
  });

  it("GAZELLE 20 km = 4 550 FCFA (tranche 1 puis tranche 2)", () => {
    expect(pricing.ridePrice(20, "GAZELLE")).toBe(4550);
  });

  it("LEOPARD 20 km = 20 000 FCFA", () => {
    expect(pricing.ridePrice(20, "LEOPARD")).toBe(20000);
  });

  it("KOALA 10 km = 4 950 FCFA (1 200 + 10 × 375)", () => {
    expect(pricing.ridePrice(10, "KOALA")).toBe(4950);
  });

  it("KOALA 20 km = 8 575 FCFA (1 200 + 15 × 375 + 5 × 350)", () => {
    expect(pricing.ridePrice(20, "KOALA")).toBe(8575);
  });

  it("LEOPARD 10 km = 11 500 FCFA (2 500 + 10 × 900)", () => {
    expect(pricing.ridePrice(10, "LEOPARD")).toBe(11500);
  });

  it("facture le tarif de base seul pour une distance nulle", () => {
    expect(pricing.ridePrice(0, "GAZELLE")).toBe(800);
    expect(pricing.ridePrice(0, "KOALA")).toBe(1200);
    expect(pricing.ridePrice(0, "LEOPARD")).toBe(2500);
  });

  it("applique exactement le seuil de 15 km à la première tranche", () => {
    // 15 km : toute la distance au prix « 0 à 15 km »
    expect(pricing.ridePrice(15, "GAZELLE")).toBe(800 + 15 * 200);
    // 16 km : 15 km + 1 km à partir du 16e
    expect(pricing.ridePrice(16, "GAZELLE")).toBe(800 + 15 * 200 + 1 * 150);
  });

  it("ne dépasse jamais une tranche (1 000 km GAZELLE)", () => {
    expect(pricing.ridePrice(1000, "GAZELLE")).toBe(800 + 15 * 200 + 985 * 150);
  });

  it("tronque le coût kilométrique (FCFA entiers, pas d'arrondi)", () => {
    // 10,5 km GAZELLE : floor(10,5 × 200) = 2 100
    expect(pricing.ridePrice(10.5, "GAZELLE")).toBe(2900);
    // 20,9 km GAZELLE : floor(20,9 - 15 = 5,9) → floor(5,9 × 150) = 885
    expect(pricing.ridePrice(20.9, "GAZELLE")).toBe(800 + 15 * 200 + 885);
  });

  it("expose le détail du calcul poste par poste (une ligne par palier)", () => {
    const detail = pricing.breakdown(20, "GAZELLE");
    expect(detail).toMatchObject({
      gamme: "GAZELLE",
      family: "CAR",
      base: 800,
      baseFull: 800,
      baseDiscountPct: 0,
      baseDiscountApplied: false,
      baseDiscountAboveKm: null,
      price: 4550,
      currency: "FCFA",
    });
    expect(detail.brackets).toEqual([
      { upToKm: 15, perKm: 200, km: 15, amount: 3000 },
      { upToKm: null, perKm: 150, km: 5, amount: 750 },
    ]);
  });

  it("KOALA est la gamme climatisée", () => {
    expect(pricing.getVehiclePricing("KOALA").airConditioned).toBe(true);
    expect(pricing.vehicleLabel("KOALA")).toBe("KOALA (climatisé)");
    expect(pricing.getVehiclePricing("GAZELLE").airConditioned).toBeUndefined();
  });

  it("refuse un véhicule inconnu et une distance négative", () => {
    expect(() => pricing.ridePrice(5, "FUSEE")).toThrow(/inconnu/i);
    expect(() => pricing.ridePrice(-1, "GAZELLE")).toThrow(/positif/i);
  });

  it("convertit les anciens types de véhicules encore en base", () => {
    // « ZEM » (moto-taxi historique) → Zem à essence ; « CAR » → voiture Koala.
    expect(pricing.resolveVehicleKey("ZEM")).toBe("ZEM_ESSENCE");
    expect(pricing.resolveVehicleKey("CAR")).toBe("KOALA");
    expect(pricing.resolveVehicleKey("gazelle")).toBe("GAZELLE");
    expect(pricing.resolveVehicleKey("ZEM_ELECTRIC")).toBe("ZEM_ELECTRIC");
  });
});

describe("PricingService — filière Zem (motos-taxis)", () => {
  const pricing = new PricingService(loadTarificationConfig());

  it("les deux Zem partagent les paliers kilométriques ; seule la base diffère", () => {
    const essence = pricing.getVehiclePricing("ZEM_ESSENCE");
    const electrique = pricing.getVehiclePricing("ZEM_ELECTRIC");
    // Bases distinctes : 150 F à essence, 100 F en électrique
    expect(essence.base).toBe(150);
    expect(electrique.base).toBe(100);
    // Aucune remise de base dans le barème en vigueur
    expect(essence.baseDiscount).toBeUndefined();
    expect(electrique.baseDiscount).toBeUndefined();
    // Paliers STRICTEMENT identiques : mêmes bornes ET mêmes tarifs au kilomètre
    expect(essence.brackets).toEqual([
      { upToKm: 15, perKm: 70 },
      { upToKm: 25, perKm: 60 },
      { upToKm: null, perKm: 50 },
    ]);
    expect(electrique.brackets).toEqual(essence.brackets);
    // Distance nulle : seule la base est due
    expect(pricing.ridePrice(0, "ZEM_ESSENCE")).toBe(150);
    expect(pricing.ridePrice(0, "ZEM_ELECTRIC")).toBe(100);
  });

  it("premier palier : 70 F/km de 0 à 15 km", () => {
    // 5 km : essence 150 + 5 × 70 = 500 · électrique 100 + 350 = 450
    expect(pricing.ridePrice(5, "ZEM_ESSENCE")).toBe(500);
    expect(pricing.ridePrice(5, "ZEM_ELECTRIC")).toBe(450);
    // 15 km : essence 150 + 15 × 70 = 1 200 · électrique 100 + 1 050 = 1 150
    expect(pricing.ridePrice(15, "ZEM_ESSENCE")).toBe(1200);
    expect(pricing.ridePrice(15, "ZEM_ELECTRIC")).toBe(1150);
  });

  it("deuxième palier : 60 F/km de 16 à 25 km", () => {
    // 16 km : essence 150 + 1 050 + 60 = 1 260 · électrique 100 + 1 050 + 60 = 1 210
    expect(pricing.ridePrice(16, "ZEM_ESSENCE")).toBe(1260);
    expect(pricing.ridePrice(16, "ZEM_ELECTRIC")).toBe(1210);
    // 25 km : essence 150 + 1 050 + 10 × 60 = 1 800 · électrique 1 750
    expect(pricing.ridePrice(25, "ZEM_ESSENCE")).toBe(1800);
    expect(pricing.ridePrice(25, "ZEM_ELECTRIC")).toBe(1750);
  });

  it("troisième palier : 50 F/km à partir du 26e km (dernier palier)", () => {
    // 26 km : essence 150 + 1 050 + 600 + 50 = 1 850 · électrique 1 800
    expect(pricing.ridePrice(26, "ZEM_ESSENCE")).toBe(1850);
    expect(pricing.ridePrice(26, "ZEM_ELECTRIC")).toBe(1800);
    // 30 km : essence 150 + 1 050 + 600 + 5 × 50 = 2 050 · électrique 2 000
    expect(pricing.ridePrice(30, "ZEM_ESSENCE")).toBe(2050);
    expect(pricing.ridePrice(30, "ZEM_ELECTRIC")).toBe(2000);
    // 100 km : essence 150 + 1 050 + 600 + 75 × 50 = 5 550 · électrique 5 500
    expect(pricing.ridePrice(100, "ZEM_ESSENCE")).toBe(5550);
    expect(pricing.ridePrice(100, "ZEM_ELECTRIC")).toBe(5500);
  });

  it("l'électrique est exactement 50 F moins cher, quelle que soit la distance", () => {
    // Mêmes kilomètres facturés et mêmes tarifs au km : le seul écart est la base
    for (const km of [0, 3, 10, 15, 16, 25, 26, 30, 60, 100]) {
      const essence = pricing.ridePrice(km, "ZEM_ESSENCE");
      const electrique = pricing.ridePrice(km, "ZEM_ELECTRIC");
      expect(essence - electrique).toBe(50);
      expect(electrique).toBeLessThan(essence);
    }
  });

  it("détaille les trois paliers Zem, sans remise de base", () => {
    const detail = pricing.breakdown(30, "ZEM_ESSENCE");
    expect(detail).toMatchObject({
      gamme: "ZEM_ESSENCE",
      family: "ZEM",
      base: 150,
      baseFull: 150,
      baseDiscountPct: 0,
      baseDiscountApplied: false,
      baseDiscountAboveKm: null,
      price: 2050,
      currency: "FCFA",
    });
    expect(detail.brackets).toEqual([
      { upToKm: 15, perKm: 70, km: 15, amount: 1050 },
      { upToKm: 25, perKm: 60, km: 10, amount: 600 },
      { upToKm: null, perKm: 50, km: 5, amount: 250 },
    ]);

    // À 15 km et moins : seul le premier palier est facturé
    const court = pricing.breakdown(8, "ZEM_ELECTRIC");
    expect(court.base).toBe(100);
    expect(court.baseDiscountApplied).toBe(false);
    expect(court.brackets.map((b) => b.km)).toEqual([8, 0, 0]);

    // Électrique : mêmes kilomètres et MÊMES tarifs au km, base 50 F plus basse
    const electrique = pricing.breakdown(30, "ZEM_ELECTRIC");
    expect(electrique.brackets).toEqual(detail.brackets);
    expect(electrique.base).toBe(100);
    expect(electrique.price).toBe(2000);
    expect(detail.price - electrique.price).toBe(50);
  });

  it("classe les deux Zem dans la famille ZEM et les voitures dans la famille CAR", () => {
    expect(pricing.vehicleFamily("ZEM_ESSENCE")).toBe("ZEM");
    expect(pricing.vehicleFamily("ZEM_ELECTRIC")).toBe("ZEM");
    for (const car of ["GAZELLE", "KOALA", "LEOPARD"]) {
      expect(pricing.vehicleFamily(car)).toBe("CAR");
      expect(pricing.isZem(car)).toBe(false);
    }
    expect(pricing.isZem("ZEM_ESSENCE")).toBe(true);
    expect(pricing.isZem("ZEM_ELECTRIC")).toBe(true);
    expect(pricing.isZem(null)).toBe(false);
    expect(pricing.zemVehicleKeys()).toEqual(["ZEM_ESSENCE", "ZEM_ELECTRIC"]);
  });

  it("le détail du calcul indique la famille du véhicule", () => {
    expect(pricing.breakdown(10, "ZEM_ELECTRIC").family).toBe("ZEM");
    expect(pricing.breakdown(10, "LEOPARD").family).toBe("CAR");
  });

  it("les voitures ne subissent aucune remise de base", () => {
    for (const car of ["GAZELLE", "KOALA", "LEOPARD"] as const) {
      expect(pricing.getVehiclePricing(car).baseDiscount).toBeUndefined();
      const detail = pricing.breakdown(40, car);
      expect(detail.baseDiscountApplied).toBe(false);
      expect(detail.base).toBe(detail.baseFull);
    }
  });

  it("radar strict : chaque véhicule ne voit que ses propres demandes", () => {
    // Zem essence ⇄ Zem électrique : deux véhicules distincts
    expect(pricing.rideVisibleFor("ZEM_ESSENCE", "ZEM_ESSENCE")).toBe(true);
    expect(pricing.rideVisibleFor("ZEM_ESSENCE", "ZEM_ELECTRIC")).toBe(false);
    expect(pricing.rideVisibleFor("ZEM_ELECTRIC", "ZEM_ELECTRIC")).toBe(true);
    // Voitures : correspondance exacte, jamais de mélange Zem / voiture
    expect(pricing.rideVisibleFor("KOALA", "KOALA")).toBe(true);
    expect(pricing.rideVisibleFor("KOALA", "GAZELLE")).toBe(false);
    expect(pricing.rideVisibleFor("ZEM_ESSENCE", "GAZELLE")).toBe(false);
    expect(pricing.rideVisibleFor("GAZELLE", "ZEM_ELECTRIC")).toBe(false);
    // Un ancien type encore en base reste résolu (ZEM → Zem essence)
    expect(pricing.rideVisibleFor("ZEM_ESSENCE", "ZEM")).toBe(true);
    // Compte historique sans véhicule déclaré : rien n'est masqué
    expect(pricing.rideVisibleFor(null, "GAZELLE")).toBe(true);
  });

  it("radar souple (strictVehicleMatch = false) : les deux Zem partagent leurs demandes", () => {
    const souple = new PricingService({
      ...loadTarificationConfig(),
      radar: { strictVehicleMatch: false },
    });
    expect(souple.rideVisibleFor("ZEM_ESSENCE", "ZEM_ELECTRIC")).toBe(true);
    expect(souple.rideVisibleFor("ZEM_ELECTRIC", "ZEM_ESSENCE")).toBe(true);
    // Les voitures restent filtrées par gamme exacte
    expect(souple.rideVisibleFor("KOALA", "GAZELLE")).toBe(false);
    expect(souple.rideVisibleFor("GAZELLE", "GAZELLE")).toBe(true);
  });

  it("le tarif des Zem est une règle validée, pas une valeur provisoire", () => {
    const config = loadTarificationConfig();
    const règles = provisionalRules(config).map((r) => r.chemin);
    expect(règles.some((chemin) => chemin.includes("ZEM_ESSENCE"))).toBe(false);
    expect(règles.some((chemin) => chemin.includes("ZEM_ELECTRIC"))).toBe(false);
    expect(config.radar?.strictVehicleMatch).toBe(true);
  });
});

describe("PricingService — niveaux d'agence (point 3 de la spec)", () => {
  const pricing = new PricingService(loadTarificationConfig());

  // Un cas par niveau : frais d'activation uniques, commission par course,
  // frais par retrait, limite de comptes.
  const levels = [
    { level: "PRO", activationFee: 100000, commissionPct: 3, withdrawalPct: 1, maxAccounts: 25 },
    { level: "SILVER", activationFee: 215500, commissionPct: 2.5, withdrawalPct: 0.75, maxAccounts: 50 },
    { level: "OR", activationFee: 450500, commissionPct: 2, withdrawalPct: 0.5, maxAccounts: 100 },
    { level: "DIAMANT", activationFee: 600500, commissionPct: 1, withdrawalPct: 0.25, maxAccounts: 1000 },
  ] as const;

  it.each(levels)(
    "niveau $level : activation $activationFee FCFA, commission $commissionPct %, retrait $withdrawalPct %, $maxAccounts comptes",
    ({ level, activationFee, commissionPct, withdrawalPct, maxAccounts }) => {
      expect(pricing.agencyActivationFee(level)).toBe(activationFee);
      expect(pricing.agencyMaxAccounts(level)).toBe(maxAccounts);
      expect(pricing.getAgencyLevel(level).commissionPct).toBe(commissionPct);
      expect(pricing.getAgencyLevel(level).withdrawalFeePct).toBe(withdrawalPct);
    }
  );

  it.each(levels)("niveau $level : commission prélevée sur une course de 10 000 FCFA", ({ level, commissionPct }) => {
    expect(pricing.agencyCommission(level, 10000)).toBe(Math.floor(10000 * (commissionPct / 100)));
  });

  it.each(levels)(
    "niveau $level : frais prélevés sur un retrait de 100 000 FCFA",
    ({ level, withdrawalPct }) => {
      const fees = pricing.agencyWithdrawalFees(level, 100000);
      expect(fees.feePct).toBe(withdrawalPct);
      expect(fees.fee).toBe(Math.floor(100000 * (withdrawalPct / 100)));
      expect(fees.netAmount).toBe(100000 - fees.fee);
    }
  );

  it("refuse toute création de compte au-delà de la limite du niveau", () => {
    // PRO : 25 comptes maximum
    expect(pricing.canAgencyAddAccount("PRO", 24)).toBe(true);
    expect(pricing.canAgencyAddAccount("PRO", 25)).toBe(false);
    expect(pricing.agencyRemainingAccounts("PRO", 25)).toBe(0);
    expect(pricing.agencyRemainingAccounts("PRO", 30)).toBe(0);
    // DIAMANT : 1 000 comptes
    expect(pricing.canAgencyAddAccount("DIAMANT", 999)).toBe(true);
    expect(pricing.canAgencyAddAccount("DIAMANT", 1000)).toBe(false);
  });

  it("une agence n'opère qu'une fois les frais d'activation payés", () => {
    expect(pricing.agencyCanOperate({ plan: "PRO", feePaidAt: null })).toBe(false);
    expect(pricing.agencyCanOperate({ plan: "PRO" })).toBe(false);
    expect(pricing.agencyCanOperate({ plan: "PRO", feePaidAt: new Date() })).toBe(true);
  });

  it("refuse un niveau d'agence inconnu (les niveaux ne concernent que les agences)", () => {
    expect(() => pricing.agencyActivationFee("PLATINE")).toThrow(/inconnu/i);
  });
});

describe("PricingService — profils prestataires (point 2 de la spec)", () => {
  const pricing = new PricingService(loadTarificationConfig());

  it("ZEM_INDEPENDANT : 15 % des revenus du mois (calcul mensuel, pas par course)", () => {
    expect(pricing.monthlyRevenueShare("ZEM_INDEPENDANT", 200000)).toBe(30000);
    expect(pricing.monthlyRevenueShare("ZEM_INDEPENDANT", 123456)).toBe(Math.floor(123456 * 0.15));
    // Calcul mensuel : aucune commission par course pour ce profil
    expect(pricing.rideCommission({ profile: "ZEM_INDEPENDANT" }, 10000)).toBe(0);
  });

  it("ZEM_INDEPENDANT : 1,5 % prélevés sur chaque retrait", () => {
    const fees = pricing.profileWithdrawalFees("ZEM_INDEPENDANT", 100000);
    expect(fees.feePct).toBe(1.5);
    expect(fees.fee).toBe(1500);
    expect(fees.netAmount).toBe(98500);
  });

  it("LIVREUR et COURSIER : catégorie INDEPENDANT_PERSONNEL", () => {
    expect(pricing.profileCategory("LIVREUR")).toBe("INDEPENDANT_PERSONNEL");
    expect(pricing.profileCategory("COURSIER")).toBe("INDEPENDANT_PERSONNEL");
  });

  it("LIVREUR et COURSIER : frais de retrait identiques au Zem indépendant (1,5 %)", () => {
    for (const profile of ["LIVREUR", "COURSIER"]) {
      const fees = pricing.profileWithdrawalFees(profile, 100000);
      expect(fees.feePct).toBe(1.5);
      expect(fees.fee).toBe(1500);
      expect(fees.netAmount).toBe(98500);
      // Identiques au Zem indépendant, règle validée
      expect(fees).toEqual(pricing.profileWithdrawalFees("ZEM_INDEPENDANT", 100000));
    }
  });

  it("LIVREUR et COURSIER : part mensuelle et commission par course encore à définir (0 provisoire)", () => {
    for (const profile of ["LIVREUR", "COURSIER"]) {
      // Valeurs provisoires : le 0 ne veut PAS dire « aucun frais, définitivement ».
      expect(pricing.monthlyRevenueShare(profile, 200000)).toBe(0);
      expect(pricing.rideCommission({ profile }, 10000)).toBe(0);
      expect(pricing.getConfig().profiles[profile as "LIVREUR"]._aDefinir?.length).toBeGreaterThan(0);
    }
  });

  it("préfère la règle du profil, sinon celle de l'agence de rattachement, sinon rien", () => {
    // Zem indépendant rattaché à une agence OR : le profil reste prioritaire
    expect(pricing.withdrawalFeesFor({ profile: "ZEM_INDEPENDANT", agencyLevel: "OR" }, 100000).fee).toBe(1500);
    // Conducteur rattaché à une agence : frais du niveau
    expect(pricing.withdrawalFeesFor({ profile: null, agencyLevel: "OR" }, 100000).fee).toBe(500);
    // Profil non décrit par la spécification : aucun prélèvement
    expect(pricing.withdrawalFeesFor({ profile: null, agencyLevel: null }, 100000).fee).toBe(0);
  });
});

describe("Configuration tarifaire", () => {
  it("porte les valeurs de référence de la spécification", () => {
    const config = loadTarificationConfig();
    expect(config.currency).toBe("FCFA");
    expect(config.vehicles.GAZELLE).toEqual({
      base: 800,
      family: "CAR",
      brackets: [
        { upToKm: 15, perKm: 200 },
        { upToKm: null, perKm: 150 },
      ],
    });
    expect(config.vehicles.KOALA).toMatchObject({
      base: 1200,
      family: "CAR",
      brackets: [
        { upToKm: 15, perKm: 375 },
        { upToKm: null, perKm: 350 },
      ],
    });
    expect(config.vehicles.LEOPARD).toMatchObject({
      base: 2500,
      family: "CAR",
      brackets: [
        { upToKm: 15, perKm: 900 },
        { upToKm: null, perKm: 800 },
      ],
    });
    // Motos-taxis : mêmes paliers kilométriques, seule la base diffère
    expect(config.vehicles.ZEM_ESSENCE).toEqual({
      base: 150,
      family: "ZEM",
      brackets: [
        { upToKm: 15, perKm: 70 },
        { upToKm: 25, perKm: 60 },
        { upToKm: null, perKm: 50 },
      ],
    });
    expect(config.vehicles.ZEM_ELECTRIC).toEqual({
      base: 100,
      family: "ZEM",
      brackets: [
        { upToKm: 15, perKm: 70 },
        { upToKm: 25, perKm: 60 },
        { upToKm: null, perKm: 50 },
      ],
    });
    // Les deux Zem partagent exactement les mêmes paliers ; l'électrique n'a que la base en moins
    expect(config.vehicles.ZEM_ELECTRIC.brackets).toEqual(config.vehicles.ZEM_ESSENCE.brackets);
    expect(config.vehicles.ZEM_ELECTRIC.base).toBeLessThan(config.vehicles.ZEM_ESSENCE.base);
    expect(Object.keys(config.agencyLevels)).toEqual(["PRO", "SILVER", "OR", "DIAMANT"]);
    expect(config.profiles.ZEM_INDEPENDANT).toMatchObject({ monthlyRevenueSharePct: 15, withdrawalFeePct: 1.5 });
  });

  it("déclare chaque valeur provisoire « règle à définir », avec sa valeur exacte", () => {
    const config = loadTarificationConfig();
    const règles = provisionalRules(config);
    // Aucune règle validée ne doit être marquée « à définir », et inversement :
    // chaque valeur provisoire est listée pour ne pas être confondue avec une règle.
    expect(règles.map((r) => r.chemin).sort()).toEqual([
      "delivery.commissionPct",
      "profiles.COURSIER.monthlyRevenueSharePct",
      "profiles.COURSIER.rideCommissionPct",
      "profiles.LIVREUR.monthlyRevenueSharePct",
      "profiles.LIVREUR.rideCommissionPct",
    ]);
    for (const règle of règles) {
      expect(règle.note).toMatch(/règle à définir/i);
      expect(valueAtPath(config, règle.chemin)).toBe(règle.valeurProvisoire);
    }
    // On retrouve aussi l'avertissement au niveau de chaque section concernée
    expect(config.delivery._aDefinir?.[0]).toMatch(/règle à définir/i);
    expect(config.profiles.LIVREUR._aDefinir?.join(" ")).toMatch(/règle à définir/i);
    expect(config.profiles.COURSIER._aDefinir?.join(" ")).toMatch(/règle à définir/i);
  });

  it("le Zem indépendant n'a aucune commission par course (règle validée, part mensuelle)", () => {
    const pricing = new PricingService(loadTarificationConfig());
    const config = loadTarificationConfig();
    expect(config.profiles.ZEM_INDEPENDANT.rideCommissionPct).toBe(0);
    expect(pricing.rideCommission({ profile: "ZEM_INDEPENDANT" }, 10000)).toBe(0);
    // Et sa valeur n'est pas listée comme provisoire
    expect(provisionalRules(config).some((r) => r.chemin.includes("ZEM_INDEPENDANT"))).toBe(false);
  });

  it("n'expose que des montants entiers en FCFA", () => {
    const config = loadTarificationConfig();
    expect(Object.keys(config.vehicles)).toEqual([
      "ZEM_ESSENCE",
      "ZEM_ELECTRIC",
      "GAZELLE",
      "KOALA",
      "LEOPARD",
    ]);
    for (const gamme of Object.keys(config.vehicles) as (keyof typeof config.vehicles)[]) {
      const vehicle = config.vehicles[gamme];
      expect(Number.isInteger(vehicle.base)).toBe(true);
      expect(vehicle.base).toBeGreaterThan(0);
      for (const bracket of vehicle.brackets) expect(Number.isInteger(bracket.perKm)).toBe(true);
      if (vehicle.baseDiscount) {
        expect(Number.isInteger(vehicle.baseDiscount.pct)).toBe(true);
        expect(Number.isInteger(vehicle.baseDiscount.aboveKm)).toBe(true);
      }
      // Le dernier palier est toujours illimité
      expect(vehicle.brackets[vehicle.brackets.length - 1].upToKm).toBeNull();
    }
    for (const level of Object.values(config.agencyLevels)) {
      const rules = level as { activationFee: number; maxAccounts: number };
      expect(Number.isInteger(rules.activationFee)).toBe(true);
      expect(Number.isInteger(rules.maxAccounts)).toBe(true);
    }
  });
});
