"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulate = simulate;
const geo_1 = require("./geo");
// Durées de la simulation (ms) — à remplacer par un vrai dispatch de chauffeurs.
const SEARCH_MS = 6_000;
const PICKUP_MS = 20_000;
const TRIP_MS = 30_000;
const DRIVERS = {
    transport: { name: "Koffi Adjovi", vehicle: "Toyota Corolla grise", plate: "AB 1234 RB", rating: 4.8, photoUrl: "https://i.pravatar.cc/200?img=12" },
    zem: { name: "Séraphin Dossou", vehicle: "Moto électrique jaune", plate: "RB 5678 AZ", rating: 4.9, photoUrl: "https://i.pravatar.cc/200?img=33" },
    livraison: { name: "Codjo Agbo", vehicle: "Tricycle utilitaire", plate: "AC 9012 RB", rating: 4.7, photoUrl: "https://i.pravatar.cc/200?img=53" },
};
function simulate(ride) {
    const elapsed = Date.now() - ride.createdAt.getTime();
    const type = ride.serviceType;
    const o = { lat: ride.originLat, lng: ride.originLng };
    const d = { lat: ride.destLat, lng: ride.destLng };
    if (elapsed < SEARCH_MS) {
        return { status: "SEARCHING_DRIVER", driver: null, etaMinutes: null };
    }
    let status;
    let location;
    let etaMinutes;
    const t1 = elapsed - SEARCH_MS;
    if (t1 < PICKUP_MS) {
        status = "DRIVER_ACCEPTED";
        const start = { lat: o.lat + 0.012, lng: o.lng + 0.009 }; // ≈ 1,5 km du client
        location = (0, geo_1.lerp)(start, o, t1 / PICKUP_MS);
        etaMinutes = Math.max(1, Math.ceil((((0, geo_1.haversineKm)(location, o) * 1.3) / geo_1.TARIFFS[type].speedKmh) * 60));
    }
    else if (t1 - PICKUP_MS < TRIP_MS) {
        status = "IN_PROGRESS";
        const p = (t1 - PICKUP_MS) / TRIP_MS;
        location = (0, geo_1.lerp)(o, d, p);
        etaMinutes = Math.max(1, Math.ceil(ride.durationMin * (1 - p)));
    }
    else {
        status = "COMPLETED";
        location = d;
        etaMinutes = 0;
    }
    return {
        status,
        etaMinutes,
        driver: { ...DRIVERS[type], location: { latitude: location.lat, longitude: location.lng } },
    };
}
//# sourceMappingURL=simulation.js.map