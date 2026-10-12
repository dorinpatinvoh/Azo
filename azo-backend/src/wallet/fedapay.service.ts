import { Injectable } from '@nestjs/common';
const FedaPay = require('fedapay');

@Injectable()
export class FedaPayService {
  constructor() {
    FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);
    FedaPay.setEnvironment(process.env.FEDAPAY_ENV || 'sandbox');
  }
  async createTransaction(amount: number, email: string, description: string) {
    const transaction = await FedaPay.Transaction.create({
      description,
      amount,
      currency: { iso: 'XOF' },
      callback_url: process.env.FEDAPAY_CALLBACK_URL,
      customer: { email }
    });
    const token = await FedaPay.Transaction.generateToken(transaction);
    return { transaction, token };
  }
  async verifyTransaction(id: number) {
    return await FedaPay.Transaction.retrieve(id);
  }
}