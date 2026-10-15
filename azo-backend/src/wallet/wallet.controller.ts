import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { IsInt, IsOptional, IsString, Min } from "class-validator";
import { Webhook } from "fedapay";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RegistrationCompleteGuard } from "../common/guards/registration-complete.guard";
import { MIN_RECHARGE, WalletService } from "./wallet.service";

class RechargeDto {
  @IsInt() @Min(MIN_RECHARGE, { message: `Le montant minimum de recharge est de ${MIN_RECHARGE} FCFA` }) amount: number;
  @IsString() method: string;
}

class WithdrawDto {
  @IsInt() @Min(1) amount: number;
  @IsOptional() @IsString() context?: "AGENCY";
}

const PAYMENT_RETURN_PAGE =
  '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>AZƆ̀ — Paiement</title></head><body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 24px;color:#1c1b1f">' +
  '<h2 style="color:#7100af">Paiement terminé</h2><p>Ton solde se met à jour dans quelques secondes.<br>Tu peux retourner dans l’application AZƆ̀.</p></body></html>';

/**
 * Identifiant de la transaction contenu dans un webhook FedaPay.
 *  - Événement FedaPay : `{ name: "transaction.approved", entity: { id: <transaction> }, id: <événement> }`.
 *    Le `id` du premier niveau est celui de l'ÉVÉNEMENT : la transaction est dans `entity.id`.
 *  - Appel manuel de test (sans `name`) : `{ id: <transaction> }`.
 * Renvoie null pour un événement qui ne concerne pas une transaction (il est ignoré).
 */
export function fedaPayTransactionId(body: any): number | null {
  const name = typeof body?.name === "string" ? body.name : null;
  if (name && !name.startsWith("transaction.")) return null;
  const raw = name ? body?.entity?.id : body?.id;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

@Controller("wallet")
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private wallet: WalletService) {}

  @Get()
  async get(@CurrentUser() user) {
    // Recharges FedaPay en attente : contrôlées auprès de FedaPay à chaque lecture (le solde se met à jour sans le webhook)
    await this.wallet.reconcilePendingRecharges(user.userId);
    return this.wallet.getWallet(user.userId);
  }

  @Get("transactions")
  async transactions(@CurrentUser() user) {
    await this.wallet.reconcilePendingRecharges(user.userId);
    return this.wallet.transactions(user.userId);
  }

  @Post("recharge")
  @UseGuards(RegistrationCompleteGuard)
  recharge(@CurrentUser() user, @Body() dto: RechargeDto) {
    // Spider, conducteurs et coursiers ne rechargent pas AZƆ̀ Pay : leur solde vient des courses et des fonds de leur agence.
    if (user.role === "DRIVER") {
      throw new ForbiddenException("Les Spider et conducteurs ne peuvent pas recharger leur compte AZƆ̀ Pay.");
    }
    // `user.email` peut être undefined si l'utilisateur s'est inscrit par téléphone.
    // initRecharge gère le repli vers une adresse fictive.
    return this.wallet.initRecharge(user.userId, dto.amount, user.email);
  }

  @Get("withdrawal-quote")
  withdrawalQuote(@CurrentUser() user, @Query("amount") amount: string) {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new BadRequestException("Montant invalide");
    return this.wallet.quoteWithdrawal(user.userId, Math.floor(value));
  }

  @Post("withdraw")
  @UseGuards(RegistrationCompleteGuard)
  withdraw(@CurrentUser() user, @Body() dto: WithdrawDto) {
    return this.wallet.withdraw(user.userId, dto.amount);
  }
}

/**
 * Contrôleur public pour les webhooks FedaPay.
 * Volontairement séparé de WalletController pour ne PAS hériter du JwtAuthGuard.
 *
 * POST /wallet/recharge/callback
 * Signature : si FEDAPAY_WEBHOOK_SECRET est défini (secret « wh_… » du webhook, propre à chaque mode test/live),
 * l'en-tête X-FEDAPAY-SIGNATURE est vérifié et un événement mal signé est refusé (401).
 * Dans tous les cas, le statut de la transaction est relu auprès de FedaPay avant de créditer : un faux appel
 * ne peut pas créditer un paiement qui n'est pas approuvé.
 */
@Controller("wallet/recharge")
export class FedaPayCallbackController {
  private readonly logger = new Logger(FedaPayCallbackController.name);

  constructor(private wallet: WalletService) {}

  /**
   * GET /wallet/recharge/return : page affichée à la fin du paiement FedaPay (FEDAPAY_CALLBACK_URL).
   * L'application mobile intercepte cette adresse dans sa fenêtre de paiement et se ferme toute seule ; cette page ne
   * sert que si le paiement est ouvert dans un navigateur. Le crédit du solde, lui, vient du webhook.
   */
  @Get("return")
  @Header("Content-Type", "text/html; charset=utf-8")
  paymentReturn() {
    return PAYMENT_RETURN_PAGE;
  }

  @Post("callback")
  @HttpCode(200)
  async fedaPayCallback(
    @Req() req: { rawBody?: Buffer },
    @Headers("x-fedapay-signature") signature: string | undefined,
    @Body() body: any
  ) {
    const secret = process.env.FEDAPAY_WEBHOOK_SECRET;
    if (secret) {
      try {
        Webhook.constructEvent(req.rawBody?.toString("utf8") ?? "", signature ?? "", secret);
      } catch {
        this.logger.warn("Webhook FedaPay refusé : signature invalide");
        throw new UnauthorizedException("Signature FedaPay invalide");
      }
    } else {
      this.logger.warn("FEDAPAY_WEBHOOK_SECRET absent : signature du webhook non vérifiée (statut relu auprès de FedaPay)");
    }

    const transactionId = fedaPayTransactionId(body);
    if (transactionId === null) return { credited: false, reason: "ignored_event" };
    try {
      return await this.wallet.handleFedaPayCallback(transactionId);
    } catch (error) {
      // On absorbe les erreurs : FedaPay réémettra l'événement si on ne répond pas 200.
      this.logger.warn(
        `FedaPay callback error for transaction ${transactionId}: ${error instanceof Error ? error.message : String(error)}`
      );
      return { credited: false, reason: "error" };
    }
  }
}