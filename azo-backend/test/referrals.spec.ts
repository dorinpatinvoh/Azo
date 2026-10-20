jest.mock("@prisma/client", () => ({ Role: { CLIENT: "CLIENT", DRIVER: "DRIVER", AGENCY: "AGENCY", ADMIN: "ADMIN" } }));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));

import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { ReferralsService } from "../src/referrals/referrals.module";
import { ACTIVE_WINDOW_DAYS, commercialCode, generateLegacyReferralCode, kindOf, maskPhone, nextCommercialNumber, normalizeReferralCode, referralLink, statusOf } from "../src/referrals/referral-logic";

describe("Parrainage : règles", () => {
  it("le code promo d'un commercial est COM-AZO suivi de son numéro d'ordre", () => {
    expect(commercialCode(1)).toBe("COM-AZO001");
    expect(commercialCode(42)).toBe("COM-AZO042");
    expect(commercialCode(1234)).toBe("COM-AZO1234");
    expect(nextCommercialNumber([])).toBe(1);
    expect(nextCommercialNumber(["COM-AZO001", "COM-AZO002"])).toBe(3);
    expect(nextCommercialNumber(["COM-AZO005", "COM-AZO002", "AZO-7K4M2Q"])).toBe(6);
  });

  it("normalise le code saisi : casse, espaces et tiret ignorés ; les anciens codes AZO-XXXXXX restent acceptés", () => {
    expect(normalizeReferralCode("com-azo001")).toBe("COM-AZO001");
    expect(normalizeReferralCode(" com azo 1 ")).toBe("COM-AZO001");
    expect(normalizeReferralCode("COMAZO012")).toBe("COM-AZO012");
    expect(normalizeReferralCode("COM-AZO1234")).toBe("COM-AZO1234");
    expect(normalizeReferralCode("azo-7k4m2q")).toBe("AZO-7K4M2Q");
    expect(normalizeReferralCode(" 7k4m 2q ")).toBe("AZO-7K4M2Q");
    expect(generateLegacyReferralCode()).toMatch(/^AZO-[A-HJKMNP-Z2-9]{6}$/);
    expect(normalizeReferralCode("12")).toBeNull();
    expect(normalizeReferralCode("COM-AZO")).toBeNull();
    expect(normalizeReferralCode("")).toBeNull();
    expect(normalizeReferralCode(undefined)).toBeNull();
  });

  it("le lien personnel mène à la page de téléchargement avec le code", () => {
    expect(referralLink("COM-AZO001", "https://azo.angidsnpro.com/")).toBe("https://azo.angidsnpro.com/?ref=COM-AZO001#telecharger");
    expect(referralLink("COM-AZO002", "https://azo.angidsnpro.com/#telecharger")).toBe("https://azo.angidsnpro.com/?ref=COM-AZO002#telecharger");
    expect(referralLink("COM-AZO003", "https://exemple.bj/?x=1")).toBe("https://exemple.bj/?x=1&ref=COM-AZO003#telecharger");
  });

  it("classe les prestataires : Speeder, agence, coursier personnel, livreur express", () => {
    expect(kindOf({ type: "DRIVER", categoryId: null }, null)).toBe("SPEEDER");
    expect(kindOf({ type: "AGENCY", categoryId: "FLOTTE_MIXTE" }, null)).toBe("AGENCE");
    expect(kindOf({ type: "COURIER", categoryId: "COURSIER_PERSONNEL" }, null)).toBe("COURSIER_PERSONNEL");
    expect(kindOf({ type: "COURIER", categoryId: "COURSIER_EXPRESS" }, null)).toBe("LIVREUR_EXPRESS");
    expect(kindOf({ type: "COURIER", categoryId: "LIVREUR_COLIS" }, null)).toBe("LIVREUR_EXPRESS");
    expect(kindOf(null, "DRIVER")).toBe("SPEEDER");
    expect(kindOf(null, "AGENCY")).toBe("AGENCE");
    expect(kindOf(null, "COURIER")).toBeNull();
  });

  it("actif = dossier validé et une mission terminée dans les 30 jours ; sinon inactif", () => {
    const now = new Date("2026-10-18T10:00:00Z");
    const days = (n: number) => new Date(now.getTime() - n * 24 * 3600 * 1000);
    expect(ACTIVE_WINDOW_DAYS).toBe(30);
    expect(statusOf("APPROVED", days(2), now)).toBe("ACTIF");
    expect(statusOf("APPROVED", days(29), now)).toBe("ACTIF");
    expect(statusOf("APPROVED", days(31), now)).toBe("INACTIF");
    expect(statusOf("APPROVED", null, now)).toBe("INACTIF");
    for (const s of ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEED_INFO", null]) expect(statusOf(s as any, days(1), now)).toBe("EN_ATTENTE");
    expect(statusOf("REJECTED", null, now)).toBe("REFUSE");
    expect(statusOf("SUSPENDED", days(1), now)).toBe("SUSPENDU");
  });

  it("masque le numéro pour le parrain", () => {
    expect(maskPhone("+2290197000042")).toBe("01 •• •• •• 42");
  });
});

describe("Parrainage : service", () => {
  const make = (over: Record<string, any> = {}) => {
    const prisma: any = {
      referrer: { findUnique: jest.fn(), create: jest.fn().mockResolvedValue({ id: "r1" }), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      user: { findUnique: jest.fn(), findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
      ...over,
    };
    return { prisma, service: new ReferralsService(prisma) };
  };

  it("rattache un nouveau prestataire quand le code est valide", async () => {
    const { prisma, service } = make();
    prisma.referrer.findUnique.mockResolvedValue({ id: "r1", userId: "p1", active: true });
    prisma.user.findUnique.mockResolvedValue({ referrerId: null, profileCompletedAt: null, referrerProfile: null });
    await expect(service.attachByCode("u1", "com azo 1")).resolves.toBe("APPLIED");
    expect(prisma.referrer.findUnique).toHaveBeenCalledWith({ where: { code: "COM-AZO001" } });
    expect(prisma.user.update.mock.calls[0][0].data).toMatchObject({ referrerId: "r1" });
  });

  it("signale un code inconnu, désactivé ou celui du prestataire lui-même, sans rien enregistrer", async () => {
    const { prisma, service } = make();
    prisma.referrer.findUnique.mockResolvedValueOnce(null);
    await expect(service.attachByCode("u1", "COM-AZO001")).resolves.toBe("INVALID");
    prisma.referrer.findUnique.mockResolvedValueOnce({ id: "r1", userId: "p1", active: false });
    await expect(service.attachByCode("u1", "COM-AZO001")).resolves.toBe("INVALID");
    prisma.referrer.findUnique.mockResolvedValueOnce({ id: "r1", userId: "u1", active: true });
    await expect(service.attachByCode("u1", "COM-AZO001")).resolves.toBe("INVALID");
    await expect(service.attachByCode("u1", "12")).resolves.toBe("INVALID");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("sans code, ou pour un compte déjà parrainé ou déjà inscrit comme client, rien ne change", async () => {
    const { prisma, service } = make();
    await expect(service.attachByCode("u1", "")).resolves.toBe("IGNORED");
    await expect(service.attachByCode("u1", undefined)).resolves.toBe("IGNORED");
    prisma.referrer.findUnique.mockResolvedValue({ id: "r1", userId: "p1", active: true });
    for (const row of [{ referrerId: "r2" }, { profileCompletedAt: new Date() }, { referrerProfile: { id: "x" } }]) {
      prisma.user.findUnique.mockResolvedValueOnce({ referrerId: null, profileCompletedAt: null, referrerProfile: null, ...row });
      await expect(service.attachByCode("u1", "COM-AZO001")).resolves.toBe("IGNORED");
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("l'administrateur crée un parrain avec un code ; un numéro déjà utilisé par un client ou un prestataire est refusé", async () => {
    const { prisma, service } = make();
    prisma.referrer.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: "p1", phone: "+2290197000011" });
    prisma.referrer.findMany.mockResolvedValueOnce([]).mockResolvedValue([{ code: "COM-AZO001" }, { code: "COM-AZO007" }]);
    const r: any = await service.createReferrer("admin1", { fullName: "Kossi Adjovi", phone: "0197000011" });
    expect(r.code).toBe("COM-AZO001");
    expect(r.link).toBe("https://azo.angidsnpro.com/?ref=COM-AZO001#telecharger");
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({ fullName: "Kossi Adjovi", firstName: "Kossi", lastName: "Adjovi" });
    expect(prisma.referrer.create.mock.calls[0][0].data).toMatchObject({ userId: "p1", code: "COM-AZO001", createdById: "admin1" });

    prisma.user.findFirst.mockResolvedValueOnce({ id: "x", role: "CLIENT", profileCompletedAt: new Date(), agencyId: null, provider: null, referrerProfile: null });
    await expect(service.createReferrer("admin1", { fullName: "Ama Dossou", phone: "0197000012" })).rejects.toBeInstanceOf(ConflictException);
    prisma.user.findFirst.mockResolvedValueOnce({ id: "y", role: "CLIENT", profileCompletedAt: null, agencyId: null, provider: { id: "pp" }, referrerProfile: null });
    await expect(service.createReferrer("admin1", { fullName: "Ama Dossou", phone: "0197000013" })).rejects.toBeInstanceOf(ConflictException);
    prisma.user.findFirst.mockResolvedValueOnce({ id: "z", role: "CLIENT", profileCompletedAt: null, agencyId: null, provider: null, referrerProfile: { id: "r9" } });
    await expect(service.createReferrer("admin1", { fullName: "Ama Dossou", phone: "0197000014" })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.createReferrer("admin1", { fullName: "Ama Dossou", phone: "123" })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("l'espace parrain est réservé aux parrains actifs", async () => {
    const { prisma, service } = make();
    prisma.referrer.findUnique.mockResolvedValueOnce(null);
    await expect(service.myOverview("u1")).rejects.toBeInstanceOf(ForbiddenException);
    prisma.referrer.findUnique.mockResolvedValueOnce({ id: "r1", active: false, user: { fullName: "K" }, code: "AZO-AAAAAA", createdAt: new Date() });
    await expect(service.myOverview("u1")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("le rattachement par l'administrateur refuse un client simple, un parrain et un prestataire déjà parrainé", async () => {
    const { prisma, service } = make();
    prisma.referrer.findUnique.mockResolvedValue({ id: "r1", userId: "p1" });
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(service.attach("r1", { phone: "0197000020" })).rejects.toThrow(/Aucun compte/);
    prisma.user.findFirst.mockResolvedValueOnce({ id: "c", referrerId: null, signupKind: "CLIENT", provider: null, referrerProfile: null });
    await expect(service.attach("r1", { phone: "0197000021" })).rejects.toBeInstanceOf(BadRequestException);
    prisma.user.findFirst.mockResolvedValueOnce({ id: "d", referrerId: "r2", signupKind: "DRIVER", provider: { id: "pp" }, referrerProfile: null });
    await expect(service.attach("r1", { phone: "0197000022" })).rejects.toThrow(/déjà un commercial/);
    prisma.user.findFirst.mockResolvedValueOnce({ id: "e", referrerId: null, signupKind: "DRIVER", provider: { id: "pp" }, referrerProfile: { id: "r5" } });
    await expect(service.attach("r1", { phone: "0197000023" })).rejects.toBeInstanceOf(ConflictException);
  });
});
