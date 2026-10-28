import { IsEnum } from 'class-validator';
import { StaffRole } from '../../generated/prisma/client.js';

// POST /staff/members/:id/role
export class ChangeRoleDto {
  @IsEnum(StaffRole, { message: 'Choose a role' })
  role: StaffRole;
}
