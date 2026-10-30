import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { decryptToolConfig } from '@/lib/integrations/tool-config';
import {
  fetchDatadogSyntheticExecutionState,
  fetchDatadogBatchSnapshot,
  fetchDatadogTestConfigSummary,
  type DatadogBatchSnapshot,
  type DatadogIntegrationConfig,
  type ExternalStepExecutionItem,
  type ExternalTestExecutionResult,
  type StepApiExecutionRecord,
} from '@/lib/integrations/tool-clients';

// =========================================================================
// Backend-managed polling policy. These are NOT user-facing run controls.
// =========================================================================

/** Default interval between provider result polls. */
export const DEFAULT_POLL_INTERVAL_MS = 15_000;
/** Hard ceiling for the exponential backoff between polls. */
export const MAX_POLL_INTERVAL_MS = 60_000;
/** How long the backend keeps monitoring an execution with no terminal result. */
export const DEFAULT_MONITORING_EXPIRY_MS = 30 * 60 * 1000;
/** Optimistic lock TTL so two pollers never process the same row concurrently. */
const LOCK_TTL_MS = 2 * 60 * 1000;

export type MonitorExecutionStatus = 'pending' | 'pass' | 'fail' | 'skip';

export interface MonitorExecutionRecord {
  publicId: string;
  resultId: string;
  testType?: string;
  testName?: string;
  status: MonitorExecutionStatus;
  durationMs?: number;
  failureMessage?: string;
  externalResultUrl?: string;
  subSteps?: ExternalStepExecutionItem[];
  apiExecution?: StepApiExecutionRecord;
  startedAt?: string;
  finishedAt?: string;
}

/** Exponential backoff with a ceiling; honours a provider `Retry-After`. */
export function computePollBackoffMs(
  attempts: number,
  baseMs: number = DEFAULT_POLL_INTERVAL_MS,
  retryAfterMs?: number
): number {
  const base = Math.max(1000, baseMs);
  const exp = Math.min(Math.max(0, attempts), 4);
  const backoff = Math.min(base * Math.pow(2, exp), MAX_POLL_INTERVAL_MS);
  return Math.max(backoff, retryAfterMs ?? 0);
}

export function isMonitorExpired(deadlineAt: Date | string, now: Date = new Date()): boolean {
  const deadline = typeof deadlineAt === 'string' ? new Date(deadlineAt) : deadlineAt;
  return deadline.getTime() <= now.getTime();
}

/**
 * Aggregate execution records into a terminal outcome.
 * Never invents pass/fail: pending dominates, then genuine provider failures.
 */
export function deriveOverallFromExecutions(
  executions: MonitorExecutionRecord[]
): 'PASS' | 'FAIL' | 'SKIP' | 'PENDING' | 'UNAVAILABLE' {
  if (!executions || executions.length === 0) return 'UNAVAILABLE';
  if (executions.some((e) => e.status === 'pending')) return 'PENDING';
  if (executions.some((e) => e.status === 'fail')) return 'FAIL';
  if (executions.every((e) => e.status === 'skip')) return 'SKIP';
  return 'PASS';
}

export interface BuildExternalResultInput {
  executions: MonitorExecutionRecord[];
  batchId?: string | null;
  environment?: string | null;
  executionRule?: string | null;
  startedAtMs: number;
  /** Set when monitoring expired without a terminal provider result. */
  expired?: boolean;
  /** Explicit diagnostic when the outcome is UNAVAILABLE. */
  unavailableReason?: string;
}

/**
 * Provider batch states that will never produce a result id: the test was not
 * executed (paused / CI-skip rule / batch concurrency / interruption).
 * Without this, such an execution stays "pending" until the 30-minute expiry.
 */
const PROVIDER_NOT_EXECUTED_STATUSES = new Set(['skipped', 'missed', 'interrupted']);

/** Batch entries for this run that the provider decided not to execute. */
export function providerNotExecutedEntries(
  snapshot: DatadogBatchSnapshot
): Array<{ publicId: string; status: string }> {
  const out: Array<{ publicId: string; status: string }> = [];
  for (const result of snapshot.results || []) {
    const status = String(result.status || '').toLowerCase();
    if (!result.publicId || result.resultId) continue;
    if (!PROVIDER_NOT_EXECUTED_STATUSES.has(status)) continue;
    if (out.some((entry) => entry.publicId === result.publicId)) continue;
    out.push({ publicId: result.publicId, status });
  }
  return out;
}

/** Human-readable explanation for a test Datadog refused to execute. */
export function describeProviderNotExecuted(
  status: string,
  meta?: { paused?: boolean; ciExecutionRule?: string } | null
): string {
  if (String(status).toLowerCase() === 'missed') {
    return 'Datadog did not run this test within its CI batch window (provider concurrency).';
  }
  if (String(status).toLowerCase() === 'interrupted') {
    return 'Datadog interrupted this test before it produced a result.';
  }
  if (meta?.paused) {
    return 'Datadog skipped this test because it is paused in Datadog.';
  }
  if (String(meta?.ciExecutionRule || '').toLowerCase() === 'skipped') {
    return "Datadog skipped this test because its CI execution rule is 'skipped'.";
  }
  return 'Datadog skipped this test without starting an execution.';
}

/**
 * Pure builder: monitor state -> the same `ExternalTestExecutionResult` shape the
 * manual/postman path already persists, so the execution console renders every
 * provider identically.
 */
export function buildExternalResultFromExecutions(
  input: BuildExternalResultInput
): ExternalTestExecutionResult {
  const { executions, batchId, environment, executionRule, startedAtMs } = input;
  const totalDurationMs = Math.max(0, Date.now() - startedAtMs);

  const stepResults: ExternalTestExecutionResult['stepResults'] = {};
  const steps: ExternalStepExecutionItem[] = [];
  const logLines: string[] = [
    '=== DATADOG SYNTHETICS CI RUN (background) ===',
    `Batch ID: ${batchId || 'N/A'} | InkaTest Environment: ${environment || 'Default'}`,
    `Execution Rule: ${executionRule || 'blocking'} | Tests: ${executions.length}`,
    '---------------------------------',
  ];

  const pending = executions.filter((e) => e.status === 'pending');
  const overallStatus = input.expired
    ? 'UNAVAILABLE'
    : deriveOverallFromExecutions(executions);

  executions.forEach((exec, idx) => {
    const order = idx + 1;
    const testName = exec.testName || `Synthetic Test ${exec.publicId}`;
    if (exec.status === 'pending') {
      // When monitoring expired, the step is "unavailable" (not a failure and
      // no longer pending). While still monitoring it stays pending.
      const stepStatus: 'pending' | 'unavailable' = input.expired ? 'unavailable' : 'pending';
      stepResults[String(order)] = {
        status: stepStatus,
        note: input.expired
          ? `[${testName}] Result unavailable — ${input.unavailableReason || 'Datadog did not return a terminal result.'}`
          : `[${testName}] Awaiting results from Datadog${
              exec.resultId ? ` (result #${exec.resultId})` : ''
            }`,
      };
      steps.push({
        order,
        name: testName,
        status: 'skip',
        durationMs: 0,
        detail: `Awaiting results from Datadog${exec.resultId ? ` · Result #${exec.resultId}` : ''}`,
      });
      logLines.push(`#${order} [PENDING] ${testName} (${exec.publicId})`);
      return;
    }

    const subSteps = exec.subSteps;
    const failStepCount = subSteps?.filter((s) => s.status === 'fail').length || 0;
    const detail = `${exec.status.toUpperCase()} (${exec.durationMs ?? 0}ms)${
      exec.resultId ? ` · Result #${exec.resultId}` : ''
    }${subSteps ? ` · ${subSteps.length} step(s)${failStepCount ? `, ${failStepCount} failed` : ''}` : ''}${
      exec.failureMessage ? ` · ${exec.failureMessage}` : ''
    }${exec.externalResultUrl ? ` · ${exec.externalResultUrl}` : ''}`;

    stepResults[String(order)] = {
      status: exec.status === 'skip' ? 'skip' : exec.status === 'fail' ? 'fail' : 'pass',
      note: `[${testName}] ${detail}`,
      subSteps,
      failureMessage: exec.failureMessage,
      externalResultUrl: exec.externalResultUrl,
      apiExecution: exec.apiExecution,
    };
    steps.push({
      order,
      name: testName,
      status: exec.status === 'skip' ? 'skip' : exec.status === 'fail' ? 'fail' : 'pass',
      durationMs: exec.durationMs ?? 0,
      detail,
      subSteps,
      failureMessage: exec.failureMessage,
      externalResultUrl: exec.externalResultUrl,
    });
    logLines.push(`#${order} [${exec.status.toUpperCase()}] ${testName} (${exec.publicId}) -> ${detail}`);
    if (subSteps) {
      for (const s of subSteps) {
        logLines.push(
          `   ${s.status === 'pass' ? '✓' : s.status === 'fail' ? '✗' : '○'} ${s.name} (${s.durationMs}ms)${
            s.failureMessage ? ` — ${s.failureMessage}` : ''
          }${s.screenshotBucketKey ? ` [screenshot: ${s.screenshotBucketKey}]` : ''}`
        );
      }
    }
  });

  const passCount = steps.filter((s) => s.status === 'pass').length;
  const failCount = steps.filter((s) => s.status === 'fail').length;

  let summary: string;
  if (overallStatus === 'PENDING') {
    summary = `Datadog Synthetics: awaiting results (${pending.length} of ${executions.length} still running)`;
  } else if (overallStatus === 'UNAVAILABLE') {
    summary = `Datadog Synthetics: result unavailable — ${
      input.unavailableReason || 'no terminal result was returned before monitoring expiry'
    }`;
  } else if (overallStatus === 'SKIP') {
    summary = `Datadog Synthetics: not executed — ${
      executions.find((e) => e.failureMessage)?.failureMessage ||
      'the provider did not run this test'
    }`;
  } else {
    summary = `Datadog Synthetics: ${passCount} passed, ${failCount} failed (${totalDurationMs}ms)`;
  }
  logLines.push('---------------------------------', `Summary: ${summary}`);

  const externalUrl =
    executions.find((e) => e.externalResultUrl)?.externalResultUrl ||
    (executions[0]?.publicId
      ? `https://app.datadoghq.com/synthetics/details/${executions[0].publicId}`
      : undefined);

  return {
    provider: 'datadog',
    overallStatus,
    totalDurationMs,
    summary,
    stepResults,
    steps,
    automationLog: logLines.join('\n'),
    externalUrl,
  };
}

// =========================================================================
// Durable job store
// =========================================================================

export interface EnqueueDatadogMonitorInput {
  projectId: string;
  runId: string;
  runResultId?: string | null;
  environment?: string | null;
  batchId?: string | null;
  executions: MonitorExecutionRecord[];
  executionRule?: string | null;
  triggerContext?: Record<string, any>;
  startedAtMs?: number;
}

async function loadDatadogConfig(projectId: string): Promise<DatadogIntegrationConfig | null> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { workspace_id: true },
  });
  if (!project) return null;
  const row = await prisma.integration.findUnique({
    where: {
      workspace_id_provider: { workspace_id: project.workspace_id, provider: 'datadog' },
    },
  });
  if (!row || !row.enabled || !row.config) return null;
  return decryptToolConfig(row.config as any) as DatadogIntegrationConfig;
}

/**
 * Create (or reuse) the durable monitor for an execution. Reusing an existing
 * active row is what guarantees a Datadog test is never triggered twice.
 */
export async function enqueueDatadogMonitor(input: EnqueueDatadogMonitorInput) {
  const existing = await prisma.externalExecutionMonitor.findFirst({
    where: {
      run_id: input.runId,
      ...(input.runResultId ? { run_result_id: input.runResultId } : {}),
      status: { in: ['PENDING', 'POLLING'] },
    },
    orderBy: { created_at: 'desc' },
  });
  if (existing) return existing;

  const config = await loadDatadogConfig(input.projectId);
  const expiryMs =
    (config as any)?.defaultMonitoringExpiryMs && Number((config as any).defaultMonitoringExpiryMs) > 0
      ? Number((config as any).defaultMonitoringExpiryMs)
      : DEFAULT_MONITORING_EXPIRY_MS;

  return prisma.externalExecutionMonitor.create({
    data: {
      provider: 'datadog',
      project_id: input.projectId,
      run_id: input.runId,
      run_result_id: input.runResultId ?? null,
      environment: input.environment ?? null,
      status: 'PENDING',
      batch_id: input.batchId ?? null,
      executions: input.executions as any,
      execution_rule: input.executionRule ?? null,
      trigger_context: (input.triggerContext || {}) as any,
      next_poll_at: new Date(),
      deadline_at: new Date(Date.now() + expiryMs),
    },
  });
}

export async function getActiveMonitorsForRun(runId: string) {
  return prisma.externalExecutionMonitor.findMany({
    where: { run_id: runId, status: { in: ['PENDING', 'POLLING'] } },
  });
}

export async function getMonitorForResult(runResultId: string) {
  return prisma.externalExecutionMonitor.findFirst({
    where: { run_result_id: runResultId },
    orderBy: { created_at: 'desc' },
  });
}

interface ClaimedMonitor {
  id: string;
  project_id: string;
  run_id: string;
  run_result_id: string | null;
  environment: string | null;
  status: string;
  batch_id: string | null;
  executions: MonitorExecutionRecord[];
  execution_rule: string | null;
  trigger_context: any;
  attempts: number;
  deadline_at: Date;
  created_at: Date;
}

/**
 * Claim and advance a single monitor. Returns the terminal status when the
 * monitor reaches one, otherwise null (still pending).
 */
async function pollMonitor(claimed: ClaimedMonitor): Promise<string | null> {
  const config = await loadDatadogConfig(claimed.project_id);
  if (!config) {
    await finalizeMonitor(claimed, {
      terminal: 'UNAVAILABLE',
      reason: 'Datadog integration is disabled or not configured for this workspace.',
    });
    return 'UNAVAILABLE';
  }

  const run = await prisma.testRun.findUnique({
    where: { id: claimed.run_id },
    select: { status: true, run_context: true },
  });

  // An aborted run no longer dispatches new cases, but an execution that the
  // provider already accepted may still produce a valid result. Keep polling
  // until the provider settles it or the monitoring deadline is reached; never
  // mark it UNAVAILABLE merely because the run was aborted.
  const runAborted = run?.status === 'ABORTED';

  let executions = claimed.executions || [];

  // Discover result ids from the batch when the trigger did not return them.
  const missingResultIds = executions.filter((e) => !e.resultId);
  if (missingResultIds.length > 0) {
    if (claimed.batch_id) {
      const snapshot: DatadogBatchSnapshot | null = await fetchDatadogBatchSnapshot(
        config,
        claimed.batch_id
      ).catch(() => null);
      if (snapshot) {
        // Tests the provider decided not to execute never get a result id; they
        // must settle now instead of waiting for the 30-minute expiry.
        const notExecuted = providerNotExecutedEntries(snapshot).filter((entry) =>
          missingResultIds.some((e) => e.publicId === entry.publicId)
        );
        const skipNotes = new Map<string, string>();
        await Promise.all(
          notExecuted.map(async (entry) => {
            const meta =
              entry.status === 'skipped'
                ? await fetchDatadogTestConfigSummary(config, entry.publicId).catch(() => null)
                : null;
            skipNotes.set(entry.publicId, describeProviderNotExecuted(entry.status, meta));
          })
        );

        executions = executions.map((e) => {
          if (e.resultId) return e;
          const match = snapshot.results.find((r) => r.publicId === e.publicId && r.resultId);
          if (match) {
            return { ...e, resultId: match.resultId, testType: e.testType || match.testType };
          }
          const note = skipNotes.get(e.publicId);
          if (note) {
            return {
              ...e,
              status: 'skip',
              durationMs: 0,
              failureMessage: note,
              finishedAt: new Date().toISOString(),
            };
          }
          return e;
        });
      }
    }
  }

  let authError: string | null = null;
  let rateLimitedMs: number | undefined;
  let transientError: string | null = null;

  for (let i = 0; i < executions.length; i++) {
    const exec = executions[i];
    if (exec.status !== 'pending') continue;
    if (!exec.resultId) continue; // still awaiting a result id; retry next tick

    let state;
    try {
      state = await fetchDatadogSyntheticExecutionState(
        config,
        exec.publicId,
        exec.resultId,
        exec.testType
      );
    } catch (e: any) {
      transientError = e?.message || 'Datadog result poll failed';
      continue;
    }

    if (state.state === 'terminal') {
      const detail = state.detail;
      executions[i] = {
        ...exec,
        status: detail.overallStatus,
        durationMs: detail.durationMs,
        failureMessage: detail.failureMessage,
        externalResultUrl: detail.externalResultUrl,
        subSteps: detail.hasStepDetail
          ? detail.steps.map((s) => ({
              order: s.order,
              name: s.name,
              status: s.status,
              durationMs: s.durationMs,
              detail: `[Datadog step] ${s.status.toUpperCase()} (${s.durationMs}ms)${
                s.failureMessage ? ` — ${s.failureMessage}` : ''
              }`,
              assertions: s.assertions,
              failureMessage: s.failureMessage,
              screenshotBucketKey: s.screenshotBucketKey,
              screenshotUrl: s.screenshotUrl,
              apiExecution: s.apiExecution,
            }))
          : undefined,
        apiExecution:
          detail.steps.find((s) => s.status === 'fail')?.apiExecution ||
          detail.steps.find((s) => Boolean(s.apiExecution))?.apiExecution,
        finishedAt: new Date().toISOString(),
      };
    } else if (state.state === 'auth_error') {
      authError = state.error;
    } else if (state.state === 'rate_limited') {
      rateLimitedMs = state.retryAfterMs ?? MAX_POLL_INTERVAL_MS;
    } else if (state.state === 'error') {
      transientError = state.error;
    }
    // state === 'pending' -> keep waiting
  }

  const stillPending = executions.some((e) => e.status === 'pending');

  if (authError) {
    await finalizeMonitor(claimed, {
      terminal: 'UNAVAILABLE',
      reason: authError,
      executions,
    });
    return 'UNAVAILABLE';
  }

  if (!stillPending) {
    await finalizeMonitor(claimed, { terminal: 'TERMINAL', executions });
    return 'TERMINAL';
  }

  if (isMonitorExpired(claimed.deadline_at)) {
    await finalizeMonitor(claimed, {
      terminal: 'UNAVAILABLE',
      reason: `No terminal result after ${Math.round(
        (Date.now() - claimed.created_at.getTime()) / 60000
      )} minutes of monitoring. The test may still be running in Datadog.`,
      executions,
    });
    return 'UNAVAILABLE';
  }

  // Aborted runs keep their monitoring lease but the outcome stays pending for
  // as long as the provider is still executing.

  if (runAborted) {
    logger.info('Monitoring aborted run until the provider settles', {
      monitorId: claimed.id,
      runId: claimed.run_id,
    });
  }

  const baseInterval = Number((config as any).defaultPollingIntervalMs) || DEFAULT_POLL_INTERVAL_MS;
  const backoff = computePollBackoffMs(claimed.attempts, baseInterval, rateLimitedMs);
  await prisma.externalExecutionMonitor.update({
    where: { id: claimed.id },
    data: {
      status: 'POLLING',
      executions: executions as any,
      attempts: { increment: 1 },
      next_poll_at: new Date(Date.now() + backoff),
      locked_until: null,
      last_error: transientError,
    },
  });
  return null;
}

interface FinalizeInput {
  // 'TERMINAL' uses the aggregated execution statuses; the other two are explicit.
  terminal: 'TERMINAL' | 'UNAVAILABLE';
  executions?: MonitorExecutionRecord[];
  reason?: string;
}

/**
 * Persist the terminal outcome exactly once. Guarded by a conditional update so
 * duplicate/parallel pollers can never write a second result.
 */
async function finalizeMonitor(claimed: ClaimedMonitor, input: FinalizeInput) {
  const executions = input.executions || claimed.executions || [];
  const expired = input.terminal === 'UNAVAILABLE';

  const result = buildExternalResultFromExecutions({
    executions,
    batchId: claimed.batch_id,
    environment: claimed.environment,
    executionRule: claimed.execution_rule,
    startedAtMs: claimed.created_at.getTime(),
    expired,
    unavailableReason: input.reason,
  });

  // 1) Claim terminal ownership of the monitor.
  const claim = await prisma.externalExecutionMonitor.updateMany({
    where: { id: claimed.id, status: { in: ['PENDING', 'POLLING'] } },
    data: {
      status: expired ? 'UNAVAILABLE' : 'COMPLETED',
      executions: executions as any,
      completed_at: new Date(),
      locked_until: null,
      next_poll_at: new Date(),
      last_error: expired ? input.reason || 'Monitoring expiry reached' : null,
    },
  });
  if (claim.count === 0) return; // already finalized by another poller

  const durationSeconds = Math.max(1, Math.round(result.totalDurationMs / 1000));
  const statusValue = expired ? 'UNAVAILABLE' : result.overallStatus;

  const resultData = {
    status: statusValue as any,
    notes: result.summary,
    step_results: {
      ...result.stepResults,
      _externalMonitor: {
        provider: 'datadog',
        status: result.overallStatus,
        completedAt: new Date().toISOString(),
      },
    } as any,
    automation_log: result.automationLog,
    time_spent_seconds: durationSeconds,
    executed_at: new Date(),
    source: 'automated',
  };

  const triggerCtx = (claimed.trigger_context || {}) as Record<string, any>;
  const expectedAttempt =
    typeof triggerCtx.attemptNumber === 'number' ? triggerCtx.attemptNumber : null;
  const expectedGeneration =
    typeof triggerCtx.generation === 'number' ? triggerCtx.generation : null;

  if (claimed.run_result_id) {
    const before = await prisma.runResult
      .findUnique({
        where: { id: claimed.run_result_id },
        select: { status: true, attempt_number: true, execution_generation: true },
      })
      .catch(() => null);

    // Late result safety: never overwrite a newer attempt, a newer generation,
    // or a manual verdict that was recorded while the provider was running.
    const stale =
      !before ||
      String(before.status).toUpperCase() !== 'PENDING' ||
      (expectedAttempt !== null && before.attempt_number !== expectedAttempt) ||
      (expectedGeneration !== null && before.execution_generation !== expectedGeneration);

    if (stale) {
      await prisma.externalExecutionMonitor
        .updateMany({
          where: { id: claimed.id },
          data: { last_error: 'Stale provider result ignored (attempt superseded)' },
        })
        .catch(() => {});
      logger.info('Ignored stale provider result', {
        monitorId: claimed.id,
        runId: claimed.run_id,
        resultId: claimed.run_result_id,
        expectedAttempt,
        expectedGeneration,
      });
      return;
    }

    const written = await prisma.runResult
      .updateMany({
        where: {
          id: claimed.run_result_id,
          status: 'PENDING',
          attempt_number: before.attempt_number,
          execution_generation: before.execution_generation,
        },
        data: {
          ...resultData,
          execution_state: 'SETTLED',
          finished_at: new Date(),
          lease_owner: null,
          lease_expires_at: null,
          provider_execution_id: claimed.id,
        },
      })
      .catch(() => ({ count: 0 }));
    if (written.count === 0) return;

    // Legacy queue markers are no longer authoritative; clear the one for this
    // result if an old client wrote it.
    const runCtx = await prisma.testRun
      .findUnique({ where: { id: claimed.run_id }, select: { run_context: true } })
      .catch(() => null);
    const ctx = ((runCtx?.run_context as any) || {}) as Record<string, any>;
    if (ctx.caseStates?.[claimed.run_result_id]) {
      const caseStates = { ...ctx.caseStates };
      delete caseStates[claimed.run_result_id];
      await prisma.testRun
        .update({ where: { id: claimed.run_id }, data: { run_context: { ...ctx, caseStates } } })
        .catch(() => {});
    }
  } else {
    // Ad-hoc monitor: only the still-pending result belongs to this execution.
    await prisma.runResult
      .updateMany({
        where: { run_id: claimed.run_id, status: 'PENDING' },
        data: {
          ...resultData,
          execution_state: 'SETTLED',
          finished_at: new Date(),
          lease_owner: null,
          lease_expires_at: null,
        },
      })
      .catch(() => {});
  }

  await reconcileRunState(claimed.run_id);
  logger.info('External execution monitor finalized', {
    monitorId: claimed.id,
    runId: claimed.run_id,
    outcome: statusValue,
  });

  // Publish (best effort, same process) and let the server scheduler advance the
  // queue immediately. The durable tick still picks it up without this call.
  try {
    const { publishExecutionEvent } = await import('@/lib/execution/events');
    publishExecutionEvent(claimed.run_id, {
      type: 'CASE',
      resultId: claimed.run_result_id || undefined,
      status: String(statusValue).toLowerCase(),
      executionState: 'SETTLED',
    });
    const { tickRun } = await import('@/lib/execution/coordinator');
    setTimeout(() => {
      void tickRun(claimed.run_id).catch(() => {});
    }, 500);
  } catch {
    // never fail finalization because of the notification path
  }
}

/**
 * Recompute the parent run: complete it only when no result is still pending.
 * Honours stop-on-first-failure by skipping the remaining pending cases.
 */
export async function reconcileRunState(runId: string) {
  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { run_context: true, status: true },
  });
  if (!run || run.status === 'ABORTED') return;

  const results = await prisma.runResult.findMany({
    where: { run_id: runId },
    select: { id: true, status: true, execution_state: true },
    orderBy: { order_index: 'asc' },
  });

  const stopOnFirstFailure = Boolean(((run.run_context as any)?.config || {}).stopOnFirstFailure);
  const hasFailure = results.some((r) => r.status === 'FAIL');

  if (stopOnFirstFailure && hasFailure) {
    // Only not-yet-started cases are cancelled. A case that is actively running
    // or owned by a provider monitor is handled by the coordinator, which stops
    // awaiting the provider and settles it as CANCELLED.
    const pending = results
      .filter(
        (r) =>
          r.status === 'PENDING' &&
          ['IDLE', 'QUEUED'].includes(String(r.execution_state || '').toUpperCase())
      )
      .map((r) => r.id);
    if (pending.length > 0) {
      await prisma.runResult
        .updateMany({
          where: { id: { in: pending }, status: 'PENDING' },
          data: {
            status: 'CANCELLED',
            execution_state: 'SETTLED',
            finished_at: new Date(),
            lease_owner: null,
            lease_expires_at: null,
            notes: 'Cancelled — run stopped on first failure',
            executed_at: new Date(),
            source: 'automated',
          },
        })
        .catch(() => {});
      const ctx = ((run.run_context as any) || {}) as Record<string, any>;
      if (ctx.caseStates) {
        const caseStates = { ...ctx.caseStates };
        for (const id of pending) delete caseStates[id];
        await prisma.testRun
          .update({ where: { id: runId }, data: { run_context: { ...ctx, caseStates } } })
          .catch(() => {});
      }
      // Any monitor that belongs to a cancelled result is no longer awaited.
      await prisma.externalExecutionMonitor
        .updateMany({
          where: {
            run_id: runId,
            run_result_id: { in: pending },
            status: { in: ['PENDING', 'POLLING'] },
          },
          data: {
            status: 'CANCELLED',
            completed_at: new Date(),
            last_error: 'Cancelled after first failure',
          },
        })
        .catch(() => {});
    }
  }

  const refreshed = await prisma.runResult.findMany({
    where: { run_id: runId },
    select: { status: true },
  });
  if (refreshed.some((r) => r.status === 'PENDING')) return;

  const anyFail = refreshed.some((r) => r.status === 'FAIL');
  await prisma.testRun
    .update({
      where: { id: runId },
      data: { status: anyFail ? 'FAILED' : 'COMPLETED', completed_at: new Date() },
    })
    .catch(() => {});
}

/**
 * Process due monitors. Called by the backend interval worker and by client
 * kicks. Safe to call concurrently and repeatedly (idempotent + locked).
 */
export async function processDueExternalMonitors(
  limit = 5,
  onlyIds?: string[]
): Promise<number> {
  const now = new Date();
  let due: Array<{ id: string }> = [];
  try {
    due = await prisma.externalExecutionMonitor.findMany({
      where: {
        ...(onlyIds && onlyIds.length > 0 ? { id: { in: onlyIds } } : {}),
        status: { in: ['PENDING', 'POLLING'] },
        next_poll_at: { lte: now },
        OR: [{ locked_until: null }, { locked_until: { lt: now } }],
      },
      orderBy: { next_poll_at: 'asc' },
      take: limit,
      select: { id: true },
    });
  } catch (e: any) {
    logger.warn('Failed to load due external monitors', { error: e?.message });
    return 0;
  }

  let processed = 0;
  for (const row of due) {
    const claimed = await prisma.externalExecutionMonitor
      .updateMany({
        where: {
          id: row.id,
          status: { in: ['PENDING', 'POLLING'] },
          OR: [{ locked_until: null }, { locked_until: { lt: now } }],
        },
        data: { locked_until: new Date(Date.now() + LOCK_TTL_MS), status: 'POLLING' },
      })
      .catch(() => ({ count: 0 }));
    if (!claimed || claimed.count === 0) continue;

    const full = (await prisma.externalExecutionMonitor.findUnique({
      where: { id: row.id },
    })) as unknown as ClaimedMonitor | null;
    if (!full) continue;

    try {
      await pollMonitor({
        ...full,
        executions: (full.executions as unknown as MonitorExecutionRecord[]) || [],
      });
      processed++;
    } catch (e: any) {
      logger.warn('External monitor poll failed', { monitorId: row.id, error: e?.message });
      await prisma.externalExecutionMonitor
        .update({
          where: { id: row.id },
          data: {
            status: 'POLLING',
            locked_until: null,
            attempts: { increment: 1 },
            next_poll_at: new Date(Date.now() + MAX_POLL_INTERVAL_MS),
            last_error: e?.message || 'Poll failed',
          },
        })
        .catch(() => {});
    }
  }
  return processed;
}

/** Advance (and, when a monitor finishes, continue) all monitors of one run. */
export async function advanceMonitorsForRun(runId: string): Promise<number> {
  const monitors = await prisma.externalExecutionMonitor.findMany({
    where: {
      run_id: runId,
      status: { in: ['PENDING', 'POLLING'] },
    },
    select: { id: true },
  });
  if (monitors.length === 0) return 0;
  // Process only this run's monitors, and only when they are actually due —
  // client kicks must not defeat the backend-managed backoff / rate limiting.
  return processDueExternalMonitors(monitors.length, monitors.map((m) => m.id));
}
