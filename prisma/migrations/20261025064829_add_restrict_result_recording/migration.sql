-- Restrict result recording to assignee / leads / admins (optional, default off)

ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "restrict_result_recording" BOOLEAN NOT NULL DEFAULT false;
