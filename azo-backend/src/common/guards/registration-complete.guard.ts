import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { isRegistrationComplete } from "../registration-profile";

@Injectable()
export class RegistrationCompleteGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (request.user?.role !== "CLIENT") return true;

    const user = await this.prisma.user.findUnique({
      where: { id: request.user.userId },
      select: {
        firstName: true,
        lastName: true,
        gender: true,
        npiHash: true,
        npiCipher: true,
        npiLast4: true,
      },
    });
    if (!user || !isRegistrationComplete(user)) {
      throw new ForbiddenException({
        code: "REGISTRATION_REQUIRED",
        message: "Termine ton inscription pour continuer.",
      });
    }
    return true;
  }
}
