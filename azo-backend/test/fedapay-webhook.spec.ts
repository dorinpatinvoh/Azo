/**
 * Webhook FedaPay (POST /wallet/recharge/callback) : lecture de l'identifiant de la transaction dans l'événement
 * (entity.id, pas le id de l'événement), vérification de signature et événements ignorés.
 */
jest.mock("../src/wallet/wallet.service", () => ({ WalletService: class WalletService {}, MIN_RECHARGE: 300 }));
jest.mock("../src/common/guards/jwt-auth.guard", () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock("../src/common/guards/registration-complete.guard", () => ({
  RegistrationCompleteGuard: class RegistrationCompleteGuard {},
}));

import { UnauthorizedException } from "@nestjs/common";
import { Webhook } from "fedapay";
import { FedaPayCallbackController, fedaPayTransactionId } from "../src/wallet/wallet.controller";

const SECRET = "wh_sandbox_test_secret";

function makeController() {
  const wallet = { handleFedaPayCallback: jest.fn().mockResolvedValue({ credited: true, amount: 500, walletId: "w1" }) };
  return { controller: new FedaPayCallbackController(wallet as any), wallet };
}

const event = (name: string, transactionId: number) => ({
  id: 999999, // identifiant de l'ÉVÉNEMENT : ne doit jamais être pris pour la transaction
  object: "event",
  name,
  entity: { id: transactionId, status: "approved" },
});

function signed(body: object, secret = SECRET) {
  const payload = JSON.stringify(body);
  const header = Webhook.generateTestHeaderString({ payload, secret });
  return { req: { rawBody: Buffer.from(payload) }, header };
}

describe("fedaPayTransactionId", () => {
  it("lit entity.id d'un événement transaction.* (pas le id de l'événement)", () => {
    expect(fedaPayTransactionId(event("transaction.approved", 522847))).toBe(522847);
  });
  it("accepte l'appel manuel { id } sans nom d'événement", () => {
    expect(fedaPayTransactionId({ id: 522847 })).toBe(522847);
    expect(fedaPayTransactionId({ id: "522847" })).toBe(522847);
  });
  it("ignore les événements qui ne concernent pas une transaction et les corps invalides", () => {
    expect(fedaPayTransactionId(event("customer.created", 5))).toBeNull();
    expect(fedaPayTransactionId({ name: "transaction.approved" })).toBeNull();
    expect(fedaPayTransactionId({ id: "abc" })).toBeNull();
    expect(fedaPayTransactionId(undefined)).toBeNull();
  });
});

describe("POST /wallet/recharge/callback", () => {
  const OLD = process.env.FEDAPAY_WEBHOOK_SECRET;
  afterEach(() => {
    if (OLD === undefined) delete process.env.FEDAPAY_WEBHOOK_SECRET;
    else process.env.FEDAPAY_WEBHOOK_SECRET = OLD;
  });

  it("crédite la transaction de l'événement signé", async () => {
    process.env.FEDAPAY_WEBHOOK_SECRET = SECRET;
    const { controller, wallet } = makeController();
    const body = event("transaction.approved", 522847);
    const { req, header } = signed(body);
    await expect(controller.fedaPayCallback(req, header, body)).resolves.toMatchObject({ credited: true });
    expect(wallet.handleFedaPayCallback).toHaveBeenCalledWith(522847);
  });

  it("refuse un événement mal signé (401) sans rien créditer", async () => {
    process.env.FEDAPAY_WEBHOOK_SECRET = SECRET;
    const { controller, wallet } = makeController();
    const body = event("transaction.approved", 522847);
    const { req, header } = signed(body, "wh_autre_secret");
    await expect(controller.fedaPayCallback(req, header, body)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(wallet.handleFedaPayCallback).not.toHaveBeenCalled();
  });

  it("refuse un événement sans signature quand le secret est configuré", async () => {
    process.env.FEDAPAY_WEBHOOK_SECRET = SECRET;
    const { controller, wallet } = makeController();
    const body = event("transaction.approved", 522847);
    await expect(controller.fedaPayCallback({ rawBody: Buffer.from(JSON.stringify(body)) }, undefined, body)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(wallet.handleFedaPayCallback).not.toHaveBeenCalled();
  });

  it("sans secret configuré : traite l'événement (le statut est relu auprès de FedaPay)", async () => {
    delete process.env.FEDAPAY_WEBHOOK_SECRET;
    const { controller, wallet } = makeController();
    await controller.fedaPayCallback({}, undefined, event("transaction.approved", 11));
    expect(wallet.handleFedaPayCallback).toHaveBeenCalledWith(11);
  });

  it("répond 200 et ignore un événement hors transaction", async () => {
    delete process.env.FEDAPAY_WEBHOOK_SECRET;
    const { controller, wallet } = makeController();
    await expect(controller.fedaPayCallback({}, undefined, event("customer.created", 5))).resolves.toEqual({
      credited: false,
      reason: "ignored_event",
    });
    expect(wallet.handleFedaPayCallback).not.toHaveBeenCalled();
  });

  it("absorbe une erreur interne : FedaPay reçoit 200 et réémettra l'événement", async () => {
    delete process.env.FEDAPAY_WEBHOOK_SECRET;
    const { controller, wallet } = makeController();
    wallet.handleFedaPayCallback.mockRejectedValue(new Error("FedaPay injoignable"));
    await expect(controller.fedaPayCallback({}, undefined, event("transaction.approved", 3))).resolves.toEqual({
      credited: false,
      reason: "error",
    });
  });
});

describe("GET /wallet/recharge/return", () => {
  it("renvoie une page HTML de fin de paiement (sans rien créditer)", () => {
    const { controller, wallet } = makeController();
    const page = controller.paymentReturn();
    expect(page).toContain("<html");
    expect(page).toContain("Paiement terminé");
    expect(wallet.handleFedaPayCallback).not.toHaveBeenCalled();
  });
});
