import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

jest.mock("@prisma/client", () => ({
  Gender: { M: "M", F: "F" },
  Role: { CLIENT: "CLIENT", DRIVER: "DRIVER", AGENCY: "AGENCY", ADMIN: "ADMIN", ARTISAN: "ARTISAN" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));

import { ROLES_KEY } from "../src/common/decorators/roles.decorator";
import {
  MAX_REGISTRATION_ATTEMPTS,
  RegisterUserDto,
  UsersController,
  UsersService,
  UpdateProfileDto,
} from "../src/users/users.module";
import { RegistrationCompleteGuard } from "../src/common/guards/registration-complete.guard";
import { NpiCryptoService } from "../src/common/npi-crypto.service";

afterEach(() => jest.restoreAllMocks());

async function validateDto<T extends object>(type: new () => T, body: unknown) {
  const dto = plainToInstance(type, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors };
}

function makeService(options: { complete?: boolean; updateError?: unknown } = {}) {
  const stored: Record<string, any> = {
    id: "u1",
    phone: "+2290197000042",
    fullName: null,
    role: "CLIENT",
    status: "ACTIVE",
    createdAt: new Date("2026-10-11T00:00:00Z"),
    firstName: null,
    lastName: null,
    gender: null,
    npiHash: null,
    npiCipher: null,
    npiLast4: null,
    profileCompletedAt: null,
  };
  if (options.complete) {
    Object.assign(stored, {
      firstName: "Kossi",
      lastName: "Adjovi",
      gender: "M",
      npiHash: "hashed",
      npiCipher: "encrypted",
      npiLast4: "7890",
      profileCompletedAt: new Date(),
    });
  }
  const updateMany = jest.fn().mockImplementation(async ({ data }) => {
    if (options.updateError) throw options.updateError;
    Object.assign(stored, data);
    return { count: 1 };
  });
  const prisma = {
    user: {
      findUnique: jest.fn().mockImplementation(async () => stored),
      updateMany,
      update: jest.fn().mockImplementation(async ({ data }) => Object.assign(stored, data)),
    },
    npiRegistrationAttempt: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    },
  };
  (prisma as any).$transaction = jest.fn((callback) => callback(prisma));
  (prisma as any).$queryRaw = jest.fn();
  const crypto = {
    hash: jest.fn().mockReturnValue("hmac-value"),
    encrypt: jest.fn().mockReturnValue("v1:iv:tag:ciphertext"),
  };
  return { service: new UsersService(prisma as any, crypto as any), prisma, crypto, stored, updateMany };
}

describe("inscription client POST /users/me/registration", () => {
  it("normalise le nom, chiffre le NPI et renvoie uniquement sa forme masquée", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const { service, prisma, crypto, stored } = makeService();
    const { dto, errors } = await validateDto(RegisterUserDto, {
      firstName: "  Kossi   ",
      lastName: "  Adjovi ",
      gender: "M",
      npi: "1234 5678-90",
    });
    expect(errors).toHaveLength(0);
    expect(dto.firstName).toBe("Kossi");
    expect(dto.lastName).toBe("Adjovi");
    expect(dto.npi).toBe("1234567890");

    const result = await service.register("u1", dto as RegisterUserDto);
    expect(stored).toMatchObject({
      firstName: "Kossi",
      lastName: "Adjovi",
      gender: "M",
      fullName: "Kossi Adjovi",
      npiHash: "hmac-value",
      npiCipher: "v1:iv:tag:ciphertext",
      npiLast4: "7890",
    });
    expect(stored.profileCompletedAt).toBeInstanceOf(Date);
    expect(crypto.hash).toHaveBeenCalledWith("1234567890");
    expect(crypto.encrypt).toHaveBeenCalledWith("1234567890");
    expect(result).toMatchObject({ profileComplete: true, npiMasked: "••••••7890" });
    expect(result).not.toHaveProperty("npi");
    expect(result).not.toHaveProperty("npiCipher");
    expect(result).not.toHaveProperty("npiHash");
    expect(result).not.toHaveProperty("npiLast4");
    expect(prisma.npiRegistrationAttempt.create).toHaveBeenCalledWith({ data: { userId: "u1" } });
    expect(logSpy).not.toHaveBeenCalled();
  });

  it.each([
    [{ firstName: "", lastName: "Adjovi", gender: "M", npi: "1234567890" }],
    [{ firstName: "K", lastName: "Adjovi", gender: "M", npi: "1234567890" }],
    [{ firstName: "Kossi2", lastName: "Adjovi", gender: "M", npi: "1234567890" }],
    [{ firstName: "Kossi", lastName: "A", gender: "M", npi: "1234567890" }],
    [{ firstName: "Kossi", lastName: "Adjovi3", gender: "M", npi: "1234567890" }],
    [{ firstName: "Kossi", lastName: "Adjovi", gender: "X", npi: "1234567890" }],
    [{ firstName: "Kossi", lastName: "Adjovi", gender: "M", npi: "123456789" }],
    [{ firstName: "Kossi", lastName: "Adjovi", gender: "M", npi: "12345678901" }],
    [{ firstName: "Kossi", lastName: "Adjovi", gender: "M", npi: "12345A7890" }],
  ])("refuse les champs invalides: %o", async (body) => {
    const { errors } = await validateDto(RegisterUserDto, body);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("refuse un NPI déjà utilisé sans révéler le compte propriétaire", async () => {
    const { service } = makeService({ updateError: { code: "P2002" } });
    const dto = { firstName: "Kossi", lastName: "Adjovi", gender: "M", npi: "1234567890" };
    await expect(service.register("u1", dto as RegisterUserDto)).rejects.toThrow(
      "Ce NPI est déjà utilisé. Contacte le support."
    );
  });

  it("refuse une deuxième inscription sur un profil terminé sans toucher au NPI", async () => {
    const { service, updateMany } = makeService({ complete: true });
    await expect(
      service.register("u1", { firstName: "Awa", lastName: "Toto", gender: "F", npi: "9999999999" })
    ).rejects.toThrow("Ton inscription est déjà terminée.");
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("limite les tentatives d'inscription à trois par heure", async () => {
    const { service, prisma } = makeService();
    prisma.npiRegistrationAttempt.count.mockResolvedValue(MAX_REGISTRATION_ATTEMPTS);
    await expect(
      service.register("u1", { firstName: "Kossi", lastName: "Adjovi", gender: "M", npi: "1234567890" })
    ).rejects.toThrow("Trop de tentatives d'inscription.");
    expect(prisma.npiRegistrationAttempt.create).not.toHaveBeenCalled();
  });

  it("autorise uniquement le rôle CLIENT sur l'inscription et l'ancien pseudo", () => {
    expect(Reflect.getMetadata(ROLES_KEY, UsersController.prototype.register)).toEqual(["CLIENT"]);
    expect(Reflect.getMetadata(ROLES_KEY, UsersController.prototype.updateLegacyProfile)).toEqual(["CLIENT"]);
  });

  it("le garde refuse un client incomplet avec le code stable attendu", async () => {
    const guard = new RegistrationCompleteGuard({
      user: { findUnique: jest.fn().mockResolvedValue({ firstName: null }) },
    } as any);
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user: { userId: "u1", role: "CLIENT" } }) }),
    } as any;
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: {
        code: "REGISTRATION_REQUIRED",
        message: "Termine ton inscription pour continuer.",
      },
    });
  });

  it("le garde accepte un client après inscription et n'applique pas le formulaire aux prestataires", async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          firstName: "Kossi",
          lastName: "Adjovi",
          gender: "M",
          npiHash: "hash",
          npiCipher: "cipher",
          npiLast4: "7890",
        }),
      },
    };
    const guard = new RegistrationCompleteGuard(prisma as any);
    const clientContext = {
      switchToHttp: () => ({ getRequest: () => ({ user: { userId: "u1", role: "CLIENT" } }) }),
    } as any;
    await expect(guard.canActivate(clientContext)).resolves.toBe(true);

    const driverContext = {
      switchToHttp: () => ({ getRequest: () => ({ user: { userId: "d1", role: "DRIVER" } }) }),
    } as any;
    await expect(guard.canActivate(driverContext)).resolves.toBe(true);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it("ne modifie pas le profil structuré via l'ancien endpoint pseudo", async () => {
    const { service, prisma } = makeService({ complete: true });
    await expect(service.updateLegacyProfile("u1", { fullName: "Autre nom" })).rejects.toThrow(
      "Ton profil inscrit ne peut plus être modifié."
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("normalise le pseudo historique sans le laisser marquer l'inscription comme terminée", async () => {
    const { service, stored } = makeService();
    const { dto, errors } = await validateDto(UpdateProfileDto, { fullName: "  Amine   Koffi " });
    expect(errors).toHaveLength(0);
    expect(dto.fullName).toBe("Amine Koffi");
    const result = await service.updateLegacyProfile("u1", dto);
    expect(result.profileComplete).toBe(false);
    expect(stored.fullName).toBe("Amine Koffi");
  });

  it("chiffre et déchiffre avec AES-256-GCM et produit une empreinte HMAC stable", () => {
    const oldEncryptionKey = process.env.NPI_ENCRYPTION_KEY;
    const oldHashKey = process.env.NPI_HASH_KEY;
    process.env.NPI_ENCRYPTION_KEY = "encryption-key-test-that-is-distinct-32";
    process.env.NPI_HASH_KEY = "hash-key-test-that-is-distinct-32-characters";
    try {
      const crypto = new NpiCryptoService();
      const cipher = crypto.encrypt("1234567890");
      expect(cipher).not.toContain("1234567890");
      expect(crypto.decrypt(cipher)).toBe("1234567890");
      expect(crypto.hash("1234567890")).toBe(crypto.hash("1234567890"));
      expect(crypto.hash("1234567890")).not.toBe("1234567890");
    } finally {
      if (oldEncryptionKey === undefined) delete process.env.NPI_ENCRYPTION_KEY;
      else process.env.NPI_ENCRYPTION_KEY = oldEncryptionKey;
      if (oldHashKey === undefined) delete process.env.NPI_HASH_KEY;
      else process.env.NPI_HASH_KEY = oldHashKey;
    }
  });
});
