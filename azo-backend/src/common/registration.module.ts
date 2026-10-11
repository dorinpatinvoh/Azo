import { Global, Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { NpiCryptoService } from "./npi-crypto.service";
import { RegistrationCompleteGuard } from "./guards/registration-complete.guard";

@Global()
@Module({
  imports: [PrismaModule],
  providers: [NpiCryptoService, RegistrationCompleteGuard],
  exports: [NpiCryptoService, RegistrationCompleteGuard],
})
export class RegistrationModule {}
