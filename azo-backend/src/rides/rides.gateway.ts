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

// Suivi en direct : le chauffeur envoie sa position, le client la reçoit.
// Côté mobile : socket.emit("ride:join", { rideId }) puis socket.on("driver:location", ...)
@WebSocketGateway({ cors: { origin: "*" } })
export class RidesGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

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
    return { joined: data.rideId };
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

  // Appelable depuis le service pour pousser un changement de statut aux clients
  emitStatus(rideId: string, status: string) {
    this.server.to(`ride:${rideId}`).emit("ride:status", { rideId, status });
  }
}
