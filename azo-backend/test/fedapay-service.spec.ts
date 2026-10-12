import { FedaPay, Transaction } from "fedapay";
import { FedaPayService } from "../src/wallet/fedapay.service";

const originalSecretKey = process.env.FEDAPAY_SECRET_KEY;
const originalEnvironment = process.env.FEDAPAY_ENV;
const originalCallbackUrl = process.env.FEDAPAY_CALLBACK_URL;

describe("FedaPayService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    if (originalSecretKey === undefined) delete process.env.FEDAPAY_SECRET_KEY;
    else process.env.FEDAPAY_SECRET_KEY = originalSecretKey;
    if (originalEnvironment === undefined) delete process.env.FEDAPAY_ENV;
    else process.env.FEDAPAY_ENV = originalEnvironment;
    if (originalCallbackUrl === undefined) delete process.env.FEDAPAY_CALLBACK_URL;
    else process.env.FEDAPAY_CALLBACK_URL = originalCallbackUrl;
  });

  it("configures the SDK and generates the checkout token from the created transaction", async () => {
    process.env.FEDAPAY_SECRET_KEY = "test-secret";
    process.env.FEDAPAY_ENV = "sandbox";
    process.env.FEDAPAY_CALLBACK_URL = "https://example.test/payment-callback";

    const transaction = new Transaction();
    transaction.generateToken = jest.fn().mockResolvedValue({ url: "https://checkout.test" });
    const create = jest.spyOn(Transaction, "create").mockResolvedValue(transaction);
    const setApiKey = jest.spyOn(FedaPay, "setApiKey");
    const setEnvironment = jest.spyOn(FedaPay, "setEnvironment");

    const service = new FedaPayService();
    const result = await service.createTransaction(1250, "customer@example.test", "Test payment");

    expect(setApiKey).toHaveBeenCalledWith("test-secret");
    expect(setEnvironment).toHaveBeenCalledWith("sandbox");
    expect(create).toHaveBeenCalledWith({
      description: "Test payment",
      amount: 1250,
      currency: { iso: "XOF" },
      callback_url: "https://example.test/payment-callback",
      customer: { email: "customer@example.test" },
    });
    expect(transaction.generateToken).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ transaction, token: { url: "https://checkout.test" } });
  });

  it("retrieves a transaction using the SDK's named Transaction export", async () => {
    const transaction = new Transaction(42);
    const retrieve = jest.spyOn(Transaction, "retrieve").mockResolvedValue(transaction);
    const service = new FedaPayService();

    await expect(service.verifyTransaction(42)).resolves.toBe(transaction);
    expect(retrieve).toHaveBeenCalledWith(42);
  });
});
