-- AlterTable
ALTER TABLE "StaffInvite" ADD COLUMN     "resetForId" UUID;

-- CreateIndex
CREATE INDEX "StaffInvite_resetForId_idx" ON "StaffInvite"("resetForId");

-- AddForeignKey
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_resetForId_fkey" FOREIGN KEY ("resetForId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
