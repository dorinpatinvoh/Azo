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
    },
  };
  const gateway = new RidesGateway({} as any, prisma as any);
  (gateway as any).server = server;

  return { gateway, prisma, server, emit };
}

function makeSocket(userId: string, role = "DRIVER") {
  return {
    data: { user: { userId, role } },
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
