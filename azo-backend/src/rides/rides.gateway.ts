import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

// Suivi en direct : le chauffeur envoie sa position, le client la reçoit.
// Côté mobile : socket.emit("ride:join", { rideId }) puis socket.on("driver:location", ...)
@WebSocketGateway({ cors: { origin: "*" } })
export class RidesGateway {
  @WebSocketServer() server: Server;

  @SubscribeMessage("ride:join")
  join(@ConnectedSocket() client: Socket, @MessageBody() data: { rideId: string }) {
    client.join(`ride:${data.rideId}`);
    return { joined: data.rideId };
  }

  // Le chauffeur émet sa position toutes les ~5 secondes
  @SubscribeMessage("driver:location")
  location(@MessageBody() data: { rideId: string; lat: number; lng: number }) {
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
