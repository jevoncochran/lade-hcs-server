import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { StaffRole } from '../generated/prisma/client.js';
import type { StaffRequest } from './staff-auth.guard.js';

// Administrators only. Use after StaffAuthGuard, which loads the staff
// member (with their current role) on every request:
//   @UseGuards(StaffAuthGuard, AdminGuard)
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const staff = context.switchToHttp().getRequest<StaffRequest>().staff;
    if (staff?.role !== StaffRole.ADMIN) {
      throw new ForbiddenException('Only administrators can do this.');
    }
    return true;
  }
}
