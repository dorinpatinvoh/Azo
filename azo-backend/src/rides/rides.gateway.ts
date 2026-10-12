import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger, Optional } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { PricingService } from "../pricing/pricing.module";
import { Server, Socket } from "socket.io";
import { OdometerPoint, haversineMeters, odometerStep } from "./odometer";

export type RideChatMessage = {
  id: string;
  rideId: string;
  senderId: string;
  senderRole: "CLIENT" | "PROVIDER";
  senderName: string;
  text: string;
  createdAt: string;
};

type LiveLocationPayload = {
  rideId?: string;
  lat?: number;
  lng?: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  ts?: number;
};

const ACTIVE_DRIVER_LOCATION_STATUSES = ["MATCHED", "ARRIVED", "IN_PROGRESS"] as const;
const ACTIVE_CLIENT_LOCATION_STATUSES = ["MATCHED", "ARRIVED"] as const;
const LOCATION_PERSIST_INTERVAL_MS = 5_000;
const LOCATION_RATE_LIMIT_MS = 400;
const MAX_PLAUSIBLE_LOCATION_SPEED_MPS = 100;
const TRACK_RETENTION_DAYS = 30;

type RideLocationContext = {
  clientId: string;
  driverId: string | null;
  status: string;
  vehicleType: string;
  estimatedPrice: number;
  lastDriverAt: number;
  lastDriverLocation: OdometerPoint | null;
  lastClientAt: number;
  lastClientLocation: OdometerPoint | null;
  traveledMeters: number;
  odometer: OdometerPoint | null;
  odometerAccuracy: number | null;
  odometerSpeed: number | null;
  pendingMeters: number;
  dirtyOdometer: boolean;
  pendingStop: boolean;
};

// Suivi en direct + Messagerie sécurisée in-app :
// Côté mobile : socket.emit("ride:join", { rideId }) puis socket.on("driver:location" | "ride:chat", ...)
@WebSocketGateway({ cors: { origin: "*" } })
export class RidesGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  private chatStore = new Map<string, RideChatMessage[]>();
  private readonly logger = new Logger(RidesGateway.name);
  private lastDriverTimestamp = new Map<string, number>();
  private lastClientTimestamp = new Map<string, number>();
  private lastLocationReceivedAt = new Map<string, number>();
  private lastLocationByEmitter = new Map<string, OdometerPoint>();
  private lastDriverPersistAt = new Map<string, number>();
  private lastClientPersistAt = new Map<string, number>();
  private rideLocationContexts = new Map<string, RideLocationContext>();
  private rideLocationContextTasks = new Map<string, Promise<RideLocationContext | null>>();
  private rideContextGeneration = new Map<string, number>();
  private driverLocationTasks = new Map<string, Promise<unknown>>();
  private lastProgressEmitAt = new Map<string, number>();
  private lastTrackCleanupAt = 0;
  private readonly pricing: PricingService;

  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
    @Optional() pricing?: PricingService
  ) {
    this.pricing = pricing ?? new PricingService();
  }

  handleConnection(client: Socket) {
    const raw =
      (typeof client.handshake.auth?.token === "string" && client.handshake.auth.token) ||
      (typeof client.handshake.headers?.authorization === "string" &&
        client.handshake.headers.authorization.replace(/^Bearer\s+/i, "")) ||
      (typeof client.handshake.query?.token === "string" && client.handshake.query.token);

    if (raw) {
      try {
        const payload = this.jwt.verify(raw);
        client.data.user = { userId: payload.sub, role: payload.role, phone: payload.phone };
        // Room personnelle dès la connexion : le client reçoit la popup « un Zem a accepté », quel que soit
        // l'écran affiché, sans avoir à ouvrir le suivi de la course (ride:join).
        client.join(`user:${payload.sub}`);
        // Les chauffeurs rejoignent la room "drivers" pour recevoir les événements radar
        if (payload.role === "DRIVER") {
          client.join("drivers");
        }
      } catch {
        // Jeton expiré ou invalide : la socket ne pourra pas rejoindre une course privée.
      }
    }
  }

  @SubscribeMessage("ride:join")
  async join(@ConnectedSocket() client: Socket, @MessageBody() data: { rideId?: string }) {
    const userId = client.data?.user?.userId;
    if (!userId || !data?.rideId || typeof data.rideId !== "string") return { joined: null };

    const ride = await this.prisma.ride.findUnique({
      where: { id: data.rideId },
      select: {
        clientId: true,
        driverId: true,
        status: true,
        vehicleType: true,
        price: true,
        driverLat: true,
        driverLng: true,
        driverHeading: true,
        driverSpeed: true,
        driverLocatedAt: true,
        clientLat: true,
        clientLng: true,
        clientLocatedAt: true,
      },
    });
    if (!ride || (ride.clientId !== userId && ride.driverId !== userId)) return { joined: null };

    client.join(`ride:${data.rideId}`);
    client.join(`user:${userId}`);
    const result: {
      joined: string;
      messages: RideChatMessage[];
      driverLocation?: { lat: number; lng: number; heading?: number; speed?: number; at: number };
      clientLocation?: { lat: number; lng: number; at: number };
    } = { joined: data.rideId, messages: this.getMessages(data.rideId) };

    if (
      userId === ride.clientId &&
      ACTIVE_DRIVER_LOCATION_STATUSES.includes(ride.status as (typeof ACTIVE_DRIVER_LOCATION_STATUSES)[number]) &&
      ride.driverLat !== null &&
      ride.driverLat !== undefined &&
      ride.driverLng !== null &&
      ride.driverLng !== undefined &&
      ride.driverLocatedAt
    ) {
      result.driverLocation = {
        lat: ride.driverLat,
        lng: ride.driverLng,
        ...(ride.driverHeading !== null ? { heading: ride.driverHeading } : {}),
        ...(ride.driverSpeed !== null ? { speed: ride.driverSpeed } : {}),
        at: ride.driverLocatedAt.getTime(),
      };
    }
    if (
      userId === ride.driverId &&
      ACTIVE_CLIENT_LOCATION_STATUSES.includes(ride.status as (typeof ACTIVE_CLIENT_LOCATION_STATUSES)[number]) &&
      ride.clientLat !== null &&
      ride.clientLat !== undefined &&
      ride.clientLng !== null &&
      ride.clientLng !== undefined &&
      ride.clientLocatedAt
    ) {
      result.clientLocation = {
        lat: ride.clientLat,
        lng: ride.clientLng,
        at: ride.clientLocatedAt.getTime(),
      };
    }
    return result;
  }

  // Autoriser la position du Zem pendant OFFERED (client voit sa distance)
  @SubscribeMessage("driver:location")
  async location(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: LiveLocationPayload
  ) {
    const userId = client.data?.user?.userId;
    if (!userId || !this.hasValidCoordinates(data)) return;
    await this.serializeDriverLocation(data.rideId, async () => {
      const ride = await this.getRideLocationContext(data.rideId);
      const ACTIVE_DRIVER_WITH_OFFERED = ["OFFERED", "MATCHED", "ARRIVED", "IN_PROGRESS"] as const;
      if (
        !ride ||
        ride.driverId !== userId ||
        !ACTIVE_DRIVER_WITH_OFFERED.includes(ride.status as (typeof ACTIVE_DRIVER_WITH_OFFERED)[number])
      ) {
        return;
      }

      const at = this.locationTimestamp(data.ts);
      if (at <= Math.max(this.lastDriverTimestamp.get(data.rideId) ?? 0, ride.lastDriverAt)) return;
      const emitterKey = this.locationEmitterKey(data.rideId, userId);
      if (!this.canAcceptLocation(emitterKey, ride.lastDriverLocation, data.lat, data.lng, at)) return;
      this.lastDriverTimestamp.set(data.rideId, at);
      ride.lastDriverAt = at;
      ride.lastDriverLocation = { lat: data.lat, lng: data.lng, at };
      const heading = this.validHeading(data.heading);
      const speed = this.validNonNegative(data.speed);
      const accuracy = this.validNonNegative(data.accuracy);
      this.server?.to(`ride:${data.rideId}`).emit("driver:location", {
        lat: data.lat,
        lng: data.lng,
        ...(heading !== undefined ? { heading } : {}),
        ...(speed !== undefined ? { speed } : {}),
        ...(accuracy !== undefined ? { accuracy: Math.round(accuracy) } : {}),
        at,
      });

      if (ride.status === "IN_PROGRESS") {
        await this.expireStopRequest(data.rideId, ride);
        if (!ride.pendingStop) {
          const result = odometerStep(
            ride.odometer,
            { lat: data.lat, lng: data.lng, at },
            accuracy
          );
          if (result?.accepted) {
            ride.odometer = result.point;
            ride.odometerAccuracy = accuracy !== undefined ? Math.round(accuracy) : null;
            ride.odometerSpeed = speed ?? null;
            ride.traveledMeters += result.meters;
            ride.pendingMeters += result.meters;
            ride.dirtyOdometer = true;
          }
        }
        this.emitRideProgress(data.rideId, ride);
      }

      await this.persistDriverLocation(data.rideId, data, at, heading, speed, ride);
    });
  }

  private async serializeDriverLocation<T>(rideId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.driverLocationTasks.get(rideId) ?? Promise.resolve();
    const current = previous.then(work, work);
    this.driverLocationTasks.set(rideId, current);
    try {
      return await current;
    } finally {
      if (this.driverLocationTasks.get(rideId) === current) this.driverLocationTasks.delete(rideId);
    }
  }

  async freezeRideProgress(rideId: string) {
    return this.serializeDriverLocation(rideId, async () => {
      const context = await this.getRideLocationContext(rideId);
      if (!context || context.status !== "IN_PROGRESS") return null;
      context.pendingStop = true;
      return {
        traveledMeters: context.traveledMeters,
        pendingMeters: context.pendingMeters,
        dirtyOdometer: context.dirtyOdometer,
        odometer: context.odometer,
        odometerAccuracy: context.odometerAccuracy,
        odometerSpeed: context.odometerSpeed,
        currentPrice: Math.min(
          this.pricing.breakdown(context.traveledMeters / 1000, context.vehicleType).price,
          context.estimatedPrice
        ),
      };
    });
  }

  private async getRideLocationContext(rideId: string): Promise<RideLocationContext | null> {
    const cached = this.rideLocationContexts.get(rideId);
    if (cached) return cached;
    let task = this.rideLocationContextTasks.get(rideId);
    if (!task) {
      const generation = this.rideContextGeneration.get(rideId) ?? 0;
      task = this.loadRideLocationContext(rideId, generation);
      this.rideLocationContextTasks.set(rideId, task);
    }
    try {
      return await task;
    } finally {
      if (this.rideLocationContextTasks.get(rideId) === task) {
        this.rideLocationContextTasks.delete(rideId);
      }
    }
  }

  private async loadRideLocationContext(
    rideId: string,
    generation: number
  ): Promise<RideLocationContext | null> {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: {
        clientId: true,
        driverId: true,
        status: true,
        vehicleType: true,
        price: true,
        driverLocatedAt: true,
        driverLat: true,
        driverLng: true,
        clientLocatedAt: true,
        clientLat: true,
        clientLng: true,
        traveledMeters: true,
        odoLat: true,
        odoLng: true,
        odoAt: true,
        stopRequestedBy: true,
        stopRequestedAt: true,
      },
    });
    if (!ride) return null;
    if ((this.rideContextGeneration.get(rideId) ?? 0) !== generation) {
      return this.loadRideLocationContext(rideId, this.rideContextGeneration.get(rideId) ?? 0);
    }
    const context: RideLocationContext = {
      clientId: ride.clientId,
      driverId: ride.driverId,
      status: ride.status,
      vehicleType: ride.vehicleType,
      estimatedPrice: ride.price,
      lastDriverAt: ride.driverLocatedAt?.getTime() ?? 0,
      lastDriverLocation:
        ride.driverLat !== null && ride.driverLat !== undefined &&
        ride.driverLng !== null && ride.driverLng !== undefined && ride.driverLocatedAt
          ? { lat: ride.driverLat, lng: ride.driverLng, at: ride.driverLocatedAt.getTime() }
          : null,
      lastClientAt: ride.clientLocatedAt?.getTime() ?? 0,
      lastClientLocation:
        ride.clientLat !== null && ride.clientLat !== undefined &&
        ride.clientLng !== null && ride.clientLng !== undefined && ride.clientLocatedAt
          ? { lat: ride.clientLat, lng: ride.clientLng, at: ride.clientLocatedAt.getTime() }
          : null,
      traveledMeters: ride.traveledMeters,
      odometer:
        ride.odoLat !== null && ride.odoLng !== null && ride.odoAt
          ? { lat: ride.odoLat, lng: ride.odoLng, at: ride.odoAt.getTime() }
          : null,
      odometerAccuracy: null,
      odometerSpeed: null,
      pendingMeters: 0,
      dirtyOdometer: false,
      pendingStop: !!ride.stopRequestedBy && !!ride.stopRequestedAt &&
        Date.now() - ride.stopRequestedAt.getTime() <
          this.pricing.rideSettings().stopRequestExpiryMinutes * 60_000,
    };
    this.rideLocationContexts.set(rideId, context);
    return context;
  }

  private async expireStopRequest(rideId: string, context: RideLocationContext) {
    if (!context.pendingStop) return;
    const expiredBefore = new Date(
      Date.now() - this.pricing.rideSettings().stopRequestExpiryMinutes * 60_000
    );
    const result = await this.prisma.ride.updateMany({
      where: { id: rideId, status: "IN_PROGRESS", stopRequestedAt: { lte: expiredBefore } },
      data: {
        stopRequestedBy: null,
        stopRequestedAt: null,
        stopRequestedPrice: null,
        stopRequestedDistanceMeters: null,
      },
    });
    if (result.count > 0) {
      context.pendingStop = false;
      this.server?.to(`ride:${rideId}`).emit("ride:stop", { rideId, stopRequest: null, expired: true });
    }
  }

  private emitRideProgress(rideId: string, context: RideLocationContext) {
    const now = Date.now();
    if (now - (this.lastProgressEmitAt.get(rideId) ?? 0) < LOCATION_PERSIST_INTERVAL_MS) return;
    this.lastProgressEmitAt.set(rideId, now);
    const price = Math.min(
      this.pricing.breakdown(context.traveledMeters / 1000, context.vehicleType).price,
      context.estimatedPrice
    );
    this.server?.to(`ride:${rideId}`).emit("ride:progress", {
      rideId,
      traveledMeters: context.traveledMeters,
      currentPrice: price,
      at: new Date(now).toISOString(),
    });
  }

  @SubscribeMessage("client:location")
  async clientLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: LiveLocationPayload
  ) {
    const userId = client.data?.user?.userId;
    if (!userId || !this.hasValidCoordinates(data)) return;

    const ride = await this.getRideLocationContext(data.rideId);
    if (
      !ride ||
      ride.clientId !== userId ||
      !ACTIVE_CLIENT_LOCATION_STATUSES.includes(ride.status as (typeof ACTIVE_CLIENT_LOCATION_STATUSES)[number])
    ) {
      return;
    }

    const at = this.locationTimestamp(data.ts);
    if (at <= Math.max(this.lastClientTimestamp.get(data.rideId) ?? 0, ride.lastClientAt)) return;
    const emitterKey = this.locationEmitterKey(data.rideId, userId);
    if (!this.canAcceptLocation(emitterKey, ride.lastClientLocation, data.lat, data.lng, at)) return;
    this.lastClientTimestamp.set(data.rideId, at);
    ride.lastClientAt = at;
    ride.lastClientLocation = { lat: data.lat, lng: data.lng, at };
    const accuracy = this.validNonNegative(data.accuracy);
    const heading = this.validHeading(data.heading);
    const speed = this.validNonNegative(data.speed);
    if (ride.driverId) {
      this.server?.to(`user:${ride.driverId}`).emit("client:location", {
        lat: data.lat,
        lng: data.lng,
        ...(heading !== undefined ? { heading } : {}),
        ...(speed !== undefined ? { speed } : {}),
        ...(accuracy !== undefined ? { accuracy: Math.round(accuracy) } : {}),
        at,
      });
    }
    await this.persistClientLocation(data.rideId, data, at);
  }

  clearRideLocations(rideId: string) {
    this.rideContextGeneration.set(rideId, (this.rideContextGeneration.get(rideId) ?? 0) + 1);
    this.lastDriverTimestamp.delete(rideId);
    this.lastClientTimestamp.delete(rideId);
    this.clearLocationRateState(rideId);
    this.lastDriverPersistAt.delete(rideId);
    this.lastClientPersistAt.delete(rideId);
    this.rideLocationContexts.delete(rideId);
    this.lastProgressEmitAt.delete(rideId);
  }

  invalidateRideLocationContext(rideId: string) {
    this.rideContextGeneration.set(rideId, (this.rideContextGeneration.get(rideId) ?? 0) + 1);
    this.rideLocationContexts.delete(rideId);
  }

  emitStopRequest(rideId: string, request: {
    by: string;
    at: string;
    expiresAt: string;
    price: number;
    distanceMeters: number;
  } | null, extra: { accepted?: boolean; declined?: boolean; cancelled?: boolean; expired?: boolean } = {}) {
    this.server?.to(`ride:${rideId}`).emit("ride:stop", { rideId, stopRequest: request, ...extra });
  }

  emitRideSettled(rideId: string, payload: { finalPrice: number; settledDistanceMeters: number; priceMode: string }) {
    this.server?.to(`ride:${rideId}`).emit("ride:progress", { rideId, ...payload });
  }

  clearClientLocationState(rideId: string) {
    this.lastClientTimestamp.delete(rideId);
    this.lastClientPersistAt.delete(rideId);
    const clientId = this.rideLocationContexts.get(rideId)?.clientId;
    if (clientId) {
      const emitterKey = this.locationEmitterKey(rideId, clientId);
      this.lastLocationReceivedAt.delete(emitterKey);
      this.lastLocationByEmitter.delete(emitterKey);
    }
    const context = this.rideLocationContexts.get(rideId);
    if (context) {
      context.lastClientAt = 0;
      context.lastClientLocation = null;
    }
  }

  // Messagerie instantanée sécurisée Client <-> Prestataire (sans exposer les numéros)
  @SubscribeMessage("ride:chat")
  async onChat(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      rideId?: string;
      senderRole?: "CLIENT" | "PROVIDER";
      senderName?: string;
      text?: string;
    }
  ) {
    const senderId = client.data?.user?.userId;
    if (!senderId || !data?.rideId || !data?.text || typeof data.text !== "string") return;

    const ride = await this.prisma.ride.findUnique({
      where: { id: data.rideId },
      select: { clientId: true, driverId: true },
    });
    if (!ride || (ride.clientId !== senderId && ride.driverId !== senderId)) return;

    const role: "CLIENT" | "PROVIDER" = ride.driverId === senderId ? "PROVIDER" : "CLIENT";
    const name = role === "PROVIDER" ? "Prestataire AZƆ̀" : "Client AZƆ̀";
    return this.addChatMessage(data.rideId, senderId, role, name, data.text);
  }

  getMessages(rideId: string): RideChatMessage[] {
    return this.chatStore.get(rideId) ?? [];
  }

  addChatMessage(
    rideId: string,
    senderId: string,
    senderRole: "CLIENT" | "PROVIDER",
    senderName: string,
    rawText: string
  ): RideChatMessage {
    const text = rawText.trim().slice(0, 300);
    const msg: RideChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      rideId,
      senderId,
      senderRole,
      senderName,
      text,
      createdAt: new Date().toISOString(),
    };
    const list = this.chatStore.get(rideId) ?? [];
    list.push(msg);
    if (list.length > 50) list.shift();
    this.chatStore.set(rideId, list);
    this.server?.to(`ride:${rideId}`).emit("ride:chat", msg);
    return msg;
  }

  private hasValidCoordinates(data: LiveLocationPayload | undefined): data is LiveLocationPayload & {
    rideId: string;
    lat: number;
    lng: number;
  } {
    return (
      !!data &&
      typeof data.rideId === "string" &&
      data.rideId.length > 0 &&
      typeof data.lat === "number" &&
      typeof data.lng === "number" &&
      Number.isFinite(data.lat) &&
      Number.isFinite(data.lng) &&
      Math.abs(data.lat) <= 90 &&
      Math.abs(data.lng) <= 180
    );
  }

  private locationTimestamp(ts: number | undefined): number {
    const now = Date.now();
    return typeof ts === "number" && Number.isFinite(ts) && ts > 0 && ts <= now + 60_000 ? ts : now;
  }

  private validHeading(heading: number | undefined): number | undefined {
    return typeof heading === "number" && Number.isFinite(heading) && heading >= 0 && heading < 360
      ? Math.round(heading) % 360
      : undefined;
  }

  private validNonNegative(value: number | undefined): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  private locationEmitterKey(rideId: string, userId: string): string {
    return `${rideId}:${userId}`;
  }

  private canAcceptLocation(
    emitterKey: string,
    previous: OdometerPoint | null,
    lat: number,
    lng: number,
    at: number
  ): boolean {
    const now = Date.now();
    if (now - (this.lastLocationReceivedAt.get(emitterKey) ?? 0) < LOCATION_RATE_LIMIT_MS) return false;
    const lastLocation = this.lastLocationByEmitter.get(emitterKey) ?? previous;
    if (lastLocation) {
      const elapsedMs = at - lastLocation.at;
      if (
        elapsedMs <= 0 ||
        haversineMeters(lastLocation, { lat, lng }) / (elapsedMs / 1000) >
          MAX_PLAUSIBLE_LOCATION_SPEED_MPS
      ) {
        return false;
      }
    }
    this.lastLocationReceivedAt.set(emitterKey, now);
    this.lastLocationByEmitter.set(emitterKey, { lat, lng, at });
    return true;
  }

  private clearLocationRateState(rideId: string) {
    const prefix = `${rideId}:`;
    for (const key of this.lastLocationReceivedAt.keys()) {
      if (key.startsWith(prefix)) this.lastLocationReceivedAt.delete(key);
    }
    for (const key of this.lastLocationByEmitter.keys()) {
      if (key.startsWith(prefix)) this.lastLocationByEmitter.delete(key);
    }
  }

  private async persistDriverLocation(
    rideId: string,
    data: LiveLocationPayload & { lat: number; lng: number },
    at: number,
    heading: number | undefined,
    speed: number | undefined,
    context: RideLocationContext
  ) {
    const now = Date.now();
    if (now - (this.lastDriverPersistAt.get(rideId) ?? 0) < LOCATION_PERSIST_INTERVAL_MS) return;
    const locatedAt = new Date(at);
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const where: Prisma.RideWhereInput = {
          id: rideId,
          driverId: context.driverId,
          status: { in: [...ACTIVE_DRIVER_LOCATION_STATUSES] },
          OR: [{ driverLocatedAt: null }, { driverLocatedAt: { lt: locatedAt } }],
        };
        if (context.status === "IN_PROGRESS" && context.dirtyOdometer && context.odometer) {
          where.AND = [
            {
              OR: [{ odoAt: null }, { odoAt: { lt: new Date(context.odometer.at) } }],
            },
          ];
        }
        const updated = await tx.ride.updateMany({
          where,
          data: {
            driverLat: data.lat,
            driverLng: data.lng,
            driverHeading: heading ?? null,
            driverSpeed: speed ?? null,
            driverLocatedAt: locatedAt,
            ...(context.status === "IN_PROGRESS" && context.dirtyOdometer && context.odometer
              ? {
                  traveledMeters: { increment: context.pendingMeters },
                  odoLat: context.odometer.lat,
                  odoLng: context.odometer.lng,
                  odoAt: new Date(context.odometer.at),
                }
              : {}),
          },
        });
        if (updated.count === 0) return false;
        if (context.status === "IN_PROGRESS" && context.dirtyOdometer && context.odometer) {
          await tx.rideTrackPoint.create({
            data: {
              rideId,
              lat: context.odometer.lat,
              lng: context.odometer.lng,
              accuracy: context.odometerAccuracy,
              speed: context.odometerSpeed,
              at: new Date(context.odometer.at),
            },
          });
        }
        return true;
      });
      if (!result) {
        this.rideLocationContexts.delete(rideId);
        return;
      }
      this.lastDriverPersistAt.set(rideId, now);
      if (context.status === "IN_PROGRESS" && context.dirtyOdometer) {
        context.pendingMeters = 0;
        context.dirtyOdometer = false;
      }
      if (Date.now() - this.lastTrackCleanupAt > 60 * 60_000) {
        this.lastTrackCleanupAt = Date.now();
        await this.prisma.rideTrackPoint.deleteMany({
          where: { at: { lt: new Date(Date.now() - TRACK_RETENTION_DAYS * 24 * 60 * 60_000) } },
        });
      }
    } catch (error) {
      this.lastDriverPersistAt.delete(rideId);
      this.logger.error(`Could not persist driver location for ride ${rideId}`, error);
    }
  }

  private async persistClientLocation(
    rideId: string,
    data: LiveLocationPayload & { lat: number; lng: number },
    at: number
  ) {
    const now = Date.now();
    if (now - (this.lastClientPersistAt.get(rideId) ?? 0) < LOCATION_PERSIST_INTERVAL_MS) return;
    this.lastClientPersistAt.set(rideId, now);
    const locatedAt = new Date(at);
    try {
      await this.prisma.ride.updateMany({
        where: {
          id: rideId,
          status: { in: [...ACTIVE_CLIENT_LOCATION_STATUSES] },
          OR: [{ clientLocatedAt: null }, { clientLocatedAt: { lt: locatedAt } }],
        },
        data: {
          clientLat: data.lat,
          clientLng: data.lng,
          clientLocatedAt: locatedAt,
        },
      });
    } catch (error) {
      this.lastClientPersistAt.delete(rideId);
      this.logger.error(`Could not persist client location for ride ${rideId}`, error);
    }
  }

  // Appelable depuis le service pour pousser un changement de statut aux clients
  emitStatus(rideId: string, status: string) {
    this.invalidateRideLocationContext(rideId);
    this.server.to(`ride:${rideId}`).emit("ride:status", { rideId, status });
  }

  /**
   * Nouvelle demande publiée : émise uniquement dans la room `drivers`.
   * Payload inclut `clientDisplayName` pour affichage sur le radar.
   */
  emitNewRequest(payload: {
    rideId: string;
    vehicleType: string;
    price: number;
    originLat: number;
    originLng: number;
    clientDisplayName?: string | null;
  }) {
    this.server?.to("drivers").emit("ride:new", { ...payload, at: new Date().toISOString() });
  }

  /** Un Zem a accepté la course : le client reçoit le profil du Zem (popup) dans sa room personnelle. */
  emitOffered(clientId: string, payload: Record<string, unknown>) {
    this.server?.to(`user:${clientId}`).emit("ride:offered", payload);
  }

  /** La proposition est terminée : la popup du client se ferme (retirée, expirée, annulée, choisie ailleurs). */
  emitOfferEnded(clientId: string, rideId: string, outcome: "declined" | "withdrawn" | "expired" | "cancelled" | "approved") {
    this.server?.to(`user:${clientId}`).emit("ride:offer-ended", { rideId, outcome, at: new Date().toISOString() });
  }

  /** Le client a ouvert la popup : le Zem peut afficher « Le client regarde ton profil ». */
  emitOfferSeen(driverId: string, rideId: string, at: string) {
    this.server?.to(`user:${driverId}`).emit("ride:offer-seen", { rideId, at });
  }

  /**
   * Une demande quitte le radar (prise, offerte, annulée, expirée).
   * Émis dans la room `drivers`.
   */
  emitRideRemoved(rideId: string, reason: "taken" | "offered" | "cancelled" | "expired") {
    this.server?.to("drivers").emit("ride:removed", { rideId, reason, at: new Date().toISOString() });
  }
}
