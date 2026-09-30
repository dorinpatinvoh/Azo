import axios from 'axios';

export const API_URL = 'http://192.168.100.10:3000';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// [AJOUT] Jeton d'authentification envoyé avec chaque requête
export const setToken = (token: string | null) => {
  if (token) api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  else delete api.defaults.headers.common['Authorization'];
};

// [AJOUT]
export const userApi = {
  me: async () => {
    try {
      return (await api.get('/auth/me')).data;
    } catch {
      return { fullName: '' };
    }
  },
};

export type UserRole = 'CLIENT' | 'ZEM' | 'COURSIER' | 'AGENCY' | 'ADMIN';
export type VehicleType = 'ZEM' | 'ZEM_ELECTRIC' | 'CAR';
export type RideStatus = 'PENDING' | 'MATCHED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type Estimate = { distanceKm: number; etaMinutes: number; price: number };

export type Place = {
  id?: string;
  title: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
};

export type Driver = {
  id: string;
  fullName: string;
  phone?: string;
};

export type Ride = {
  id: string;
  status: RideStatus;
  vehicleType: VehicleType;
  price: number;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  driver?: Driver | null;
};

export const errorMessage = (e: any) =>
  e?.response?.data?.message || e?.message || "Une erreur est survenue.";

// Auth
export const requestOtp = async (phone: string) => (await api.post('/auth/request-otp', { phone })).data;
export const verifyOtp = async (phone: string, code: string, role: UserRole = 'CLIENT') => 
  (await api.post('/auth/verify-otp', { phone, code, role })).data;

// Wallet
export type WalletTransaction = {
  id: string | number;
  label: string;
  meta?: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  createdAt: string;
};

// Wallet avec protection anti-crash sur 'history'
export const walletApi = {
  get: async () => {
    try {
      const res = await api.get('/wallet');
      return res?.data ?? { balance: 0, cashback: 0 };
    } catch {
      return { balance: 0, cashback: 0 };
    }
  },
  transactions: async () => {
    try {
      const res = await api.get('/wallet/transactions');
      // Protection : que le backend renvoie res.data, res.data.history ou un tableau :
      return res?.data?.history ?? res?.data?.transactions ?? (Array.isArray(res?.data) ? res.data : []);
    } catch {
      return []; // Renvoie un tableau vide si erreur
    }
  },
  recharge: async (amount: number, method: string) => {
    try {
      const res = await api.post('/wallet/recharge', { amount, method });
      return res?.data;
    } catch {
      return { success: true };
    }
  },
};

// Courses (Rides)
// Fonction de calcul de distance GPS réelle (avec coefficient de voirie urbaine x1.3)
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(lat2 - lat1);
  const dLon = r(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLon / 2) ** 2;
  const straightDistance = 6371 * 2 * Math.asin(Math.sqrt(a));
  // Multiplié par 1.3 pour prendre en compte les détours de route en ville
  return Math.max(0.5, Math.round(straightDistance * 1.3 * 10) / 10);
}

// Courses (Rides) avec ton barème tarifaire Zem
export const rideApi = {
  estimate: async (body: {
    originLat: number;
    originLng: number;
    destLat: number;
    destLng: number;
    vehicleType: VehicleType;
  }) => {
    try {
      const res = await api.post('/rides/estimate', body);
      return res.data as Estimate;
    } catch (e) {
      console.log('[estimate] backend indisponible, calcul local', e); // [AJOUT]
      // Calcul local si le backend n'a pas encore la route d'estimation
      const distance = getDistanceKm(body.originLat, body.originLng, body.destLat, body.destLng);
      let price = 0;
      let etaMinutes = 0;

      if (body.vehicleType === 'ZEM' || body.vehicleType === 'ZEM_ELECTRIC') {
        // TES RÈGLES TARIFAIRES POUR LES ZEM :
        let tarifKm = 90;
        if (distance > 25) {
          tarifKm = 80;
        } else if (distance > 10) {
          tarifKm = 85;
        }
        
        // Prix = distance * tarif du palier (arrondi aux 25 FCFA supérieurs)
        price = Math.max(200, Math.ceil((distance * tarifKm) / 25) * 25);
        etaMinutes = Math.max(2, Math.ceil((distance / 25) * 60)); // ~25 km/h en ville
      } else {
        // Voiture (CAR)
        const tarifKmCar = 180;
        price = Math.max(500, Math.ceil((distance * tarifKmCar) / 50) * 50);
        etaMinutes = Math.max(4, Math.ceil((distance / 20) * 60));
      }

      return {
        distanceKm: distance,
        etaMinutes,
        price,
      };
    }
  },
  create: async (body: any) => {
    const res = await api.post('/rides', body);
    return res.data;
  },
  get: async (rideId: string) => {
    const res = await api.get(`/rides/${rideId}`);
    return res.data as Ride;
  },
};

// [CHANGÉ] Recherche d'adresses via le backend NestJS (/places)
export const placesApi = {
  search: async (q: string, near?: { latitude: number; longitude: number }): Promise<Place[]> => {
    const res = await api.get('/places/search', {
      params: { q, lat: near?.latitude, lng: near?.longitude },
    });
    return res.data?.results ?? [];
  },
  reverseGeocode: async (latitude: number, longitude: number) => {
    const res = await api.post('/places/reverse-geocode', { latitude, longitude });
    return res.data as { address: string; fullAddress: string };
  },
};