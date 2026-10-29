-- AlterTable
ALTER TABLE "Booking" ALTER COLUMN "requesterEmailHash" DROP NOT NULL,
ALTER COLUMN "requesterPhoneHash" DROP NOT NULL,
ALTER COLUMN "riderNameHash" DROP NOT NULL;
