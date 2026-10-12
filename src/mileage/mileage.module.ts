import { Module } from '@nestjs/common';
import { AWS_LOCATION, LocationModule } from '../location/location.module.js';
import type { AwsLocation } from '../location/aws-location.js';
import { DistanceProvider } from './distance-provider.js';
import { MileageService } from './mileage.service.js';
import { AwsDistanceProvider } from './providers/aws-distance.provider.js';
import { EstimatedDistanceProvider } from './providers/estimated-distance.provider.js';

@Module({
  imports: [LocationModule],
  providers: [
    {
      // Real distances when AWS Location is configured (MILEAGE_PROVIDER=aws),
      // otherwise the ZIP-code estimate.
      provide: DistanceProvider,
      inject: [AWS_LOCATION],
      useFactory: (aws: AwsLocation | null): DistanceProvider =>
        aws ? new AwsDistanceProvider(aws) : new EstimatedDistanceProvider(),
    },
    MileageService,
  ],
  exports: [MileageService],
})
export class MileageModule {}
