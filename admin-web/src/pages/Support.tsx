import React, { useState } from "react";
import { api } from "../api";
import { Badge, ConfirmModal, Empty, ErrorBox, PageHead, Spinner, useLoad, useToast } from "../ui";
import { dateTime, phone } from "../format";
import type { TicketDetail, TicketRow } from "../types";

const STATUS = { OPEN: { label: "À traiter", tone: "orange" }, ANSWERED: { label: "Répondu", tone: "ok" }, CLOSED: { label: "Fermé", tone: "grey" } } as const;
const CATEGORY: Record<string, string> = { RIDE: "Course", PAYMENT: "Paiement", ACCOUNT: "Compte", SAFETY: "Sécurité", OTHER: "Autre" };
const ROLE: Record<string, string> = { CLIENT: "Client", DRIVER: "Speeder / coursier", AGENCY: "Agence" };

export default function Support({ id }: { id: string | null }) {
  return id ? <Detail id={id} /> : <List />;
}

function List() {
  const [status, setStatus] = useState<"" | "OPEN" | "ANSWERED" | "CLOSED">("OPEN");
  const { data, error, loading, reload } = useLoad(() => api.get<{ tickets: TicketRow[] }>(`/admin/support/tickets${status ? `?status=${status}` : ""}`), [status]);
  return (
    <>
      <PageHead title="Support" subtitle="Les demandes d'assistance des clients et des prestataires">
        <button className="btn ghost sm" onClick={reload}>Actualiser</button>
      </PageHead>
      <div className="tabs">
        {([["OPEN", "À traiter"], ["ANSWERED", "Répondues"], ["CLOSED", "Fermées"], ["", "Toutes"]] as const).map(([k, l]) => (
          <button key={k} className={`chip ${status === k ? "on" : ""}`} onClick={() => setStatus(k)}>{l}</button>
        ))}
      </div>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : null}
      {data && data.tickets.length === 0 ? <Empty>Aucune demande dans cette vue.</Empty> : null}
      {data && data.tickets.length > 0 ? (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Demande</th><th>De</th><th>Catégorie</th><th>État</th><th>Dernier message</th><th>Mise à jour</th></tr></thead>
            <tbody>
              {data.tickets.map((t) => (
                <tr key={t.id} className="click" onClick={() => (window.location.hash = `#/support/${t.id}`)}>
                  <td><b>{t.subject}</b></td>
                  <td>{t.user?.fullName ?? "Sans nom"}<div className="muted small">{phone(t.user?.phone)} · {ROLE[t.user?.role ?? ""] ?? t.user?.role}</div></td>
                  <td>{CATEGORY[t.category] ?? t.category}</td>
                  <td><Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge></td>
                  <td className="small">{t.lastMessage ? `${t.lastMessage.authorRole === "ADMIN" ? "Vous : " : ""}${t.lastMessage.text}` : "—"}</td>
                  <td className="small">{dateTime(t.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function Detail({ id }: { id: string }) {
  const toast = useToast();
  const { data: t, error, loading, reload, setData } = useLoad(() => api.get<TicketDetail>(`/admin/support/tickets/${id}`), [id]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);

  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post(`/admin/support/tickets/${id}/reply`, { text: text.trim() });
      setText("");
      toast("Réponse envoyée.");
      setData(await api.get<TicketDetail>(`/admin/support/tickets/${id}`));
    } catch (e) {
      toast(e instanceof Error ? e.message : "Envoi impossible", true);
    } finally {
      setBusy(false);
    }
  }

  if (loading && !t) return <Spinner />;
  if (!t) return <ErrorBox error={error ?? "Demande introuvable"} onRetry={reload} />;
  return (
    <>
      <p><a href="#/support">← Toutes les demandes</a></p>
      <PageHead title={t.subject} subtitle={`${t.user.fullName ?? "Sans nom"} · ${phone(t.user.phone)} · ${ROLE[t.user.role] ?? t.user.role} · ${CATEGORY[t.category] ?? t.category}`}>
        <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
        {t.status !== "CLOSED" ? <button className="btn ghost sm" onClick={() => setClosing(true)}>Fermer la demande</button> : null}
      </PageHead>
      {t.rideId ? <div className="infobox">Course concernée : <code>{t.rideId}</code></div> : null}
      <div className="card">
        <div className="chat">
          {t.messages.map((m) => (
            <div key={m.id} className={`msg ${m.authorRole === "ADMIN" ? "admin" : ""}`}>
              {m.text}
              <div className="t">{m.authorRole === "ADMIN" ? "AZƆ̀" : t.user.fullName ?? "Utilisateur"} · {dateTime(m.createdAt)}</div>
            </div>
          ))}
        </div>
      </div>
      {t.status !== "CLOSED" ? (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="field">
            <label>Ta réponse</label>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Écris ta réponse : l'utilisateur la reçoit en notification." maxLength={2000} />
          </div>
          <button className="btn" onClick={send} disabled={busy || !text.trim()}>{busy ? "Envoi…" : "Envoyer la réponse"}</button>
        </div>
      ) : <div className="infobox" style={{ marginTop: 16 }}>Cette demande est fermée.</div>}
      {closing ? <ConfirmModal title="Fermer cette demande" confirmLabel="Fermer" message="L'utilisateur est prévenu ; il devra ouvrir une nouvelle demande pour reposer une question." onClose={() => setClosing(false)} onConfirm={() => api.post(`/admin/support/tickets/${id}/close`).then(() => { toast("Demande fermée."); return reload(); })} /> : null}
    </>
  );
}
