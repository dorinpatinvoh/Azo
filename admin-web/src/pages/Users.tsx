import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Badge, ConfirmModal, Empty, ErrorBox, Modal, PageHead, Spinner, useLoad, useToast } from "../ui";
import { STATUS_LABEL, STATUS_TONE, TYPE_LABEL, dateOnly, fcfa, phone } from "../format";
import type { UserRow } from "../types";

const ROLE_LABEL: Record<string, string> = { CLIENT: "Client", DRIVER: "Speeder / coursier", AGENCY: "Agence", ADMIN: "Administrateur", ARTISAN: "Artisan" };
const USER_STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "Actif", tone: "ok" },
  PENDING_VALIDATION: { label: "En attente", tone: "warn" },
  BLOCKED: { label: "Bloqué", tone: "err" },
};

type Action = null | { kind: "block" | "unblock" | "ratings" | "delete"; user: UserRow } | { kind: "npi"; user: UserRow };

export default function Users() {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [action, setAction] = useState<Action>(null);
  const [npi, setNpi] = useState<{ user: UserRow; npi: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  const { data, error, loading, reload } = useLoad(() => {
    const p = new URLSearchParams();
    if (query) p.set("q", query);
    if (role) p.set("role", role);
    return api.get<UserRow[]>(`/admin/users?${p}`);
  }, [query, role]);

  return (
    <>
      <PageHead title="Utilisateurs" subtitle="Rechercher un compte, le bloquer, le supprimer, remettre ses notes à zéro, consulter son NPI">
        <button className="btn ghost sm" onClick={reload}>Actualiser</button>
      </PageHead>
      <div className="toolbar">
        <input placeholder="Nom ou numéro de téléphone" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">Tous les profils</option>
          <option value="CLIENT">Clients</option>
          <option value="DRIVER">Speeders et coursiers</option>
          <option value="AGENCY">Agences</option>
          <option value="ADMIN">Administrateurs</option>
        </select>
        {data ? <span className="muted small">{data.length >= 100 ? "100 premiers résultats : affine la recherche" : `${data.length} compte(s)`}</span> : null}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : null}
      {data && data.length === 0 ? <Empty>Aucun compte ne correspond.</Empty> : null}
      {data && data.length > 0 ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Compte</th><th>Profil</th><th>Prestataire</th><th>État</th><th className="num">Solde</th><th>Inscrit le</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {data.map((u) => {
                const st = USER_STATUS[u.status] ?? { label: u.status, tone: "grey" };
                return (
                  <tr key={u.id}>
                    <td><b>{u.fullName ?? "Sans nom"}</b><div className="muted small">{phone(u.phone)}</div></td>
                    <td>{ROLE_LABEL[u.role] ?? u.role}{u.agency ? <div className="muted small">Agence {u.agency.name}</div> : null}</td>
                    <td>
                      {u.provider ? (
                        <a href={`#/dossiers/${u.provider.id}`}>
                          {TYPE_LABEL[u.provider.type]} · <Badge tone={STATUS_TONE[u.provider.status]}>{STATUS_LABEL[u.provider.status]}</Badge>
                        </a>
                      ) : "—"}
                    </td>
                    <td><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="num">{fcfa(u.wallet?.balance)}</td>
                    <td className="small">{dateOnly(u.createdAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {u.status === "BLOCKED" ? (
                          <button className="btn ok sm" onClick={() => setAction({ kind: "unblock", user: u })}>Débloquer</button>
                        ) : u.role !== "ADMIN" ? (
                          <button className="btn danger sm" onClick={() => setAction({ kind: "block", user: u })}>Bloquer</button>
                        ) : null}
                        <button className="btn ghost sm" onClick={() => setAction({ kind: "ratings", user: u })}>Notes à zéro</button>
                        <button className="btn ghost sm" onClick={() => setAction({ kind: "npi", user: u })}>NPI</button>
                        {!u.phone.startsWith("supprime-") ? (
                          <button className="btn danger sm" onClick={() => setAction({ kind: "delete", user: u })}>Supprimer définitivement</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {action && action.kind === "block" ? (
        <ConfirmModal title={`Bloquer ${action.user.fullName ?? phone(action.user.phone)}`} danger confirmLabel="Bloquer le compte" reasonLabel="Motif (enregistré dans l'historique)" message="Il ne pourra plus utiliser l'application tant que le compte est bloqué." onClose={() => setAction(null)}
          onConfirm={(reason) => api.post(`/admin/users/${action.user.id}/status`, { status: "BLOCKED", ...(reason ? { reason } : {}) }).then(() => { toast("Compte bloqué."); return reload(); })} />
      ) : null}
      {action && action.kind === "unblock" ? (
        <ConfirmModal title={`Débloquer ${action.user.fullName ?? phone(action.user.phone)}`} confirmLabel="Débloquer" onClose={() => setAction(null)}
          onConfirm={() => api.post(`/admin/users/${action.user.id}/status`, { status: "ACTIVE" }).then(() => { toast("Compte débloqué."); return reload(); })} />
      ) : null}
      {action && action.kind === "delete" ? (
        <ConfirmModal title={`Supprimer ${action.user.fullName ?? phone(action.user.phone)}`} danger confirmLabel={(action.user.wallet?.balance ?? 0) !== 0 ? "Solder et supprimer définitivement" : "Supprimer définitivement"}
          message={<>{(action.user.wallet?.balance ?? 0) !== 0 ? <><b>Son portefeuille contient {fcfa(action.user.wallet?.balance)} : en confirmant, ce solde est remis à zéro (écriture conservée dans l'historique). Rembourse-le-lui avant si cet argent lui appartient.</b><br /><br /></> : null}Le compte de <b>{phone(action.user.phone)}</b> sera supprimé. S'il a déjà des courses, des livraisons ou des mouvements d'argent, ils sont conservés pour la comptabilité mais son nom, son numéro et son NPI sont effacés. Si c'est un commercial, son code disparaît et les prestataires qu'il a recrutés restent sans commercial. Si c'est un prestataire ou une agence, son dossier et ses pièces sont effacés (ses conducteurs restent rattachés à l'agence). Si c'est un administrateur, il perd tous ses droits : le dernier administrateur ne peut pas être supprimé. Cette action est définitive. Aucune course ne doit être en cours.</>}
          onClose={() => setAction(null)}
          onConfirm={() => api.delete<{ mode: "deleted" | "anonymized" }>(`/admin/users/${action.user.id}${(action.user.wallet?.balance ?? 0) !== 0 ? "?settle=1" : ""}`).then((r) => { toast(r.mode === "deleted" ? "Compte supprimé." : "Compte supprimé (historique conservé, données personnelles effacées)."); return reload(); })} />
      ) : null}
      {action && action.kind === "ratings" ? (
        <ConfirmModal title="Remettre les notes à zéro" confirmLabel="Remettre à zéro" message={`Les avis reçus par ${action.user.fullName ?? phone(action.user.phone)} avant aujourd'hui ne comptent plus (cela lève aussi une éventuelle restriction due à une mauvaise note).`} onClose={() => setAction(null)}
          onConfirm={() => api.post(`/admin/users/${action.user.id}/ratings-reset`).then(() => { toast("Notes remises à zéro."); })} />
      ) : null}
      {action && action.kind === "npi" ? (
        <ConfirmModal title="Consulter le NPI" confirmLabel="Afficher le NPI" message={<>L'accès au NPI de <b>{action.user.fullName ?? phone(action.user.phone)}</b> est enregistré dans un journal de sécurité (qui, quand). Ne le communique à personne.</>} onClose={() => setAction(null)}
          onConfirm={async () => { const r = await api.get<{ npi: string }>(`/admin/users/${action.user.id}/npi`); setNpi({ user: action.user, npi: r.npi }); }} />
      ) : null}
      {npi ? (
        <Modal title="NPI" onClose={() => setNpi(null)}>
          <p className="muted">{npi.user.fullName ?? phone(npi.user.phone)}</p>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 2, textAlign: "center", padding: 16 }}>{npi.npi}</div>
          <div className="actions"><button className="btn" onClick={() => setNpi(null)}>Fermer</button></div>
        </Modal>
      ) : null}
    </>
  );
}
