import { PricingService } from "../src/pricing/pricing.service";
import { OdometerPoint, odometerStep } from "../src/rides/odometer";

const METERS_PER_LATITUDE_DEGREE = 111_195;
const pointAtMeters = (meters: number, at: number): OdometerPoint => ({
  lat: meters / METERS_PER_LATITUDE_DEGREE,
  lng: 0,
  at,
});

describe("odometerStep", () => {
  it("measures a straight 1,500 m trace", () => {
    const start = pointAtMeters(0, 1_000);
    const result = odometerStep(start, pointAtMeters(1_500, 101_000), 5);

    expect(result?.accepted).toBe(true);
    expect(result?.meters).toBeCloseTo(1_500, -1);
  });

  it("counts a return trip as cumulative distance", () => {
    const first = odometerStep(null, pointAtMeters(0, 1_000), 5);
    const outbound = odometerStep(first!.point, pointAtMeters(1_500, 101_000), 5);
    const inbound = odometerStep(outbound!.point, pointAtMeters(0, 201_000), 5);

    expect(outbound!.meters + inbound!.meters).toBeCloseTo(3_000, -1);
  });

  it("rejects GPS drift under max(5 m, accuracy)", () => {
    const result = odometerStep(pointAtMeters(0, 1_000), pointAtMeters(4, 10_000), 10);

    expect(result).toMatchObject({ accepted: false, meters: 0 });
    expect(result?.point).toEqual(pointAtMeters(0, 1_000));
  });

  it("ne compte pas le bruit du GPS à l'arrêt : 20 m de décalage avec 10 m de précision restent ignorés", () => {
    let anchor = odometerStep(null, pointAtMeters(0, 1_000), 10)!.point;
    let total = 0;
    // 60 positions « immobiles » qui dansent de ±20 m autour du même endroit, une par seconde
    for (let i = 1; i <= 60; i++) {
      const wobble = i % 2 === 0 ? 20 : -15;
      const step = odometerStep(anchor, pointAtMeters(wobble, 1_000 + i * 1_000), 10, 0.2);
      if (step?.accepted) {
        total += step.meters;
        anchor = step.point;
      }
    }
    expect(total).toBe(0);
  });

  it("exige un écart trois fois plus grand quand le téléphone mesure une vitesse nulle", () => {
    const previous = odometerStep(null, pointAtMeters(0, 1_000), 10)!.point;
    expect(odometerStep(previous, pointAtMeters(50, 11_000), 10, 0.1)?.accepted).toBe(false);
    expect(odometerStep(previous, pointAtMeters(70, 11_000), 10, 0.1)?.accepted).toBe(true);
    // en roulant (10 m/s), les mêmes 50 m sont comptés
    expect(odometerStep(previous, pointAtMeters(50, 6_000), 10, 10)?.accepted).toBe(true);
  });

  it("rejects implausible speed, inaccurate fixes and non-increasing timestamps", () => {
    const previous = pointAtMeters(0, 10_000);
    expect(odometerStep(previous, pointAtMeters(5_000, 11_000), 5)?.accepted).toBe(false);
    expect(odometerStep(previous, pointAtMeters(20, 20_000), 200)).toBeNull();
    expect(odometerStep(previous, pointAtMeters(20, 10_000), 5)).toBeNull();
  });
});

describe("metered ride pricing", () => {
  const pricing = new PricingService();

  it.each([
    ["ZEM_ESSENCE", 1, 220],
    ["ZEM_ESSENCE", 1.5, 255],
    ["ZEM_ESSENCE", 3, 360],
    ["ZEM_ELECTRIC", 1, 180],
    ["ZEM_ELECTRIC", 1.5, 210],
    ["ZEM_ELECTRIC", 3, 300],
  ])("%s at %s km costs %s FCFA including one base fare", (vehicle, distance, expected) => {
    expect(pricing.breakdown(Number(distance), String(vehicle)).price).toBe(expected);
  });
});

describe("odometerStep : petits déplacements réels (vitesse du téléphone)", () => {
  it("compte un déplacement lent mais réel (1 m/s) que la position seule ne verrait pas", () => {
    let anchor = odometerStep(null, pointAtMeters(0, 1_000), 8)!.point;
    let total = 0;
    // 10 s à 1 m/s : le GPS « danse » de quelques mètres, la vitesse mesurée dit 1 m/s
    for (let i = 1; i <= 10; i++) {
      const wobble = i % 2 ? 3 : -2;
      const r = odometerStep(anchor, pointAtMeters(i * 0.2 + wobble, 1_000 + i * 1_000), 8, 1);
      if (r?.accepted) {
        anchor = r.point;
        total += r.meters;
      }
    }
    expect(total).toBeGreaterThan(8);
    expect(total).toBeLessThan(11);
  });

  it("compte au millimètre : 0,3 m/s pendant 1 s = 0,3 m", () => {
    const start = odometerStep(null, pointAtMeters(0, 1_000), 5)!.point;
    const r = odometerStep(start, pointAtMeters(1, 2_000), 5, 0.6);
    expect(r?.accepted).toBe(true);
    expect(r?.meters).toBeCloseTo(0.6, 3);
  });

  it("à l'arrêt (vitesse nulle ou sous 0,5 m/s) rien n'est compté, même si la position danse", () => {
    let anchor = odometerStep(null, pointAtMeters(0, 1_000), 8)!.point;
    let total = 0;
    for (let i = 1; i <= 120; i++) {
      const r = odometerStep(anchor, pointAtMeters(i % 2 ? 9 : -9, 1_000 + i * 1_000), 8, i % 3 === 0 ? 0.3 : 0);
      if (r?.accepted) {
        anchor = r.point;
        total += r.meters;
      }
    }
    expect(total).toBe(0);
  });

  it("ne compte pas deux fois : la vitesse puis la position donnent la distance réelle", () => {
    let anchor = odometerStep(null, pointAtMeters(0, 1_000), 5)!.point;
    let total = 0;
    // 20 s à 3 m/s = 60 m, avec position mesurée correctement
    for (let i = 1; i <= 20; i++) {
      const r = odometerStep(anchor, pointAtMeters(i * 3, 1_000 + i * 1_000), 5, 3);
      if (r?.accepted) {
        anchor = r.point;
        total += r.meters;
      }
    }
    expect(total).toBeGreaterThan(55);
    expect(total).toBeLessThan(65);
  });
});

describe("odometerStep en mode strict (coursier personnel, livreur express)", () => {
  const strict = { strict: true };
  /** Rejoue une série de positions : renvoie la distance comptée. */
  function replay(samples: { meters: number; speed?: number; acc?: number }[], stepMs = 1_500) {
    let anchor = odometerStep(null, pointAtMeters(0, 1_000), 8, undefined, strict)!.point;
    let total = 0;
    samples.forEach((s, i) => {
      const step = odometerStep(anchor, pointAtMeters(s.meters, 1_000 + (i + 1) * stepMs), s.acc ?? 8, s.speed, strict);
      if (step?.accepted) {
        total += step.meters;
        anchor = step.point;
      }
    });
    return total;
  }

  it("ne compte rien pour un téléphone posé dont le GPS dérive de ±40 m pendant 10 minutes (vitesse proche de 0)", () => {
    const samples = Array.from({ length: 400 }, (_, i) => ({ meters: [0, 35, -20, 45, -38, 25][i % 6], speed: [0, 0.1, 0.4, 0.2][i % 4] }));
    expect(replay(samples)).toBe(0);
  });

  it("ne compte rien quand la vitesse GPS est inconnue et que la position dérive de ±25 m", () => {
    const samples = Array.from({ length: 400 }, (_, i) => ({ meters: [0, 25, -15, 22, -25, 12][i % 6] }));
    expect(replay(samples)).toBe(0);
  });

  it("ne compte rien quand la vitesse GPS parasite reste sous 1 m/s malgré une position qui bouge de ±30 m", () => {
    const samples = Array.from({ length: 400 }, (_, i) => ({ meters: [0, 30, -28, 33, -30][i % 5], speed: 0.9 }));
    expect(replay(samples)).toBe(0);
  });

  it("mesure un vrai trajet de moto de 2 km à 8 m/s à ±3 %", () => {
    const samples = Array.from({ length: 167 }, (_, i) => ({ meters: (i + 1) * 12, speed: 8 }));
    const total = replay(samples);
    expect(total).toBeGreaterThan(1_940);
    expect(total).toBeLessThan(2_060);
  });

  it("ne perd pas un trajet lent : 300 m parcourus à 1 m/s sont comptés (à moins de 120 m près)", () => {
    const samples = Array.from({ length: 200 }, (_, i) => ({ meters: (i + 1) * 1.5, speed: 1 }));
    const total = replay(samples);
    expect(total).toBeGreaterThan(180);
    expect(total).toBeLessThanOrEqual(300);
  });

  it("ignore un saut de GPS incohérent avec la vitesse mesurée, sans perdre le vrai trajet qui suit", () => {
    // moto à 8 m/s (12 m toutes les 1,5 s), un point aberrant 100 m plus loin au 11e relevé, puis le trajet reprend normalement
    const samples = Array.from({ length: 21 }, (_, i) => ({ meters: i === 10 ? 12 * (i + 1) + 100 : 12 * (i + 1), speed: 8 }));
    const total = replay(samples);
    expect(total).toBeGreaterThan(230);
    expect(total).toBeLessThan(260);
  });

  it("une vitesse parasite de 2 m/s sans aucun déplacement de la position ne fait rien monter", () => {
    const samples = Array.from({ length: 400 }, () => ({ meters: 0, speed: 2 }));
    expect(replay(samples)).toBe(0);
  });

  it("compte bien l'arrêt puis la reprise : 500 m, 5 min immobile avec GPS qui danse, puis 500 m", () => {
    const go1 = Array.from({ length: 42 }, (_, i) => ({ meters: (i + 1) * 12, speed: 8 }));
    const wait = Array.from({ length: 200 }, (_, i) => ({ meters: 504 + [0, 30, -25, 38, -20][i % 5], speed: 0.1 }));
    const go2 = Array.from({ length: 42 }, (_, i) => ({ meters: 504 + (i + 1) * 12, speed: 8 }));
    const total = replay([...go1, ...wait, ...go2]);
    expect(total).toBeGreaterThan(960);
    expect(total).toBeLessThan(1_060);
  });
});
