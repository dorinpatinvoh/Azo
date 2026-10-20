import React, { useState } from "react";
import { api } from "../api";
import { ConfirmModal, Empty, ErrorBox, PageHead, Spinner, useLoad, useToast } from "../ui";
import { dateTime, phone } from "../format";
import type { IdentityCorrection } from "../types";

const GENDER: Record<string, string> = { M: "Homme", F: "Femme" };
type Action = null | { kind: "approve" | "reject"; c: IdentityCorrection };

export default function Corrections() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get<IdentityCorrection[]>("/admin/identity-corrections"));
  const [action, setAction] = useState<Action>(null);

  return (
    <>
      <PageHead title="Corrections d'identité" subtitle="Demandes des clients après la fenêtre de correction de 24 h (nom, prénom, sexe) — le NPI, lui, ne change jamais">
        <button className="btn ghost sm" onClick={reload}>Actualiser</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : null}
      {data && data.length === 0 ? <Empty>Aucune demande en attente.</Empty> : null}
      {data && data.length > 0 ? (
        <div className="stack">
          {data.map((c) => (
            <div className="card" key={c.id}>
              <div className="row between">
                <div>
                  <b>{[c.user.firstName, c.user.lastName].filter(Boolean).join(" ") || "Sans nom"}</b>
                  <span className="muted small"> · {phone(c.user.phone)} · demandé le {dateTime(c.createdAt)}</span>
                </div>
                <div className="row">
                  <button className="btn ok sm" onClick={() => setAction({ kind: "approve", c })}>Accepter</button>
                  <button className="btn danger sm" onClick={() => setAction({ kind: "reject", c })}>Refuser</button>
                </div>
              </div>
              <div className="tablewrap" style={{ marginTop: 12 }}>
                <table>
                  <thead><tr><th>Champ</th><th>Actuellement</th><th>Demandé</th></tr></thead>
                  <tbody>
                    {c.firstName ? <tr><td>Prénom</td><td>{c.user.firstName ?? "—"}</td><td><b>{c.firstName}</b></td></tr> : null}
                    {c.lastName ? <tr><td>Nom</td><td>{c.user.lastName ?? "—"}</td><td><b>{c.lastName}</b></td></tr> : null}
                    {c.gender ? <tr><td>Sexe</td><td>{GENDER[c.user.gender ?? ""] ?? "—"}</td><td><b>{GENDER[c.gender] ?? c.gender}</b></td></tr> : null}
                  </tbody>
                </table>
              </div>
              <p style={{ marginBottom: 0 }}><span className="muted">Motif du client :</span> {c.reason}</p>
            </div>
          ))}
        </div>
      ) : null}
      {action?.kind === "approve" ? <ConfirmModal title="Accepter la correction" confirmLabel="Accepter" message="Le profil du client est modifié et il est prévenu." onClose={() => setAction(null)} onConfirm={() => api.post(`/admin/identity-corrections/${action.c.id}/approve`).then(() => { toast("Correction acceptée."); return reload(); })} /> : null}
      {action?.kind === "reject" ? <ConfirmModal title="Refuser la correction" danger confirmLabel="Refuser" reasonLabel="Motif du refus (le client le verra)" reasonRequired onClose={() => setAction(null)} onConfirm={(reason) => api.post(`/admin/identity-corrections/${action.c.id}/reject`, { reason }).then(() => { toast("Correction refusée."); return reload(); })} /> : null}
    </>
  );
}
