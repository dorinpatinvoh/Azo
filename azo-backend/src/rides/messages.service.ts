import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { PricingService } from "../pricing/pricing.module";
import { NotificationsService } from "../notifications/notifications.module";
import { buildDisplayName, buildDriverDisplayName } from "./display-name";
import { Server } from "socket.io";
import type { RideStatus } from "@prisma/client";

// Statuts où l'écriture de message est permise
const CHAT_OPEN_STATUSES: RideStatus[] = ["MATCHED", "ARRIVED", "IN_PROGRESS"];

// Limite de débit : 20 messages par minute et par utilisateur
const CHAT_RATE_LIMIT = 20;
const CHAT_RATE_WINDOW_MS = 60 * 1000;

// Intervalle minimum entre push notifications pour le chat (30 s par course)
const CHAT_PUSH_THROTTLE_MS = 30 * 1000;

@Injectable()
export class MessagesService {
  // Serveur socket : injecté depuis le gateway après démarrage
  private socketServer: Server | null = null;
  // Throttle pour les push notifications de chat
  private lastChatPushAt = new Map<string, number>(); // clé : `${rideId}:${recipientId}`

  constructor(
    private prisma: PrismaService,
    private pricing: PricingService,
    private notifications: NotificationsService,
  ) {}

  setSocketServer(server: Server) {
    this.socketServer = server;
  }

  // ─── Vérifier que l'utilisateur est participant de la course ─────────────────

  private async assertParticipant(rideId: string, userId: string) {
    const ride = await this.prisma.ride.findUnique({
      where: { id: rideId },
      select: { clientId: true, driverId: true, status: true, completedAt: true },
    });
    if (!ride) throw new NotFoundException("Course introuvable");
    if (ride.clientId !== userId && ride.driverId !== userId) {
      throw new ForbiddenException({ code: "FORBIDDEN", message: "Accès refusé." });
    }
    return ride;
  }

  // ─── GET /rides/:id/messages ─────────────────────────────────────────────────

  async getMessages(
    rideId: string,
    userId: string,
    params: { before?: string; limit?: number; scope?: "ride" | "peer" } = {}
  ) {
    const ride = await this.assertParticipant(rideId, userId);

    const limit = Math.min(Math.max(1, params.limit ?? 50), 200);
    const before = params.before ? new Date(params.before) : undefined;
    const chatSettings = this.pricing.chatSettings();
    const minutesAfterRide = chatSettings.minutesAfterRide ?? 0;
    const locked = !CHAT_OPEN_STATUSES.includes(ride.status)
      && !(
        minutesAfterRide > 0
        && ride.completedAt
        && Date.now() - ride.completedAt.getTime() < minutesAfterRide * 60_000
      );

    if (params.scope === "peer") {
      // Messages de toutes les courses entre ces deux personnes
      const peerId = ride.clientId === userId ? ride.driverId : ride.clientId;
      if (!peerId) {
        return { items: [], nextBefore: null, locked };
      }
      const whereRides = {
        OR: [
          { clientId: ride.clientId, driverId: ride.driverId },
        ],
      };
      const messages = await this.prisma.rideMessage.findMany({
        where: {
          ride: whereRides,
          ...(before ? { createdAt: { lt: before } } : {}),
        },
        include: {
          sender: { select: { firstName: true, lastName: true, fullName: true, role: true } },
          ride: { select: { clientId: true, driverId: true } },
        },
        orderBy: { createdAt: "asc" },
        take: limit + 1,
      });

      const hasMore = messages.length > limit;
      const items = messages.slice(0, limit).map((m) => this.formatMessage(m, userId));
      return {
        items,
        nextBefore: hasMore && items.length > 0 ? items[0].createdAt : null,
        locked,
      };
    }

    // scope = "ride" (défaut)
    const messages = await this.prisma.rideMessage.findMany({
      where: {
        rideId,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      include: {
        sender: { select: { firstName: true, lastName: true, fullName: true, role: true } },
        ride: { select: { clientId: true, driverId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
    });

    const hasMore = messages.length > limit;
    const items = messages.slice(0, limit).reverse().map((m) => this.formatMessage(m, userId));
    return {
      items,
      nextBefore: hasMore ? items[0]?.createdAt ?? null : null,
      locked,
    };
  }

  // ─── POST /rides/:id/messages ────────────────────────────────────────────────

  async sendMessage(
    rideId: string,
    userId: string,
    text: string,
    senderRole?: "CLIENT" | "PROVIDER"
  ) {
    // Sécurité : vérifier l'appartenance
    const ride = await this.assertParticipant(rideId, userId);

    // Vérifier que le chat est ouvert
    const chatSettings = this.pricing.chatSettings();
    const minutesAfterRide = chatSettings.minutesAfterRide ?? 0;
    const chatOpen = CHAT_OPEN_STATUSES.includes(ride.status)
      || (
        minutesAfterRide > 0
        && ride.completedAt
        && Date.now() - ride.completedAt.getTime() < minutesAfterRide * 60_000
      );

    if (!chatOpen) {
      throw new ForbiddenException({ code: "CHAT_LOCKED", message: "La discussion est verrouillée pour cette course." });
    }

    // Nettoyage et validation du texte
    const cleanText = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
    if (!cleanText || cleanText.length > 300) {
      throw new ForbiddenException({ code: "MESSAGE_INVALID", message: "Le message doit contenir entre 1 et 300 caractères." });
    }

    // Limite de débit : 20 messages/minute
    const recentCount = await this.prisma.rideMessage.count({
      where: { senderId: userId, createdAt: { gt: new Date(Date.now() - CHAT_RATE_WINDOW_MS) } },
    });
    if (recentCount >= CHAT_RATE_LIMIT) {
      throw new HttpException(
        { code: "TOO_MANY_REQUESTS", message: "Trop de messages envoyés. Patiente une minute." },
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    // Calculer le rôle depuis la course (ignorer senderRole du client)
    const role: "CLIENT" | "PROVIDER" = ride.driverId === userId ? "PROVIDER" : "CLIENT";

    // Persister le message
    const message = await this.prisma.rideMessage.create({
      data: { rideId, senderId: userId, senderRole: role, text: cleanText },
      include: {
        sender: { select: { firstName: true, lastName: true, fullName: true, role: true } },
        ride: { select: { clientId: true, driverId: true } },
      },
    });

    const formatted = this.formatMessage(message, userId);

    // Diffusion socket dans la room de la course
    this.socketServer?.to(`ride:${rideId}`).emit("ride:chat", formatted);

    // Événement unread vers le destinataire
    const recipientId = ride.clientId === userId ? ride.driverId : ride.clientId;
    if (recipientId) {
      const unreadTotal = await this.countUnreadForUser(recipientId, rideId);
      this.socketServer?.to(`user:${recipientId}`).emit("messages:unread", {
        rideId,
        unreadTotal,
        peerDisplayName: formatted.senderName,
        text: cleanText.slice(0, 80),
        at: formatted.createdAt,
      });

      // Push si le destinataire n'est pas dans la room de la course
      const throttleKey = `${rideId}:${recipientId}`;
      const lastPush = this.lastChatPushAt.get(throttleKey) ?? 0;
      if (Date.now() - lastPush > CHAT_PUSH_THROTTLE_MS) {
        const recipientInRoom = this.socketServer
          ? (await this.socketServer.in(`ride:${rideId}`).fetchSockets()).some(
              (s: any) => s.data?.user?.userId === recipientId
            )
          : false;

        if (!recipientInRoom) {
          this.lastChatPushAt.set(throttleKey, Date.now());
          await this.notifications.push(
            recipientId,
            formatted.senderName,
            cleanText.slice(0, 80),
            "chat",
            {
              sendPush: true,
              titleKey: "NOTIFICATION_CHAT_MESSAGE",
              params: { peer: formatted.senderName, text: cleanText.slice(0, 80) },
              data: { event: "chat-message", rideId },
            }
          ).catch(() => null);
        }
      }
    }

    return formatted;
  }

  // ─── POST /rides/:id/messages/read ──────────────────────────────────────────

  async markAsRead(rideId: string, userId: string) {
    // Vérifier l'appartenance
    await this.assertParticipant(rideId, userId);

    const now = new Date();
    await this.prisma.rideMessage.updateMany({
      where: { rideId, senderId: { not: userId }, readAt: null },
      data: { readAt: now },
    });

    const unreadTotal = await this.countUnreadForUser(userId);
    return { unreadTotal };
  }

  // ─── GET /messages/unread-count ──────────────────────────────────────────────

  async getUnreadCount(userId: string) {
    const count = await this.countUnreadForUser(userId);
    return { count };
  }

  // ─── GET /messages/conversations ────────────────────────────────────────────

  async getConversations(userId: string, params: { limit?: number; cursor?: string } = {}) {
    const limit = Math.min(Math.max(1, params.limit ?? 30), 50);
    const cursor = params.cursor ? new Date(params.cursor) : undefined;

    // Trouver toutes les courses où l'utilisateur a participé ET qui ont des messages
    const ridesWithMessages = await this.prisma.ride.findMany({
      where: {
        OR: [{ clientId: userId }, { driverId: userId }],
        messages: { some: {} },
      },
      select: {
        id: true,
        clientId: true,
        driverId: true,
        status: true,
        client: { select: { firstName: true, lastName: true, fullName: true } },
        driver: {
          select: {
            firstName: true,
            lastName: true,
            fullName: true,
            provider: { select: { vehicleType: true, status: true, kycScore: true, fullName: true } },
          },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { text: true, createdAt: true, senderId: true },
        },
      },
    });

    // Grouper par paire (clientId, driverId)
    type PairKey = string;
    const pairMap = new Map<
      PairKey,
      {
        clientId: string;
        driverId: string;
        lastMessage: { text: string; at: Date; fromMe: boolean };
        lastRideId: string;
        lastRideStatus: string;
        ridesCount: number;
        rideIds: string[];
        client: typeof ridesWithMessages[0]["client"];
        driver: typeof ridesWithMessages[0]["driver"];
      }
    >();

    for (const ride of ridesWithMessages) {
      if (!ride.driverId) continue;
      const pairKey: PairKey = `${ride.clientId}:${ride.driverId}`;
      const lastMsg = ride.messages[0];
      if (!lastMsg) continue;

      const existing = pairMap.get(pairKey);
      if (!existing) {
        pairMap.set(pairKey, {
          clientId: ride.clientId,
          driverId: ride.driverId,
          lastMessage: { text: lastMsg.text, at: lastMsg.createdAt, fromMe: lastMsg.senderId === userId },
          lastRideId: ride.id,
          lastRideStatus: ride.status,
          ridesCount: 1,
          rideIds: [ride.id],
          client: ride.client,
          driver: ride.driver,
        });
      } else {
        existing.ridesCount++;
        existing.rideIds.push(ride.id);
        if (lastMsg.createdAt > existing.lastMessage.at) {
          existing.lastMessage = { text: lastMsg.text, at: lastMsg.createdAt, fromMe: lastMsg.senderId === userId };
          existing.lastRideId = ride.id;
          existing.lastRideStatus = ride.status;
        }
      }
    }

    // Trier par dernier message décroissant, appliquer curseur et limite
    let pairs = Array.from(pairMap.values()).sort(
      (a, b) => b.lastMessage.at.getTime() - a.lastMessage.at.getTime()
    );

    if (cursor) {
      pairs = pairs.filter((p) => p.lastMessage.at < cursor);
    }
    const hasMore = pairs.length > limit;
    const page = pairs.slice(0, limit);

    // Enrichir chaque paire
    const items = await Promise.all(page.map(async (pair) => {
      const peerId = pair.clientId === userId ? pair.driverId : pair.clientId;
      const peerIsDriver = pair.driverId !== userId;

      // Compter les non-lus
      const unreadCount = await this.prisma.rideMessage.count({
        where: {
          rideId: { in: pair.rideIds },
          senderId: { not: userId },
          readAt: null,
        },
      });

      // Course en cours entre les deux ?
      const activePairRide = await this.prisma.ride.findFirst({
        where: {
          clientId: pair.clientId,
          driverId: pair.driverId,
          status: { in: CHAT_OPEN_STATUSES },
        },
        select: { id: true },
      });

      // Profil du pair
      let peer: Record<string, unknown>;
      if (peerIsDriver && pair.driver) {
        const d = pair.driver;
        const { displayName } = buildDriverDisplayName({
          providerFullName: d.provider?.fullName ?? null,
          userFullName: d.fullName,
          firstName: d.firstName,
          lastName: d.lastName,
        });
        peer = {
          displayName,
          role: "DRIVER",
          photoUrl: null,
          verified: d.provider?.status === "APPROVED" && (d.provider?.kycScore ?? 0) >= 80,
          vehicleType: d.provider?.vehicleType ?? null,
        };
      } else {
        const c = pair.client;
        const { displayName } = buildDisplayName({ firstName: c?.firstName, lastName: c?.lastName, fullName: c?.fullName });
        peer = { displayName, role: "CLIENT", photoUrl: null };
      }

      return {
        peer,
        lastRideId: pair.lastRideId,
        lastRideStatus: pair.lastRideStatus,
        ridesCount: pair.ridesCount,
        lastMessage: {
          text: pair.lastMessage.text,
          at: pair.lastMessage.at.toISOString(),
          fromMe: pair.lastMessage.fromMe,
        },
        unreadCount,
        activeRideId: activePairRide?.id ?? null,
        canReply: !!activePairRide,
      };
    }));

    return {
      items,
      nextCursor: hasMore && page.length > 0 ? page[page.length - 1].lastMessage.at.toISOString() : null,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private formatMessage(
    message: {
      id: string;
      rideId: string;
      senderId: string;
      senderRole: string;
      text: string;
      createdAt: Date;
      readAt: Date | null;
      sender: { firstName?: string | null; lastName?: string | null; fullName?: string | null; role?: string };
      ride: { clientId: string; driverId: string | null };
    },
    _requesterId: string
  ) {
    const isDriver = message.ride.driverId === message.senderId;
    const { displayName } = isDriver
      ? buildDisplayName({ firstName: message.sender.firstName, lastName: message.sender.lastName, fullName: message.sender.fullName })
      : buildDisplayName({ firstName: message.sender.firstName, lastName: message.sender.lastName, fullName: message.sender.fullName });

    return {
      id: message.id,
      rideId: message.rideId,
      senderRole: message.senderRole as "CLIENT" | "PROVIDER",
      senderName: displayName ?? (message.senderRole === "PROVIDER" ? "Prestataire AZƆ̀" : "Client AZƆ̀"),
      text: message.text,
      createdAt: message.createdAt.toISOString(),
      readAt: message.readAt?.toISOString() ?? null,
    };
  }

  private async countUnreadForUser(userId: string, rideId?: string) {
    return this.prisma.rideMessage.count({
      where: {
        ...(rideId ? { rideId } : {}),
        senderId: { not: userId },
        readAt: null,
        ride: {
          OR: [{ clientId: userId }, { driverId: userId }],
        },
      },
    });
  }
}
