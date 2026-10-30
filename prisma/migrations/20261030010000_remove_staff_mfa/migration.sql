-- Staff sign in with email and password only: the authenticator codes are
-- removed, along with the stored secrets.

-- AlterTable
ALTER TABLE "StaffInvite" DROP COLUMN "mfaLastTimeStep",
DROP COLUMN "mfaSecret",
DROP COLUMN "mfaVerifiedAt";

-- AlterTable
ALTER TABLE "StaffUser" DROP COLUMN "mfaLastTimeStep",
DROP COLUMN "mfaSecret";
