-- Organization / member access suspension (nullable = active, reversible)

ALTER TABLE "Organization"
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspended_by" INTEGER,
  ADD COLUMN IF NOT EXISTS "suspend_reason" TEXT;

ALTER TABLE "OrganizationMember"
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspended_by" INTEGER;
