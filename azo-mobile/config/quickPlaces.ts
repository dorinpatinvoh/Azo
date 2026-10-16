import type { Place } from "../services/api";

/** Lieux populaires de Cotonou (coordonnées) : destinations en 1 clic de l'accueil et suggestions de la commande de course. */
export const POPULAR_PLACES: Place[] = [
  { id: "etoile", title: "Place de l'Étoile Rouge", subtitle: "Cotonou Centre", latitude: 6.3725, longitude: 2.4061 },
  { id: "dantokpa", title: "Marché Dantokpa", subtitle: "St Michel, Cotonou", latitude: 6.3728, longitude: 2.4339 },
  { id: "aeroport", title: "Aéroport de Cotonou", subtitle: "Cadjèhoun", latitude: 6.3572, longitude: 2.3844 },
  { id: "ganhi", title: "Ganhi Quartier des Affaires", subtitle: "Cotonou", latitude: 6.3556, longitude: 2.4398 },
  { id: "haievive", title: "Les Cocotiers / Haie Vive", subtitle: "Cotonou", latitude: 6.3589, longitude: 2.3976 },
  { id: "calavi", title: "Carrefour IITA Calavi", subtitle: "Abomey-Calavi", latitude: 6.4225, longitude: 2.3397 },
];
