/** Masque la plaque : « AB1234CD » → « AB123****CD » (début et fin visibles, milieu caché). */
export function maskPlate(plate: string | null | undefined): string | null {
  if (!plate) return null;
  const compact = plate.replace(/[\s-]/g, "");
  if (compact.length <= 3) return "****" + compact.slice(-1);
  const tail = 2;
  const head = Math.min(5, Math.max(1, compact.length - tail - 1));
  return compact.slice(0, head) + "****" + compact.slice(-tail);
}
