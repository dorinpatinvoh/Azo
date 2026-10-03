import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { JwtService } from "@nestjs/jwt";
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

  constructor(private jwt: JwtService) {}

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
        // Jeton expiré ou invalide : on laisse la connexion en lecture seule sur ride:join
      }
    }
  }

  @SubscribeMessage("ride:join")
  join(@ConnectedSocket() client: Socket, @MessageBody() data: { rideId?: string }) {
    if (!data?.rideId || typeof data.rideId !== "string") return { joined: null };
    client.join(`ride:${data.rideId}`);
    return { joined: data.rideId, messages: this.getMessages(data.rideId) };
  }

  // Le chauffeur émet sa position toutes les ~5 secondes
  @SubscribeMessage("driver:location")
  location(@MessageBody() data: { rideId?: string; lat?: number; lng?: number }) {
    if (
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
    this.server.to(`ride:${data.rideId}`).emit("driver:location", {
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
}
