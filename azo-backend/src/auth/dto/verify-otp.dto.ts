import { IsIn, IsOptional, IsString, Length } from "class-validator";

export class VerifyOtpDto {
  @IsString()
  phone: string;

  @IsString()
  @Length(4, 4, { message: "Le code doit contenir 4 chiffres" })
  code: string;

  // Profil choisi à l'inscription (ouvre un brouillon de dossier prestataire).
  // ADMIN n'est jamais attribuable par l'API ; ARTISAN n'existe pas sur AZƆ̀.
  @IsOptional()
  @IsIn(["CLIENT", "DRIVER", "COURIER", "AGENCY"])
  profile?: "CLIENT" | "DRIVER" | "COURIER" | "AGENCY";
}
