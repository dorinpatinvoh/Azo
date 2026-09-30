import { IsIn, IsOptional, IsString, Length } from "class-validator";

export class VerifyOtpDto {
  @IsString()
  phone: string;

  @IsString()
  @Length(4, 4, { message: "Le code doit contenir 4 chiffres" })
  code: string;

  // Profil choisi à l'inscription. ADMIN est volontairement absent de la liste.
  @IsOptional()
  @IsIn(["CLIENT", "DRIVER", "AGENCY"])
  profile?: string;
}
