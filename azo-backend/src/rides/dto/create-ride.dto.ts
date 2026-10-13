import { IsEnum, IsISO8601, IsNumber, IsOptional, IsString, MaxLength } from "class-validator";
import { Transform } from "class-transformer";
import { VehicleType } from "@prisma/client";

function sanitizeLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Couper les espaces, retirer les caractères de contrôle
  return value.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, 120) || undefined;
}

export class CreateRideDto {
  @IsNumber() originLat: number;
  @IsNumber() originLng: number;
  @IsNumber() destLat: number;
  @IsNumber() destLng: number;
  @IsEnum(VehicleType) vehicleType: VehicleType;

  /** Libellé lisible du point de départ (envoyé par le mobile, optionnel). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => sanitizeLabel(value))
  originLabel?: string;

  /** Libellé lisible de la destination (envoyé par le mobile, optionnel). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => sanitizeLabel(value))
  destLabel?: string;

  /** Course programmée : heure de prise en charge souhaitée (ISO 8601). Absent = tout de suite. */
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}
