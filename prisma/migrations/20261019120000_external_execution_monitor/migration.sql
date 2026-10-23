-- Add a terminal "result unavailable" state to ResultStatus.
-- This is NOT a test failure: it is emitted when the monitoring-expiry policy is
-- reached before the provider returns a terminal result.
ALTER TYPE "ResultStatus" ADD VALUE IF NOT EXISTS 'UNAVAILABLE';

-- CreateEnum
CREATE TYPE "ExternalMonitorStatus" AS ENUM ('PENDING', 'POLLING', 'COMPLETED', 'UNAVAILABLE', 'ERROR');

-- CreateTable
CREATE TABLE "ExternalExecutionMonitor" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "run_result_id" TEXT,
    "environment" TEXT,
    "status" "ExternalMonitorStatus" NOT NULL DEFAULT 'PENDING',
    "batch_id" TEXT,
    "executions" JSONB NOT NULL DEFAULT '[]',
    "trigger_context" JSONB,
    "execution_rule" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_poll_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline_at" TIMESTAMP(3) NOT NULL,
    "locked_until" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalExecutionMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalExecutionMonitor_status_next_poll_at_idx" ON "ExternalExecutionMonitor"("status", "next_poll_at");

-- CreateIndex
CREATE INDEX "ExternalExecutionMonitor_run_id_idx" ON "ExternalExecutionMonitor"("run_id");

-- CreateIndex
CREATE INDEX "ExternalExecutionMonitor_run_result_id_idx" ON "ExternalExecutionMonitor"("run_result_id");
