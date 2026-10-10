import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { CareLevel } from '../generated/prisma/client.js';
import { normalizeAddress } from '../mileage/address.js';
import { MileageService } from '../mileage/mileage.service.js';
import {
  formatCents,
  type CallForQuoteReason,
  type PriceLine,
} from '../pricing/pricing.js';
import { PricingService } from '../pricing/pricing.service.js';
import type { CreateQuoteDto } from './dto/create-quote.dto.js';

const HOUR_MS = 60 * 60 * 1000;

export type QuoteReason = CallForQuoteReason | 'SHORT_NOTICE';

export type QuoteResponse =
  | {
      status: 'priced';
      currency: 'usd';
      lines: PriceLine[];
      totalCents: number;
      billableMiles: number;
      // Things the customer should know before booking (e.g. waiting charges).
      notes: string[];
    }
  | { status: 'call_for_quote'; reason: QuoteReason; message: string };

const CARE_LEVEL_LABEL: Record<CareLevel, string> = {
  AMBULATORY: 'ambulatory',
  WHEELCHAIR: 'wheelchair',
  BARIATRIC_WHEELCHAIR: 'bariatric wheelchair',
  STRETCHER: 'stretcher',
};

// Prices a trip for the booking form. Nothing is stored: the booking step
// recalculates the price itself, so a quote can't be tampered with.
@Injectable()
export class QuotesService {
  constructor(
    private readonly mileage: MileageService,
    private readonly pricing: PricingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async quote(dto: CreateQuoteDto, now = new Date()): Promise<QuoteResponse> {
    if (normalizeAddress(dto.pickup) === normalizeAddress(dto.dropoff)) {
      throw new BadRequestException(
        'The pickup and drop-off addresses are the same.',
      );
    }

    // Checked first: no point looking up the route for a ride we can't take
    // online. Also covers pickup times in the past.
    const minNoticeHours = this.config.get('MIN_NOTICE_HOURS', { infer: true });
    if (
      new Date(dto.pickupAt).getTime() <
      now.getTime() + minNoticeHours * HOUR_MS
    ) {
      return this.callForQuote('SHORT_NOTICE', dto.careLevel);
    }

    const legs = await this.mileage.measureTrip(
      dto.tripKind,
      dto.pickup,
      dto.dropoff,
    );
    const { quote, rule } = await this.pricing.quote(
      dto.careLevel,
      { tripKind: dto.tripKind, legs },
      now,
    );

    if (quote.kind === 'call_for_quote' || !rule) {
      return this.callForQuote(
        quote.kind === 'call_for_quote' ? quote.reason : 'NO_RATE',
        dto.careLevel,
      );
    }

    return {
      status: 'priced',
      currency: 'usd',
      lines: quote.lines,
      totalCents: quote.totalCents,
      billableMiles: quote.billableMiles,
      notes: [
        `Waiting time over ${rule.waitGraceMinutes} minutes is ${formatCents(rule.waitIncrementCents)} ` +
          `for each ${rule.waitIncrementMinutes} minutes, charged after the ride.`,
      ],
    };
  }

  private callForQuote(
    reason: QuoteReason,
    careLevel: CareLevel,
  ): QuoteResponse {
    const messages: Record<QuoteReason, string> = {
      SHORT_NOTICE: `Online bookings need at least ${this.config.get('MIN_NOTICE_HOURS', { infer: true })} hours' notice. For a sooner ride, please call us.`,
      LONG_DISTANCE: `Trips over ${this.config.get('LONG_DISTANCE_MAX_MILES', { infer: true })} miles each way need a custom quote. Please call us.`,
      OUT_OF_STATE:
        'Trips outside Florida need a custom quote. Please call us.',
      NO_RATE: `Online prices for ${CARE_LEVEL_LABEL[careLevel]} transportation aren't available yet. Please call us for a quote.`,
    };
    return { status: 'call_for_quote', reason, message: messages[reason] };
  }
}
