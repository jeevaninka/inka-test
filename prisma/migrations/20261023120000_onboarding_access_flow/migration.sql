-- Email verification state for email + password accounts.
-- Existing accounts predate verification and are treated as already verified.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email_verification_token" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email_verification_expires" TIMESTAMP(3);
UPDATE "User" SET "email_verified" = true WHERE "email_verified" = false;

CREATE UNIQUE INDEX IF NOT EXISTS "User_email_verification_token_key"
  ON "User"("email_verification_token");

-- Only one PENDING access request is allowed per user + organization.
-- Keep the latest row when historical duplicates exist.
DELETE FROM "OrganizationJoinRequest" a
USING "OrganizationJoinRequest" b
WHERE a.status = 'PENDING'::"JoinRequestStatus"
  AND b.status = 'PENDING'::"JoinRequestStatus"
  AND a.user_id = b.user_id
  AND a.organization_id = b.organization_id
  AND (
    a.created_at < b.created_at
    OR (a.created_at = b.created_at AND a.id < b.id)
  );

ALTER TABLE "OrganizationJoinRequest" ADD COLUMN IF NOT EXISTS "pending_key" TEXT;

UPDATE "OrganizationJoinRequest"
SET "pending_key" = "user_id"::text || ':' || "organization_id"
WHERE status = 'PENDING'::"JoinRequestStatus";

UPDATE "OrganizationJoinRequest"
SET "pending_key" = NULL
WHERE status <> 'PENDING'::"JoinRequestStatus";

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationJoinRequest_pending_key_key"
  ON "OrganizationJoinRequest"("pending_key");

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationJoinRequest_user_org_pending_key"
  ON "OrganizationJoinRequest"("user_id", "organization_id")
  WHERE status = 'PENDING'::"JoinRequestStatus";

-- The requester-side "approved your workspace request" notification is retired.
DELETE FROM "Notification" WHERE type = 'JOIN_APPROVED';
