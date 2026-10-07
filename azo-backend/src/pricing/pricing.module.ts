import { Global, Module } from "@nestjs/common";
import { PricingService } from "./pricing.service";
import { TARIFICATION_CONFIG, loadTarificationConfig } from "./tarification.config";

export { PricingService };

@Global()
@Module({
  providers: [
    {
      provide: TARIFICATION_CONFIG,
      useFactory: () => loadTarificationConfig(),
    },
    PricingService,
  ],
  exports: [PricingService, TARIFICATION_CONFIG],
})
export class PricingModule {}