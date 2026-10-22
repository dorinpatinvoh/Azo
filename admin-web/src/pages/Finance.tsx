import React, { useState } from "react";
import { api } from "../api";
import { Badge, ConfirmModal, Empty, ErrorBox, Field, Modal, PageHead, Spinner, Stat, useLoad, useToast } from "../ui";
import { VEHICLE_LABEL, dateTime, fcfa, km, phone } from "../format";
import type { CommissionRow, FinanceSummary, PhoneCommissions, Withdrawal } from "../types";

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const monthLabel = (key: string) => {
  const [, m] = key.split("-").map(Number);
  return MONTHS[(m ?? 1) - 1] ?? key;
};
const W_STATUS = { REQUESTED: { label: "En attente", tone: "warn" }, PAID: { label: "Versé", tone: "ok" }, CANCELLED: { label: "Annulé", tone: "grey" } } as const;

export default function Finance() {
  const toast = useToast();
  const [limit, setLimit] = useState(50);
  const { data, error, loading, reload } = useLoad(async () => {
    const [summary, commissions, withdrawals, phoneCommissions] = await Promise.all([
      api.get<FinanceSummary>("/admin/finance"),
      api.get<CommissionRow[]>(`/admin/finance/commissions?limit=${limit}`),
      api.get<Withdrawal[]>("/admin/finance/withdrawals"),
      api.get<PhoneCommissions>("/admin/finance/phone-commissions").catch(() => null),
    ]);
    return { summary, commissions, withdrawals, phoneCommissions };
  }, [limit]);
  const [asking, setAsking] = useState(false);
  const [paying, setPaying] = useState<Withdrawal | null>(null);
  const [cancelling, setCancelling] = useState<Withdrawal | null>(null);
  const [detail, setDetail] = useState<CommissionRow | null>(null);

  const s = data?.summary;
  const maxMonth = Math.max(1, ...(s?.months ?? []).map((m) => m.total));
  return (
    <>
      <PageHead title="Finances" subtitle="Gains de l'entreprise, commission de chaque course, retraits">
        <button className="btn ghost sm" onClick={reload}>Actualiser</button>
        <button className="btn" onClick={() => setAsking(true)} disabled={!s || s.available < s.minWithdrawal}>Faire un retrait</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : null}
      {data && s ? (
        <div className="stack">
          <div className="grid g4">
            <Stat hero value={fcfa(s.total)} label="Gains cumulés" />
            <Stat value={fcfa(s.thisMonth)} label="Ce mois" />
            <Stat value={fcfa(s.available)} label={`Disponible au retrait (minimum ${fcfa(s.minWithdrawal)})`} />
            <Stat value={fcfa(s.withdrawn)} label={`Déjà retiré${s.pendingWithdrawals ? ` · ${fcfa(s.pendingWithdrawals)} en attente` : ""}`} />
          </div>

          <div className="grid g2">
            <div className="card">
              <h2>D'où viennent les gains</h2>
              <div className="tablewrap" style={{ marginTop: 12, border: 0 }}>
                <table>
                  <thead><tr><th>Source</th><th className="num">Ce mois</th><th className="num">Total</th></tr></thead>
                  <tbody>
                    {s.sources.map((x) => (
                      <tr key={x.key}><td>{x.label}</td><td className="num">{fcfa(x.thisMonth)}</td><td className="num"><b>{fcfa(x.total)}</b></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <h2>Les 6 derniers mois</h2>
              <div className="bars" style={{ marginTop: 16 }}>
                {s.months.map((m) => (
                  <div className="col" key={m.month}>
                    <span className="small muted">{m.total > 0 ? `${Math.round(m.total / 1000)}k` : ""}</span>
                    <div className="bar" style={{ height: `${Math.max(3, Math.round((m.total / maxMonth) * 100))}%` }} />
                    <span className="small">{monthLabel(m.month)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {data.phoneCommissions && data.phoneCommissions.total > 0 ? (
            <div className="card">
              <div className="row between">
                <h2>Commissions téléphone à reverser aux boutiques</h2>
                <span className="muted small">Total : <b>{fcfa(data.phoneCommissions.total)}</b> · ce mois : <b>{fcfa(data.phoneCommissions.thisMonth)}</b> · {data.phoneCommissions.rides} course(s) ou livraison(s)</span>
              </div>
              <p className="muted small">Prélevées en plus des 15 % sur les Speeders, coursiers et livreurs dont le téléphone a été fourni par une boutique partenaire (4 mois, du lundi au vendredi). Elles ne comptent pas dans les gains de l'entreprise ci-dessus : elles sont à reverser.</p>
              <div className="tablewrap" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr><th>Prestataire</th><th>Boutique</th><th>Téléphone remis le</th><th className="num">Missions</th><th className="num">À reverser</th></tr></thead>
                  <tbody>
                    {data.phoneCommissions.speeders.map((x) => (
                      <tr key={x.userId}>
                        <td>{x.providerId ? <a href={`#/dossiers/${x.providerId}`}>{x.fullName ?? phone(x.phone)}</a> : (x.fullName ?? phone(x.phone))}<div className="muted small">{phone(x.phone)}</div></td>
                        <td>{x.shop ?? "—"}</td>
                        <td className="small">{x.since ? dateTime(x.since) : "retiré"}</td>
                        <td className="num">{x.rides}</td>
                        <td className="num"><b>{fcfa(x.total)}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <div className="card">
            <div className="row between">
              <h2>Commissions reçues</h2>
              <div className="row">
                <span className="muted small">Total des {data.commissions.length} lignes : <b>{fcfa(data.commissions.reduce((t, c) => t + c.commission, 0))}</b></span>
                <select value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="btn ghost sm" style={{ padding: "6px 10px" }}>
                  <option value={50}>50 dernières</option>
                  <option value={100}>100 dernières</option>
                  <option value={200}>200 dernières</option>
                </select>
              </div>
            </div>
            {data.commissions.length === 0 ? <Empty>Aucune course ou livraison terminée pour le moment.</Empty> : (
              <div className="tablewrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr><th>Date</th><th>Prestataire</th><th>Type</th><th>Trajet</th><th className="num">Course</th><th className="num">Commission</th></tr>
                  </thead>
                  <tbody>
                    {data.commissions.map((c) => (
                      <tr key={`${c.kind}-${c.id}`} className="click" onClick={() => setDetail(c)}>
                        <td className="small">{dateTime(c.date)}</td>
                        <td>
                          <b>{c.driverName ?? c.who ?? "—"}</b>
                          <div className="muted small">{c.independent === false ? `Agence ${c.agencyName ?? ""}` : "Indépendant"}</div>
                        </td>
                        <td className="small">{c.ref}</td>
                        <td className="small">{c.origin || c.dest ? `${c.origin ?? "?"} → ${c.dest ?? "?"}` : "—"}</td>
                        <td className="num">{fcfa(c.amount)}</td>
                        <td className="num"><b style={{ color: "var(--ok)" }}>+{fcfa(c.commission)}</b><div className="muted small">{c.pct.toLocaleString("fr-FR")} %</div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Retraits de l'entreprise</h2>
            {data.withdrawals.length === 0 ? <Empty>Aucun retrait demandé.</Empty> : (
              <div className="tablewrap" style={{ marginTop: 12 }}>
                <table>
                  <thead><tr><th>Demandé le</th><th className="num">Montant</th><th>Numéro qui reçoit</th><th>État</th><th>Référence</th><th>Actions</th></tr></thead>
                  <tbody>
                    {data.withdrawals.map((w) => (
                      <tr key={w.id}>
                        <td className="small">{dateTime(w.createdAt)}</td>
                        <td className="num"><b>{fcfa(w.amount)}</b></td>
                        <td>{phone(w.phone)}<div className="muted small">{w.method ?? ""}{w.note ? ` · ${w.note}` : ""}</div></td>
                        <td><Badge tone={W_STATUS[w.status].tone}>{W_STATUS[w.status].label}</Badge>{w.paidAt ? <div className="muted small">{dateTime(w.paidAt)}</div> : null}</td>
                        <td className="small">{w.reference ?? "—"}</td>
                        <td>
                          {w.status === "REQUESTED" ? (
                            <div className="row" style={{ gap: 6 }}>
                              <button className="btn ok sm" onClick={() => setPaying(w)}>Marquer comme versé</button>
                              <button className="btn ghost sm" onClick={() => setCancelling(w)}>Annuler</button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {asking && s ? <WithdrawalModal available={s.available} min={s.minWithdrawal} onClose={() => setAsking(false)} onDone={() => { toast("Demande de retrait enregistrée."); reload(); }} /> : null}
      {paying ? <PaidModal w={paying} onClose={() => setPaying(null)} onDone={() => { toast("Retrait marqué comme versé."); reload(); }} /> : null}
      {cancelling ? <ConfirmModal title="Annuler cette demande" confirmLabel="Annuler la demande" danger message={`Retrait de ${fcfa(cancelling.amount)} vers ${phone(cancelling.phone)} : le montant redevient disponible.`} onClose={() => setCancelling(null)} onConfirm={() => api.post(`/admin/finance/withdrawals/${cancelling.id}/cancel`).then(() => { toast("Demande annulée."); return reload(); })} /> : null}
      {detail ? (
        <Modal title={detail.ref} onClose={() => setDetail(null)}>
          <dl className="kv">
            <dt>Date</dt><dd>{dateTime(detail.date)}</dd>
            <dt>Prestataire</dt><dd>{detail.driverName ?? detail.who ?? "—"} {detail.driverPhone ? `· ${phone(detail.driverPhone)}` : ""}</dd>
            <dt>Statut</dt><dd>{detail.independent === false ? `Employé de l'agence ${detail.agencyName ?? ""}` : "Indépendant"}</dd>
            <dt>Client</dt><dd>{detail.clientName ?? "—"} {detail.clientPhone ? `· ${phone(detail.clientPhone)}` : ""}</dd>
            <dt>Départ</dt><dd>{detail.origin ?? "—"}</dd>
            <dt>Arrivée</dt><dd>{detail.dest ?? "—"}</dd>
            <dt>Distance</dt><dd>{km(detail.distanceKm)}</dd>
            <dt>Véhicule</dt><dd>{detail.vehicle ? VEHICLE_LABEL[detail.vehicle] ?? detail.vehicle : "—"}</dd>
            <dt>Montant de la course</dt><dd>{fcfa(detail.amount)}</dd>
            <dt>Commission de l'entreprise</dt><dd style={{ color: "var(--ok)" }}>{fcfa(detail.commission)} ({detail.pct.toLocaleString("fr-FR")} %)</dd>
          </dl>
          <div className="actions"><button className="btn" onClick={() => setDetail(null)}>Fermer</button></div>
        </Modal>
      ) : null}
    </>
  );
}

function WithdrawalModal({ available, min, onClose, onDone }: { available: number; min: number; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState("");
  const [tel, setTel] = useState("");
  const [method, setMethod] = useState("MTN");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(amount);
  const digits = tel.replace(/\D/g, "");
  const ok = Number.isInteger(n) && n >= min && n <= available && digits.length === 10 && digits.startsWith("01");

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/admin/finance/withdrawals", { amount: n, phone: digits, method, ...(note.trim() ? { note: note.trim() } : {}) });
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible");
      setBusy(false);
    }
  }
  return (
    <Modal title="Faire un retrait" onClose={onClose}>
      <p className="muted">Disponible : <b>{fcfa(available)}</b> · minimum {fcfa(min)}</p>
      <Field label="Montant (FCFA)">
        <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 9))} placeholder="Ex. 50000" />
        <a href="#" onClick={(e) => { e.preventDefault(); setAmount(String(available)); }}>Tout retirer</a>
      </Field>
      <Field label="Opérateur Mobile Money">
        <select value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="MTN">MTN</option><option value="MOOV">Moov</option><option value="CELTIIS">Celtiis</option>
        </select>
      </Field>
      <Field label="Numéro qui reçoit l'argent" hint="10 chiffres, commençant par 01">
        <input inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="01 XX XX XX XX" />
      </Field>
      <Field label="Note (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
      <ErrorBox error={error} />
      <div className="actions">
        <button className="btn ghost" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn" onClick={go} disabled={!ok || busy}>{busy ? "…" : "Enregistrer le retrait"}</button>
      </div>
    </Modal>
  );
}

function PaidModal({ w, onClose, onDone }: { w: Withdrawal; onClose: () => void; onDone: () => void }) {
  const [ref, setRef] = useState("");
  return (
    <ConfirmModal
      title="Retrait versé ?"
      confirmLabel="Oui, c'est versé"
      message={`${fcfa(w.amount)} sur ${phone(w.phone)}. Saisis la référence de l'opération Mobile Money si tu l'as.`}
      reasonLabel="Référence de l'opération (facultatif)"
      onClose={onClose}
      onConfirm={async (reference) => {
        await api.post(`/admin/finance/withdrawals/${w.id}/paid`, reference ? { reference } : {});
        void ref;
        setRef("");
        onDone();
      }}
    />
  );
}
