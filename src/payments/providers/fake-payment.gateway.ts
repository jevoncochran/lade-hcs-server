import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  PaymentGateway,
  type CardSetup,
  type CardSetupResult,
} from '../payment-gateway.js';

const id = (prefix: string) =>
  `${prefix}_${randomBytes(12).toString('base64url')}`;

// DEVELOPMENT STAND-IN for Stripe. Returns made-up ids so booking can be built
// and tested without Stripe. No card is ever saved or charged; every card
// setup reports "saved". Config validation refuses it in production.
@Injectable()
export class FakePaymentGateway extends PaymentGateway {
  readonly provider = 'fake' as const;

  async createCustomer() {
    return { id: id('fake_cus') };
  }

  ownsCustomerId(id: string) {
    return id.startsWith('fake_cus_');
  }

  async createCardSetup(): Promise<CardSetup> {
    return this.retrieveCardSetup(id('fake_seti'));
  }

  async retrieveCardSetup(setupId: string): Promise<CardSetup> {
    return { id: setupId, clientSecret: `${setupId}_secret_fake` };
  }

  async checkCardSetup(): Promise<CardSetupResult> {
    return { status: 'saved', paymentMethodId: 'fake_pm_test_card' };
  }
}
