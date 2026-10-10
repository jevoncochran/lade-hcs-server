import { SetMetadata } from '@nestjs/common';

export const SKIP_ORIGIN_CHECK = 'skipOriginCheck';

// For endpoints called server-to-server rather than by the website, such as
// Stripe webhooks (which verify their own signature instead). See OriginGuard.
export const SkipOriginCheck = () => SetMetadata(SKIP_ORIGIN_CHECK, true);
