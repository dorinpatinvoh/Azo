import { loadTarificationConfig } from "../src/pricing/tarification.config";

// Grille des niveaux d'agence validée le 14/10/2026 (six niveaux)
describe("niveaux d'agence", () => {
  const levels = loadTarificationConfig().agencyLevels;

  it.each([
    ["PRO", 100000, 3, 1, 30],
    ["SILVER", 215500, 2.5, 0.75, 75],
    ["OR", 450500, 2, 0.5, 100],
    ["DIAMANT", 600500, 1, 0.25, 1000],
    ["PLATINE", 1200500, 0.5, 0.2, 2500],
    ["ELITE", 2500500, 0.25, 0.1, 5000],
  ])("%s : activation %i F, commission %f %%, retrait %f %%, %i comptes", (level, fee, commission, withdrawal, accounts) => {
    expect(levels[level as keyof typeof levels]).toEqual({
      activationFee: fee,
      commissionPct: commission,
      withdrawalFeePct: withdrawal,
      maxAccounts: accounts,
    });
  });
});
