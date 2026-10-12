/*
  Warnings:

  - You are about to drop the column `riderName` on the `Booking` table. All the data in the column will be lost.
  - You are about to drop the column `riderNameHash` on the `Booking` table. All the data in the column will be lost.
  - Added the required column `riderFirstName` to the `Booking` table without a default value. This is not possible if the table is not empty.
  - Added the required column `riderLastName` to the `Booking` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Booking_riderNameHash_idx";

-- AlterTable
ALTER TABLE "Booking" DROP COLUMN "riderName",
DROP COLUMN "riderNameHash",
ADD COLUMN     "riderFirstName" TEXT NOT NULL,
ADD COLUMN     "riderLastName" TEXT NOT NULL,
ADD COLUMN     "riderLastNameHash" TEXT;

-- CreateIndex
CREATE INDEX "Booking_riderLastNameHash_idx" ON "Booking"("riderLastNameHash");
