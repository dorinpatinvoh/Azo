import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { RidesService } from "./rides.service";

/**
 * Ouvre aux chauffeurs les courses programmées dont l'heure approche. Toutes les 30 s ; sans `@nestjs/schedule`, un simple
 * `setInterval`. Si le serveur dormait (offre gratuite de Render), le rattrapage a lieu au réveil : les courses dont
 * l'heure d'ouverture est passée sont publiées au premier passage.
 */
@Injectable()
export class ScheduledRidesTask implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScheduledRidesTask.name);
  private handle: ReturnType<typeof setInterval> | null = null;
  private first: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly rides: RidesService) {}

  onModuleInit() {
    const run = () =>
      this.rides.releaseDueScheduledRides().catch((e) => this.logger.warn(`Scheduled rides sweep error: ${e?.message ?? e}`));
    // Premier passage 5 s après le démarrage : au réveil du serveur, le retard est rattrapé tout de suite
    this.first = setTimeout(run, 5_000);
    this.handle = setInterval(run, 30_000);
  }

  onModuleDestroy() {
    if (this.first !== null) {
      clearTimeout(this.first);
      this.first = null;
    }
    if (this.handle !== null) {
      clearInterval(this.handle);
      this.handle = null;
    }
  }
}
