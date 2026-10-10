jest.mock("@prisma/client", () => ({}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/providers/providers.module", () => ({ ProvidersService: class ProvidersService {} }));

import {
  AuthService,
  MAX_VERIFY_ATTEMPTS,
  OTP_ATTEMPT_WINDOW_MS,
  OTP_TTL_MS,
  otpLockStatus,
} from "../src/auth/auth.service";

type Row = { id: string; phone: string; code: string; consumed: boolean; attempts: number; createdAt: Date; expiresAt: Date };

/** Mini base en mémoire : assez fidèle pour tester les essais sur plusieurs codes. */
function makeService() {
  const codes: Row[] = [];
  let seq = 0;
  const matches = (r: Row, w: any) =>
    (!w.phone || w.phone.in.includes(r.phone)) &&
    (w.consumed === undefined || r.consumed === w.consumed) &&
    (!w.expiresAt || r.expiresAt > w.expiresAt.gt) &&
    (!w.createdAt || r.createdAt > w.createdAt.gt) &&
    (!w.attempts || r.attempts > w.attempts.gt) &&
    (!w.id || r.id === w.id);
  const prisma = {
    otpCode: {
      count: jest.fn().mockImplementation(async ({ where }) => codes.filter((r) => matches(r, where)).length),
      create: jest.fn().mockImplementation(async ({ data }) => {
        const row = { id: `otp-${++seq}`, consumed: false, attempts: 0, createdAt: new Date(), ...data };
        codes.push(row);
        return row;
      }),
      findFirst: jest.fn().mockImplementation(async ({ where }) =>
        [...codes].reverse().find((r) => matches(r, where)) ?? null),
      findMany: jest.fn().mockImplementation(async ({ where }) => codes.filter((r) => matches(r, where))),
      update: jest.fn().mockImplementation(async ({ where, data }) => {
        const row = codes.find((r) => r.id === where.id)!;
        if (data.attempts?.increment) row.attempts += data.attempts.increment;
        return row;
      }),
      updateMany: jest.fn().mockImplementation(async ({ where, data }) => {
        const hit = codes.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      }),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: "u1", phone: "+2290197000042", role: "CLIENT", status: "ACTIVE", fullName: null }),
      findUnique: jest.fn().mockResolvedValue(null),
    },
  };
  const providers = { statusOf: jest.fn().mockResolvedValue(null), openDraftOnSignup: jest.fn() };
  const service = new AuthService(prisma as any, { signAsync: jest.fn().mockResolvedValue("jwt") } as any, providers as any);
  const issue = async (code: string) => {
    await service.requestOtp("0197000042");
    codes[codes.length - 1].code = code; // le code généré est aléatoire : on le fixe
  };
  return { service, prisma, codes, issue };
}

const PHONE = "0197000042";

describe("expiration du code OTP de connexion", () => {
  beforeEach(() => jest.spyOn(console, "log").mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it("dure 1 minute", () => expect(OTP_TTL_MS).toBe(60_000));

  it("refuse un code dont l'échéance est dépassée", async () => {
    const { service, issue, codes } = makeService();
    await issue("4829");
    codes[0].expiresAt = new Date(Date.now() - 1000);
    await expect(service.verifyOtp(PHONE, "4829")).rejects.toThrow("Code invalide ou expiré");
  });
});

describe("3 essais par heure sur le code OTP de connexion", () => {
  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    process.env.SMS_PROVIDER = "live";
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SMS_PROVIDER;
  });

  it("la règle est de 3 essais sur 1 heure", () => {
    expect(MAX_VERIFY_ATTEMPTS).toBe(3);
    expect(OTP_ATTEMPT_WINDOW_MS).toBe(3_600_000);
  });

  it("indique les essais restants, puis bloque au 3e échec", async () => {
    const { service, issue } = makeService();
    await issue("4829");
    await expect(service.verifyOtp(PHONE, "1111")).rejects.toThrow("Il te reste 2 essais");
    await expect(service.verifyOtp(PHONE, "2222")).rejects.toThrow("Il te reste 1 essai.");
    await expect(service.verifyOtp(PHONE, "3333")).rejects.toThrow("Trop de tentatives");
  });

  it("un nouveau code ne remet PAS le compteur à zéro", async () => {
    const { service, issue } = makeService();
    await issue("4829");
    await service.verifyOtp(PHONE, "1111").catch(() => undefined);
    await service.verifyOtp(PHONE, "2222").catch(() => undefined);
    await issue("5555"); // 2 essais déjà consommés sur ce numéro
    await expect(service.verifyOtp(PHONE, "9999")).rejects.toThrow("Trop de tentatives");
  });

  it("bloqué : même le bon code est refusé, et aucun nouveau code n'est envoyé", async () => {
    const { service, issue, prisma } = makeService();
    await issue("4829");
    for (const bad of ["1111", "2222", "3333"]) await service.verifyOtp(PHONE, bad).catch(() => undefined);

    await expect(service.verifyOtp(PHONE, "4829")).rejects.toThrow(/Réessaie dans \d+ minute/);
    const created = prisma.otpCode.create.mock.calls.length;
    await expect(service.requestOtp(PHONE)).rejects.toThrow(/Réessaie dans \d+ minute/);
    expect(prisma.otpCode.create.mock.calls.length).toBe(created);
  });

  it("les essais plus vieux qu'une heure ne comptent plus", async () => {
    const { service, issue, codes } = makeService();
    await issue("4829");
    for (const bad of ["1111", "2222", "3333"]) await service.verifyOtp(PHONE, bad).catch(() => undefined);
    codes.forEach((r) => (r.createdAt = new Date(Date.now() - OTP_ATTEMPT_WINDOW_MS - 1000)));

    await issue("7777");
    const result: any = await service.verifyOtp(PHONE, "7777");
    expect(result.token).toBe("jwt");
  });

  it("une connexion réussie remet le compteur à zéro", async () => {
    const { service, issue, codes } = makeService();
    await issue("4829");
    await service.verifyOtp(PHONE, "1111").catch(() => undefined);
    await service.verifyOtp(PHONE, "4829");
    expect(codes.every((r) => r.attempts === 0)).toBe(true);
  });

  it("un même code ne peut pas ouvrir deux sessions", async () => {
    const { service, issue } = makeService();
    await issue("4829");
    await service.verifyOtp(PHONE, "4829");
    await expect(service.verifyOtp(PHONE, "4829")).rejects.toThrow("Code invalide ou expiré");
  });

  it("en simulation, la demande de code n'est pas bloquée (0000 reste utilisable)", async () => {
    const { service, issue } = makeService();
    await issue("4829");
    for (const bad of ["1111", "2222", "3333"]) await service.verifyOtp(PHONE, bad).catch(() => undefined);
    process.env.SMS_PROVIDER = "simulation";
    await expect(service.requestOtp(PHONE)).resolves.toMatchObject({ message: "Code envoyé" });
  });
});

describe("otpLockStatus (calcul du déblocage)", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const ago = (min: number) => new Date(now - min * 60_000);

  it("libre sous 3 essais", () => {
    expect(otpLockStatus([{ attempts: 2, createdAt: ago(5) }], now)).toEqual({ locked: false });
  });

  it("bloqué à 3 essais, jusqu'à 1 h après le plus ancien code qui libère un essai", () => {
    const status = otpLockStatus(
      [{ attempts: 1, createdAt: ago(50) }, { attempts: 2, createdAt: ago(10) }],
      now
    );
    expect(status).toEqual({ locked: true, retryAt: new Date(now + 10 * 60_000) });
  });

  it("ignore les essais hors fenêtre", () => {
    expect(otpLockStatus([{ attempts: 3, createdAt: ago(61) }], now)).toEqual({ locked: false });
  });
});
