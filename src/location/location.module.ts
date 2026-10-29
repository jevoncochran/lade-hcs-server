import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation.js';
import { AwsLocation } from './aws-location.js';

// Provides AwsLocation when MILEAGE_PROVIDER is "aws", otherwise null (the
// estimate stand-in needs no outside service).
export const AWS_LOCATION = Symbol('AWS_LOCATION');

@Module({
  providers: [
    {
      provide: AWS_LOCATION,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        config.get('MILEAGE_PROVIDER', { infer: true }) === 'aws'
          ? AwsLocation.withApiKey(
              config.get('AWS_LOCATION_API_KEY', { infer: true })!,
              config.get('AWS_REGION', { infer: true }),
            )
          : null,
    },
  ],
  exports: [AWS_LOCATION],
})
export class LocationModule {}
