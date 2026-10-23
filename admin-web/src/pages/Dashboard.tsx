import React from "react";
import { api } from "../api";
import { Badge, Empty, ErrorBox, PageHead, Spinner, Stat, useLoad } from "../ui";
import { EVENT_LABEL, TYPE_LABEL, dateTime, fcfa } from "../format";
import type { AuditEvent, FinanceSummary, GlobalStats, ProviderStats } from "../types";

export default function Dashboard() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [stats, providers, finance, audit] = await Promise.all([
      api.get<GlobalStats>("/admin/stats"),
      api.get<ProviderStats>("/admin/providers/stats"),
      api.get<FinanceSummary>("/admin/finance"),
      api.get<AuditEvent[]>("/admin/audit-log"),
    ]);
    return { stats, providers, finance, audit };
  });

  return (
    <>
      <PageHead title="Tableau de bord" subtitle="Vue d'ensemble de l'activité AZƆ̀">
        <button className="btn ghost sm" onClick={reload}>Actualiser</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : null}
      {data ? (
        <div className="stack">
          <div className="grid g4">
            <Stat hero value={fcfa(data.finance.total)} label="Gains cumulés de l'entreprise" />
            <Stat value={fcfa(data.finance.thisMonth)} label="Gains de ce mois" />
            <Stat value={fcfa(data.finance.available)} label="Disponible au retrait" />
            <Stat value={fcfa(data.stats.commissionsRevenue)} label="Commissions des courses et livraisons" />
          </div>

          <div className="grid g4">
            <Stat hero value={data.stats.inProgress} label="En cours en ce moment" />
            <Stat value={`${data.stats.today.rides + data.stats.today.deliveries}`} label={`Aujourd'hui : ${data.stats.today.rides} course(s), ${data.stats.today.deliveries} livraison(s)`} />
            <Stat value={fcfa(data.stats.today.volume)} label="Volume terminé aujourd'hui" />
            <Stat value={fcfa(data.stats.volumeTotal)} label="Volume total terminé" />
          </div>

          <div className="grid g4">
            <Stat value={data.stats.users.toLocaleString("fr-FR")} label={`Comptes (${data.stats.clients.toLocaleString("fr-FR")} clients) · +${data.stats.newUsers7d} en 7 jours`} />
            <Stat value={`${data.stats.completedRides} / ${data.stats.rides}`} label="Courses terminées / demandées" />
            <Stat value={`${data.stats.completedDeliveries} / ${data.stats.deliveries}`} label="Livraisons terminées / demandées" />
            <Stat value={data.stats.averageRating != null ? `${data.stats.averageRating.toLocaleString("fr-FR")} / 5` : "—"} label={`Note moyenne des courses · ${data.stats.agencies} agence(s)`} />
          </div>

          <div className="card">
            <div className="row between">
              <h2>7 derniers jours</h2>
              <span className="muted small">courses + livraisons demandées par jour</span>
            </div>
            <WeekBars week={data.stats.week} />
          </div>

          {data.stats.providerWithdrawalsPending.count > 0 ? (
            <div className="card">
              <div className="row between">
                <h2>Retraits de prestataires à payer</h2>
                <a href="#/retraits">Ouvrir</a>
              </div>
              <p style={{ margin: "8px 0 0" }}><b>{data.stats.providerWithdrawalsPending.count}</b> demande(s) pour <b>{fcfa(data.stats.providerWithdrawalsPending.amount)}</b></p>
            </div>
          ) : null}

          <div className="grid g2">
            <div className="card">
              <div className="row between">
                <h2>Dossiers prestataires</h2>
                <a href="#/dossiers">Ouvrir</a>
              </div>
              <div className="grid g3" style={{ marginTop: 12 }}>
                <Mini value={data.providers.pending} label="À traiter" warn={data.providers.pending > 0} />
                <Mini value={data.providers.overdue} label={`En retard (> ${data.providers.slaHours} h)`} warn={data.providers.overdue > 0} />
                <Mini value={data.providers.approved} label="Validés" />
              </div>
              <p className="muted small" style={{ marginBottom: 0 }}>
                {data.providers.averageReviewHours != null ? `Délai moyen d'examen : ${data.providers.averageReviewHours.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} h · ` : ""}
                {data.providers.suspended} suspendu(s) · {data.stats.blockedUsers} compte(s) bloqué(s)
              </p>
              <div className="row" style={{ marginTop: 10 }}>
                {Object.entries(data.providers.byType).map(([t, n]) => (
                  <Badge key={t}>{TYPE_LABEL[t] ?? t} : {n}</Badge>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="row between">
                <h2>Dernières actions sur les dossiers</h2>
                <a href="#/journal">Journal complet</a>
              </div>
              {data.audit.length === 0 ? (
                <Empty>Aucune action pour le moment.</Empty>
              ) : (
                <ul className="timeline" style={{ marginTop: 12 }}>
                  {data.audit.slice(0, 6).map((e) => (
                    <li key={e.id}>
                      <b>{EVENT_LABEL[e.type] ?? e.type}</b> · {e.provider.name}
                      <div className="muted small">{dateTime(e.createdAt)}{e.comment ? ` — ${e.comment}` : ""}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function WeekBars({ week }: { week: { day: string; rides: number; deliveries: number; volume: number }[] }) {
  const max = Math.max(1, ...week.map((w) => w.rides + w.deliveries));
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 130, marginTop: 14 }}>
      {week.map((w) => {
        const n = w.rides + w.deliveries;
        const label = new Date(w.day + "T12:00:00Z").toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
        return (
          <div key={w.day} style={{ flex: 1, textAlign: "center", minWidth: 0 }} title={`${w.rides} course(s), ${w.deliveries} livraison(s), ${fcfa(w.volume)} terminés`}>
            <div className="small">{n}</div>
            <div style={{ height: Math.max(3, (n / max) * 80), background: "var(--p)", borderRadius: 6, opacity: n ? 1 : 0.25 }} />
            <div className="muted small" style={{ marginTop: 4 }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

function Mini({ value, label, warn }: { value: number; label: string; warn?: boolean }) {
  return (
    <div className="stat">
      <span className="v" style={warn ? { color: "var(--sec)" } : undefined}>{value}</span>
      <span className="l">{label}</span>
    </div>
  );
}
