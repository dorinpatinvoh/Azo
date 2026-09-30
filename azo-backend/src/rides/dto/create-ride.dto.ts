import { IsEnum, IsNumber } from "class-validator";
import { VehicleType } from "@prisma/client";

export class CreateRideDto {
  @IsNumber() originLat: number;
  @IsNumber() originLng: number;
  @IsNumber() destLat: number;
  @IsNumber() destLng: number;
  @IsEnum(VehicleType) vehicleType: VehicleType;
}
