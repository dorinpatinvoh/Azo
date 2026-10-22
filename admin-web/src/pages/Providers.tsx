import React, { useEffect, useState } from "react";
import { api } from "../api";
import { Badge, ConfirmModal, Empty, ErrorBox, Field, Modal, PageHead, Spinner, useLoad, useToast } from "../ui";
import { EVENT_LABEL, STATUS_LABEL, STATUS_TONE, VEHICLE_LABEL, dateOnly, dateTime, fcfa, phone, providerKind } from "../format";
import type { ProviderDetail, ProviderDocument, ProviderItem, ProviderQueue, ProviderStatus } from "../types";

const STATUS_ORDER: ProviderStatus[] = ["SUBMITTED", "UNDER_REVIEW", "NEED_INFO", "APPROVED", "REJECTED", "SUSPENDED", "DRAFT"];
const nameOf = (p: ProviderItem) => p.identity.fullName ?? p.activity.agencyName ?? p.user.fullName ?? phone(p.user.phone);

export default function Providers({ id }: { id: string | null }) {
  return id ? <Detail id={id} /> : <List />;
}

/* ------------------------------------------------------------------ liste */
function List() {
  const [status, setStatus] = useState<ProviderStatus | "">("SUBMITTED");
  const [type, setType] = useState("");
  const [city, setCity] = useState("");
  const [cityInput, setCityInput] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setCity(cityInput.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [cityInput]);

  const { data, error, loading, reload } = useLoad(() => {
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (type) q.set("type", type);
    if (city) q.set("city", city);
    q.set("page", String(page));
    return api.get<ProviderQueue>(`/admin/providers?${q}`);
  }, [status, type, city, page]);

  const counts = data?.counts ?? {};
  return (
    <>
      <PageHead title="Dossiers prestataires" subtitle="Speeders, coursiers, livreurs et agences : examiner, valider, refuser">
        <button className="btn ghost sm" onClick={reload}>Actualiser</button>
      </PageHead>

      <div className="tabs">
        <button className={`chip ${status === "" ? "on" : ""}`} onClick={() => { setStatus(""); setPage(1); }}>Tous</button>
        {STATUS_ORDER.map((s) => (
          <button key={s} className={`chip ${status === s ? "on" : ""}`} onClick={() => { setStatus(s); setPage(1); }}>
            {STATUS_LABEL[s]}
            {counts[s] != null ? <span className="n">{counts[s]}</span> : null}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">Tous les types</option>
          <option value="DRIVER">Speeders</option>
          <option value="COURIER">Coursiers et livreurs</option>
          <option value="AGENCY">Agences</option>
        </select>
        <input placeholder="Ville" value={cityInput} onChange={(e) => setCityInput(e.target.value)} />
        {data ? <span className="muted small">{data.total} dossier(s)</span> : null}
      </div>

      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : null}
      {data && data.items.length === 0 ? <Empty>Aucun dossier dans cette vue.</Empty> : null}
      {data && data.items.length > 0 ? (
        <>
          <div className="tablewrap">
            <table>
              <thead>
                <tr><th>Prestataire</th><th>Type</th><th>Ville</th><th>État</th><th>Déposé le</th><th>Attente</th><th className="num">Dossier</th></tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.id} className="click" onClick={() => (window.location.hash = `#/dossiers/${p.id}`)}>
                    <td>
                      <b>{nameOf(p)}</b>
                      <div className="muted small">{phone(p.user.phone)}</div>
                    </td>
                    <td>{providerKind(p)}</td>
                    <td>{p.identity.city ?? "—"}</td>
                    <td><Badge tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status]}</Badge></td>
                    <td className="small">{dateOnly(p.review.submittedAt)}</td>
                    <td>
                      {p.review.waitingHours != null ? `${Math.round(p.review.waitingHours)} h` : "—"}
                      {p.review.overdue ? <> <Badge tone="err">En retard</Badge></> : null}
                    </td>
                    <td className="num">{p.activation.kycScore} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.pages > 1 ? (
            <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
              <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Précédent</button>
              <span className="muted small">Page {data.page} sur {data.pages}</span>
              <button className="btn ghost sm" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Suivant →</button>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------ fiche */
type Action = null | "approve" | "reject" | "info" | "suspend" | "reinstate" | "phoneOn" | "phoneOff" | { doc: ProviderDocument; decision: "VALID" | "INVALID" };

function Detail({ id }: { id: string }) {
  const toast = useToast();
  const { data: d, error, loading, reload, setData } = useLoad(() => api.get<ProviderDetail>(`/admin/providers/${id}`), [id]);
  const [action, setAction] = useState<Action>(null);
  const [preview, setPreview] = useState<ProviderDocument | null>(null);

  async function startReview() {
    try {
      setData(await api.post<ProviderDetail>(`/admin/providers/${id}/start-review`));
      toast("Examen commencé.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Impossible", true);
    }
  }
  const decide = (decision: string, reason?: string, override?: boolean) =>
    api.post(`/admin/providers/${id}/decision`, { decision, ...(reason ? { reason } : {}), ...(override ? { overrideDocuments: true } : {}) }).then(() => {
      toast("Décision enregistrée.");
      return reload();
    });

  if (loading && !d) return <Spinner />;
  if (!d) return <ErrorBox error={error ?? "Dossier introuvable"} onRetry={reload} />;

  const ag = d.activity.agencyDetails;
  const canDecide = ["SUBMITTED", "UNDER_REVIEW", "NEED_INFO"].includes(d.status);
  const missing = d.missingDocuments.length > 0 || d.missingFields.length > 0;

  return (
    <>
      <p><a href="#/dossiers">← Tous les dossiers</a></p>
      <PageHead title={nameOf(d)} subtitle={`${providerKind(d)} · ${phone(d.user.phone)}`}>
        <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
        {d.status === "SUBMITTED" ? <button className="btn" onClick={startReview}>Commencer l'examen</button> : null}
        {canDecide ? (
          <>
            <button className="btn ok" onClick={() => setAction("approve")}>Valider</button>
            <button className="btn soft" onClick={() => setAction("info")}>Demander une information</button>
            <button className="btn danger" onClick={() => setAction("reject")}>Refuser</button>
          </>
        ) : null}
        {d.status === "APPROVED" ? <button className="btn danger" onClick={() => setAction("suspend")}>Suspendre</button> : null}
        {d.status === "SUSPENDED" ? <button className="btn ok" onClick={() => setAction("reinstate")}>Rétablir</button> : null}
      </PageHead>

      <ErrorBox error={error} onRetry={reload} />
      {d.review.rejectReason ? <div className="errbox">Motif du refus : {d.review.rejectReason}</div> : null}
      {d.review.suspensionReason ? <div className="errbox">Motif de la suspension : {d.review.suspensionReason}</div> : null}
      {d.review.infoRequested ? <div className="infobox">Information demandée au candidat : {d.review.infoRequested}</div> : null}
      {canDecide && missing ? (
        <div className="infobox">
          {d.missingFields.length > 0 ? <>Champs manquants : {d.missingFields.join(", ")}. </> : null}
          {d.missingDocuments.length > 0 ? <>Pièces manquantes : {d.missingDocuments.map((m) => m.label).join(", ")}. </> : null}
          La validation exige alors une dérogation tracée.
        </div>
      ) : null}

      <div className="grid g2">
        <div className="card">
          <h2>Identité</h2>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Nom</dt><dd>{d.identity.fullName ?? "—"}</dd>
            <dt>Téléphone</dt><dd>{phone(d.user.phone)}</dd>
            <dt>Ville</dt><dd>{d.identity.city ?? "—"}</dd>
            <dt>Zones</dt><dd>{d.identity.zones.length ? d.identity.zones.join(", ") : "—"}</dd>
            <dt>Expérience</dt><dd>{d.identity.experienceYears != null ? `${d.identity.experienceYears} an(s)` : "—"}</dd>
            <dt>Compte créé le</dt><dd>{dateTime(d.user.createdAt)}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Activité</h2>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Spécialité</dt><dd>{d.activity.categoryId ?? "—"}</dd>
            <dt>Véhicule</dt><dd>{d.activity.vehicleType ? VEHICLE_LABEL[d.activity.vehicleType] ?? d.activity.vehicleType : "—"}</dd>
            <dt>Modèle</dt><dd>{d.activity.vehicleModel ?? "—"}</dd>
            <dt>Plaque</dt><dd>{d.activity.plateNumber ?? "—"}</dd>
            {d.type === "AGENCY" ? (
              <>
                <dt>Agence</dt><dd>{d.activity.agencyName ?? "—"}</dd>
                <dt>Formule</dt><dd>{d.activity.planLabel ?? d.activity.plan ?? "—"}{d.activity.planFee != null ? ` · activation ${fcfa(d.activity.planFee)}` : ""}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </div>

      {ag ? (
        <div className="card">
          <h2>Dossier de l'agence</h2>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Représentant</dt><dd>{[ag.representativeFirstName, ag.representativeLastName].filter(Boolean).join(" ") || "—"} {ag.representativeRole ? `(${ag.representativeRole})` : ""}</dd>
            <dt>NPI du représentant</dt><dd>{ag.representativeNpi || "—"}</dd>
            <dt>Forme juridique</dt><dd>{ag.legalForm || "—"}</dd>
            <dt>IFU</dt><dd>{ag.ifuNumber || "—"}</dd>
            <dt>RCCM</dt><dd>{ag.rccmNumber || "—"}</dd>
            <dt>Siège</dt><dd>{ag.headquartersAddress || "—"}</dd>
            <dt>Téléphone pro</dt><dd>{ag.businessPhone || "—"}</dd>
            <dt>E-mail pro</dt><dd>{ag.businessEmail || "—"}</dd>
            <dt>Reversements Mobile Money</dt><dd>{ag.payoutPhone || "—"}</dd>
            <dt>Taille du parc</dt><dd>{ag.fleetSize != null ? `${ag.fleetSize} véhicule(s)` : "—"}</dd>
          </dl>
        </div>
      ) : null}

      <div className="grid g2" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Examen</h2>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Déposé le</dt><dd>{dateTime(d.review.submittedAt)}</dd>
            <dt>Dernière décision</dt><dd>{dateTime(d.review.reviewedAt)}</dd>
            <dt>Attente</dt><dd>{d.review.waitingHours != null ? `${Math.round(d.review.waitingHours)} h (objectif ${d.review.slaHours} h)` : "—"}{d.review.overdue ? " · en retard" : ""}</dd>
          </dl>
        </div>
        <div className="card">
          <h2>Activation</h2>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Activé le</dt><dd>{dateTime(d.activation.activatedAt)}</dd>
            <dt>Missions terminées</dt><dd>{d.activation.jobsCompleted}</dd>
            <dt>Note</dt><dd>{d.activation.rating ? d.activation.rating.toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "—"}</dd>
            <dt>Complétude du dossier</dt><dd>{d.activation.kycScore} %</dd>
            {d.agency ? <><dt>Agence rattachée</dt><dd>{d.agency.name} ({d.agency.plan})</dd></> : null}
          </dl>
        </div>
      </div>

      {(d.type === "DRIVER" || d.type === "COURIER") && d.phoneSupport ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row between">
            <h2>Téléphone fourni par une boutique partenaire</h2>
            <Badge tone={d.phoneSupport.active ? "warn" : d.phoneSupport.enrolled ? "ok" : "grey"}>{d.phoneSupport.active ? "Commission téléphone active" : d.phoneSupport.enrolled ? "Période terminée" : "Aucun téléphone fourni"}</Badge>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Pour un Speeder, un coursier ou un livreur sans téléphone Android, équipé via une boutique partenaire : en plus des 15 % de l'entreprise, <b>{d.phoneSupport.commissionPct} %</b> de chaque course ou livraison terminée {d.phoneSupport.weekendsOnly ? "le samedi et le dimanche " : ""}sont prélevés (commission téléphone) pendant <b>{d.phoneSupport.durationMonths} mois</b> à partir de la remise du téléphone, à reverser à la boutique. Le prestataire voit ce rappel dans son application.
          </p>
          <dl className="kv" style={{ marginTop: 12 }}>
            <dt>Téléphone remis le</dt><dd>{d.phoneSupport.enrolled ? dateTime(d.phoneSupport.since) : "—"}</dd>
            <dt>Prélèvements jusqu'au</dt><dd>{d.phoneSupport.enrolled ? dateTime(d.phoneSupport.until) : "—"}</dd>
            <dt>Boutique</dt><dd>{d.phoneSupport.shop ?? "—"}</dd>
            <dt>Déjà prélevé</dt><dd>{fcfa(d.phoneSupport.collected)} sur {d.phoneSupport.rides} course(s) ou livraison(s)</dd>
          </dl>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={() => setAction("phoneOn")}>{d.phoneSupport.enrolled ? "Changer de boutique" : "Marquer : téléphone fourni"}</button>
            {d.phoneSupport.enrolled ? <button className="btn ghost" onClick={() => setAction("phoneOff")}>Retirer la commission téléphone</button> : null}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Pièces justificatives</h2>
        {d.documents.length === 0 ? <Empty>Aucune pièce déposée.</Empty> : (
          <div className="docgrid" style={{ marginTop: 14 }}>
            {d.documents.map((doc) => (
              <DocCard key={doc.id} doc={doc} onOpen={() => setPreview(doc)} onDecide={(decision) => setAction({ doc, decision })} />
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Historique</h2>
        <ul className="timeline" style={{ marginTop: 14 }}>
          {d.timeline.map((e) => (
            <li key={e.id}>
              <b>{EVENT_LABEL[e.type] ?? e.type}</b> {e.byAdmin ? <Badge>administrateur</Badge> : null}
              <div className="muted small">{dateTime(e.createdAt)}{e.comment ? ` — ${e.comment}` : ""}</div>
            </li>
          ))}
        </ul>
      </div>

      {action === "approve" ? <ApproveModal missing={missing} onClose={() => setAction(null)} onConfirm={(override) => decide("APPROVE", undefined, override)} /> : null}
      {action === "reject" ? <ConfirmModal title="Refuser ce dossier" danger confirmLabel="Refuser" reasonLabel="Motif du refus (le candidat le verra)" reasonRequired message="Le candidat pourra corriger son dossier et le redéposer." onClose={() => setAction(null)} onConfirm={(r) => decide("REJECT", r)} /> : null}
      {action === "info" ? <ConfirmModal title="Demander une information" confirmLabel="Envoyer la demande" reasonLabel="Ce que le candidat doit fournir ou corriger" reasonRequired onClose={() => setAction(null)} onConfirm={(r) => decide("NEED_INFO", r)} /> : null}
      {action === "suspend" ? <ConfirmModal title="Suspendre ce prestataire" danger confirmLabel="Suspendre" reasonLabel="Motif de la suspension" reasonRequired message="Il ne pourra plus travailler tant que la suspension n'est pas levée." onClose={() => setAction(null)} onConfirm={(r) => decide("SUSPEND", r)} /> : null}
      {action === "phoneOn" ? (
        <ConfirmModal
          title="Téléphone fourni par une boutique partenaire"
          confirmLabel={d.phoneSupport?.enrolled ? "Enregistrer" : "Activer la commission téléphone"}
          reasonLabel="Boutique partenaire (facultatif)"
          message={<>À partir de maintenant, chaque course ou livraison terminée de ce prestataire paie <b>{d.phoneSupport?.commissionPct ?? 10} %</b> de commission téléphone {d.phoneSupport?.weekendsOnly ? "le samedi et le dimanche " : ""}pendant <b>{d.phoneSupport?.durationMonths ?? 4} mois</b>, en plus des 15 % de l'entreprise. Ce qui est déjà terminé ne change pas. Il le verra dans son application.</>}
          onClose={() => setAction(null)}
          onConfirm={(shop) => api.post(`/admin/providers/${id}/phone-support`, { enabled: true, ...(shop ? { shop } : {}) }).then(() => { toast("Commission téléphone activée."); return reload(); })}
        />
      ) : null}
      {action === "phoneOff" ? (
        <ConfirmModal
          title="Retirer la commission téléphone"
          confirmLabel="Retirer"
          message="Ce Speeder ne paiera plus que la commission de l'entreprise sur ses prochaines courses. Ce qui a déjà été prélevé est conservé."
          onClose={() => setAction(null)}
          onConfirm={() => api.post(`/admin/providers/${id}/phone-support`, { enabled: false }).then(() => { toast("Commission téléphone retirée."); return reload(); })}
        />
      ) : null}
      {action === "reinstate" ? <ConfirmModal title="Rétablir ce prestataire" confirmLabel="Rétablir" message="Le compte retrouve son accès." onClose={() => setAction(null)} onConfirm={() => api.post(`/admin/providers/${id}/reinstate`).then(() => { toast("Compte rétabli."); return reload(); })} /> : null}
      {action && typeof action === "object" ? (
        <ConfirmModal
          title={action.decision === "VALID" ? `Valider la pièce « ${action.doc.label} »` : `Refuser la pièce « ${action.doc.label} »`}
          danger={action.decision === "INVALID"}
          confirmLabel={action.decision === "VALID" ? "Valider la pièce" : "Refuser la pièce"}
          reasonLabel="Note (le candidat la verra)"
          reasonRequired={action.decision === "INVALID"}
          onClose={() => setAction(null)}
          onConfirm={(note) => api.post(`/admin/providers/${id}/documents/${action.doc.id}/decision`, { decision: action.decision, ...(note ? { note } : {}) }).then(() => { toast("Pièce mise à jour."); return reload(); })}
        />
      ) : null}
      {preview ? <PreviewModal doc={preview} onClose={() => setPreview(null)} /> : null}
    </>
  );
}

function ApproveModal({ missing, onClose, onConfirm }: { missing: boolean; onClose: () => void; onConfirm: (override: boolean) => Promise<void> }) {
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(override);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible");
      setBusy(false);
    }
  }
  return (
    <Modal title="Valider ce dossier" onClose={onClose}>
      <p className="muted">Le prestataire est prévenu et son compte professionnel est activé.</p>
      {missing ? (
        <Field label="Pièces ou champs manquants">
          <label className="row" style={{ fontWeight: 500 }}>
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} style={{ width: "auto" }} />
            Valider malgré tout (dérogation enregistrée dans l'historique)
          </label>
        </Field>
      ) : null}
      <ErrorBox error={error} />
      <div className="actions">
        <button className="btn ghost" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn ok" onClick={go} disabled={busy || (missing && !override)}>{busy ? "…" : "Valider le dossier"}</button>
      </div>
    </Modal>
  );
}

const DOC_TONE = { PENDING: "warn", VALID: "ok", INVALID: "err" } as const;
const DOC_LABEL = { PENDING: "À vérifier", VALID: "Validée", INVALID: "Refusée" } as const;

function useDocBlob(doc: ProviderDocument, enabled = true) {
  const [file, setFile] = useState<{ url: string; type: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !doc.hasFile) return;
    let alive = true;
    let created: string | null = null;
    api.blob(`/providers/documents/${doc.id}/file`).then(
      (f) => {
        created = f.url;
        if (alive) setFile(f);
      },
      (e) => alive && setErr(e instanceof Error ? e.message : "Fichier illisible")
    );
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [doc.id, doc.hasFile, enabled]);
  return { file, err };
}

function DocCard({ doc, onOpen, onDecide }: { doc: ProviderDocument; onOpen: () => void; onDecide: (d: "VALID" | "INVALID") => void }) {
  const { file, err } = useDocBlob(doc);
  const isImage = file?.type.startsWith("image/");
  return (
    <div className="doc">
      <div className="thumb" onClick={doc.hasFile ? onOpen : undefined}>
        {!doc.hasFile ? <span className="muted small">Aucun fichier</span> : err ? <span className="err small">{err}</span> : !file ? <span className="spinner" /> : isImage ? <img src={file.url} alt={doc.label} /> : <span>📄 Ouvrir le fichier</span>}
      </div>
      <div className="body">
        <div className="row between">
          <b>{doc.label}</b>
          <Badge tone={DOC_TONE[doc.status]}>{DOC_LABEL[doc.status]}</Badge>
        </div>
        <div className="muted small">
          Déposée le {dateOnly(doc.uploadedAt)}
          {doc.expiresAt ? ` · expire le ${dateOnly(doc.expiresAt)}` : ""}
          {doc.note ? <div>Note : {doc.note}</div> : null}
        </div>
        <div className="row">
          <button className="btn ok sm" onClick={() => onDecide("VALID")} disabled={doc.status === "VALID"}>Valider</button>
          <button className="btn danger sm" onClick={() => onDecide("INVALID")} disabled={doc.status === "INVALID"}>Refuser</button>
        </div>
      </div>
    </div>
  );
}

function PreviewModal({ doc, onClose }: { doc: ProviderDocument; onClose: () => void }) {
  const { file, err } = useDocBlob(doc);
  return (
    <Modal title={doc.label} onClose={onClose} wide>
      {err ? <ErrorBox error={err} /> : !file ? <Spinner /> : file.type.startsWith("image/") ? (
        <img src={file.url} alt={doc.label} style={{ width: "100%", maxHeight: "75vh", objectFit: "contain", borderRadius: 12 }} />
      ) : (
        <iframe src={file.url} title={doc.label} style={{ width: "100%", height: "75vh", border: 0, borderRadius: 12 }} />
      )}
      <div className="actions">
        {file ? <a className="btn ghost" href={file.url} download={`${doc.kind}`}>Télécharger</a> : null}
        <button className="btn" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
