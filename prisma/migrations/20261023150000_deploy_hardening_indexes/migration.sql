-- Deploy hardening: foreign-key and list-query indexes.
--
-- Postgres does NOT create an index for a foreign key automatically, so every
-- relation column used in a WHERE / ORDER BY / JOIN needs one explicitly.
-- All statements are idempotent so this migration can be re-run against a
-- database where an equivalent index already exists.

-- ApiKey
CREATE INDEX IF NOT EXISTS "ApiKey_workspace_id_created_at_idx" ON "ApiKey"("workspace_id", "created_at");
CREATE INDEX IF NOT EXISTS "ApiKey_created_by_idx" ON "ApiKey"("created_by");

-- TestRun (list pages filter project_id + deleted_at and sort by created_at)
CREATE INDEX IF NOT EXISTS "TestRun_project_id_deleted_at_created_at_idx" ON "TestRun"("project_id", "deleted_at", "created_at");
CREATE INDEX IF NOT EXISTS "TestRun_suite_id_idx" ON "TestRun"("suite_id");
CREATE INDEX IF NOT EXISTS "TestRun_created_by_idx" ON "TestRun"("created_by");

-- RunResult
CREATE INDEX IF NOT EXISTS "RunResult_test_version_id_idx" ON "RunResult"("test_version_id");
CREATE INDEX IF NOT EXISTS "RunResult_assigned_to_idx" ON "RunResult"("assigned_to");

-- RunResultStep
CREATE INDEX IF NOT EXISTS "RunResultStep_test_case_step_id_idx" ON "RunResultStep"("test_case_step_id");

-- Comment
CREATE INDEX IF NOT EXISTS "Comment_author_id_idx" ON "Comment"("author_id");
CREATE INDEX IF NOT EXISTS "Comment_parent_id_idx" ON "Comment"("parent_id");
CREATE INDEX IF NOT EXISTS "Comment_resolved_by_id_idx" ON "Comment"("resolved_by_id");

-- Attachment
CREATE INDEX IF NOT EXISTS "Attachment_project_id_created_at_idx" ON "Attachment"("project_id", "created_at");
CREATE INDEX IF NOT EXISTS "Attachment_workspace_id_idx" ON "Attachment"("workspace_id");
CREATE INDEX IF NOT EXISTS "Attachment_uploaded_by_idx" ON "Attachment"("uploaded_by");

-- ActivityLog / AuditLog
CREATE INDEX IF NOT EXISTS "ActivityLog_user_id_created_at_idx" ON "ActivityLog"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "AuditLog_user_id_idx" ON "AuditLog"("user_id");

-- Defect
CREATE INDEX IF NOT EXISTS "Defect_raised_by_idx" ON "Defect"("raised_by");

-- WebhookDelivery
CREATE INDEX IF NOT EXISTS "WebhookDelivery_webhook_id_created_at_idx" ON "WebhookDelivery"("webhook_id", "created_at");
CREATE INDEX IF NOT EXISTS "WebhookDelivery_created_at_idx" ON "WebhookDelivery"("created_at");

-- SuiteCase / TestSuite
CREATE INDEX IF NOT EXISTS "SuiteCase_assignee_id_idx" ON "SuiteCase"("assignee_id");
CREATE INDEX IF NOT EXISTS "TestSuite_created_by_idx" ON "TestSuite"("created_by");
