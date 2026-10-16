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
