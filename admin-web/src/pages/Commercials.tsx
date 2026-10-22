import React, { useMemo, useState } from "react";
import { api } from "../api";
import { Badge, ConfirmModal, Empty, ErrorBox, Field, Modal, PageHead, Spinner, Stat, copyText, useLoad, useToast } from "../ui";
import { VEHICLE_LABEL, dateOnly, fcfa, phone } from "../format";
import type { CommercialDetail, CommercialRow, ReferralItem, ReferralKind, ReferralStatus } from "../types";

const KINDS: { key: ReferralKind; label: string }[] = [
  { key: "SPEEDER", label: "Speeders" },
  { key: "AGENCE", label: "Agences" },
  { key: "COURSIER_PERSONNEL", label: "Coursiers personnels" },
  { key: "LIVREUR_EXPRESS", label: "Livreurs express" },
  { key: "CLIENT", label: "Clients" },
];
const KIND_ONE: Record<ReferralKind, string> = { SPEEDER: "Speeder", AGENCE: "Agence", COURSIER_PERSONNEL: "Coursier personnel", LIVREUR_EXPRESS: "Livreur express", CLIENT: "Client" };
const STATUS: Record<ReferralStatus, { label: string; tone: string }> = {
  ACTIF: { label: "Actif", tone: "ok" },
  INACTIF: { label: "Inactif", tone: "orange" },
  EN_ATTENTE: { label: "Dossier en attente", tone: "warn" },
  REFUSE: { label: "Dossier refusé", tone: "err" },
  SUSPENDU: { label: "Suspendu", tone: "err" },
};

export default function Commercials({ id }: { id: string | null }) {
  return id ? <Detail id={id} /> : <List />;
}

function promoMessage(code: string, link: string, name?: string | null) {
  return `${name ? `${name} te recommande AZƆ̀ !\n` : ""}Télécharge l'application avec ce lien : ${link}\nCode promo à saisir à l'inscription : ${code}`;
}

/* ------------------------------------------------------------------ liste */
function List() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get<CommercialRow[]>("/admin/referrals"));
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ code: string; link: string; fullName: string; phone: string } | null>(null);

  return (
    <>
      <PageHead title="Commerciaux" subtitle="Chaque commercial a un code promo COM-AZO… et un lien personnel ; il suit les clients et les prestataires qu'il recrute">
        <button className="btn ghost sm" onClick={reload}>Actualiser</button>
        <button className="btn" onClick={() => setCreating(true)}>Ajouter un commercial</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : null}
      {data && data.length === 0 ? <Empty>Aucun commercial pour le moment. Ajoute le premier : il reçoit un code promo et un lien de téléchargement personnel.</Empty> : null}
      {data && data.length > 0 ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Commercial</th><th>Code promo</th><th className="num">Speeders</th><th className="num">Agences</th><th className="num">Coursiers</th><th className="num">Livreurs</th><th className="num">Clients</th><th className="num">Actifs</th><th className="num">Inactifs</th><th className="num">Ont rechargé</th></tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="click" onClick={() => (window.location.hash = `#/commerciaux/${r.id}`)}>
                  <td><b>{r.fullName ?? "Sans nom"}</b> {!r.active ? <Badge tone="err">Désactivé</Badge> : null}<div className="muted small">{phone(r.phone)}</div></td>
                  <td><code>{r.code}</code></td>
                  <td className="num">{r.byKind.SPEEDER.total}</td>
                  <td className="num">{r.byKind.AGENCE.total}</td>
                  <td className="num">{r.byKind.COURSIER_PERSONNEL.total}</td>
                  <td className="num">{r.byKind.LIVREUR_EXPRESS.total}</td>
                  <td className="num">{r.byKind.CLIENT.total}</td>
                  <td className="num">{r.totals.actifs}</td>
                  <td className="num">{r.totals.inactifs}</td>
                  <td className="num">{r.totals.ontRecharge}<div className="muted small">{fcfa(r.totals.montantRecharge)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {creating ? <CreateModal onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); setCreated(c); reload(); }} /> : null}
      {created ? (
        <Modal title="Commercial créé ✅" onClose={() => setCreated(null)}>
          <p><b>{created.fullName}</b> · {phone(created.phone)}</p>
          <div className="infobox">
            Code promo : <b style={{ fontSize: 20 }}>{created.code}</b>
            <div className="small" style={{ marginTop: 6, wordBreak: "break-all" }}>Lien : {created.link}</div>
          </div>
          <p className="muted small">Il se connecte sur l'application avec ce numéro et retrouve son code, son lien et ses recrues.</p>
          <div className="actions">
            <button className="btn ghost" onClick={async () => toast((await copyText(promoMessage(created.code, created.link, created.fullName))) ? "Message copié, prêt à envoyer." : "Copie impossible", false)}>Copier le message</button>
            <button className="btn" onClick={() => setCreated(null)}>Fermer</button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: { code: string; link: string; fullName: string; phone: string }) => void }) {
  const [name, setName] = useState("");
  const [tel, setTel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = tel.replace(/\D/g, "");
  const ok = name.trim().length >= 2 && digits.length === 10 && digits.startsWith("01");
  async function go() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ code: string; link: string; fullName: string; phone: string }>("/admin/referrals", { fullName: name.trim(), phone: digits, ...(note.trim() ? { note: note.trim() } : {}) });
      onCreated(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Création impossible");
      setBusy(false);
    }
  }
  return (
    <Modal title="Ajouter un commercial" onClose={onClose}>
      <p className="muted">Il reçoit un code promo COM-AZO…, son lien personnel de téléchargement et un espace pour suivre les clients et les prestataires qu'il recrute. Le numéro doit être neuf (pas déjà un client ou un prestataire).</p>
      <Field label="Nom complet"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Kossi Adjovi" autoFocus /></Field>
      <Field label="Numéro de téléphone" hint="10 chiffres, commençant par 01"><input inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="01 XX XX XX XX" /></Field>
      <Field label="Note (facultatif)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex. Zone Cotonou" maxLength={300} /></Field>
      <ErrorBox error={error} />
      <div className="actions">
        <button className="btn ghost" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn" onClick={go} disabled={!ok || busy}>{busy ? "…" : "Créer le commercial"}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ fiche */
function Detail({ id }: { id: string }) {
  const toast = useToast();
  const { data: d, error, loading, reload, setData } = useLoad(() => api.get<CommercialDetail>(`/admin/referrals/${id}`), [id]);
  const [kind, setKind] = useState<ReferralKind | "">("");
  const [status, setStatus] = useState<"" | "ACTIF" | "INACTIF" | "EN_ATTENTE" | "RECHARGE">("");
  const [attaching, setAttaching] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [detaching, setDetaching] = useState<ReferralItem | null>(null);

  const rows = useMemo(
    () =>
      (d?.referrals ?? []).filter((r) => {
        if (kind && r.kind !== kind) return false;
        if (status === "RECHARGE") return r.recharged;
        if (status) return r.status === status;
        return true;
      }),
    [d, kind, status]
  );

  if (loading && !d) return <Spinner />;
  if (!d) return <ErrorBox error={error ?? "Commercial introuvable"} onRetry={reload} />;
  const t = d.summary.totals;
  const r = d.referrer;

  return (
    <>
      <p><a href="#/commerciaux">← Tous les commerciaux</a></p>
      <PageHead title={r.fullName ?? "Commercial"} subtitle={`${phone(r.phone)} · commercial depuis le ${dateOnly(r.createdAt)}`}>
        {!r.active ? <Badge tone="err">Désactivé</Badge> : <Badge tone="ok">Actif</Badge>}
        <button className="btn ghost sm" onClick={() => setAttaching(true)}>Rattacher un client ou un prestataire</button>
        <button className={`btn sm ${r.active ? "danger" : "ok"}`} onClick={() => setToggling(true)}>{r.active ? "Désactiver" : "Réactiver"}</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {r.note ? <div className="infobox">Note : {r.note}</div> : null}

      <div className="card" style={{ background: "linear-gradient(135deg, var(--pd), var(--p))", color: "#fff", border: 0 }}>
        <div className="small" style={{ opacity: 0.85, textTransform: "uppercase", letterSpacing: "0.06em" }}>Code promo</div>
        <div style={{ fontFamily: "Plus Jakarta Sans", fontSize: 34, fontWeight: 800, letterSpacing: 1 }}>{r.code}</div>
        <div className="small" style={{ opacity: 0.9, wordBreak: "break-all", margin: "6px 0 12px" }}>{r.link}</div>
        <div className="row">
          <button className="btn soft sm" onClick={async () => toast((await copyText(r.code)) ? "Code copié." : "Copie impossible")}>Copier le code</button>
          <button className="btn soft sm" onClick={async () => toast((await copyText(r.link)) ? "Lien copié." : "Copie impossible")}>Copier le lien</button>
          <button className="btn soft sm" onClick={async () => toast((await copyText(promoMessage(r.code, r.link, r.fullName))) ? "Message copié, prêt à envoyer." : "Copie impossible")}>Copier le message complet</button>
        </div>
      </div>

      <div className="grid g4" style={{ marginTop: 16 }}>
        {KINDS.map((k) => (
          <button key={k.key} className="card stat" style={{ textAlign: "left", cursor: "pointer", outline: kind === k.key ? "2px solid var(--p)" : "none" }} onClick={() => setKind(kind === k.key ? "" : k.key)}>
            <span className="v">{d.summary.byKind[k.key].total}</span>
            <span className="l"><b>{k.label}</b></span>
            <span className="small muted">{d.summary.byKind[k.key].actifs} actifs · {d.summary.byKind[k.key].inactifs} inactifs · {d.summary.byKind[k.key].enAttente} en attente · {d.summary.byKind[k.key].ontRecharge} rechargé</span>
          </button>
        ))}
      </div>
      <div className="grid g4" style={{ marginTop: 16 }}>
        <Stat value={t.total} label="Recrutés" />
        <Stat value={t.actifs} label={`Actifs (mission terminée ces ${d.summary.activeWindowDays} jours)`} />
        <Stat value={t.inactifs} label="Inactifs (validés, sans activité récente)" />
        <Stat value={`${t.ontRecharge} · ${fcfa(t.montantRecharge)}`} label="Ont rechargé · total rechargé" />
      </div>

      <h2 style={{ margin: "26px 0 12px" }}>Recrues</h2>
      <div className="tabs">
        {([["", "Toutes"], ["ACTIF", "Actifs"], ["INACTIF", "Inactifs"], ["EN_ATTENTE", "En attente"], ["RECHARGE", "Ont rechargé"]] as const).map(([k, l]) => (
          <button key={k} className={`chip ${status === k ? "on" : ""}`} onClick={() => setStatus(k)}>{l}</button>
        ))}
        {kind ? <button className="chip on" onClick={() => setKind("")}>{KIND_ONE[kind]} ✕</button> : null}
      </div>
      {rows.length === 0 ? <Empty>{d.referrals.length === 0 ? "Aucune recrue pour le moment." : "Aucune recrue dans cette vue."}</Empty> : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Recrue</th><th>Catégorie</th><th>État</th><th>Inscrit le</th><th>Dernière activité</th><th className="num">Missions (30 j)</th><th>Recharges</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.userId}>
                  <td><b>{x.name}</b><div className="muted small">{phone(x.phone)}{x.city ? ` · ${x.city}` : ""}</div></td>
                  <td>{x.kind ? KIND_ONE[x.kind] : "—"}{x.vehicleType ? <div className="muted small">{VEHICLE_LABEL[x.vehicleType] ?? x.vehicleType}</div> : null}{x.fleetSize != null ? <div className="muted small">flotte de {x.fleetSize}</div> : null}</td>
                  <td><Badge tone={STATUS[x.status].tone}>{x.kind === "CLIENT" && x.status === "EN_ATTENTE" ? "Inscription à terminer" : STATUS[x.status].label}</Badge>{x.approvedAt ? <div className="muted small">validé le {dateOnly(x.approvedAt)}</div> : null}</td>
                  <td className="small">{dateOnly(x.registeredAt)}</td>
                  <td className="small">{dateOnly(x.lastActivityAt)}</td>
                  <td className="num">{x.jobsTotal} <span className="muted">({x.jobsLast30Days})</span></td>
                  <td className="small">{x.recharged ? <><b style={{ color: "var(--ok)" }}>{x.rechargeCount} × · {fcfa(x.rechargedTotal)}</b><div className="muted">dernière le {dateOnly(x.lastRechargeAt)}</div></> : <span className="muted">Jamais</span>}</td>
                  <td><button className="btn ghost sm" onClick={() => setDetaching(x)}>Retirer</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {attaching ? <AttachModal id={id} onClose={() => setAttaching(false)} onDone={(next) => { setData(next); toast("Compte rattaché."); }} /> : null}
      {toggling ? <ConfirmModal title={r.active ? "Désactiver ce commercial" : "Réactiver ce commercial"} danger={r.active} confirmLabel={r.active ? "Désactiver" : "Réactiver"} message={r.active ? "Il n'accède plus à son espace et son code promo n'est plus accepté pour de nouvelles inscriptions. Ses recrues restent rattachées." : "Il retrouve son espace et son code promo redevient valable."} onClose={() => setToggling(false)} onConfirm={() => api.patch<CommercialDetail>(`/admin/referrals/${id}`, { active: !r.active }).then((next) => { setData(next); toast(r.active ? "Commercial désactivé." : "Commercial réactivé."); })} /> : null}
      {detaching ? <ConfirmModal title="Retirer cette recrue" danger confirmLabel="Retirer" message={`${detaching.name} ne sera plus rattaché à ${r.fullName ?? "ce commercial"}.`} onClose={() => setDetaching(null)} onConfirm={() => api.delete<CommercialDetail>(`/admin/referrals/referral/${detaching.userId}`).then((next) => { setData(next); toast("Recrue retirée."); })} /> : null}
    </>
  );
}

function AttachModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: (d: CommercialDetail) => void }) {
  const [tel, setTel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = tel.replace(/\D/g, "");
  async function go() {
    setBusy(true);
    setError(null);
    try {
      onDone(await api.post<CommercialDetail>(`/admin/referrals/${id}/attach`, { phone: digits }));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rattachement impossible");
      setBusy(false);
    }
  }
  return (
    <Modal title="Rattacher un client ou un prestataire" onClose={onClose}>
      <p className="muted">Numéro d'un client, d'un Speeder, d'une agence, d'un livreur express ou d'un coursier déjà inscrit et sans commercial.</p>
      <Field label="Numéro de téléphone" hint="10 chiffres, commençant par 01"><input inputMode="tel" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="01 XX XX XX XX" autoFocus /></Field>
      <ErrorBox error={error} />
      <div className="actions">
        <button className="btn ghost" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn" onClick={go} disabled={busy || digits.length !== 10 || !digits.startsWith("01")}>{busy ? "…" : "Rattacher"}</button>
      </div>
    </Modal>
  );
}
