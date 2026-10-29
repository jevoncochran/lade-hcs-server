-- AlterTable
ALTER TABLE "StaffInvite" ADD COLUMN     "mfaLastTimeStep" INTEGER,
ADD COLUMN     "mfaVerifiedAt" TIMESTAMPTZ(6);
