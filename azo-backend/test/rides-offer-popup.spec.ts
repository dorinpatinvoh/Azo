/**
 * Popup de proposition du Zem (PROJECT_SUMMARY/DEMANDE_BACKEND_POPUP_PROPOSITION_ZEM.md) :
 * événement `ride:offered`, notification dédiée non bloquante, rattrapage, « vu par le client »,
 * marge de confirmation et fermeture de la popup quand la proposition se termine.
 */
jest.mock("@prisma/client", () => ({
  VehicleType: {
    ZEM_ESSENCE: "ZEM_ESSENCE",
    ZEM_ELECTRIC: "ZEM_ELECTRIC",
    GAZELLE: "GAZELLE",
    KOALA: "KOALA",
    LEOPARD: "LEOPARD",
  },
}));
jest.mock("../src/prisma/prisma.service", () => ({ PrismaService: class PrismaService {} }));
jest.mock("../src/wallet/wallet.module", () => ({ WalletService: class WalletService {} }));
jest.mock("../src/pricing/pricing.module", () => ({ PricingService: class PricingService {} }));
jest.mock("../src/rides/rides.gateway", () => ({ RidesGateway: class RidesGateway {} }));
jest.mock("../src/notifications/notifications.module", () => {
  // Le vrai service est testé plus bas : on garde la classe réelle, sans ses dépendances Nest/Prisma.
  const actual = jest.requireActual("../src/notifications/notifications.module");
  return actual;
});

import { ForbiddenException } from "@nestjs/common";
import { RidesService } from "../src/rides/rides.service";
import { NotificationsService } from "../src/notifications/notifications.module";
import { offerPushText } from "../src/rides/offer-texts";

const rideId = "ride-1";
const clientId = "client-1";
const driverId = "driver-1";

type State = { status: string; offerExpiresAt: Date | null; offerSeenAt: Date | null; driverId: string | null };

function makeService(initial: Partial<State> = {}, opts: { pushNever?: boolean } = {}) {
  const state: State = { status: "PENDING", offerExpiresAt: null, offerSeenAt: null, driverId: null, ...initial };
  const rideRow = () => ({
    id: rideId,
    clientId,
    driverId: state.driverId,
    status: state.status,
    vehicleType: "ZEM_ELECTRIC",
    price: 1200,
    originLabel: "Cadjèhoun",
    destLabel: "Marché Dantokpa",
    originLat: 6.37,
    originLng: 2.39,
    destLat: 6.38,
    destLng: 2.4,
    driverLat: 6.371,
    driverLng: 2.391,
    offerExpiresAt: state.offerExpiresAt,
    offerSeenAt: state.offerSeenAt,
    declinedDriverIds: [] as string[],
    createdAt: new Date(),
    client: { fullName: "Kossi Adjovi", phone: "+22901000000", firstName: "Kossi", lastName: "Adjovi" },
  });
  const offers: any[] = [];
  const prisma = {
    ride: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(rideRow())),
      findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve(rideRow())),
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockImplementation(({ data, where }) => {
        // Reproduit les conditions du serveur (statut, marge, offerSeenAt)
        if (where.status && where.status !== state.status) return Promise.resolve({ count: 0 });
        if (where.offerSeenAt === null && state.offerSeenAt) return Promise.resolve({ count: 0 });
        if (where.offerExpiresAt?.gt && !(state.offerExpiresAt && state.offerExpiresAt > where.offerExpiresAt.gt)) {
          return Promise.resolve({ count: 0 });
        }
        if (data.status) state.status = data.status;
        if ("driverId" in data) state.driverId = data.driverId;
        if ("offerExpiresAt" in data) state.offerExpiresAt = data.offerExpiresAt;
        if ("offerSeenAt" in data) state.offerSeenAt = data.offerSeenAt;
        return Promise.resolve({ count: 1 });
      }),
    },
    rideOffer: {
      create: jest.fn().mockImplementation(({ data }) => {
        offers.push({ ...data, endedAt: null });
        return Promise.resolve(data);
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        const open = offers.filter((o) => o.rideId === where.rideId && o.driverId === where.driverId && o.status === where.status);
        open.forEach((o) => Object.assign(o, data));
        return Promise.resolve({ count: open.length });
      }),
      findFirst: jest.fn().mockImplementation(({ where }) => {
        const found = offers
          .filter((o) => o.driverId === where.driverId && (!where.rideId || o.rideId === where.rideId) && o.status !== "OFFERED" && o.endedAt)
          .sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime())[0];
        return Promise.resolve(found ?? null);
      }),
    },
    user: {
      findUnique: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(
          where.id === driverId
            ? {
                fullName: "Romaric Soglo",
                firstName: "Romaric",
                lastName: "Soglo",
                createdAt: new Date("2025-03-12"),
                provider: {
                  fullName: "Romaric Soglo",
                  city: "Cotonou",
                  zones: ["Cadjèhoun"],
                  bio: "Zem depuis 4 ans",
                  experienceYears: 4,
                  vehicleType: "ZEM_ELECTRIC",
                  vehicleModel: "Bajaj Boxer",
                  plateNumber: "RB-5421-AX",
                  status: "APPROVED",
                  kycScore: 90,
                  rating: 4.8,
                  ratingCount: 126,
                  jobsCompleted: 340,
                  agencyName: null,
                },
              }
            : { language: "fr" }
        )
      ),
    },
  };
  const notifications = {
    push: jest.fn().mockImplementation(() => (opts.pushNever ? new Promise(() => undefined) : Promise.resolve({}))),
    pushSilent: jest.fn().mockResolvedValue(undefined),
  };
  const pricing = {
    rideSettings: jest.fn().mockReturnValue({ offerExpirySeconds: 45, requireClientApproval: true, offerApprovalGraceSeconds: 5 }),
    radarSettings: jest.fn().mockReturnValue({ pendingExpiryMinutes: 20 }),
    isZem: jest.fn().mockReturnValue(true),
  };
  const gateway = {
    invalidateRideLocationContext: jest.fn(),
    emitStatus: jest.fn(),
    emitRideRemoved: jest.fn(),
    emitNewRequest: jest.fn(),
    emitOffered: jest.fn(),
    emitOfferEnded: jest.fn(),
    emitRideCancelled: jest.fn(),
    emitOfferSeen: jest.fn(),
    emitOfferApproved: jest.fn(),
    clearRideLocations: jest.fn(),
  };
  const service = new RidesService(prisma as any, {} as any, notifications as any, pricing as any, gateway as any);
  return { service, prisma, notifications, gateway, state, offers };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("accept : annonce au client", () => {
  it("émet ride:offered avec le profil public, sans téléphone ni identifiant du Zem", async () => {
    const { service, gateway } = makeService();
    const accepted = await service.accept(rideId, driverId);
    await flush();
    expect(accepted.status).toBe("OFFERED");
    expect(gateway.emitOffered).toHaveBeenCalledTimes(1);
    const [target, payload] = gateway.emitOffered.mock.calls[0];
    expect(target).toBe(clientId);
    expect(payload).toMatchObject({
      rideId,
      price: 1200,
      originLabel: "Cadjèhoun",
      destLabel: "Marché Dantokpa",
      expiresInSeconds: expect.any(Number),
      driver: { displayName: "Romaric S.", verified: true, rating: 4.8, ratingCount: 126, vehicleType: "ZEM_ELECTRIC" },
    });
    expect(payload.expiresInSeconds).toBeGreaterThan(40);
    expect(new Date(payload.serverNow).getTime()).toBeLessThanOrEqual(Date.now());
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("phone");
    expect(serialized).not.toContain("Soglo");
    expect(serialized).not.toContain(driverId);
    expect(serialized).not.toContain("RB-5421-AX"); // plaque masquée seulement
  });

  it("envoie une notification poussée dédiée : canal ride-offers, durée de vie = délai, texte du client", async () => {
    const { service, notifications } = makeService();
    await service.accept(rideId, driverId);
    await flush();
    const [to, title, body, type, options] = notifications.push.mock.calls[0];
    expect(to).toBe(clientId);
    expect(type).toBe("ride");
    expect(title).toBe("Un Zem a accepté ta course");
    expect(body).toMatch(/il te reste \d+ s/);
    expect(options).toMatchObject({ sendPush: true, channelId: "ride-offers" });
    expect(options.ttlSeconds).toBeGreaterThan(40);
    expect(options.data).toMatchObject({ event: "ride-offered", rideId });
    // Pas de profil complet ni de données sensibles dans la notification
    expect(JSON.stringify(options.data)).not.toContain("driver");
  });

  it("répond au Zem sans attendre la notification (l'API Expo peut mettre 6 s)", async () => {
    const { service } = makeService({}, { pushNever: true });
    const result = await Promise.race([
      service.accept(rideId, driverId).then(() => "done"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 500)),
    ]);
    expect(result).toBe("done");
  });
});

describe("rattrapage : GET /rides/offers/pending", () => {
  it("renvoie la proposition en cours avec le même contenu que l'événement", async () => {
    const { service, prisma } = makeService({ status: "OFFERED", driverId, offerExpiresAt: new Date(Date.now() + 30_000) });
    prisma.ride.findMany.mockResolvedValue([{ id: rideId }]);
    const { offers } = await service.pendingOffers(clientId);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ rideId, driver: { displayName: "Romaric S." } });
    expect(prisma.ride.findMany.mock.calls[0][0].where).toMatchObject({ clientId, status: "OFFERED" });
  });

  it("ne renvoie rien quand aucune proposition n'est en attente", async () => {
    const { service } = makeService();
    expect((await service.pendingOffers(clientId)).offers).toEqual([]);
  });
});

describe("offer-seen : le Zem sait que le client regarde son profil", () => {
  const offered = () => ({ status: "OFFERED", driverId, offerExpiresAt: new Date(Date.now() + 30_000) });

  it("enregistre l'ouverture et prévient le Zem, une seule fois (idempotent)", async () => {
    const { service, gateway } = makeService(offered());
    const first = await service.offerSeen(rideId, clientId);
    const second = await service.offerSeen(rideId, clientId);
    expect(second.seenAt).toBe(first.seenAt);
    expect(gateway.emitOfferSeen).toHaveBeenCalledTimes(1);
    expect(gateway.emitOfferSeen).toHaveBeenCalledWith(driverId, rideId, first.seenAt);
  });

  it("refuse un autre utilisateur", async () => {
    const { service } = makeService(offered());
    await expect(service.offerSeen(rideId, "intrus")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("répond RIDE_OFFER_ENDED quand la proposition n'est plus en attente", async () => {
    const { service } = makeService({ status: "MATCHED", driverId });
    await expect(service.offerSeen(rideId, clientId)).rejects.toMatchObject({
      response: { code: "RIDE_OFFER_ENDED" },
    });
  });
});

describe("marge de confirmation", () => {
  it("accepte « Choisir ce Zem » 3 s après la fin du compte à rebours (dans la marge de 5 s)", async () => {
    const { service, gateway, state } = makeService({ status: "OFFERED", driverId, offerExpiresAt: new Date(Date.now() - 3_000) });
    const ride = await service.approveDriver(rideId, clientId);
    expect(state.status).toBe("MATCHED");
    expect(ride.status).toBe("MATCHED");
    expect(gateway.emitOfferEnded).toHaveBeenCalledWith(clientId, rideId, "approved");
  });

  it("refuse 6 s après la fin : RIDE_OFFER_ENDED", async () => {
    const { service, state } = makeService({ status: "OFFERED", driverId, offerExpiresAt: new Date(Date.now() - 6_000) });
    await expect(service.approveDriver(rideId, clientId)).rejects.toMatchObject({ response: { code: "RIDE_OFFER_ENDED" } });
    expect(state.status).not.toBe("MATCHED");
  });

  it("la tâche d'expiration n'agit pas pendant la marge, puis remet la demande en recherche", async () => {
    const inGrace = makeService({ status: "OFFERED", driverId, offerExpiresAt: new Date(Date.now() - 3_000) });
    inGrace.prisma.ride.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(inGrace.state.offerExpiresAt! < where.offerExpiresAt.lt ? [{ id: rideId, clientId, driverId, status: "OFFERED", declinedDriverIds: [] }] : [])
    );
    await inGrace.service.expireAllPendingOffers();
    expect(inGrace.state.status).toBe("OFFERED");

    const past = makeService({ status: "OFFERED", driverId, offerExpiresAt: new Date(Date.now() - 6_000) });
    past.prisma.ride.findMany.mockImplementation(({ where }: any) =>
      Promise.resolve(past.state.offerExpiresAt! < where.offerExpiresAt.lt ? [{ id: rideId, clientId, driverId, status: "OFFERED", declinedDriverIds: [] }] : [])
    );
    await past.service.expireAllPendingOffers();
    expect(past.state.status).toBe("PENDING");
    expect(past.gateway.emitOfferEnded).toHaveBeenCalledWith(clientId, rideId, "expired");
  });
});

describe("fin de proposition : la popup se ferme", () => {
  const offered = () => ({ status: "OFFERED", driverId, offerExpiresAt: new Date(Date.now() + 30_000), offerSeenAt: new Date() });

  it("le Zem retire sa proposition : événement + notification silencieuse au client", async () => {
    const { service, gateway, notifications, state } = makeService(offered());
    await service.withdrawOffer(rideId, driverId);
    await flush();
    expect(state.status).toBe("PENDING");
    expect(state.offerSeenAt).toBeNull();
    expect(gateway.emitOfferEnded).toHaveBeenCalledWith(clientId, rideId, "withdrawn");
    expect(notifications.pushSilent).toHaveBeenCalledWith(
      clientId,
      expect.objectContaining({ event: "ride-offer-ended", rideId, outcome: "withdrawn" }),
      expect.anything()
    );
  });

  it("le client refuse : événement (autres appareils) sans notification silencieuse", async () => {
    const { service, gateway, notifications } = makeService(offered());
    await service.declineDriver(rideId, clientId);
    await flush();
    expect(gateway.emitOfferEnded).toHaveBeenCalledWith(clientId, rideId, "declined");
    expect(notifications.pushSilent).not.toHaveBeenCalled();
  });

  it("le client annule pendant la proposition : popup fermée sur ses autres appareils", async () => {
    const { service, gateway, prisma } = makeService(offered());
    (prisma.ride as any).update = jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: rideId, clientId, driverId, ...data }));
    await service.cancel(rideId, clientId);
    expect(gateway.emitOfferEnded).toHaveBeenCalledWith(clientId, rideId, "cancelled");
  });

  it("retirer une proposition déjà terminée répond RIDE_OFFER_ENDED", async () => {
    const { service } = makeService({ status: "PENDING", driverId });
    await expect(service.withdrawOffer(rideId, driverId)).rejects.toMatchObject({ response: { code: "RIDE_OFFER_ENDED" } });
  });
});

describe("NotificationsService : canal, durée de vie et push silencieux", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function makeNotifications() {
    const prisma = {
      notification: { create: jest.fn().mockResolvedValue({ id: "n1" }) },
      devicePushToken: {
        findMany: jest.fn().mockResolvedValue([{ token: "ExponentPushToken[abc]" }]),
        deleteMany: jest.fn(),
      },
    };
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: "ok" }] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    return { service: new NotificationsService(prisma as any), prisma, fetchMock };
  }

  it("transmet channelId et ttl à l'API Expo", async () => {
    const { service, fetchMock } = makeNotifications();
    await service.push("u1", "Titre", "Corps", "ride", { sendPush: true, channelId: "ride-offers", ttlSeconds: 45, data: { event: "ride-offered" } });
    const [message] = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(message).toMatchObject({ title: "Titre", body: "Corps", channelId: "ride-offers", ttl: 45, priority: "high", sound: "default" });
    expect(message.data).toEqual({ event: "ride-offered" });
  });

  it("garde le canal par défaut sans ttl quand rien n'est précisé", async () => {
    const { service, fetchMock } = makeNotifications();
    await service.push("u1", "T", "B", "ride", { sendPush: true });
    const [message] = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(message.channelId).toBe("default");
    expect(message.ttl).toBeUndefined();
  });

  it("pushSilent : aucun titre, aucun son, aucune ligne dans la boîte de réception", async () => {
    const { service, prisma, fetchMock } = makeNotifications();
    await service.pushSilent("u1", { event: "ride-offer-ended", rideId: "r1" }, { channelId: "ride-offers" });
    const [message] = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(message.title).toBeUndefined();
    expect(message.body).toBeUndefined();
    expect(message.sound).toBeUndefined();
    expect(message._contentAvailable).toBe(true);
    expect(message.data).toEqual({ event: "ride-offer-ended", rideId: "r1" });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});

describe("offerPushText", () => {
  it.each([
    ["fr", "Un Zem a accepté ta course"],
    ["en", "A Zem accepted your ride"],
    ["es", "Un Zem aceptó tu viaje"],
    ["de", "Ein Zem hat deine Fahrt angenommen"],
  ])("texte %s", (lang, title) => {
    const text = offerPushText(lang, 30);
    expect(text.title).toBe(title);
    expect(text.body).toContain("30");
  });

  it("retombe sur le français pour une langue inconnue ou absente", () => {
    expect(offerPushText("xx", 10).title).toBe("Un Zem a accepté ta course");
    expect(offerPushText(null, 10).title).toBe("Un Zem a accepté ta course");
  });
});

describe("fin de proposition : le Zem est informé (DEMANDE_BACKEND_FIN_PROPOSITION_ZEM.md)", () => {
  const offered = () => ({ status: "OFFERED", driverId, offerExpiresAt: new Date(Date.now() + 30_000) });

  it("accept crée la trace de la proposition", async () => {
    const { service, offers } = makeService();
    await service.accept(rideId, driverId);
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ rideId, driverId, status: "OFFERED" });
  });

  it("le client refuse : le Zem lit offerOutcome=declined (jamais 403) et reçoit ride:offer-ended", async () => {
    const { service, gateway } = makeService();
    await service.accept(rideId, driverId);
    await service.declineDriver(rideId, clientId);
    expect(gateway.emitOfferEnded).toHaveBeenCalledWith(driverId, rideId, "declined");
    const view: any = await service.findOne(rideId, driverId);
    expect(view).toMatchObject({ id: rideId, status: "PENDING", driverId: null, offerOutcome: "declined" });
    expect(view.offerEndedAt).toEqual(expect.any(String));
  });

  it("la vue restreinte ne contient ni position, ni téléphone, ni nom complet du client", async () => {
    const { service } = makeService();
    await service.accept(rideId, driverId);
    await service.declineDriver(rideId, clientId);
    const serialized = JSON.stringify(await service.findOne(rideId, driverId));
    for (const secret of ["clientLat", "phone", "Adjovi", "+2290", "originLat"]) expect(serialized).not.toContain(secret);
  });

  it("expiration : offerOutcome=expired + notification push au Zem", async () => {
    const { service, notifications, gateway, state } = makeService();
    await service.accept(rideId, driverId);
    await flush();
    state.offerExpiresAt = new Date(Date.now() - 10_000); // au-delà de la marge de 5 s
    notifications.push.mockClear();
    await service.findOne(rideId, driverId);
    expect(gateway.emitOfferEnded).toHaveBeenCalledWith(driverId, rideId, "expired");
    expect(notifications.push).toHaveBeenCalledWith(
      driverId, expect.any(String), expect.any(String), "ride",
      expect.objectContaining({ sendPush: true, data: { event: "ride-offer-expired", rideId } })
    );
    expect(await service.findOne(rideId, driverId)).toMatchObject({ offerOutcome: "expired" });
  });

  it("retrait par le Zem : offerOutcome=withdrawn", async () => {
    const { service, gateway } = makeService();
    await service.accept(rideId, driverId);
    await service.withdrawOffer(rideId, driverId);
    expect(gateway.emitOfferEnded).toHaveBeenCalledWith(driverId, rideId, "withdrawn");
    expect(await service.findOne(rideId, driverId)).toMatchObject({ offerOutcome: "withdrawn" });
  });

  it("le client choisit ce Zem : ride:offer-approved vers le Zem, sans room de course", async () => {
    const { service, gateway, offers } = makeService();
    await service.accept(rideId, driverId);
    await service.approveDriver(rideId, clientId);
    expect(gateway.emitOfferApproved).toHaveBeenCalledWith(driverId, rideId);
    expect(offers[0].status).toBe("APPROVED");
  });

  it("un Zem sans aucune proposition sur cette course reçoit 403", async () => {
    const { service } = makeService(offered());
    await expect(service.findOne(rideId, "intrus")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("GET /rides/offers/current : proposition en cours puis dernière terminée", async () => {
    const { service, prisma } = makeService();
    await service.accept(rideId, driverId);
    (prisma.ride.findFirst as jest.Mock).mockResolvedValueOnce({
      id: rideId, price: 1200, vehicleType: "ZEM_ELECTRIC", originLabel: "A", destLabel: "B",
      offerExpiresAt: new Date(Date.now() + 30_000), offerSeenAt: null,
    });
    const during: any = await service.currentOffer(driverId);
    expect(during.offer).toMatchObject({ rideId, status: "OFFERED" });
    expect(during.lastEnded).toBeNull();
    await service.declineDriver(rideId, clientId);
    const after: any = await service.currentOffer(driverId);
    expect(after.offer).toBeNull();
    expect(after.lastEnded).toMatchObject({ rideId, outcome: "declined" });
  });

  it("annulation du client pendant OFFERED : offerOutcome=cancelled", async () => {
    const { service, gateway, prisma } = makeService();
    await service.accept(rideId, driverId);
    (prisma.ride as any).update = jest.fn().mockResolvedValue({ id: rideId, status: "CANCELLED" });
    await service.cancel(rideId, clientId).catch(() => undefined);
    expect(gateway.emitOfferEnded).toHaveBeenCalledWith(driverId, rideId, "cancelled");
  });
});
