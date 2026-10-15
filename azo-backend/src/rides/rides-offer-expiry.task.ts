import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { RidesService } from "./rides.service";

/**
 * Tâche périodique qui expire les propositions Spider (statut OFFERED) dont le délai
 * est dépassé. Sans `@nestjs/schedule`, on utilise un simple `setInterval`.
 *
 * Exécution toutes les 5 secondes : une offre de 45 s ne restera jamais bloquée
 * plus de 50 s (5 s de latence max).
 */
@Injectable()
export class RidesOfferExpiryTask implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RidesOfferExpiryTask.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly rides: RidesService) {}

  onModuleInit() {
    this.intervalHandle = setInterval(() => {
      this.rides.expireAllPendingOffers().catch((e) => {
        this.logger.warn(`Offer expiry sweep error: ${e?.message ?? e}`);
      });
    }, 5_000);
  }

  onModuleDestroy() {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
