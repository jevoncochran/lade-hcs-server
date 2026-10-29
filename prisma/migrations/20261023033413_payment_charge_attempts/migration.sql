-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'CHARGE_PENDING';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "chargeAttempts" INTEGER NOT NULL DEFAULT 0;
