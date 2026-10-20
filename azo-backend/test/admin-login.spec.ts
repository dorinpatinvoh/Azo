jest.mock("@prisma/client", () => ({}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/providers/providers.module", () => ({ ProvidersService: class ProvidersService {} }));
jest.mock("../src/referrals/referrals.module", () => ({ ReferralsService: class ReferralsService {} }));

import { ForbiddenException } from "@nestjs/common";
import { AuthService } from "../src/auth/auth.service";
import { hashPassword, isStrongPassword, verifyPassword } from "../src/common/password";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const scriptLib = require("../scripts/lib/password");

describe("Mot de passe de la console administrateur", () => {
  it("hache avec un sel et vérifie ; jamais le mot de passe en clair", () => {
    const h = hashPassword("Boss2026secure");
    expect(h).toMatch(/^scrypt\$16384\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(h).not.toContain("Boss2026secure");
    expect(verifyPassword("Boss2026secure", h)).toBe(true);
    expect(verifyPassword("boss2026secure", h)).toBe(false);
    expect(hashPassword("Boss2026secure")).not.toBe(h);
    expect(verifyPassword("x", null)).toBe(false);
    expect(verifyPassword("x", "texte quelconque")).toBe(false);
  });

  it("le script de création du compte et le serveur utilisent le même algorithme", () => {
    expect(verifyPassword("Boss2026secure", scriptLib.hashPassword("Boss2026secure"))).toBe(true);
    expect(scriptLib.verifyPassword("Boss2026secure", hashPassword("Boss2026secure"))).toBe(true);
  });

  it("exige 10 caractères, une lettre et un chiffre", () => {
    expect(isStrongPassword("Boss2026secure")).toBe(true);
    expect(isStrongPassword("court1")).toBe(false);
    expect(isStrongPassword("uniquementdeslettres")).toBe(false);
    expect(isStrongPassword("1234567890123")).toBe(false);
  });
});

describe("Connexion administrateur (numéro + mot de passe)", () => {
  const PHONE = "0197000099";
  const make = (user: Record<string, unknown> | null) => {
    const prisma: any = { user: { findFirst: jest.fn().mockResolvedValue(user), findUnique: jest.fn() } };
    const jwt: any = { signAsync: jest.fn().mockResolvedValue("jeton"), verify: jest.fn() };
    return { prisma, jwt, service: new AuthService(prisma, jwt, {} as any) };
  };
  const admin = () => ({ id: "a1", phone: "+2290197000099", role: "ADMIN", status: "ACTIVE", fullName: "Boss", passwordHash: hashPassword("Boss2026secure"), createdAt: new Date() });

  it("bon mot de passe : jeton de 12 heures", async () => {
    const { service, jwt } = make(admin());
    const r: any = await service.adminLogin(PHONE, "Boss2026secure", "1.2.3.4");
    expect(r.token).toBe("jeton");
    expect(r.user).toEqual({ id: "a1", phone: "+2290197000099", fullName: "Boss", role: "ADMIN" });
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ sub: "a1", role: "ADMIN" }), { expiresIn: "12h" });
  });

  it("même message pour un mauvais mot de passe, un compte inconnu, un non-administrateur et un compte sans mot de passe", async () => {
    const cases: [string, Record<string, unknown> | null][] = [
      ["mauvais mot de passe", admin()],
      ["inconnu", null],
      ["client", { ...admin(), role: "CLIENT" }],
      ["sans mot de passe", { ...admin(), passwordHash: null }],
    ];
    for (const [, user] of cases) {
      const { service } = make(user);
      await expect(service.adminLogin(PHONE, "Mauvais2026pass", "9.9.9.9")).rejects.toThrow("Numéro ou mot de passe incorrect.");
    }
  });

  it("5 échecs en 15 minutes bloquent le numéro, même avec le bon mot de passe", async () => {
    const { service, jwt } = make(admin());
    for (let i = 0; i < 5; i++) await expect(service.adminLogin(PHONE, "Faux2026motdepasse", "5.5.5.5")).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.adminLogin(PHONE, "Boss2026secure", "5.5.5.5")).rejects.toThrow(/Trop de tentatives/);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it("un compte bloqué ne se connecte pas", async () => {
    const { service } = make({ ...admin(), status: "BLOCKED" });
    await expect(service.adminLogin(PHONE, "Boss2026secure", "7.7.7.7")).rejects.toThrow("Compte suspendu.");
  });

  it("un numéro invalide est refusé", async () => {
    const { service } = make(null);
    await expect(service.adminLogin("123", "x", "1.1.1.1")).rejects.toThrow(/invalide/);
  });

  it("un compte administrateur ne s'ouvre jamais avec le code de simulation 0000", async () => {
    const previous = process.env.SMS_PROVIDER;
    process.env.SMS_PROVIDER = "simulation";
    try {
      const { service, jwt } = make(admin());
      await expect(service.verifyOtp(PHONE, "0000")).rejects.toThrow(/mot de passe sur la console web/);
      expect(jwt.signAsync).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.SMS_PROVIDER;
      else process.env.SMS_PROVIDER = previous;
    }
  });
});
