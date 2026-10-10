import { Module } from '@nestjs/common';
import { DistanceProvider } from './distance-provider.js';
import { MileageService } from './mileage.service.js';
import { EstimatedDistanceProvider } from './providers/estimated-distance.provider.js';

@Module({
  providers: [
    // MILEAGE_PROVIDER only allows "estimate" until the AWS Location Service
    // provider is added; then this becomes a factory that picks by config.
    { provide: DistanceProvider, useClass: EstimatedDistanceProvider },
    MileageService,
  ],
  exports: [MileageService],
})
export class MileageModule {}
