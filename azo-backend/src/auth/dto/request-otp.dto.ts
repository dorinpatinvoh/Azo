import { IsString, Matches } from "class-validator";

export class RequestOtpDto {
  // Numéro béninois à 10 chiffres (01 + 8 chiffres, ex. 01 XX XX XX XX), avec ou sans +229.
  // Tolère aussi 8 chiffres pour la rétrocompatibilité des anciens comptes.
  @IsString()
  @Matches(/^(\+?229)?[\s.-]*(\d[\s.-]*){8,10}$/, {
    message: "Numéro béninois invalide : saisis les 10 chiffres commençant par 01 (ex. 01 XX XX XX XX)",
  })
  phone: string;
}
