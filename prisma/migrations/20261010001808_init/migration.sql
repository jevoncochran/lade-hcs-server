-- CreateEnum
CREATE TYPE "CareLevel" AS ENUM ('AMBULATORY', 'WHEELCHAIR', 'BARIATRIC_WHEELCHAIR', 'STRETCHER');

-- CreateEnum
CREATE TYPE "TripType" AS ENUM ('MEDICAL_APPOINTMENT', 'HOSPITAL_DISCHARGE', 'DIALYSIS_RECURRING', 'PRIVATE');

-- CreateEnum
CREATE TYPE "TripKind" AS ENUM ('ONE_WAY', 'ROUND_TRIP', 'WAIT_AND_RETURN');

-- CreateEnum
CREATE TYPE "RequesterRelationship" AS ENUM ('SELF', 'FAMILY_CAREGIVER', 'FACILITY_STAFF', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING_PAYMENT', 'REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "LegDirection" AS ENUM ('OUTBOUND', 'RETURN');

-- CreateEnum
CREATE TYPE "LegStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CARD_PENDING', 'CARD_SAVED', 'CHARGED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELED');

-- CreateEnum
CREATE TYPE "ChargeType" AS ENUM ('BASE_FARE', 'MILEAGE', 'WAIT_TIME', 'NO_SHOW', 'LATE_CANCELLATION', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PriceChannel" AS ENUM ('PUBLIC', 'PARTNER');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'DISPATCHER');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('PUBLIC', 'STAFF', 'SYSTEM');

-- CreateTable
CREATE TABLE "Booking" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "idempotencyKey" TEXT NOT NULL,
    "careLevel" "CareLevel" NOT NULL,
    "tripType" "TripType" NOT NULL,
    "tripKind" "TripKind" NOT NULL,
    "companionCount" INTEGER NOT NULL DEFAULT 0,
    "requesterRelationship" "RequesterRelationship" NOT NULL,
    "requesterName" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL,
    "requesterPhone" TEXT NOT NULL,
    "requesterEmailHash" TEXT NOT NULL,
    "requesterPhoneHash" TEXT NOT NULL,
    "riderName" TEXT NOT NULL,
    "riderPhone" TEXT,
    "riderNameHash" TEXT NOT NULL,
    "mobilityNotes" TEXT,
    "instructions" TEXT,
    "pricingRuleId" UUID NOT NULL,
    "billableMeters" INTEGER NOT NULL,
    "quotedPriceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "priceBreakdown" JSONB NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMPTZ(6) NOT NULL,
    "manageTokenHash" TEXT,
    "manageTokenExpiresAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripLeg" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "direction" "LegDirection" NOT NULL,
    "status" "LegStatus" NOT NULL DEFAULT 'SCHEDULED',
    "pickupAt" TIMESTAMPTZ(6),
    "willCall" BOOLEAN NOT NULL DEFAULT false,
    "appointmentAt" TIMESTAMPTZ(6),
    "waitMinutes" INTEGER,
    "waitedMinutes" INTEGER,
    "pickupAddress" TEXT NOT NULL,
    "dropoffAddress" TEXT NOT NULL,
    "distanceMeters" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TripLeg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingCharge" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "legId" UUID,
    "type" "ChargeType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "quantity" DECIMAL(10,2),
    "createdById" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingEvent" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "fromStatus" "BookingStatus",
    "toStatus" "BookingStatus" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "staffUserId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "bookingId" UUID NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'CARD_PENDING',
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSetupIntentId" TEXT,
    "stripePaymentMethodId" TEXT,
    "stripePaymentIntentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" UUID NOT NULL,
    "channel" "PriceChannel" NOT NULL DEFAULT 'PUBLIC',
    "careLevel" "CareLevel" NOT NULL,
    "oneWayBaseCents" INTEGER NOT NULL,
    "roundTripBaseCents" INTEGER NOT NULL,
    "perMileCents" INTEGER NOT NULL,
    "waitGraceMinutes" INTEGER NOT NULL DEFAULT 15,
    "waitIncrementMinutes" INTEGER NOT NULL DEFAULT 15,
    "waitIncrementCents" INTEGER NOT NULL DEFAULT 1500,
    "noShowFeeCents" INTEGER NOT NULL,
    "lateCancelFeeCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffUser" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'DISPATCHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mfaSecret" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "lastLoginAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "StaffUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "staffUserId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffInvite" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL DEFAULT 'DISPATCHER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "invitedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "staffUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_idempotencyKey_key" ON "Booking"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_manageTokenHash_key" ON "Booking"("manageTokenHash");

-- CreateIndex
CREATE INDEX "Booking_status_idx" ON "Booking"("status");

-- CreateIndex
CREATE INDEX "Booking_requesterEmailHash_idx" ON "Booking"("requesterEmailHash");

-- CreateIndex
CREATE INDEX "Booking_requesterPhoneHash_idx" ON "Booking"("requesterPhoneHash");

-- CreateIndex
CREATE INDEX "Booking_riderNameHash_idx" ON "Booking"("riderNameHash");

-- CreateIndex
CREATE INDEX "TripLeg_pickupAt_idx" ON "TripLeg"("pickupAt");

-- CreateIndex
CREATE UNIQUE INDEX "TripLeg_bookingId_direction_key" ON "TripLeg"("bookingId", "direction");

-- CreateIndex
CREATE INDEX "BookingCharge_bookingId_idx" ON "BookingCharge"("bookingId");

-- CreateIndex
CREATE INDEX "BookingCharge_legId_idx" ON "BookingCharge"("legId");

-- CreateIndex
CREATE INDEX "BookingEvent_bookingId_createdAt_idx" ON "BookingEvent"("bookingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeSetupIntentId_key" ON "Payment"("stripeSetupIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- CreateIndex
CREATE INDEX "PricingRule_channel_careLevel_effectiveFrom_idx" ON "PricingRule"("channel", "careLevel", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "StaffUser_email_key" ON "StaffUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_staffUserId_idx" ON "RefreshToken"("staffUserId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "StaffInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "StaffInvite_email_idx" ON "StaffInvite"("email");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_staffUserId_createdAt_idx" ON "AuditLog"("staffUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_pricingRuleId_fkey" FOREIGN KEY ("pricingRuleId") REFERENCES "PricingRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripLeg" ADD CONSTRAINT "TripLeg_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCharge" ADD CONSTRAINT "BookingCharge_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCharge" ADD CONSTRAINT "BookingCharge_legId_fkey" FOREIGN KEY ("legId") REFERENCES "TripLeg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCharge" ADD CONSTRAINT "BookingCharge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingEvent" ADD CONSTRAINT "BookingEvent_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffInvite" ADD CONSTRAINT "StaffInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
