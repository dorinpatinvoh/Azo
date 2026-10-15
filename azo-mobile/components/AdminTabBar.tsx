import React from "react";
import PillTabBar, { type PillTabItem } from "./PillTabBar";

/** Onglets de l'espace administrateur : chacun ouvre son écran (le choix est géré par App.tsx). */
export type AdminTab = "providers" | "dashboard" | "finance" | "support";

const ADMIN_TABS: PillTabItem<AdminTab>[] = [
  { id: "providers", label: "Dossiers", icon: "shield-checkmark-outline", iconActive: "shield-checkmark" },
  { id: "dashboard", label: "Pilotage", icon: "speedometer-outline", iconActive: "speedometer" },
  { id: "finance", label: "Finances", icon: "cash-outline", iconActive: "cash" },
  { id: "support", label: "Support", icon: "headset-outline", iconActive: "headset" },
];

type Props = { active: AdminTab; onNavigate?: (tab: AdminTab) => void };

/** Barre du bas de l'administrateur (même pilule que les autres espaces). */
export default function AdminTabBar({ active, onNavigate }: Props) {
  return <PillTabBar items={ADMIN_TABS} active={active} onNavigate={(tab) => onNavigate?.(tab)} />;
}
