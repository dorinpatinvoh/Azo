import { RidesGateway } from "../src/rides/rides.gateway";

const rideId = "ride-123";
const driverId = "driver-123";
const clientId = "client-123";

function makeGateway(ride: Record<string, unknown> | null) {
  const emit = jest.fn();
  const server = {
    to: jest.fn().mockReturnValue({ emit }),
  };
  const prisma = {
    ride: {
      findUnique: jest.fn().mockResolvedValue(ride),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const gateway = new RidesGateway({} as any, prisma as any);
  (gateway as any).server = server;

  return { gateway, prisma, server, emit };
}

function makeSocket(userId: string, role = "DRIVER") {
  return {
    data: { user: { userId, role } },
    join: jest.fn(),
  } as any;
}

describe("RidesGateway real-time ride events", () => {
  describe("driver:location", () => {
    it("relays an active assigned driver's location even when the JWT role is stale", async () => {
      const { gateway, server, emit } = makeGateway({
        driverId,
        status: "IN_PROGRESS",
      });

      await gateway.location(
        makeSocket(driverId, "CLIENT"),
        { rideId, lat: 6.37, lng: 2.39, heading: 92.4 }
      );

      expect(server.to).toHaveBeenCalledWith(`ride:${rideId}`);
      expect(emit).toHaveBeenCalledWith(
        "driver:location",
        expect.objectContaining({ lat: 6.37, lng: 2.39, heading: 92, at: expect.any(Number) })
      );
    });

    it("does not relay a location from a user not assigned to the ride", async () => {
      const { gateway, server } = makeGateway({
        driverId: "another-driver",
        status: "IN_PROGRESS",
      });
      await gateway.location(makeSocket(driverId), { rideId, lat: 6.37, lng: 2.39 });

      expect(server.to).not.toHaveBeenCalled();
    });

    it("ignores an older point and persists no more often than every five seconds", async () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-10-10T12:00:00.000Z"));
      try {
        const { gateway, prisma, emit } = makeGateway({
          driverId,
          status: "IN_PROGRESS",
          driverLocatedAt: null,
        });
        const socket = makeSocket(driverId);

        await gateway.location(socket, {
          rideId,
          lat: 6.37,
          lng: 2.39,
          ts: Date.now() - 2_000,
          speed: 4.6,
          accuracy: 8.2,
        });
        await gateway.location(socket, {
          rideId,
          lat: 6.38,
          lng: 2.4,
          ts: Date.now() - 3_000,
        });
        jest.advanceTimersByTime(2_000);
        await gateway.location(socket, {
          rideId,
          lat: 6.39,
          lng: 2.41,
          ts: Date.now() - 1_000,
          speed: 4.6,
          accuracy: 8.2,
        });

        expect(emit).toHaveBeenCalledTimes(2);
        expect(emit).toHaveBeenLastCalledWith(
          "driver:location",
          expect.objectContaining({ lat: 6.39, lng: 2.41, speed: 4.6, accuracy: 8, at: Date.now() - 1_000 })
        );
        expect(prisma.ride.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.ride.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: rideId,
              status: { in: ["MATCHED", "ARRIVED", "IN_PROGRESS"] },
            }),
            data: expect.objectContaining({
              driverLat: 6.37,
              driverLng: 2.39,
              driverSpeed: 4.6,
              driverLocatedAt: new Date("2026-10-10T11:59:58.000Z"),
            }),
          })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    describe("client:location", () => {
      it.each(["MATCHED", "ARRIVED"])("sends the client's point only to their assigned driver in %s", async (status) => {
        const { gateway, server, emit, prisma } = makeGateway({ clientId, driverId, status, clientLocatedAt: null });

        await gateway.clientLocation(makeSocket(clientId, "CLIENT"), {
          rideId,
          lat: 6.37,
          lng: 2.39,
          accuracy: 7.4,
          ts: Date.now(),
        });

        expect(server.to).toHaveBeenCalledWith(`user:${driverId}`);
        expect(server.to).not.toHaveBeenCalledWith(`ride:${rideId}`);
        expect(emit).toHaveBeenCalledWith(
          "client:location",
          expect.objectContaining({ lat: 6.37, lng: 2.39, accuracy: 7, at: expect.any(Number) })
        );
        expect(prisma.ride.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ clientLat: 6.37, clientLng: 2.39 }),
          })
        );
      });

      it.each([
        ["another user", "intruder", "MATCHED", 6.37, 2.39],
        ["the driver", driverId, "ARRIVED", 6.37, 2.39],
        ["a pending ride", clientId, "PENDING", 6.37, 2.39],
        ["a completed ride", clientId, "COMPLETED", 6.37, 2.39],
        ["a cancelled ride", clientId, "CANCELLED", 6.37, 2.39],
        ["invalid coordinates", clientId, "MATCHED", 91, 2.39],
      ])("does not relay client location for %s", async (_label, userId, status, lat, lng) => {
        const { gateway, server, prisma } = makeGateway({ clientId, driverId, status, clientLocatedAt: null });

        await gateway.clientLocation(makeSocket(userId as string), { rideId, lat: lat as number, lng: lng as number });

        expect(server.to).not.toHaveBeenCalled();
        expect(prisma.ride.updateMany).not.toHaveBeenCalled();
      });

      it("does not emit or retain client location during IN_PROGRESS", async () => {
        const { gateway, server, prisma } = makeGateway({
          clientId,
          driverId,
          status: "IN_PROGRESS",
          clientLocatedAt: null,
        });

        await gateway.clientLocation(makeSocket(clientId, "CLIENT"), { rideId, lat: 6.37, lng: 2.39 });

        expect(server.to).not.toHaveBeenCalled();
        expect(prisma.ride.updateMany).not.toHaveBeenCalled();
      });
    });

    describe("ride:join location snapshots", () => {
      const liveRide = {
        clientId,
        driverId,
        status: "IN_PROGRESS",
        driverLat: 6.37,
        driverLng: 2.39,
        driverHeading: 92,
        driverSpeed: 3.5,
        driverLocatedAt: new Date("2026-10-10T12:00:00.000Z"),
        clientLat: 6.4,
        clientLng: 2.42,
        clientLocatedAt: new Date("2026-10-10T12:00:00.000Z"),
      };

      it("returns the Zem's latest point only to the client", async () => {
        const { gateway } = makeGateway(liveRide);
        const socket = makeSocket(clientId, "CLIENT");

        const result = await gateway.join(socket, { rideId });

        expect(result).toMatchObject({
          joined: rideId,
          driverLocation: { lat: 6.37, lng: 2.39, heading: 92, speed: 3.5 },
        });
        expect(result).not.toHaveProperty("clientLocation");
        expect(socket.join).toHaveBeenCalledWith(`ride:${rideId}`);
        expect(socket.join).toHaveBeenCalledWith(`user:${clientId}`);
      });

      it("returns the client's latest point only to the Zem before the trip starts", async () => {
        const { gateway } = makeGateway({ ...liveRide, status: "ARRIVED" });

        const result = await gateway.join(makeSocket(driverId), { rideId });

        expect(result).toMatchObject({ joined: rideId, clientLocation: { lat: 6.4, lng: 2.42 } });
        expect(result).not.toHaveProperty("driverLocation");
      });

      it("does not return either location for a completed ride", async () => {
        const { gateway } = makeGateway({ ...liveRide, status: "COMPLETED" });

        const result = await gateway.join(makeSocket(clientId, "CLIENT"), { rideId });

        expect(result).not.toHaveProperty("driverLocation");
        expect(result).not.toHaveProperty("clientLocation");
      });
    });

    it.each(["PENDING", "COMPLETED", "CANCELLED"])(
      "does not relay a location when the ride is %s",
      async (status) => {
        const { gateway, server } = makeGateway({ driverId, status });

        await gateway.location(makeSocket(driverId), { rideId, lat: 6.37, lng: 2.39 });

        expect(server.to).not.toHaveBeenCalled();
      }
    );

    it.each([
      { lat: Number.NaN, lng: 2.39 },
      { lat: 91, lng: 2.39 },
      { lat: 6.37, lng: -181 },
    ])("does not relay invalid coordinates: %p", async (coords) => {
      const { gateway, prisma, server } = makeGateway({ driverId, status: "IN_PROGRESS" });

      await gateway.location(makeSocket(driverId), { rideId, ...coords });

      expect(prisma.ride.findUnique).not.toHaveBeenCalled();
      expect(server.to).not.toHaveBeenCalled();
    });
  });

  describe("ride:chat", () => {
    it.each([
      [driverId, "CLIENT", "PROVIDER"],
      [clientId, "DRIVER", "CLIENT"],
    ])("derives participant role from the ride, not the token", async (userId, tokenRole, expectedRole) => {
      const { gateway, prisma, emit } = makeGateway({ clientId, driverId });
      const socket = makeSocket(userId as string, tokenRole as string);

      const message = await gateway.onChat(socket, {
        rideId,
        senderRole: expectedRole === "PROVIDER" ? "CLIENT" : "PROVIDER",
        text: "Je suis là",
      });

      expect(prisma.ride.findUnique).toHaveBeenCalledWith({
        where: { id: rideId },
        select: { clientId: true, driverId: true },
      });
      expect(message).toMatchObject({
        senderId: userId,
        senderRole: expectedRole,
        senderName: expectedRole === "PROVIDER" ? "Prestataire AZƆ̀" : "Client AZƆ̀",
      });
      expect(emit).toHaveBeenCalledWith("ride:chat", expect.objectContaining({ senderRole: expectedRole }));
    });

    it("does not allow a non-participant to send a chat message", async () => {
      const { gateway, server, emit } = makeGateway({ clientId, driverId });

      const message = await gateway.onChat(makeSocket("intruder"), { rideId, text: "Salut" });

      expect(message).toBeUndefined();
      expect(server.to).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it("does not allow an unauthenticated socket to send a chat message", async () => {
      const { gateway, prisma, server } = makeGateway({ clientId, driverId });

      const message = await gateway.onChat({ data: {} } as any, { rideId, text: "Salut" });

      expect(message).toBeUndefined();
      expect(prisma.ride.findUnique).not.toHaveBeenCalled();
      expect(server.to).not.toHaveBeenCalled();
    });
  });
});
