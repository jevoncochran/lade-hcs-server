import {
  Catch,
  HttpStatus,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AddressNotFoundError,
  DistanceUnavailableError,
} from './distance-provider.js';

// Turns mileage problems into clear responses for the booking form:
//   - an address the map can't find → 422 saying which (pickup or dropoff),
//     so the form can point at it
//   - the map service unavailable → 503 asking to try again or call
// Addresses are never echoed back or logged (PHI).
//
// Use on any controller that measures trips: @UseFilters(AddressNotFoundFilter)
@Catch(AddressNotFoundError, DistanceUnavailableError)
export class AddressNotFoundFilter implements ExceptionFilter {
  catch(
    error: AddressNotFoundError | DistanceUnavailableError,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();

    if (error instanceof DistanceUnavailableError) {
      response.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'Service Unavailable',
        message: error.message,
      });
      return;
    }

    response.status(HttpStatus.UNPROCESSABLE_ENTITY).json({
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      error: 'Unprocessable Entity',
      message: error.message,
      field: error.which,
    });
  }
}
