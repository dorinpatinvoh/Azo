import React, { useCallback, useEffect, useState } from "react";
import { Admin, api, clearSession, loadSession, saveSession, setUnauthorizedHandler } from "./api";
import { ErrorBox, Field } from "./ui";
import { phone as formatPhone } from "./format";
import Dashboard from "./pages/Dashboard";
import Providers from "./pages/Providers";
import Users from "./pages/Users";
import Finance from "./pages/Finance";
import Commercials from "./pages/Commercials";
import Support from "./pages/Support";
import Corrections from "./pages/Corrections";
import Rentals from "./pages/Rentals";
import Audit from "./pages/Audit";
import type { GlobalStats, IdentityCorrection, TicketRow } from "./types";

/* ---------- Routage par l'adresse (#/page/identifiant) ---------- */
function useHash() {
  const [hash, setHash] = useState(() => window.location.hash || "#/tableau-de-bord");
  useEffect(() => {
    const on = () => setHash(window.location.hash || "#/tableau-de-bord");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { page: parts[0] ?? "tableau-de-bord", id: parts[1] ?? null };
}

const NAV: { key: string; label: string; icon: string }[] = [
  { key: "tableau-de-bord", label: "Tableau de bord", icon: "📊" },
  { key: "dossiers", label: "Dossiers", icon: "🛡️" },
  { key: "utilisateurs", label: "Utilisateurs", icon: "👥" },
  { key: "finances", label: "Finances", icon: "💰" },
  { key: "commerciaux", label: "Commerciaux", icon: "🤝" },
  { key: "support", label: "Support", icon: "🎧" },
  { key: "corrections", label: "Corrections d'identité", icon: "✏️" },
  { key: "location", label: "Location de voitures", icon: "🚗" },
  { key: "journal", label: "Journal d'audit", icon: "📜" },
];

/* ---------- Connexion ---------- */
function Login({ onLogged }: { onLogged: (token: string, admin: Admin) => void }) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(phone.replace(/\D/g, ""), password);
      onLogged(r.token, r.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connexion impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>AZƆ̀</h1>
        <p className="muted" style={{ marginTop: 0 }}>Console administrateur</p>
        <ErrorBox error={error} />
        <Field label="Numéro de téléphone" hint="10 chiffres, commençant par 01">
          <input inputMode="tel" autoComplete="username" placeholder="01 XX XX XX XX" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
        </Field>
        <Field label="Mot de passe">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn" style={{ width: "100%" }} disabled={busy || phone.replace(/\D/g, "").length < 8 || !password}>
          {busy ? "Connexion…" : "Se connecter"}
        </button>
        <p className="muted small" style={{ marginBottom: 0 }}>Accès réservé aux administrateurs AZƆ̀. Après 5 erreurs, le numéro est bloqué 15 minutes.</p>
      </form>
    </div>
  );
}

/* ---------- Cadre de la console ---------- */
function Shell({ admin, onLogout }: { admin: Admin; onLogout: () => void }) {
  const { page, id } = useHash();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});

  const refreshCounts = useCallback(async () => {
    const [stats, tickets, corr] = await Promise.allSettled([
      api.get<GlobalStats>("/admin/stats"),
      api.get<{ tickets: TicketRow[] }>("/admin/support/tickets?status=OPEN"),
      api.get<IdentityCorrection[]>("/admin/identity-corrections"),
    ]);
    setCounts({
      dossiers: stats.status === "fulfilled" ? stats.value.providersPending ?? 0 : 0,
      support: tickets.status === "fulfilled" ? tickets.value.tickets.length : 0,
      corrections: corr.status === "fulfilled" ? corr.value.length : 0,
    });
  }, []);

  useEffect(() => {
    refreshCounts();
    const t = setInterval(refreshCounts, 60_000);
    return () => clearInterval(t);
  }, [refreshCounts, page, id]);

  useEffect(() => setOpen(false), [page, id]);

  let content: React.ReactNode;
  switch (page) {
    case "dossiers": content = <Providers id={id} />; break;
    case "utilisateurs": content = <Users />; break;
    case "finances": content = <Finance />; break;
    case "commerciaux": content = <Commercials id={id} />; break;
    case "support": content = <Support id={id} />; break;
    case "corrections": content = <Corrections />; break;
    case "location": content = <Rentals />; break;
    case "journal": content = <Audit />; break;
    default: content = <Dashboard />;
  }

  return (
    <div className="shell">
      {open ? <div className="scrim" onClick={() => setOpen(false)} /> : null}
      <aside className={`side ${open ? "open" : ""}`}>
        <div className="brand">
          <span>AZƆ̀<small>Console admin</small></span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.key} href={`#/${n.key}`} className={page === n.key || (page === "" && n.key === "tableau-de-bord") ? "active" : ""}>
              <span>{n.icon}</span>
              {n.label}
              {counts[n.key] ? <span className="count">{counts[n.key]}</span> : null}
            </a>
          ))}
        </nav>
        <div className="spacer" />
        <div className="who">
          <b>{admin.fullName ?? "Administrateur"}</b>
          {formatPhone(admin.phone)}
          <div style={{ marginTop: 10 }}>
            <button className="btn soft sm" onClick={onLogout}>Se déconnecter</button>
          </div>
        </div>
      </aside>
      <div>
        <div className="topbar">
          <button className="btn ghost sm" onClick={() => setOpen(true)} aria-label="Ouvrir le menu">☰ Menu</button>
          <b>AZƆ̀ · Console admin</b>
        </div>
        <main className="main">{content}</main>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(() => loadSession());

  const logout = useCallback(() => {
    clearSession();
    setSession(null);
    window.location.hash = "#/tableau-de-bord";
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  if (!session) {
    return (
      <Login
        onLogged={(token, admin) => {
          saveSession(token, admin);
          setSession(loadSession());
        }}
      />
    );
  }
  return <Shell admin={session.admin} onLogout={logout} />;
}
