"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RidesGateway = void 0;
const websockets_1 = require("@nestjs/websockets");
const jwt_1 = require("@nestjs/jwt");
const socket_io_1 = require("socket.io");
// Suivi en direct + Messagerie sécurisée in-app :
// Côté mobile : socket.emit("ride:join", { rideId }) puis socket.on("driver:location" | "ride:chat", ...)
let RidesGateway = class RidesGateway {
    constructor(jwt) {
        this.jwt = jwt;
        this.chatStore = new Map();
    }
    handleConnection(client) {
        const raw = (typeof client.handshake.auth?.token === "string" && client.handshake.auth.token) ||
            (typeof client.handshake.headers?.authorization === "string" &&
                client.handshake.headers.authorization.replace(/^Bearer\s+/i, "")) ||
            (typeof client.handshake.query?.token === "string" && client.handshake.query.token);
        if (raw) {
            try {
                const payload = this.jwt.verify(raw);
                client.data.user = { userId: payload.sub, role: payload.role, phone: payload.phone };
            }
            catch {
                // Jeton expiré ou invalide : on laisse la connexion en lecture seule sur ride:join
            }
        }
    }
    join(client, data) {
        if (!data?.rideId || typeof data.rideId !== "string")
            return { joined: null };
        client.join(`ride:${data.rideId}`);
        return { joined: data.rideId, messages: this.getMessages(data.rideId) };
    }
    // Le chauffeur émet sa position toutes les ~5 secondes
    location(data) {
        if (!data?.rideId ||
            typeof data.lat !== "number" ||
            typeof data.lng !== "number" ||
            !Number.isFinite(data.lat) ||
            !Number.isFinite(data.lng) ||
            Math.abs(data.lat) > 90 ||
            Math.abs(data.lng) > 180) {
            return;
        }
        this.server.to(`ride:${data.rideId}`).emit("driver:location", {
            lat: data.lat,
            lng: data.lng,
            at: Date.now(),
        });
    }
    // Messagerie instantanée sécurisée Client <-> Prestataire (sans exposer les numéros)
    onChat(client, data) {
        if (!data?.rideId || !data?.text || typeof data.text !== "string")
            return;
        const senderId = client.data?.user?.userId || "anon";
        const role = data.senderRole === "PROVIDER" || client.data?.user?.role === "DRIVER"
            ? "PROVIDER"
            : "CLIENT";
        const name = (data.senderName || (role === "PROVIDER" ? "Prestataire AZƆ̀" : "Client AZƆ̀")).slice(0, 40);
        return this.addChatMessage(data.rideId, senderId, role, name, data.text);
    }
    getMessages(rideId) {
        return this.chatStore.get(rideId) ?? [];
    }
    addChatMessage(rideId, senderId, senderRole, senderName, rawText) {
        const text = rawText.trim().slice(0, 300);
        const msg = {
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
        if (list.length > 50)
            list.shift();
        this.chatStore.set(rideId, list);
        this.server?.to(`ride:${rideId}`).emit("ride:chat", msg);
        return msg;
    }
    // Appelable depuis le service pour pousser un changement de statut aux clients
    emitStatus(rideId, status) {
        this.server.to(`ride:${rideId}`).emit("ride:status", { rideId, status });
    }
};
exports.RidesGateway = RidesGateway;
__decorate([
    (0, websockets_1.WebSocketServer)(),
    __metadata("design:type", socket_io_1.Server)
], RidesGateway.prototype, "server", void 0);
__decorate([
    (0, websockets_1.SubscribeMessage)("ride:join"),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], RidesGateway.prototype, "join", null);
__decorate([
    (0, websockets_1.SubscribeMessage)("driver:location"),
    __param(0, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], RidesGateway.prototype, "location", null);
__decorate([
    (0, websockets_1.SubscribeMessage)("ride:chat"),
    __param(0, (0, websockets_1.ConnectedSocket)()),
    __param(1, (0, websockets_1.MessageBody)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [socket_io_1.Socket, Object]),
    __metadata("design:returntype", void 0)
], RidesGateway.prototype, "onChat", null);
exports.RidesGateway = RidesGateway = __decorate([
    (0, websockets_1.WebSocketGateway)({ cors: { origin: "*" } }),
    __metadata("design:paramtypes", [jwt_1.JwtService])
], RidesGateway);
//# sourceMappingURL=rides.gateway.js.map