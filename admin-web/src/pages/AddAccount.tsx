import React, { useState } from "react";
import { api } from "../api";
import { ErrorBox, Field, PageHead, useToast } from "../ui";
import { fcfa, phone as formatPhone } from "../format";

type Kind = "spider-essence" | "spider-electrique" | "spider-tricycle" | "voiture" | "coursier-personnel" | "livreur-express" | "agence";

const KINDS: { key: Kind; label: string; icon: string; vehicles?: { value: string; label: string }[] }[] = [
  { key: "spider-essence", label: "Speeder à essence", icon: "🏍️" },
  { key: "spider-electrique", label: "Speeder électrique", icon: "⚡" },
  { key: "spider-tricycle", label: "Speeder tricycle", icon: "🛺" },
  { key: "voiture", label: "Conducteur de voiture", icon: "🚗", vehicles: [{ value: "GAZELLE", label: "Gazelle" }, { value: "KOALA", label: "Koala (climatisé)" }, { value: "LEOPARD", label: "Léopard (premium)" }] },
  {
    key: "coursier-personnel",
    label: "Coursier personnel",
    icon: "🚶",
    vehicles: [
      { value: "ZEM_ESSENCE", label: "Moto à essence" }, { value: "ZEM_ELECTRIC", label: "Moto électrique" }, { value: "ZEM_TRICYCLE", label: "Tricycle" },
      { value: "GAZELLE", label: "Gazelle" }, { value: "KOALA", label: "Koala" }, { value: "LEOPARD", label: "Léopard" },
    ],
  },
  { key: "livreur-express", label: "Livreur express", icon: "📦", vehicles: [{ value: "ZEM_ESSENCE", label: "Moto à essence" }, { value: "ZEM_ELECTRIC", label: "Moto électrique" }, { value: "ZEM_TRICYCLE", label: "Tricycle (gros colis)" }] },
  { key: "agence", label: "Agence de flotte", icon: "🏢" },
];

const LEVELS: { value: string; label: string; fee: number }[] = [
  { value: "PRO", label: "PRO", fee: 100000 },
  { value: "SILVER", label: "SILVER", fee: 215500 },
  { value: "OR", label: "OR", fee: 450500 },
  { value: "DIAMANT", label: "DIAMANT", fee: 600500 },
  { value: "PLATINE", label: "PLATINE", fee: 1200500 },
  { value: "ELITE", label: "ELITE", fee: 2500500 },
];

export default function AddAccount() {
  const toast = useToast();
  const [kind, setKind] = useState<Kind>("spider-essence");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [plate, setPlate] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [plan, setPlan] = useState("PRO");
  const [activated, setActivated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const def = KINDS.find((k) => k.key === kind)!;
  const isAgency = kind === "agence";
  const digits = phone.replace(/\D/g, "");
  const phoneOk = digits.length === 10 && digits.startsWith("01");
  const ready = phoneOk && name.trim().length >= 2 && (!isAgency || agencyName.trim().length >= 2);

  function pickKind(k: Kind) {
    setKind(k);
    setVehicle("");
    setError(null);
    setDone(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (isAgency) {
        const r = await api.post<{ agencyName: string; plan: string; activationFee: number; activated: boolean; phone: string; convertedFromClient: boolean }>("/admin/accounts/agency", {
          phone, ownerName: name, agencyName, plan, activated,
        });
        setDone(`Agence « ${r.agencyName} » créée (niveau ${r.plan}). Gérant : ${formatPhone(r.phone)}. ${r.activated ? "Frais d'activation marqués comme payés." : `Frais d'activation à payer par le gérant : ${fcfa(r.activationFee)}.`}${r.convertedFromClient ? " Ce numéro était un compte client : il devient le compte du gérant." : ""}`);
      } else {
        const r = await api.post<{ fullName: string; profile: string; phone: string; convertedFromClient: boolean }>("/admin/accounts/provider", {
          phone, fullName: name, profile: kind, ...(vehicle ? { vehicle } : {}), ...(plate.trim() ? { plate } : {}),
        });
        setDone(`${r.profile} créé : ${r.fullName}, ${formatPhone(r.phone)}. Dossier déjà approuvé : il se connecte avec son numéro et le code reçu.${r.convertedFromClient ? " Ce numéro était un compte client : il devient prestataire." : ""}`);
      }
      toast("Compte créé.");
      setPhone("");
      setName("");
      setPlate("");
      setAgencyName("");
      setActivated(false);
    } catch (e: any) {
      setError(e?.message ?? "Création impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead title="Ajouter un compte" subtitle="Créer un Speeder, un coursier, un livreur ou une agence directement depuis la console" />
      <div className="card" style={{ maxWidth: 640 }}>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
          {KINDS.map((k) => (
            <button key={k.key} className={`btn ${kind === k.key ? "" : "ghost"} sm`} onClick={() => pickKind(k.key)}>{k.icon} {k.label}</button>
          ))}
        </div>

        <Field label="Numéro de téléphone" hint="10 chiffres commençant par 01. La personne se connecte avec ce numéro.">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="01 61 42 36 02" />
        </Field>
        <Field label={isAgency ? "Nom du gérant" : "Nom et prénom"}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Nom et prénom" />
        </Field>

        {isAgency ? (
          <>
            <Field label="Nom de l'agence">
              <input value={agencyName} onChange={(e) => setAgencyName(e.target.value)} maxLength={80} />
            </Field>
            <Field label="Niveau" hint="Frais d'activation, commission par course et nombre de comptes dépendent du niveau.">
              <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label} — activation {fcfa(l.fee)}</option>)}
              </select>
            </Field>
            <label className="row" style={{ gap: 8, margin: "6px 0 14px" }}>
              <input type="checkbox" checked={activated} onChange={(e) => setActivated(e.target.checked)} />
              <span>Les frais d'activation ont déjà été encaissés (l'agence est activée tout de suite)</span>
            </label>
          </>
        ) : (
          <>
            {def.vehicles ? (
              <Field label="Véhicule">
                <select value={vehicle || def.vehicles[0].value} onChange={(e) => setVehicle(e.target.value)}>
                  {def.vehicles.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
                </select>
              </Field>
            ) : null}
            <Field label="Plaque d'immatriculation (facultatif)">
              <input value={plate} onChange={(e) => setPlate(e.target.value)} maxLength={20} />
            </Field>
          </>
        )}

        <p className="muted small">
          Le compte est créé <b>déjà approuvé</b>, sans pièces à fournir : vérifie l'identité de la personne avant de l'ajouter. Son portefeuille démarre à 0 F. Si ce numéro est déjà un compte client, il est converti (même compte). Un numéro qui a déjà un dossier prestataire, une agence ou un administrateur est refusé.
        </p>
        <ErrorBox error={error} />
        {done ? <div className="infobox">{done}</div> : null}
        <div className="actions">
          <button className="btn" disabled={!ready || busy} onClick={submit}>{busy ? "Création…" : isAgency ? "Créer l'agence" : "Créer le compte"}</button>
        </div>
      </div>
    </>
  );
}
