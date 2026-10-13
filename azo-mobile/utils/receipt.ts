import { RideReceipt } from "../services/api";
import { tr } from "../i18n";

/** Texte du reçu, prêt à partager (WhatsApp, SMS, e-mail…). Montants et libellés viennent du serveur. */
export function receiptText(r: RideReceipt, vehicleLabel: string, locale: string): string {
  const money = (n: number) => `${n.toLocaleString(locale)} ${r.currency}`;
  const lines = [
    tr("receipt.heading", { ref: r.reference }),
    tr("receipt.date", { date: new Date(r.date).toLocaleString(locale) }),
  ];
  if (r.originLabel || r.destLabel) lines.push(tr("receipt.route", { from: r.originLabel ?? "—", to: r.destLabel ?? "—" }));
  lines.push(tr("receipt.vehicle", { vehicle: vehicleLabel }), tr("receipt.distance", { km: r.distanceKm.toLocaleString(locale) }));
  if (r.priceMode === "PARTIAL") lines.push(tr("receipt.partial"));
  if (r.driver) lines.push(tr("receipt.driver", { name: r.driver }));
  lines.push(tr("receipt.amount", { amount: money(r.amount) }), tr("receipt.payment"));
  if (typeof r.net === "number" && typeof r.commission === "number") {
    lines.push(tr("receipt.net", { net: money(r.net), commission: money(r.commission) }));
  }
  return lines.join("\n");
}
