// Accès à l'API AZƆ̀ (serveur Render). Le jeton de connexion reste dans ce navigateur, 12 heures au plus.
const BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").replace(/\/$/, "");
const KEY = "azo_admin_session";

export type Admin = { id: string; phone: string; fullName: string | null; role: string };
type Session = { token: string; admin: Admin; at: number };

const MAX_AGE_MS = 12 * 3600 * 1000;

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.token || Date.now() - s.at > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}
export function saveSession(token: string, admin: Admin) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, admin, at: Date.now() } satisfies Session));
  } catch {
    // navigation privée : la session ne survivra pas à la fermeture de l'onglet
  }
}
export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // rien à effacer
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `Erreur ${res.status}`;
  try {
    const body = await res.json();
    const m = body?.message;
    message = Array.isArray(m) ? m.join(" · ") : typeof m === "string" ? m : message;
  } catch {
    // réponse sans corps JSON
  }
  return new ApiError(res.status, message);
}

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const session = auth ? loadSession() : null;
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { "content-type": "application/json", ...(session ? { authorization: `Bearer ${session.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Serveur injoignable : vérifie ta connexion Internet (le serveur peut aussi être en train de se réveiller, réessaie dans une minute).");
  }
  if (res.status === 401 && auth) {
    clearSession();
    onUnauthorized?.();
    throw new ApiError(401, "Session expirée : reconnecte-toi.");
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  delete: <T>(path: string) => request<T>("DELETE", path),
  login: (phone: string, password: string) => request<{ token: string; user: Admin }>("POST", "/auth/admin-login", { phone, password }, false),
  /** Fichier protégé (pièce d'un dossier) : lu avec le jeton, affiché depuis la mémoire du navigateur. */
  async blob(path: string): Promise<{ url: string; type: string }> {
    const session = loadSession();
    const res = await fetch(BASE + path, { headers: session ? { authorization: `Bearer ${session.token}` } : {} });
    if (!res.ok) throw await parseError(res);
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), type: blob.type };
  },
};

export const API_BASE = BASE;
