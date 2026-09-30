import { Body, Controller, Injectable, Module, Param, Post, UseGuards, BadRequestException } from "@nestjs/common";
import { IsArray, IsString } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { WalletModule, WalletService } from "../wallet/wallet.module";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";

class OrderDto {
  @IsString() market: string;
  @IsArray() items: { label: string; note?: string; price: number }[];
}

@Injectable()
export class MarketplaceService {
  constructor(private prisma: PrismaService, private wallet: WalletService) {}

  // Séquestre : l'argent est débité du client et bloqué jusqu'à validation
  async order(clientId: string, dto: OrderDto) {
    const total = dto.items.reduce((s, i) => s + i.price, 0);
    await this.wallet.debit(clientId, total, "Séquestre courses marché", dto.market);
    return this.prisma.marketplaceOrder.create({
      data: { clientId, market: dto.market, items: dto.items as any, total, status: "escrowed" },
    });
  }

  // Le client valide la livraison -> le séquestre est libéré (à répartir coursier/vendeurs)
  async validate(orderId: string, clientId: string) {
    const o = await this.prisma.marketplaceOrder.findUnique({ where: { id: orderId } });
    if (!o || o.clientId !== clientId) throw new BadRequestException("Commande introuvable");
    return this.prisma.marketplaceOrder.update({ where: { id: orderId }, data: { status: "delivered" } });
  }
}

@Controller("marketplace")
@UseGuards(JwtAuthGuard)
export class MarketplaceController {
  constructor(private svc: MarketplaceService) {}
  @Post("orders") order(@CurrentUser() u, @Body() dto: OrderDto) { return this.svc.order(u.userId, dto); }
  @Post("orders/:id/validate") validate(@Param("id") id: string, @CurrentUser() u) { return this.svc.validate(id, u.userId); }
}

@Module({ imports: [WalletModule], controllers: [MarketplaceController], providers: [MarketplaceService] })
export class MarketplaceModule {}
