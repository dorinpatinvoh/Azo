import { IsString, Matches } from "class-validator";

export class RequestOtpDto {
  // Numéro béninois : 8 chiffres (avec ou sans +229)
  @IsString()
  @Matches(/^(\+229)?\s?\d{8,10}$/, { message: "Numéro de téléphone invalide" })
  phone: string;
}
