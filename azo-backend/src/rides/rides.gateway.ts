import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { Server, Socket } from "socket.io";

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

// Suivi en direct + Messagerie sécurisée in-app :
// Côté mobile : socket.emit("ride:join", { rideId }) puis socket.on("driver:location" | "ride:chat", ...)
@WebSocketGateway({ cors: { origin: "*" } })
export class RidesGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  private chatStore = new Map<string, RideChatMessage[]>();
  private readonly logger = new Logger(RidesGateway.name);
  private lastDriverTimestamp = new Map<string, number>();
  private lastClientTimestamp = new Map<string, number>();
  private lastDriverPersistAt = new Map<string, number>();
  private lastClientPersistAt = new Map<string, number>();

  constructor(private jwt: JwtService, private prisma: PrismaService) {}

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

  // Le chauffeur émet sa position toutes les ~2-3 secondes pendant une course active.
  @SubscribeMessage("driver:location")
  async location(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: LiveLocationPayload
  ) {
    const userId = client.data?.user?.userId;
    if (!userId || !this.hasValidCoordinates(data)) return;

    const ride = await this.prisma.ride.findUnique({
      where: { id: data.rideId },
      select: { driverId: true, status: true, driverLocatedAt: true },
    });
    if (
      !ride ||
      ride.driverId !== userId ||
      !ACTIVE_DRIVER_LOCATION_STATUSES.includes(ride.status as (typeof ACTIVE_DRIVER_LOCATION_STATUSES)[number])
    ) {
      return;
    }

    const at = this.locationTimestamp(data.ts);
    if (at < Math.max(this.lastDriverTimestamp.get(data.rideId) ?? 0, ride.driverLocatedAt?.getTime() ?? 0)) return;
    this.lastDriverTimestamp.set(data.rideId, at);
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
    await this.persistDriverLocation(data.rideId, data, at, heading, speed);
  }

  @SubscribeMessage("client:location")
  async clientLocation(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: LiveLocationPayload
  ) {
    const userId = client.data?.user?.userId;
    if (!userId || !this.hasValidCoordinates(data)) return;

    const ride = await this.prisma.ride.findUnique({
      where: { id: data.rideId },
      select: { clientId: true, driverId: true, status: true, clientLocatedAt: true },
    });
    if (
      !ride ||
      ride.clientId !== userId ||
      !ACTIVE_CLIENT_LOCATION_STATUSES.includes(ride.status as (typeof ACTIVE_CLIENT_LOCATION_STATUSES)[number])
    ) {
      return;
    }

    const at = this.locationTimestamp(data.ts);
    if (at < Math.max(this.lastClientTimestamp.get(data.rideId) ?? 0, ride.clientLocatedAt?.getTime() ?? 0)) return;
    this.lastClientTimestamp.set(data.rideId, at);
    const accuracy = this.validNonNegative(data.accuracy);
    if (ride.driverId) {
      this.server?.to(`user:${ride.driverId}`).emit("client:location", {
        lat: data.lat,
        lng: data.lng,
        ...(accuracy !== undefined ? { accuracy: Math.round(accuracy) } : {}),
        at,
      });
    }
    await this.persistClientLocation(data.rideId, data, at);
  }

  clearRideLocations(rideId: string) {
    this.lastDriverTimestamp.delete(rideId);
    this.lastClientTimestamp.delete(rideId);
    this.lastDriverPersistAt.delete(rideId);
    this.lastClientPersistAt.delete(rideId);
  }

  clearClientLocationState(rideId: string) {
    this.lastClientTimestamp.delete(rideId);
    this.lastClientPersistAt.delete(rideId);
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
      ? Math.round(heading)
      : undefined;
  }

  private validNonNegative(value: number | undefined): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  private async persistDriverLocation(
    rideId: string,
    data: LiveLocationPayload & { lat: number; lng: number },
    at: number,
    heading: number | undefined,
    speed: number | undefined
  ) {
    const now = Date.now();
    if (now - (this.lastDriverPersistAt.get(rideId) ?? 0) < LOCATION_PERSIST_INTERVAL_MS) return;
    this.lastDriverPersistAt.set(rideId, now);
    const locatedAt = new Date(at);
    try {
      await this.prisma.ride.updateMany({
        where: {
          id: rideId,
          status: { in: [...ACTIVE_DRIVER_LOCATION_STATUSES] },
          OR: [{ driverLocatedAt: null }, { driverLocatedAt: { lt: locatedAt } }],
        },
        data: {
          driverLat: data.lat,
          driverLng: data.lng,
          driverHeading: heading ?? null,
          driverSpeed: speed ?? null,
          driverLocatedAt: locatedAt,
        },
      });
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
    this.server.to(`ride:${rideId}`).emit("ride:status", { rideId, status });
  }

  /**
   * Nouvelle demande publiée : tous les appareils connectés sont prévenus
   * (`ride:new`). L'application mobile filtre sur le véhicule de son dossier et
   * rafraîchit son radar immédiatement, sans attendre le cycle de 8 secondes.
   *
   * Aucune donnée personnelle n'est diffusée : ni le nom du client, ni son numéro,
   * uniquement ce qui figure déjà dans le radar (course, véhicule, prix, départ).
   */
  emitNewRequest(payload: {
    rideId: string;
    vehicleType: string;
    price: number;
    originLat: number;
    originLng: number;
  }) {
    this.server?.emit("ride:new", { ...payload, at: new Date().toISOString() });
  }
}
