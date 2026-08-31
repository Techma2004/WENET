-- Onboarding + privacy toggles on User; device/session metadata on Device.
-- All additive and either nullable or defaulted, so this is safe to run
-- against a database that already has rows.

ALTER TABLE "User" ADD COLUMN "onboardedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "showLastSeen" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "showOnlineStatus" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "readReceiptsEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Device" ADD COLUMN "label" TEXT;
ALTER TABLE "Device" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "Device" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
