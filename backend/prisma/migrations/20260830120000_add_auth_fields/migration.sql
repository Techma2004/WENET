-- Add email + verification + password-reset fields to User.
--
-- Added nullable first, then backfilled, then made NOT NULL — this keeps
-- the migration safe to run even if the User table already has rows
-- (which a straight `email TEXT NOT NULL UNIQUE` would break on, since
-- every existing row would violate the new NOT NULL constraint at once).
-- If this database has zero users so far, the backfill step is a no-op.

-- AlterTable: add columns, nullable for now
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "emailVerifyToken" TEXT;
ALTER TABLE "User" ADD COLUMN "emailVerifyExpires" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "passwordResetToken" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetExpires" TIMESTAMP(3);

-- Backfill: any pre-existing accounts get a placeholder, unique-per-row
-- email so the NOT NULL + UNIQUE constraint below can be applied. These
-- users won't be able to receive verification/reset email until they set
-- a real address from account settings — flag this to them in the product
-- if this migration ever runs against a database with real users in it.
UPDATE "User" SET "email" = "username" || '+' || "id" || '@unverified.wenet.local' WHERE "email" IS NULL;

-- Now that every row has a value, enforce NOT NULL + uniqueness for real.
ALTER TABLE "User" ALTER COLUMN "email" SET NOT NULL;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_emailVerifyToken_key" ON "User"("emailVerifyToken");
CREATE UNIQUE INDEX "User_passwordResetToken_key" ON "User"("passwordResetToken");
