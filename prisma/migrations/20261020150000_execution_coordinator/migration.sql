-- Unified execution coordinator: canonical persisted queue/lease state.
-- All statements are additive and backward compatible: existing rows keep
-- working via the defaults, and run_context.caseStates is still readable as a
-- legacy fallback by the coordinator and the run-results query.

ALTER TABLE "TestRun"
  ADD COLUMN "execution_generation" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "next_dispatch_at" TIMESTAMP(3),
  ADD COLUMN "stop_requested_at" TIMESTAMP(3),
  ADD COLUMN "execution_lock_owner" TEXT,
  ADD COLUMN "execution_lock_until" TIMESTAMP(3);

ALTER TABLE "RunResult"
  ADD COLUMN "execution_state" TEXT NOT NULL DEFAULT 'IDLE',
  ADD COLUMN "execution_generation" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "queued_at" TIMESTAMP(3),
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "finished_at" TIMESTAMP(3),
  ADD COLUMN "lease_owner" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "provider_execution_id" TEXT,
  ADD COLUMN "last_execution_error" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "RunResult_run_id_execution_state_idx" ON "RunResult"("run_id", "execution_state");
CREATE INDEX "RunResult_execution_state_lease_expires_at_idx" ON "RunResult"("execution_state", "lease_expires_at");
CREATE INDEX "TestRun_next_dispatch_at_idx" ON "TestRun"("next_dispatch_at");
