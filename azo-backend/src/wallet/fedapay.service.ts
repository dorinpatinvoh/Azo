import { Injectable } from "@nestjs/common";
import { FedaPay, Transaction } from "fedapay";

@Injectable()
export class FedaPayService {
  constructor() {
    FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);
    FedaPay.setEnvironment(process.env.FEDAPAY_ENV || "sandbox");
  }

  async createTransaction(amount: number, email: string, description: string) {
    const transaction = await Transaction.create({
      description,
      amount,
      currency: { iso: "XOF" },
      callback_url: process.env.FEDAPAY_CALLBACK_URL,
      customer: { email },
    });
    const token = await transaction.generateToken();
    return { transaction, token };
  }

  async verifyTransaction(id: number) {
    return Transaction.retrieve(id);
  }
}