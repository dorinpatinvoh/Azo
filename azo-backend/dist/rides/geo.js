"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TARIFFS = exports.lerp = exports.SERVICE_TYPES = void 0;
exports.haversineKm = haversineKm;
exports.computeEstimate = computeEstimate;
exports.SERVICE_TYPES = ["transport", "zem", "livraison"];
const toRad = (d) => (d * Math.PI) / 180;
/** Distance à vol d'oiseau (km) */
function haversineKm(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
}
const lerp = (a, b, t) => ({
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
});
exports.lerp = lerp;
/** Tarifs FCFA — le Zem est nettement moins cher que la Voiture. À ajuster. */
exports.TARIFFS = {
    transport: { base: 500, perKm: 250, perMin: 20, min: 1000, speedKmh: 25 },
    zem: { base: 200, perKm: 120, perMin: 10, min: 500, speedKmh: 32 },
    livraison: { base: 400, perKm: 180, perMin: 15, min: 800, speedKmh: 28 },
};
const ROAD_FACTOR = 1.3; // vol d'oiseau -> distance routière approximative
function computeEstimate(origin, destination, serviceType) {
    const t = exports.TARIFFS[serviceType];
    const distanceKm = Math.max(0.1, Math.round(haversineKm(origin, destination) * ROAD_FACTOR * 10) / 10);
    const durationMin = Math.max(1, Math.round((distanceKm / t.speedKmh) * 60));
    const raw = t.base + distanceKm * t.perKm + durationMin * t.perMin;
    const price = Math.max(t.min, Math.round(raw / 50) * 50); // arrondi à 50 FCFA
    return { distanceKm, durationMin, price, currency: "FCFA" };
}
//# sourceMappingURL=geo.js.map