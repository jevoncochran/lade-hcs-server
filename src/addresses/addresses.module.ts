import { Module } from '@nestjs/common';
import { CustomerAuthModule } from '../customer-auth/customer-auth.module.js';
import type { AwsLocation } from '../location/aws-location.js';
import { AWS_LOCATION, LocationModule } from '../location/location.module.js';
import { AddressSearch } from './address-search.js';
import { AddressesController } from './addresses.controller.js';
import { AwsAddressSearch } from './providers/aws-address-search.js';
import { NoAddressSearch } from './providers/no-address-search.js';

@Module({
  imports: [LocationModule, CustomerAuthModule],
  controllers: [AddressesController],
  providers: [
    {
      provide: AddressSearch,
      inject: [AWS_LOCATION],
      useFactory: (aws: AwsLocation | null): AddressSearch =>
        aws ? new AwsAddressSearch(aws) : new NoAddressSearch(),
    },
  ],
})
export class AddressesModule {}
