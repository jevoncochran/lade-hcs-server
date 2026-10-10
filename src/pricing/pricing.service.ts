import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import {
  CareLevel,
  PriceChannel,
  type PricingRule,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { quoteTrip, type QuoteInput } from './pricing.js';

// Lade only operates in Florida; trips elsewhere need a custom quote.
export const SERVICE_STATE = 'FL';

@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // The rule in effect at `at` for a care level: the newest one that has
  // started and not yet ended. Null when Lade hasn't set a rate (callers then
  // get "call for a quote").
  findActiveRule(
    careLevel: CareLevel,
    at = new Date(),
    channel: PriceChannel = PriceChannel.PUBLIC,
  ): Promise<PricingRule | null> {
    return this.prisma.pricingRule.findFirst({
      where: {
        channel,
        careLevel,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  // Quote with today's rates. Returns the rule too, so a booking can store
  // which rates its price came from.
  async quote(careLevel: CareLevel, input: QuoteInput, at = new Date()) {
    const rule = await this.findActiveRule(careLevel, at);
    const quote = quoteTrip(input, rule, {
      longDistanceMaxMiles: this.config.get('LONG_DISTANCE_MAX_MILES', {
        infer: true,
      }),
      serviceState: SERVICE_STATE,
    });
    return { quote, rule };
  }
}
