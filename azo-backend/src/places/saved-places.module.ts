import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { haversineKm } from "../rides/radar";

export class SavedPlaceDto {
  @IsString() @MinLength(1) @MaxLength(120) title: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsNumber() @Min(-90) @Max(90) latitude: number;
  @IsNumber() @Min(-180) @Max(180) longitude: number;
}

export const MAX_OTHER_PLACES = 10;
const SUGGESTION_WINDOW_DAYS = 90;
/** Une suggestion à moins de 100 m d'une adresse déjà enregistrée n'apporte rien. */
const SAME_PLACE_KM = 0.1;

type PlaceRow = { id: string; kind: string; title: string; address: string | null; lat: number; lng: number };
const toPlace = (p: PlaceRow) => ({ id: p.id, kind: p.kind, title: p.title, address: p.address, latitude: p.lat, longitude: p.lng });

/**
 * Adresses enregistrées du client (Domicile, Travail, autres), conservées sur le serveur pour suivre le client d'un
 * téléphone à l'autre, et suggestions de destination calculées d'après ses courses passées.
 */
@Injectable()
export class SavedPlacesService {
  constructor(private prisma: PrismaService) {}

  async list(userId: string) {
    const rows = await this.prisma.savedPlace.findMany({ where: { userId }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] });
    return { places: rows.map(toPlace) };
  }

  /** Domicile ou Travail : un seul de chaque, remplacé à chaque enregistrement. */
  async setFixed(userId: string, kind: string, dto: SavedPlaceDto) {
    if (kind !== "HOME" && kind !== "WORK") throw new BadRequestException("Type d'adresse inconnu (HOME ou WORK).");
    const data = { title: dto.title.trim(), address: dto.address?.trim() || null, lat: dto.latitude, lng: dto.longitude };
    const existing = await this.prisma.savedPlace.findFirst({ where: { userId, kind } });
    const row = existing
      ? await this.prisma.savedPlace.update({ where: { id: existing.id }, data })
      : await this.prisma.savedPlace.create({ data: { userId, kind, ...data } });
    return toPlace(row);
  }

  async addOther(userId: string, dto: SavedPlaceDto) {
    const count = await this.prisma.savedPlace.count({ where: { userId, kind: "OTHER" } });
    if (count >= MAX_OTHER_PLACES) {
      throw new BadRequestException(`Tu peux enregistrer ${MAX_OTHER_PLACES} adresses au maximum. Supprime-en une d'abord.`);
    }
    const row = await this.prisma.savedPlace.create({
      data: { userId, kind: "OTHER", title: dto.title.trim(), address: dto.address?.trim() || null, lat: dto.latitude, lng: dto.longitude },
    });
    return toPlace(row);
  }

  async remove(userId: string, id: string) {
    const row = await this.prisma.savedPlace.findFirst({ where: { id, userId }, select: { id: true } });
    if (!row) throw new NotFoundException("Adresse introuvable");
    await this.prisma.savedPlace.delete({ where: { id } });
    return { removed: id };
  }

  /**
   * Destinations les plus fréquentes du client sur 90 jours (les courses annulées ne comptent pas), sans celles déjà
   * enregistrées. Classées par nombre de courses puis par récence.
   */
  async suggestions(userId: string, limit = 5, now: Date = new Date()) {
    const since = new Date(now.getTime() - SUGGESTION_WINDOW_DAYS * 24 * 3600 * 1000);
    const [rides, saved] = await Promise.all([
      this.prisma.ride.findMany({
        where: { clientId: userId, createdAt: { gte: since }, status: { not: "CANCELLED" }, destLabel: { not: null } },
        select: { destLabel: true, destLat: true, destLng: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      this.prisma.savedPlace.findMany({ where: { userId }, select: { title: true, lat: true, lng: true } }),
    ]);

    const groups = new Map<string, { title: string; latitude: number; longitude: number; rides: number; last: number }>();
    for (const ride of rides) {
      const title = (ride.destLabel ?? "").trim();
      if (!title) continue;
      const key = title.toLowerCase();
      const entry = groups.get(key);
      if (entry) {
        entry.rides += 1;
      } else {
        // la course la plus récente fixe les coordonnées (liste triée du plus récent au plus ancien)
        groups.set(key, { title, latitude: ride.destLat, longitude: ride.destLng, rides: 1, last: ride.createdAt.getTime() });
      }
    }

    const isSaved = (g: { title: string; latitude: number; longitude: number }) =>
      saved.some(
        (p) =>
          p.title.trim().toLowerCase() === g.title.toLowerCase() ||
          haversineKm({ latitude: p.lat, longitude: p.lng }, { latitude: g.latitude, longitude: g.longitude }) < SAME_PLACE_KM
      );

    return {
      suggestions: [...groups.values()]
        .filter((g) => !isSaved(g))
        .sort((a, b) => b.rides - a.rides || b.last - a.last)
        .slice(0, Math.max(1, Math.min(limit, 10)))
        .map(({ title, latitude, longitude, rides: count }) => ({ title, latitude, longitude, rides: count })),
    };
  }
}

@Controller("places")
@UseGuards(JwtAuthGuard)
export class SavedPlacesController {
  constructor(private svc: SavedPlacesService) {}

  // GET /places/saved
  @Get("saved")
  list(@CurrentUser() u) {
    return this.svc.list(u.userId);
  }

  // PUT /places/saved/HOME | /places/saved/WORK  { title, address?, latitude, longitude }
  @Put("saved/:kind")
  setFixed(@CurrentUser() u, @Param("kind") kind: string, @Body() dto: SavedPlaceDto) {
    return this.svc.setFixed(u.userId, kind.toUpperCase(), dto);
  }

  // POST /places/saved  { title, address?, latitude, longitude } — autre adresse (10 maximum)
  @Post("saved")
  addOther(@CurrentUser() u, @Body() dto: SavedPlaceDto) {
    return this.svc.addOther(u.userId, dto);
  }

  // DELETE /places/saved/:id
  @Delete("saved/:id")
  remove(@CurrentUser() u, @Param("id") id: string) {
    return this.svc.remove(u.userId, id);
  }

  // GET /places/suggestions — destinations fréquentes d'après l'historique des courses
  @Get("suggestions")
  suggestions(@CurrentUser() u) {
    return this.svc.suggestions(u.userId);
  }
}

@Module({ controllers: [SavedPlacesController], providers: [SavedPlacesService] })
export class SavedPlacesModule {}
