import React from "react";
import { api } from "../api";
import { Badge, Empty, ErrorBox, PageHead, Spinner, useLoad } from "../ui";
import { EVENT_LABEL, TYPE_LABEL, dateTime, phone } from "../format";
import type { AuditEvent } from "../types";

export default function Audit() {
  const { data, error, loading, reload } = useLoad(() => api.get<AuditEvent[]>("/admin/audit-log"));
  return (
    <>
      <PageHead title="Journal d'audit" subtitle="Les 60 dernières actions sur les dossiers prestataires (qui, quand, pourquoi)">
        <button className="btn ghost sm" onClick={reload}>Actualiser</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : null}
      {data && data.length === 0 ? <Empty>Aucune action enregistrée.</Empty> : null}
      {data && data.length > 0 ? (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Date</th><th>Action</th><th>Prestataire</th><th>Détail</th></tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <td className="small">{dateTime(e.createdAt)}</td>
                  <td><Badge>{EVENT_LABEL[e.type] ?? e.type}</Badge></td>
                  <td>
                    <a href={`#/dossiers/${e.provider.id}`}>{e.provider.name}</a>
                    <div className="muted small">{TYPE_LABEL[e.provider.type] ?? e.provider.type} · {phone(e.provider.phone)}</div>
                  </td>
                  <td>{e.comment ?? "—"}{e.actorId ? <div className="muted small">par un administrateur</div> : <div className="muted small">par le prestataire</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
