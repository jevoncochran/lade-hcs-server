import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  PaymentGateway,
  type CardSetup,
  type CardSetupResult,
  type ChargeResult,
} from '../payment-gateway.js';

// Tests use this saved card to simulate a declined charge.
export const FAKE_DECLINED_CARD = 'fake_pm_declined';

const id = (prefix: string) =>
  `${prefix}_${randomBytes(12).toString('base64url')}`;

// DEVELOPMENT STAND-IN for Stripe. Returns made-up ids so booking can be built
// and tested without Stripe. No card is ever saved or charged; every card
// setup reports "saved" and every charge succeeds (except on
// FAKE_DECLINED_CARD). Config validation refuses it in production.
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

  async chargeSavedCard(input: {
    paymentMethodId: string;
  }): Promise<ChargeResult> {
    if (input.paymentMethodId === FAKE_DECLINED_CARD) {
      return {
        status: 'failed',
        code: 'card_declined',
        paymentIntentId: id('fake_pi'),
      };
    }
    return { status: 'charged', paymentIntentId: id('fake_pi') };
  }

  async releaseCard() {}
}
