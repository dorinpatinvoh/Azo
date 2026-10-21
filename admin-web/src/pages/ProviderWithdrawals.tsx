import React, { useState } from "react";
import { api } from "../api";
import { Badge, ConfirmModal, Empty, ErrorBox, PageHead, Spinner, copyText, useLoad, useToast } from "../ui";
import { dateTime, fcfa, phone } from "../format";
import type { ProviderWithdrawal } from "../types";

const STATUS = {
  PENDING: { label: "À payer", tone: "warn" },
  CONFIRMED: { label: "Payé", tone: "ok" },
  FAILED: { label: "Refusé", tone: "err" },
} as const;
const ROLE: Record<string, string> = { DRIVER: "Speeder / coursier", COURIER: "Coursier", AGENCY: "Agence" };
const FILTERS: { key: "PENDING" | "CONFIRMED" | "FAILED" | ""; label: string }[] = [
  { key: "PENDING", label: "À payer" },
  { key: "CONFIRMED", label: "Payés" },
  { key: "FAILED", label: "Refusés" },
  { key: "", label: "Tous" },
];

export default function ProviderWithdrawals() {
  const toast = useToast();
  const [filter, setFilter] = useState<"PENDING" | "CONFIRMED" | "FAILED" | "">("PENDING");
  const { data, error, loading, reload } = useLoad(() => api.get<ProviderWithdrawal[]>(`/admin/provider-withdrawals${filter ? `?status=${filter}` : ""}`), [filter]);
  const [paying, setPaying] = useState<ProviderWithdrawal | null>(null);
  const [refusing, setRefusing] = useState<ProviderWithdrawal | null>(null);

  const total = (data ?? []).filter((w) => w.status === "PENDING").reduce((sum, w) => sum + w.netAmount, 0);
  return (
    <>
      <PageHead title="Retraits des prestataires" subtitle="Les Speeders, coursiers et agences demandent à retirer leur gain : verse le montant sur leur Mobile Money, puis marque la demande payée">
        <button className="btn ghost sm" onClick={reload}>Actualiser</button>
      </PageHead>
      <div className="tabs">
        {FILTERS.map((f) => (
          <button key={f.key} className={`chip ${filter === f.key ? "on" : ""}`} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      {filter === "PENDING" && data && data.length > 0 ? (
        <div className="infobox">{data.length} demande(s) à payer, soit <b>{fcfa(total)}</b> à verser au total (frais déjà déduits).</div>
      ) : null}
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : null}
      {data && data.length === 0 ? <Empty>Aucune demande {filter === "PENDING" ? "à payer" : "dans cette liste"}.</Empty> : null}
      {data && data.length > 0 ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Prestataire</th><th>Numéro à payer</th><th className="num">À verser</th><th className="num">Frais</th><th>État</th><th>Demandé le</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {data.map((w) => {
                const st = STATUS[w.status];
                return (
                  <tr key={w.id}>
                    <td><b>{w.user.fullName ?? "Sans nom"}</b><div className="muted small">{ROLE[w.user.role] ?? w.user.role} · {phone(w.user.phone)}</div></td>
                    <td>
                      <b>{phone(w.payoutPhone)}</b>
                      {w.payoutPhone ? <div><button className="btn ghost sm" onClick={() => copyText(w.payoutPhone ?? "").then(() => toast("Numéro copié."))}>Copier</button></div> : null}
                    </td>
                    <td className="num"><b>{fcfa(w.netAmount)}</b><div className="muted small">sur {fcfa(w.amount)}</div></td>
                    <td className="num">{fcfa(w.fee)}</td>
                    <td><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="small">{dateTime(w.createdAt)}</td>
                    <td>
                      {w.status === "PENDING" ? (
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn ok sm" onClick={() => setPaying(w)}>Marquer payé</button>
                          <button className="btn danger sm" onClick={() => setRefusing(w)}>Refuser</button>
                        </div>
                      ) : <span className="muted small">{w.note?.split(" · ").slice(-1)[0] ?? ""}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {paying ? (
        <ConfirmModal
          title="Marquer comme payé"
          confirmLabel="J'ai versé l'argent"
          reasonLabel="Référence de la transaction Mobile Money (facultatif)"
          message={<>Confirme seulement après avoir versé <b>{fcfa(paying.netAmount)}</b> sur le <b>{phone(paying.payoutPhone)}</b>. Le prestataire sera prévenu.</>}
          onClose={() => setPaying(null)}
          onConfirm={(ref) => api.post(`/admin/provider-withdrawals/${paying.id}/paid`, ref ? { reference: ref } : {}).then(() => { toast("Retrait marqué payé."); return reload(); })}
        />
      ) : null}
      {refusing ? (
        <ConfirmModal
          title="Refuser le retrait"
          danger
          confirmLabel="Refuser et rendre l'argent"
          reasonLabel="Motif (envoyé au prestataire)"
          reasonRequired
          message={<>Les <b>{fcfa(refusing.amount)}</b> débités sont rendus au portefeuille de {refusing.user.fullName ?? phone(refusing.user.phone)}.</>}
          onClose={() => setRefusing(null)}
          onConfirm={(reason) => api.post(`/admin/provider-withdrawals/${refusing.id}/reject`, { reason }).then(() => { toast("Retrait refusé, montant rendu."); return reload(); })}
        />
      ) : null}
    </>
  );
}
