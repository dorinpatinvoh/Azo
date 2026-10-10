import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

jest.mock("@prisma/client", () => ({
  Role: { CLIENT: "CLIENT", DRIVER: "DRIVER", AGENCY: "AGENCY", ADMIN: "ADMIN", ARTISAN: "ARTISAN" },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));

import { ROLES_KEY } from "../src/common/decorators/roles.decorator";
import { UpdateProfileDto, UsersController, UsersService } from "../src/users/users.module";

async function check(body: unknown) {
  const dto = plainToInstance(UpdateProfileDto, body);
  const errors = await validate(dto, { whitelist: true });
  return { dto, errors };
}

describe("PATCH /users/me — enregistrement du pseudo", () => {
  it("accepte un nom valide et retire les espaces superflus", async () => {
    const { dto, errors } = await check({ fullName: "  Amine   Koffi " });
    expect(errors).toHaveLength(0);
    expect(dto.fullName).toBe("Amine Koffi");
  });

  it.each([[""], ["   "], [undefined], [null], [123], ["A"], ["x".repeat(51)]])(
    "refuse %p",
    async (value) => {
      const { errors } = await check({ fullName: value });
      expect(errors.length).toBeGreaterThan(0);
    }
  );

  it("est réservé au rôle CLIENT", () => {
    const handler = UsersController.prototype.update;
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(["CLIENT"]);
  });

  it("n'écrit que fullName en base", async () => {
    const update = jest.fn().mockResolvedValue({ id: "u1", fullName: "Amine" });
    const service = new UsersService({ user: { update } } as any);
    await service.updateProfile("u1", { fullName: "Amine", role: "ADMIN" } as any);
    expect(update.mock.calls[0][0].data).toEqual({ fullName: "Amine" });
  });
});
