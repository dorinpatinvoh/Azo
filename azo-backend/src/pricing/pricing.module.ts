import { Controller, Get, Module } from "@nestjs/common";
import { PricingService } from "./pricing.service";
import { TARIFICATION_CONFIG, loadTarificationConfig } from "./tarification.config";

/**
 * Route publique en lecture seule : l'application mobile affiche exactement les
 * mêmes prix que le backend (plus aucun barème codé en dur côté app).
 */
@Controller("pricing")
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /** GET /pricing — gammes, paliers kilométriques et niveaux d'agence. */
  @Get()
  config() {
    return {
      config: this.pricing.getConfig(),
      gammes: this.pricing.vehicleGammes(),
    };
  }
}

/**
 * Module de tarification : expose `PricingService` (configuration AZƆ̀ telle que
 * définie dans `tarification.json`) à tous les modules métier.
 */
@Module({
  controllers: [PricingController],
  providers: [
    { provide: TARIFICATION_CONFIG, useFactory: loadTarificationConfig },
    PricingService,
  ],
  exports: [PricingService],
})
export class PricingModule {}

export { PricingService, loadTarificationConfig };
