import React, { useState } from "react";
import { api } from "../api";
import { Badge, Empty, ErrorBox, Field, Modal, PageHead, Spinner, useLoad, useToast } from "../ui";
import { fcfa } from "../format";
import type { RentalVehicle } from "../types";

export default function Rentals() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get<RentalVehicle[]>("/admin/rentals/vehicles"));
  const [editing, setEditing] = useState<RentalVehicle | "new" | null>(null);

  async function toggle(v: RentalVehicle) {
    try {
      await api.put(`/admin/rentals/vehicles/${v.id}`, { name: v.name, seats: v.seats, pricePerDay: v.pricePerDay, price4h: v.price4h, priceWeek: v.priceWeek, active: !v.active });
      toast(v.active ? "Véhicule retiré du catalogue." : "Véhicule remis au catalogue.");
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Impossible", true);
    }
  }

  return (
    <>
      <PageHead title="Location de voitures" subtitle="Le catalogue que voient les clients : véhicules et prix (4 heures, jour, semaine)">
        <button className="btn ghost sm" onClick={reload}>Actualiser</button>
        <button className="btn" onClick={() => setEditing("new")}>Ajouter un véhicule</button>
      </PageHead>
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : null}
      {data && data.length === 0 ? <Empty>Le catalogue est vide : les clients ne voient aucun véhicule à louer.</Empty> : null}
      {data && data.length > 0 ? (
        <div className="tablewrap">
          <table>
            <thead><tr><th>Véhicule</th><th className="num">Places</th><th className="num">4 heures</th><th className="num">Jour</th><th className="num">Semaine</th><th>État</th><th /></tr></thead>
            <tbody>
              {data.map((v) => (
                <tr key={v.id}>
                  <td><b>{v.name}</b></td>
                  <td className="num">{v.seats}</td>
                  <td className="num">{v.price4h != null ? fcfa(v.price4h) : <span className="muted">non proposée</span>}</td>
                  <td className="num">{fcfa(v.pricePerDay)}</td>
                  <td className="num">{v.priceWeek != null ? fcfa(v.priceWeek) : <span className="muted">non proposée</span>}</td>
                  <td><Badge tone={v.active ? "ok" : "grey"}>{v.active ? "Au catalogue" : "Retiré"}</Badge></td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn ghost sm" onClick={() => setEditing(v)}>Modifier</button>
                      <button className="btn ghost sm" onClick={() => toggle(v)}>{v.active ? "Retirer" : "Remettre"}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {editing ? <VehicleModal vehicle={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { toast("Catalogue mis à jour."); reload(); }} /> : null}
    </>
  );
}

function VehicleModal({ vehicle, onClose, onDone }: { vehicle: RentalVehicle | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(vehicle?.name ?? "");
  const [seats, setSeats] = useState(String(vehicle?.seats ?? 4));
  const [day, setDay] = useState(vehicle ? String(vehicle.pricePerDay) : "");
  const [h4, setH4] = useState(vehicle?.price4h != null ? String(vehicle.price4h) : "");
  const [week, setWeek] = useState(vehicle?.priceWeek != null ? String(vehicle.priceWeek) : "");
  const [active, setActive] = useState(vehicle?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const num = (s: string) => (s.trim() === "" ? null : Number(s));
  const valid = name.trim().length >= 2 && Number(seats) >= 1 && Number(day) >= 1000 && (num(h4) === null || (num(h4) as number) >= 1000) && (num(week) === null || (num(week) as number) >= 1000);

  async function go() {
    setBusy(true);
    setError(null);
    const body = { name: name.trim(), seats: Number(seats), pricePerDay: Number(day), price4h: num(h4), priceWeek: num(week), active };
    try {
      if (vehicle) await api.put(`/admin/rentals/vehicles/${vehicle.id}`, body);
      else await api.post("/admin/rentals/vehicles", body);
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Enregistrement impossible");
      setBusy(false);
    }
  }
  const digits = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => set(e.target.value.replace(/\D/g, "").slice(0, 8));
  return (
    <Modal title={vehicle ? "Modifier le véhicule" : "Ajouter un véhicule"} onClose={onClose}>
      <Field label="Nom"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. Toyota Corolla" autoFocus /></Field>
      <Field label="Nombre de places"><input inputMode="numeric" value={seats} onChange={digits(setSeats)} /></Field>
      <Field label="Prix par jour (FCFA)" hint="Obligatoire, 1 000 F au minimum"><input inputMode="numeric" value={day} onChange={digits(setDay)} /></Field>
      <Field label="Prix pour 4 heures (FCFA)" hint="Laisse vide si cette formule n'est pas proposée"><input inputMode="numeric" value={h4} onChange={digits(setH4)} /></Field>
      <Field label="Prix par semaine (FCFA)" hint="Laisse vide si cette formule n'est pas proposée"><input inputMode="numeric" value={week} onChange={digits(setWeek)} /></Field>
      <label className="row" style={{ marginBottom: 6 }}>
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: "auto" }} /> Visible dans le catalogue des clients
      </label>
      <ErrorBox error={error} />
      <div className="actions">
        <button className="btn ghost" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn" onClick={go} disabled={!valid || busy}>{busy ? "…" : "Enregistrer"}</button>
      </div>
    </Modal>
  );
}
