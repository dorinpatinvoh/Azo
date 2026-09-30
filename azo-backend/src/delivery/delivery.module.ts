import { Body, Controller, Injectable, Module, Param, Post, Get, UseGuards, BadRequestException } from "@nestjs/common";
import { IsEnum, IsString, IsInt } from "class-validator";
import { Payer } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";

class CreateDeliveryDto {
  @IsString() packageType: string; // doc | small | medium
  @IsString() pickupAddress: string;
  @IsString() dropAddress: string;
  @IsEnum(Payer) payer: Payer;
  @IsInt() price: number;
}
class ConfirmCodeDto {
  @IsString() code: string;
}

const code4 = () => Math.floor(1000 + Math.random() * 9000).toString();

@Injectable()
export class DeliveryService {
  constructor(private prisma: PrismaService) {}

  // Double sécurité OTP : un code au ramassage, un code à la remise
  create(clientId: string, dto: CreateDeliveryDto) {
    return this.prisma.delivery.create({
      data: { ...dto, clientId, pickupCode: code4(), deliveryCode: code4() },
    });
  }

  list(clientId: string) {
    return this.prisma.delivery.findMany({ where: { clientId }, orderBy: { createdAt: "desc" } });
  }

  async confirmPickup(id: string, code: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    if (!d || d.pickupCode !== code) throw new BadRequestException("Code de ramassage invalide");
    return this.prisma.delivery.update({ where: { id }, data: { status: "IN_PROGRESS" } });
  }

  async confirmDelivery(id: string, code: string) {
    const d = await this.prisma.delivery.findUnique({ where: { id } });
    if (!d || d.deliveryCode !== code) throw new BadRequestException("Code de remise invalide");
    return this.prisma.delivery.update({ where: { id }, data: { status: "COMPLETED" } });
  }
}

@Controller("deliveries")
@UseGuards(JwtAuthGuard)
export class DeliveryController {
  constructor(private svc: DeliveryService) {}
  @Post() create(@CurrentUser() u, @Body() dto: CreateDeliveryDto) { return this.svc.create(u.userId, dto); }
  @Get() list(@CurrentUser() u) { return this.svc.list(u.userId); }
  @Post(":id/confirm-pickup") pickup(@Param("id") id: string, @Body() b: ConfirmCodeDto) { return this.svc.confirmPickup(id, b.code); }
  @Post(":id/confirm-delivery") drop(@Param("id") id: string, @Body() b: ConfirmCodeDto) { return this.svc.confirmDelivery(id, b.code); }
}

@Module({ controllers: [DeliveryController], providers: [DeliveryService] })
export class DeliveryModule {}
