-- Catch-up migration: bring the committed migration chain in line with
-- prisma/schema.prisma. These changes had been applied to local dev DBs via
-- `prisma db push` but never captured as a migration.

-- AlterEnum
ALTER TYPE "ExternalMonitorStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
ALTER TYPE "ResultStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "RunResult" ADD COLUMN     "provider" TEXT;

-- AlterTable
ALTER TABLE "UserNotificationPrefs" ADD COLUMN     "slack_dm_webhook" TEXT;

-- CreateTable
CREATE TABLE "RunReportShare" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunReportShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunReportShare_token_key" ON "RunReportShare"("token");

-- CreateIndex
CREATE INDEX "RunReportShare_runId_idx" ON "RunReportShare"("runId");

-- CreateIndex
CREATE INDEX "RunReportShare_token_idx" ON "RunReportShare"("token");

-- CreateIndex
CREATE INDEX "RunReportShare_expiresAt_idx" ON "RunReportShare"("expiresAt");

-- CreateIndex
CREATE INDEX "Invitation_workspace_id_status_idx" ON "Invitation"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "Invitation_email_status_idx" ON "Invitation"("email", "status");

-- CreateIndex
CREATE INDEX "Project_slug_idx" ON "Project"("slug");

-- CreateIndex
CREATE INDEX "ReviewRequest_status_created_at_idx" ON "ReviewRequest"("status", "created_at");

-- CreateIndex
CREATE INDEX "ReviewRequest_assigned_to_status_idx" ON "ReviewRequest"("assigned_to", "status");

-- CreateIndex
CREATE INDEX "RunResult_test_case_id_executed_at_idx" ON "RunResult"("test_case_id", "executed_at");

-- CreateIndex
CREATE INDEX "RunResult_status_idx" ON "RunResult"("status");

-- CreateIndex
CREATE INDEX "TestCase_project_id_review_status_idx" ON "TestCase"("project_id", "review_status");

-- CreateIndex
CREATE INDEX "TestCase_display_id_idx" ON "TestCase"("display_id");

-- CreateIndex
CREATE INDEX "WorkspaceJoinRequest_workspace_id_status_idx" ON "WorkspaceJoinRequest"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "WorkspaceJoinRequest_user_id_status_idx" ON "WorkspaceJoinRequest"("user_id", "status");

-- AddForeignKey
ALTER TABLE "RunReportShare" ADD CONSTRAINT "RunReportShare_runId_fkey" FOREIGN KEY ("runId") REFERENCES "TestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
