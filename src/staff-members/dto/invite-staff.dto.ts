import { Transform } from 'class-transformer';
import { IsEmail, IsEnum } from 'class-validator';
import { trim } from '../../common/transforms.js';
import { StaffRole } from '../../generated/prisma/client.js';

// POST /staff/invites
export class InviteStaffDto {
  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  email: string;

  @IsEnum(StaffRole, { message: 'Choose a role' })
  role: StaffRole;
}
