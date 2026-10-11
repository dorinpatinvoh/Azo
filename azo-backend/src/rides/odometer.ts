export type OdometerPoint = {
  lat: number;
  lng: number;
  at: number;
};

export type OdometerResult = {
  point: OdometerPoint;
  meters: number;
  accepted: boolean;
};

const EARTH_RADIUS_METERS = 6_371_000;

export function haversineMeters(a: Pick<OdometerPoint, "lat" | "lng">, b: Pick<OdometerPoint, "lat" | "lng">) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(b.lat - a.lat);
  const longitudeDelta = radians(b.lng - a.lng);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(Math.min(1, Math.max(0, value))));
}

export function odometerStep(
  previous: OdometerPoint | null,
  current: OdometerPoint,
  accuracy: number | undefined
): OdometerResult | null {
  if (
    !Number.isFinite(current.lat) ||
    !Number.isFinite(current.lng) ||
    Math.abs(current.lat) > 90 ||
    Math.abs(current.lng) > 180 ||
    !Number.isFinite(current.at) ||
    typeof accuracy !== "number" ||
    !Number.isFinite(accuracy) ||
    accuracy < 0 ||
    accuracy > 50
  ) {
    return null;
  }

  if (!previous) return { point: current, meters: 0, accepted: true };

  const elapsedMs = current.at - previous.at;
  if (elapsedMs <= 0) return null;

  const distance = haversineMeters(previous, current);
  if (distance / (elapsedMs / 1000) > 40 || distance < Math.max(5, accuracy / 2)) {
    return { point: previous, meters: 0, accepted: false };
  }

  return { point: current, meters: Math.round(distance), accepted: true };
}
