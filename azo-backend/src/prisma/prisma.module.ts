import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

// @Global : PrismaService est utilisable dans tous les modules sans réimport
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
