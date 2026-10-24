-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'GUEST');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('ADMIN', 'TESTER', 'VIEWER');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('P0', 'P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "CaseType" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "CaseStatus" AS ENUM ('ACTIVE', 'DRAFT', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "SuiteType" AS ENUM ('SMOKE', 'REGRESSION', 'SPRINT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED', 'ABORTED');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('PENDING', 'PASS', 'FAIL', 'BLOCKED', 'SKIP', 'INVALID');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VariableScope" AS ENUM ('GLOBAL', 'LOCAL');

-- CreateEnum
CREATE TYPE "SuggestionType" AS ENUM ('SELF_HEAL', 'NEW_TEST_CASE', 'DEDUP_DEFECT');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ReleaseDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'DROPDOWN', 'MULTI_SELECT', 'BOOLEAN', 'NUMBER', 'URL');

-- CreateEnum
CREATE TYPE "CustomFieldEntityType" AS ENUM ('TEST_CASE', 'TEST_RUN', 'RELEASE', 'DEFECT');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "display_name" TEXT,
    "image" TEXT,
    "password_hash" TEXT,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "avatar_color" TEXT,
    "avatar_initials" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "allowed_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "domain_join_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "organization_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("organization_id","user_id")
);

-- CreateTable
CREATE TABLE "OrganizationJoinRequest" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "message" TEXT,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "workspace_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMP(3),

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("workspace_id","user_id")
);

-- CreateTable
CREATE TABLE "WorkspaceJoinRequest" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "message" TEXT,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "token" TEXT NOT NULL,
    "invited_by" INTEGER NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "project_assignments" JSONB DEFAULT '[]',
    "accepted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationInvitation" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "token" TEXT NOT NULL,
    "invited_by" INTEGER NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "project_assignments" JSONB DEFAULT '[]',
    "accepted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationInvitationWorkspaceGrant" (
    "id" TEXT NOT NULL,
    "invitation_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationInvitationWorkspaceGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[],
    "created_by" INTEGER NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'PRJ',
    "case_counter" INTEGER NOT NULL DEFAULT 0,
    "default_pm_space_id" TEXT,
    "default_pm_space_key" TEXT,
    "default_pm_space_name" TEXT,
    "ai_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_run_complete_enabled" BOOLEAN NOT NULL DEFAULT true,
    "review_required" BOOLEAN NOT NULL DEFAULT false,
    "api_secret" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "project_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" "ProjectRole" NOT NULL,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("project_id","user_id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" TEXT,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parameters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rows" JSONB NOT NULL DEFAULT '[]',
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "display_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "module_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "pre_conditions" TEXT,
    "post_conditions" TEXT,
    "steps" JSONB NOT NULL,
    "expected_result" TEXT,
    "priority" "Priority" NOT NULL,
    "type" "CaseType" NOT NULL,
    "status" "CaseStatus" NOT NULL,
    "tags" TEXT[],
    "labels" TEXT[],
    "scenario_type" TEXT,
    "custom_fields" JSONB DEFAULT '{}',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "needs_update" BOOLEAN NOT NULL DEFAULT false,
    "confidence_score" DOUBLE PRECISION,
    "flaky" BOOLEAN NOT NULL DEFAULT false,
    "flaky_score" DOUBLE PRECISION,
    "review_status" "ReviewStatus",
    "external_ref" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" INTEGER,
    "deleted_at" TIMESTAMP(3),
    "dataset_id" TEXT,
    "local_dataset" JSONB,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReusableStep" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "expected_result" TEXT,
    "data" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "project_id" TEXT NOT NULL,
    "module_id" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReusableStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseStep" (
    "id" TEXT NOT NULL,
    "test_case_id" TEXT NOT NULL,
    "reusable_step_id" TEXT,
    "reusable_step_item_id" TEXT,
    "order" INTEGER NOT NULL,
    "step" TEXT NOT NULL,
    "expected_result" TEXT,
    "data" TEXT,
    "image_url" TEXT,
    "is_outdated" BOOLEAN NOT NULL DEFAULT false,
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCaseStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseVersion" (
    "id" TEXT NOT NULL,
    "test_case_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "pre_conditions" TEXT,
    "description" TEXT,
    "snapshot_by" INTEGER NOT NULL,
    "snapshot_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCaseVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSuite" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tags" TEXT[],
    "environment" TEXT,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "TestSuite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuiteCase" (
    "suite_id" TEXT NOT NULL,
    "test_case_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "assignee_id" INTEGER,

    CONSTRAINT "SuiteCase_pkey" PRIMARY KEY ("suite_id","test_case_id")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "suite_id" TEXT,
    "release_id" TEXT,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "build_version" TEXT,
    "assigned_to" INTEGER,
    "status" "RunStatus" NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "trigger_ref" TEXT,
    "concurrent_run" BOOLEAN NOT NULL DEFAULT false,
    "timebox_mins" INTEGER,
    "run_context" JSONB,
    "custom_fields" JSONB DEFAULT '{}',
    "resolved_variables" JSONB,
    "resolved_datasets" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunResult" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "test_case_id" TEXT NOT NULL,
    "test_version_id" TEXT,
    "order_index" INTEGER NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "status" "ResultStatus" NOT NULL,
    "notes" TEXT,
    "evidence_url" TEXT,
    "time_spent_seconds" INTEGER,
    "executed_by" INTEGER,
    "executed_at" TIMESTAMP(3),
    "step_results" JSONB,
    "iteration_results" JSONB,
    "failure_reason" TEXT,
    "assigned_to" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "automation_log" TEXT,

    CONSTRAINT "RunResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunResultStep" (
    "id" TEXT NOT NULL,
    "run_result_id" TEXT NOT NULL,
    "test_case_step_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" "ResultStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,

    CONSTRAINT "RunResultStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Environment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "base_url" TEXT,
    "color" TEXT DEFAULT 'blue',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "project_id" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Environment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variable" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "scope" "VariableScope" NOT NULL,
    "project_id" TEXT NOT NULL,
    "test_case_id" TEXT,
    "default_value" TEXT,
    "description" TEXT,
    "is_secret" BOOLEAN NOT NULL DEFAULT false,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Variable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VariableValue" (
    "id" TEXT NOT NULL,
    "variable_id" TEXT NOT NULL,
    "environment_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VariableValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploratorySession" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "charter" TEXT,
    "raw_notes" TEXT NOT NULL,
    "ai_summary" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "tester_id" INTEGER NOT NULL,

    CONSTRAINT "ExploratorySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSuggestion" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "test_case_id" TEXT,
    "run_result_id" TEXT,
    "suggestion_type" "SuggestionType" NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "input_chars" INTEGER NOT NULL,
    "output_chars" INTEGER,
    "duration_ms" INTEGER,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "accepted" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "body" TEXT NOT NULL,
    "mentioned_user_ids" INTEGER[],
    "author_id" INTEGER NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" INTEGER,
    "assigned_to_id" INTEGER,
    "deleted_at" TIMESTAMP(3),
    "attachment_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL,
    "test_case_id" TEXT NOT NULL,
    "requested_by" INTEGER NOT NULL,
    "assigned_to" INTEGER,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "version_number_at_request" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action_url" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserNotificationPrefs" (
    "user_id" INTEGER NOT NULL,
    "email_mentions" BOOLEAN NOT NULL DEFAULT true,
    "email_review_requests" BOOLEAN NOT NULL DEFAULT true,
    "email_run_complete" BOOLEAN NOT NULL DEFAULT true,
    "digest_frequency" TEXT NOT NULL DEFAULT 'instant',

    CONSTRAINT "UserNotificationPrefs_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "Defect" (
    "id" TEXT NOT NULL,
    "run_result_id" TEXT NOT NULL,
    "test_case_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "Severity" NOT NULL,
    "local_status" TEXT NOT NULL DEFAULT 'OPEN',
    "ticket_url" TEXT,
    "external_ticket_id" TEXT,
    "ticket_status" TEXT,
    "raised_by" INTEGER NOT NULL,
    "raised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),

    CONSTRAINT "Defect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "test_case_step_id" TEXT,
    "filename" TEXT NOT NULL,
    "original_filename" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "storage_type" TEXT NOT NULL DEFAULT 'S3',
    "storage_key" TEXT,
    "external_url" TEXT,
    "preview_url" TEXT,
    "title" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "uploaded_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" INTEGER,
    "actor_type" TEXT NOT NULL DEFAULT 'user',
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "user_id" INTEGER,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "project_id" TEXT,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "project_id" TEXT,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_delivery_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "response_status" INTEGER,
    "response_body" TEXT,
    "delivered_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" INTEGER,
    "name" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSettings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT,
    "project_id" TEXT,
    "slack_webhook_url" TEXT,
    "slack_channel_tier" TEXT NOT NULL DEFAULT 'essential',
    "slack_dm_tier" TEXT NOT NULL DEFAULT 'essential',
    "in_app_tier" TEXT NOT NULL DEFAULT 'all',
    "email_tier" TEXT NOT NULL DEFAULT 'essential',
    "cross_post_to_workspace" BOOLEAN NOT NULL DEFAULT false,
    "custom_events_matrix" JSONB,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "due_date" TIMESTAMP(3),
    "external_ref" TEXT,
    "custom_fields" JSONB DEFAULT '{}',
    "decision" "ReleaseDecision",
    "decision_by_id" INTEGER,
    "decision_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseTicket" (
    "id" TEXT NOT NULL,
    "release_id" TEXT NOT NULL,
    "ticket_key" TEXT NOT NULL,
    "title" TEXT,
    "ticket_status" TEXT,
    "ticket_url" TEXT,
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldDefinition" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "entity_type" "CustomFieldEntityType" NOT NULL DEFAULT 'TEST_CASE',
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "description" TEXT,
    "options" JSONB,
    "default_val" JSONB,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OrganizationMember_user_id_idx" ON "OrganizationMember"("user_id");

-- CreateIndex
CREATE INDEX "OrganizationJoinRequest_organization_id_status_idx" ON "OrganizationJoinRequest"("organization_id", "status");

-- CreateIndex
CREATE INDEX "OrganizationJoinRequest_user_id_idx" ON "OrganizationJoinRequest"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Workspace_organization_id_idx" ON "Workspace"("organization_id");

-- CreateIndex
CREATE INDEX "WorkspaceMember_user_id_idx" ON "WorkspaceMember"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationInvitation_token_key" ON "OrganizationInvitation"("token");

-- CreateIndex
CREATE INDEX "OrganizationInvitation_organization_id_status_idx" ON "OrganizationInvitation"("organization_id", "status");

-- CreateIndex
CREATE INDEX "OrganizationInvitation_email_idx" ON "OrganizationInvitation"("email");

-- CreateIndex
CREATE INDEX "OrganizationInvitationWorkspaceGrant_workspace_id_idx" ON "OrganizationInvitationWorkspaceGrant"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationInvitationWorkspaceGrant_invitation_id_workspac_key" ON "OrganizationInvitationWorkspaceGrant"("invitation_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_key_hash_key" ON "ApiKey"("key_hash");

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspace_id_slug_key" ON "Project"("workspace_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspace_id_key_key" ON "Project"("workspace_id", "key");

-- CreateIndex
CREATE INDEX "ProjectMember_user_id_idx" ON "ProjectMember"("user_id");

-- CreateIndex
CREATE INDEX "Module_project_id_parent_id_idx" ON "Module"("project_id", "parent_id");

-- CreateIndex
CREATE INDEX "TestCase_project_id_status_idx" ON "TestCase"("project_id", "status");

-- CreateIndex
CREATE INDEX "TestCase_project_id_deleted_at_created_at_idx" ON "TestCase"("project_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "TestCase_project_id_module_id_idx" ON "TestCase"("project_id", "module_id");

-- CreateIndex
CREATE INDEX "TestCase_dataset_id_idx" ON "TestCase"("dataset_id");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_project_id_display_id_key" ON "TestCase"("project_id", "display_id");

-- CreateIndex
CREATE INDEX "ReusableStep_project_id_idx" ON "ReusableStep"("project_id");

-- CreateIndex
CREATE INDEX "ReusableStep_module_id_idx" ON "ReusableStep"("module_id");

-- CreateIndex
CREATE INDEX "TestCaseStep_test_case_id_idx" ON "TestCaseStep"("test_case_id");

-- CreateIndex
CREATE INDEX "TestCaseStep_reusable_step_id_idx" ON "TestCaseStep"("reusable_step_id");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseVersion_test_case_id_version_number_key" ON "TestCaseVersion"("test_case_id", "version_number");

-- CreateIndex
CREATE INDEX "TestSuite_project_id_deleted_at_idx" ON "TestSuite"("project_id", "deleted_at");

-- CreateIndex
CREATE INDEX "SuiteCase_test_case_id_idx" ON "SuiteCase"("test_case_id");

-- CreateIndex
CREATE INDEX "TestRun_project_id_status_created_at_idx" ON "TestRun"("project_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "TestRun_release_id_idx" ON "TestRun"("release_id");

-- CreateIndex
CREATE INDEX "RunResult_run_id_order_index_idx" ON "RunResult"("run_id", "order_index");

-- CreateIndex
CREATE INDEX "RunResult_run_id_test_case_id_attempt_number_idx" ON "RunResult"("run_id", "test_case_id", "attempt_number");

-- CreateIndex
CREATE INDEX "RunResultStep_run_result_id_idx" ON "RunResultStep"("run_result_id");

-- CreateIndex
CREATE UNIQUE INDEX "RunResultStep_run_result_id_test_case_step_id_key" ON "RunResultStep"("run_result_id", "test_case_step_id");

-- CreateIndex
CREATE UNIQUE INDEX "Environment_project_id_name_key" ON "Environment"("project_id", "name");

-- CreateIndex
CREATE INDEX "Variable_project_id_scope_key_idx" ON "Variable"("project_id", "scope", "key");

-- CreateIndex
CREATE INDEX "Variable_test_case_id_idx" ON "Variable"("test_case_id");

-- CreateIndex
CREATE UNIQUE INDEX "Variable_test_case_id_key_key" ON "Variable"("test_case_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "VariableValue_variable_id_environment_id_key" ON "VariableValue"("variable_id", "environment_id");

-- CreateIndex
CREATE INDEX "Comment_project_id_entity_type_entity_id_idx" ON "Comment"("project_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "Comment_assigned_to_id_resolved_idx" ON "Comment"("assigned_to_id", "resolved");

-- CreateIndex
CREATE INDEX "Comment_deleted_at_idx" ON "Comment"("deleted_at");

-- CreateIndex
CREATE INDEX "ReviewRequest_test_case_id_status_idx" ON "ReviewRequest"("test_case_id", "status");

-- CreateIndex
CREATE INDEX "ReviewRequest_assigned_to_idx" ON "ReviewRequest"("assigned_to");

-- CreateIndex
CREATE INDEX "ReviewRequest_requested_by_idx" ON "ReviewRequest"("requested_by");

-- CreateIndex
CREATE INDEX "Notification_user_id_read_created_at_idx" ON "Notification"("user_id", "read", "created_at");

-- CreateIndex
CREATE INDEX "Defect_run_result_id_idx" ON "Defect"("run_result_id");

-- CreateIndex
CREATE INDEX "Defect_test_case_id_idx" ON "Defect"("test_case_id");

-- CreateIndex
CREATE INDEX "Defect_deleted_at_local_status_idx" ON "Defect"("deleted_at", "local_status");

-- CreateIndex
CREATE INDEX "Defect_external_ticket_id_idx" ON "Defect"("external_ticket_id");

-- CreateIndex
CREATE INDEX "Attachment_entity_type_entity_id_idx" ON "Attachment"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "Attachment_storage_type_idx" ON "Attachment"("storage_type");

-- CreateIndex
CREATE INDEX "ActivityLog_project_id_created_at_idx" ON "ActivityLog"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "AuditLog_workspace_id_created_at_idx" ON "AuditLog"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "Integration_workspace_id_idx" ON "Integration"("workspace_id");

-- CreateIndex
CREATE INDEX "Integration_project_id_idx" ON "Integration"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_workspace_id_provider_key" ON "Integration"("workspace_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_project_id_provider_key" ON "Integration"("project_id", "provider");

-- CreateIndex
CREATE INDEX "Webhook_workspace_id_idx" ON "Webhook"("workspace_id");

-- CreateIndex
CREATE INDEX "Webhook_project_id_idx" ON "Webhook"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSettings_workspace_id_key" ON "NotificationSettings"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSettings_project_id_key" ON "NotificationSettings"("project_id");

-- CreateIndex
CREATE INDEX "Release_project_id_created_at_idx" ON "Release"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "Release_workspace_id_idx" ON "Release"("workspace_id");

-- CreateIndex
CREATE INDEX "ReleaseTicket_release_id_idx" ON "ReleaseTicket"("release_id");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseTicket_release_id_ticket_key_key" ON "ReleaseTicket"("release_id", "ticket_key");

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_project_id_entity_type_order_idx" ON "CustomFieldDefinition"("project_id", "entity_type", "order");

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldDefinition_project_id_entity_type_key_key" ON "CustomFieldDefinition"("project_id", "entity_type", "key");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationJoinRequest" ADD CONSTRAINT "OrganizationJoinRequest_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationJoinRequest" ADD CONSTRAINT "OrganizationJoinRequest_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceJoinRequest" ADD CONSTRAINT "WorkspaceJoinRequest_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceJoinRequest" ADD CONSTRAINT "WorkspaceJoinRequest_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationInvitationWorkspaceGrant" ADD CONSTRAINT "OrganizationInvitationWorkspaceGrant_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "OrganizationInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationInvitationWorkspaceGrant" ADD CONSTRAINT "OrganizationInvitationWorkspaceGrant_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "Dataset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReusableStep" ADD CONSTRAINT "ReusableStep_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReusableStep" ADD CONSTRAINT "ReusableStep_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "Module"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseStep" ADD CONSTRAINT "TestCaseStep_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseStep" ADD CONSTRAINT "TestCaseStep_reusable_step_id_fkey" FOREIGN KEY ("reusable_step_id") REFERENCES "ReusableStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseVersion" ADD CONSTRAINT "TestCaseVersion_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSuite" ADD CONSTRAINT "TestSuite_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuiteCase" ADD CONSTRAINT "SuiteCase_suite_id_fkey" FOREIGN KEY ("suite_id") REFERENCES "TestSuite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuiteCase" ADD CONSTRAINT "SuiteCase_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_suite_id_fkey" FOREIGN KEY ("suite_id") REFERENCES "TestSuite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunResult" ADD CONSTRAINT "RunResult_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunResult" ADD CONSTRAINT "RunResult_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunResult" ADD CONSTRAINT "RunResult_test_version_id_fkey" FOREIGN KEY ("test_version_id") REFERENCES "TestCaseVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunResultStep" ADD CONSTRAINT "RunResultStep_run_result_id_fkey" FOREIGN KEY ("run_result_id") REFERENCES "RunResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunResultStep" ADD CONSTRAINT "RunResultStep_test_case_step_id_fkey" FOREIGN KEY ("test_case_step_id") REFERENCES "TestCaseStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Environment" ADD CONSTRAINT "Environment_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variable" ADD CONSTRAINT "Variable_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variable" ADD CONSTRAINT "Variable_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariableValue" ADD CONSTRAINT "VariableValue_variable_id_fkey" FOREIGN KEY ("variable_id") REFERENCES "Variable"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VariableValue" ADD CONSTRAINT "VariableValue_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploratorySession" ADD CONSTRAINT "ExploratorySession_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSuggestion" ADD CONSTRAINT "AiSuggestion_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "TestCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "TestCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNotificationPrefs" ADD CONSTRAINT "UserNotificationPrefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_run_result_id_fkey" FOREIGN KEY ("run_result_id") REFERENCES "RunResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Integration" ADD CONSTRAINT "Integration_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSettings" ADD CONSTRAINT "NotificationSettings_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_decision_by_id_fkey" FOREIGN KEY ("decision_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseTicket" ADD CONSTRAINT "ReleaseTicket_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldDefinition" ADD CONSTRAINT "CustomFieldDefinition_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

