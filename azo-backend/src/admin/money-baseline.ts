import { PrismaService } from "../prisma/prisma.service";

export const MONEY_BASELINE_KEY = "moneyBaselineAt";

/** Date à partir de laquelle les chiffres d'argent du tableau de bord comptent (remise à zéro) ; null = depuis le début. */
export async function moneyBaseline(prisma: PrismaService): Promise<Date | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: MONEY_BASELINE_KEY } });
    const d = row ? new Date(row.value) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

export function setMoneyBaseline(prisma: PrismaService, at: Date = new Date()) {
  return prisma.appSetting.upsert({ where: { key: MONEY_BASELINE_KEY }, create: { key: MONEY_BASELINE_KEY, value: at.toISOString() }, update: { value: at.toISOString() } });
}
