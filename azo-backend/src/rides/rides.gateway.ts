import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
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

// Suivi en direct + Messagerie sécurisée in-app :
// Côté mobile : socket.emit("ride:join", { rideId }) puis socket.on("driver:location" | "ride:chat", ...)
@WebSocketGateway({ cors: { origin: "*" } })
export class RidesGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  private chatStore = new Map<string, RideChatMessage[]>();

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
      select: { clientId: true, driverId: true },
    });
    if (!ride || (ride.clientId !== userId && ride.driverId !== userId)) return { joined: null };

    client.join(`ride:${data.rideId}`);
    return { joined: data.rideId, messages: this.getMessages(data.rideId) };
  }

  // Le chauffeur émet sa position toutes les ~10 secondes pendant une course active.
  @SubscribeMessage("driver:location")
  async location(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { rideId?: string; lat?: number; lng?: number }
  ) {
    const user = client.data?.user;
    if (
      !user?.userId ||
      user.role !== "DRIVER" ||
      !data?.rideId ||
      typeof data.lat !== "number" ||
      typeof data.lng !== "number" ||
      !Number.isFinite(data.lat) ||
      !Number.isFinite(data.lng) ||
      Math.abs(data.lat) > 90 ||
      Math.abs(data.lng) > 180
    ) {
      return;
    }

    const ride = await this.prisma.ride.findUnique({
      where: { id: data.rideId },
      select: { driverId: true, status: true },
    });
    if (!ride || ride.driverId !== user.userId || !["MATCHED", "ARRIVED", "IN_PROGRESS"].includes(ride.status)) {
      return;
    }

    this.server?.to(`ride:${data.rideId}`).emit("driver:location", {
      lat: data.lat,
      lng: data.lng,
      at: Date.now(),
    });
  }

  // Messagerie instantanée sécurisée Client <-> Prestataire (sans exposer les numéros)
  @SubscribeMessage("ride:chat")
  onChat(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      rideId?: string;
      senderRole?: "CLIENT" | "PROVIDER";
      senderName?: string;
      text?: string;
    }
  ) {
    if (!data?.rideId || !data?.text || typeof data.text !== "string") return;
    const senderId = client.data?.user?.userId || "anon";
    const role: "CLIENT" | "PROVIDER" =
      data.senderRole === "PROVIDER" || client.data?.user?.role === "DRIVER"
        ? "PROVIDER"
        : "CLIENT";
    const name = (data.senderName || (role === "PROVIDER" ? "Prestataire AZƆ̀" : "Client AZƆ̀")).slice(0, 40);
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
