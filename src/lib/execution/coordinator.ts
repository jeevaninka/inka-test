/**
 * Server-side execution coordinator.
 *
 * Every automated start/rerun path (Run Deck, row actions, Execution Console,
 * scheduler recovery) goes through this module. It owns:
 *   - authorization hand-off (callers pass an authenticated actor id)
 *   - idempotent, atomic queue claims (DB conditional updates, not in-memory)
 *   - attempt identity and generation fencing
 *   - dispatch to the existing Postman/Datadog runner
 *   - stop / skip / abort semantics
 *   - durable recovery of interrupted executions
 *
 * The browser is never part of the correctness path. `tickRun` is driven by
 * `src/instrumentation.ts` and by the authenticated cron endpoint.
 */
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { requireProjectMemberByRunId } from '@/lib/permissions';
import { getCaseAutomationSource } from '@/lib/cases/automation-source';
import {
  advanceMonitorsForRun,
  getActiveMonitorsForRun,
  getMonitorForResult,
  reconcileRunState,
} from '@/lib/integrations/execution-monitor';
import { createRetryAttempts } from './attempts';
import { publishExecutionEvent } from './events';
import { createSystemActor } from './system-actor';
import {
  EXECUTION_STATE,
  computeQueuePositions,
  deriveRunLifecycle,
  isTerminalResultStatus,
  latestAttempts,
  type ExecutionState,
} from './state';

export const RUN_LOCK_TTL_MS = 2 * 60 * 1000;
export const CASE_LEASE_TTL_MS = 20 * 60 * 1000;
/** Default number of Datadog tests allowed in flight at the same time. */
export const DEFAULT_DATADOG_CONCURRENCY = 3;
export const MAX_DATADOG_CONCURRENCY = 5;
/** Wall-clock budget for synchronous dispatching inside one tick. */
const TICK_BUDGET_MS = 90_000;

const WORKER_ID = `w-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

type Provider = 'postman' | 'datadog';

interface RunConfig {
  customVariables?: Record<string, string>;
  postman?: Record<string, any>;
  datadog?: Record<string, any>;
  stopOnFirstFailure?: boolean;
  /**
   * Delay between cases. Applies to the Postman lane only — the Datadog lane
   * is bounded by a concurrency count, not by a delay.
   */
  interTestDelayMs?: number;
}

export interface RunCaseOverrides {
  provider?: Provider;
  customVariables?: Record<string, string>;
  datasetParams?: Record<string, string>;
  postman?: Record<string, any>;
  datadog?: Record<string, any>;
}

export interface StartRunResult {
  ok: boolean;
  queued: number;
  skipped: number;
  generation: number;
  lifecycle: string;
}

export interface TickResult {
  ok: boolean;
  busy?: boolean;
  dispatched: number;
  active: boolean;
  lifecycle?: string;
}

type RunRow = Awaited<ReturnType<typeof loadRun>>;
type ResultRow = NonNullable<RunRow>['results'][number];

function loadRun(runId: string) {
  return prisma.testRun.findUnique({
    where: { id: runId },
    include: {
      results: { orderBy: [{ order_index: 'asc' }, { attempt_number: 'asc' }] },
    },
  });
}

function readConfig(runContext: unknown): RunConfig {
  const ctx = (runContext || {}) as Record<string, any>;
  const config = (ctx.config || {}) as RunConfig;
  return config;
}

function clampDatadogConcurrency(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DATADOG_CONCURRENCY;
  return Math.min(MAX_DATADOG_CONCURRENCY, Math.max(1, Math.floor(parsed)));
}

function stripUndefined<T extends Record<string, any>>(value: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out as Partial<T>;
}

/* ------------------------------------------------------------------ */
/* Run-level lease                                                     */
/* ------------------------------------------------------------------ */

async function acquireRunLock(runId: string): Promise<boolean> {
  const now = new Date();
  const claimed = await prisma.testRun
    .updateMany({
      where: {
        id: runId,
        OR: [{ execution_lock_until: null }, { execution_lock_until: { lt: now } }],
      },
      data: {
        execution_lock_owner: WORKER_ID,
        execution_lock_until: new Date(now.getTime() + RUN_LOCK_TTL_MS),
      },
    })
    .catch(() => ({ count: 0 }));
  return claimed.count === 1;
}

async function renewRunLock(runId: string): Promise<void> {
  await prisma.testRun
    .updateMany({
      where: { id: runId, execution_lock_owner: WORKER_ID },
      data: { execution_lock_until: new Date(Date.now() + RUN_LOCK_TTL_MS) },
    })
    .catch(() => {});
}

async function releaseRunLock(runId: string): Promise<void> {
  await prisma.testRun
    .updateMany({
      where: { id: runId, execution_lock_owner: WORKER_ID },
      data: { execution_lock_owner: null, execution_lock_until: null },
    })
    .catch(() => {});
}

/** Renew the run lock + case lease while a long provider call is in flight. */
function startHeartbeat(runId: string, resultId?: string): () => void {
  const timer = setInterval(() => {
    void renewRunLock(runId);
    if (resultId) {
      void prisma.runResult
        .updateMany({
          where: {
            id: resultId,
            execution_state: EXECUTION_STATE.RUNNING,
            lease_owner: WORKER_ID,
          },
          data: { lease_expires_at: new Date(Date.now() + CASE_LEASE_TTL_MS) },
        })
        .catch(() => {});
    }
  }, 30_000);
  (timer as any).unref?.();
  return () => clearInterval(timer);
}

/* ------------------------------------------------------------------ */
/* Legacy queue migration                                             */
/* ------------------------------------------------------------------ */

/**
 * Adopt `run_context.caseStates` markers written before this schema existed.
 * Runs once per run: markers are removed after they are expressed in columns.
 */
async function adoptLegacyQueueState(run: NonNullable<RunRow>): Promise<void> {
  const ctx = (run.run_context || {}) as Record<string, any>;
  const legacy = ctx.caseStates as Record<string, string> | undefined;
  if (!legacy || typeof legacy !== 'object' || Object.keys(legacy).length === 0) return;

  const pendingById = new Map(
    run.results
      .filter((row) => row.status === 'PENDING' && row.execution_state === EXECUTION_STATE.IDLE)
      .map((row) => [row.id, row])
  );

  for (const [resultId, marker] of Object.entries(legacy)) {
    const row = pendingById.get(resultId);
    if (!row) continue;
    const now = new Date();
    let next: ExecutionState = EXECUTION_STATE.QUEUED;
    if (String(marker).toUpperCase() === 'RUNNING') {
      const monitor = await getMonitorForResult(resultId).catch(() => null);
      next =
        monitor && ['PENDING', 'POLLING'].includes(String(monitor.status))
          ? EXECUTION_STATE.WAITING
          : EXECUTION_STATE.QUEUED;
    }
    await prisma.runResult
      .updateMany({
        where: { id: resultId, status: 'PENDING', execution_state: EXECUTION_STATE.IDLE },
        data: {
          execution_state: next,
          queued_at: now,
          execution_generation: run.execution_generation,
          ...(next === EXECUTION_STATE.WAITING ? { started_at: now } : {}),
        },
      })
      .catch(() => {});
  }

  const rest = { ...ctx };
  delete rest.caseStates;
  await prisma.testRun
    .update({ where: { id: run.id }, data: { run_context: rest as any } })
    .catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Stale lease + orphaned monitor recovery                            */
/* ------------------------------------------------------------------ */

async function reconcileStaleCaseLeases(runId: string): Promise<void> {
  const now = new Date();
  const stale = await prisma.runResult.findMany({
    where: {
      run_id: runId,
      status: 'PENDING',
      execution_state: EXECUTION_STATE.RUNNING,
      OR: [{ lease_expires_at: null }, { lease_expires_at: { lt: now } }],
    },
    select: { id: true, lease_owner: true },
  });

  for (const row of stale) {
    const monitor = await getMonitorForResult(row.id).catch(() => null);
    if (monitor && ['PENDING', 'POLLING'].includes(String(monitor.status))) {
      // The provider owns the execution; keep the logical slot occupied.
      await prisma.runResult
        .updateMany({
          where: { id: row.id, status: 'PENDING', execution_state: EXECUTION_STATE.RUNNING },
          data: {
            execution_state: EXECUTION_STATE.WAITING,
            provider_execution_id: monitor.id,
            lease_owner: null,
            lease_expires_at: null,
          },
        })
        .catch(() => {});
      continue;
    }

    // A synchronous (Postman) execution whose worker vanished may already have
    // produced external side effects. Never blindly replay it.
    await prisma.runResult
      .updateMany({
        where: { id: row.id, status: 'PENDING', execution_state: EXECUTION_STATE.RUNNING },
        data: {
          status: 'UNAVAILABLE',
          execution_state: EXECUTION_STATE.SETTLED,
          finished_at: now,
          lease_owner: null,
          lease_expires_at: null,
          source: 'automated',
          notes:
            'Execution was interrupted before a result was recorded. It was not retried automatically because the provider requests may already have run. Use Rerun to execute it again.',
          last_execution_error: 'Worker lease expired',
        },
      })
      .catch(() => {});
    logger.warn('Recovered stale execution lease', { runId, resultId: row.id });
  }

  // WAITING cases whose monitor is gone/completed without a persisted result.
  const waiting = await prisma.runResult.findMany({
    where: {
      run_id: runId,
      status: 'PENDING',
      execution_state: EXECUTION_STATE.WAITING,
    },
    select: { id: true },
  });
  if (waiting.length === 0) return;
  const active = await getActiveMonitorsForRun(runId).catch(() => []);
  const activeIds = new Set(active.map((m) => m.run_result_id).filter(Boolean) as string[]);
  for (const row of waiting) {
    if (activeIds.has(row.id)) continue;
    const monitor = await getMonitorForResult(row.id).catch(() => null);
    await prisma.runResult
      .updateMany({
        where: { id: row.id, status: 'PENDING', execution_state: EXECUTION_STATE.WAITING },
        data: {
          status: 'UNAVAILABLE',
          execution_state: EXECUTION_STATE.SETTLED,
          finished_at: new Date(),
          source: 'automated',
          notes: monitor
            ? `Provider monitoring ended (${monitor.status}) without a recorded result.`
            : 'Provider monitor is missing; result unavailable.',
          last_execution_error: monitor?.last_error || 'Monitor missing',
        },
      })
      .catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Queueing                                                           */
/* ------------------------------------------------------------------ */

async function queueCases(
  run: NonNullable<RunRow>,
  resultIds: string[],
  generation: number
): Promise<number> {
  if (resultIds.length === 0) return 0;
  const now = new Date();
  const queued = await prisma.runResult.updateMany({
    where: {
      id: { in: resultIds },
      run_id: run.id,
      status: 'PENDING',
      execution_state: EXECUTION_STATE.IDLE,
    },
    data: {
      execution_state: EXECUTION_STATE.QUEUED,
      queued_at: now,
      execution_generation: generation,
    },
  });
  return queued.count;
}

async function skipCases(
  runId: string,
  reason: string,
  onlyIds?: string[]
): Promise<number> {
  const skipped = await prisma.runResult.updateMany({
    where: {
      run_id: runId,
      status: 'PENDING',
      execution_state: { in: [EXECUTION_STATE.IDLE, EXECUTION_STATE.QUEUED] },
      ...(onlyIds && onlyIds.length > 0 ? { id: { in: onlyIds } } : {}),
    },
    data: {
      status: 'SKIP',
      execution_state: EXECUTION_STATE.SETTLED,
      notes: reason,
      source: 'automated',
      executed_at: new Date(),
      finished_at: new Date(),
      lease_owner: null,
      lease_expires_at: null,
    },
  });
  return skipped.count;
}

/**
 * Cancel cases that never started. Used by "Stop run" and by
 * stop-on-failure: a cancelled case produced no verdict, which is a
 * different thing from a case the user deliberately skipped.
 */
async function cancelCases(
  runId: string,
  reason: string,
  onlyIds?: string[]
): Promise<number> {
  const cancelled = await prisma.runResult.updateMany({
    where: {
      run_id: runId,
      status: 'PENDING',
      execution_state: { in: [EXECUTION_STATE.IDLE, EXECUTION_STATE.QUEUED] },
      ...(onlyIds && onlyIds.length > 0 ? { id: { in: onlyIds } } : {}),
    },
    data: {
      status: 'CANCELLED',
      execution_state: EXECUTION_STATE.SETTLED,
      notes: reason,
      source: 'automated',
      executed_at: new Date(),
      finished_at: new Date(),
      lease_owner: null,
      lease_expires_at: null,
    },
  });
  return cancelled.count;
}

/**
 * Stop awaiting in-flight provider executions (Datadog). The test is *not*
 * cancelled at the provider — it keeps running there — we simply stop
 * waiting for it. The result is settled as CANCELLED, so a late provider
 * result can never overwrite it (the monitor write is fenced on
 * `status = PENDING`).
 */
async function detachInFlightProviderExecutions(
  runId: string,
  reason: string
): Promise<number> {
  const waiting = await prisma.runResult.findMany({
    where: { run_id: runId, status: 'PENDING', execution_state: EXECUTION_STATE.WAITING },
    select: { id: true },
  });
  if (waiting.length === 0) return 0;
  const ids = waiting.map((row) => row.id);

  await prisma.externalExecutionMonitor
    .updateMany({
      where: {
        run_id: runId,
        run_result_id: { in: ids },
        status: { in: ['PENDING', 'POLLING'] },
      },
      data: { status: 'CANCELLED', completed_at: new Date(), last_error: reason },
    })
    .catch(() => {});

  const cancelled = await prisma.runResult.updateMany({
    where: { id: { in: ids }, status: 'PENDING' },
    data: {
      status: 'CANCELLED',
      execution_state: EXECUTION_STATE.SETTLED,
      notes: reason,
      finished_at: new Date(),
      lease_owner: null,
      lease_expires_at: null,
    },
  });
  return cancelled.count;
}

/** Cases eligible for `Start run` / `Start remaining`. */
async function eligibleIds(
  run: NonNullable<RunRow>,
  resultIds?: string[]
): Promise<string[]> {
  const latest = latestAttempts(run.results);
  const wanted = resultIds && resultIds.length > 0 ? new Set(resultIds) : null;
  let candidates = latest.filter(
    (row) =>
      row.status === 'PENDING' &&
      row.execution_state === EXECUTION_STATE.IDLE &&
      (!wanted || wanted.has(row.id))
  );

  const isAutomatedRun = ['postman', 'datadog', 'mixed', 'automated'].includes(
    String(run.source || '')
  );
  if (!isAutomatedRun) return [];

  // Mixed/automated runs execute only cases with an in-app runner. External
  // automated cases, manual cases and unlinked rows are never dispatched.
  if (!['postman', 'datadog'].includes(String(run.source || ''))) {
    const cases = await prisma.testCase.findMany({
      where: { id: { in: candidates.map((row) => row.test_case_id) } },
      select: { id: true, type: true, custom_fields: true },
    });
    const linked = new Set(
      cases
        .filter((row) => {
          const source = getCaseAutomationSource({
            type: row.type,
            custom_fields: row.custom_fields,
          });
          return source === 'postman' || source === 'datadog';
        })
        .map((row) => row.id)
    );
    candidates = candidates.filter((row) => linked.has(row.test_case_id));
  }

  return candidates.map((row) => row.id);
}

export async function startRunCases(input: {
  runId: string;
  actorId: number;
  resultIds?: string[];
  mode?: 'start' | 'rerun-all' | 'rerun-failed' | 'resume';
  /** When false the cases are only queued; the durable scheduler starts them. */
  startImmediately?: boolean;
}): Promise<StartRunResult> {
  const { runId, actorId } = input;
  const mode = input.mode || 'start';
  await requireProjectMemberByRunId(runId, actorId);

  let run = await loadRun(runId);
  if (!run) throw new Error('Run not found');
  if (run.status === 'ABORTED') throw new Error('Cannot start cases in an aborted run');
  if (run.deleted_at) throw new Error('Run has been archived');

  await adoptLegacyQueueState(run);
  // Re-read so legacy QUEUED/RUNNING markers adopted above are visible to the
  // eligibility query in this same command.
  run = (await loadRun(runId)) as NonNullable<RunRow>;

  let targets: string[] = [];
  let generation = run.execution_generation;
  let skipped = 0;

  if (mode === 'start') {
    targets = await eligibleIds(run, input.resultIds);
  } else {
    const created = await createRetryAttempts({
      runId,
      resultIds: input.resultIds,
      mode: mode === 'resume' ? 'resume' : mode,
      bumpGeneration: mode === 'rerun-all',
    });
    targets = created.createdIds;
    generation = created.generation;
    skipped = created.skippedPending;
  }

  const queued = await queueCases(run, targets, generation);

  if (queued > 0) {
    // The person who starts the cases takes ownership of the ones nobody is
    // assigned to; an existing assignment is never overwritten.
    await prisma.runResult
      .updateMany({
        where: { id: { in: targets }, run_id: runId, assigned_to: null },
        data: { assigned_to: actorId },
      })
      .catch(() => {});

    await prisma.testRun.update({
      where: { id: runId },
      data: {
        status: 'IN_PROGRESS',
        started_at: run.started_at || new Date(),
        completed_at: null,
        stop_requested_at: null,
        execution_generation: generation,
        next_dispatch_at: null,
      },
    });
    publishExecutionEvent(runId, { type: 'RUN', status: 'QUEUED', executionState: 'QUEUED' });

    // One human-readable activity entry per actual start. The run name is not
    // in the action text because the dashboard already appends the entity name.
    const activityAction =
      mode === 'start'
        ? 'Started test run'
        : mode === 'rerun-all'
          ? 'Re-ran all cases'
          : mode === 'rerun-failed'
            ? 'Re-ran failed cases'
            : 'Resumed run';
    await prisma.activityLog
      .create({
        data: {
          project_id: run.project_id,
          user_id: actorId,
          action: activityAction,
          entity_type: 'test_run',
          entity_id: runId,
          metadata: { mode, queued } as any,
        },
      })
      .catch(() => {});
  }

  const refreshed = await loadRun(runId);
  const latest = refreshed ? latestAttempts(refreshed.results) : [];
  const lifecycle = refreshed ? deriveRunLifecycle(refreshed, latest) : 'READY';

  if (queued > 0 && input.startImmediately !== false) {
    await tickRun(runId, { actorId });
  }

  return { ok: true, queued, skipped, generation, lifecycle };
}

/* ------------------------------------------------------------------ */
/* Provider resolution + dispatch                                     */
/* ------------------------------------------------------------------ */

async function providerForCase(
  run: NonNullable<RunRow>,
  testCaseId: string
): Promise<Provider | null> {
  const source = String(run.source || '');
  if (source === 'postman' || source === 'datadog') return source as Provider;
  const row = await prisma.testCase.findUnique({
    where: { id: testCaseId },
    select: { type: true, custom_fields: true },
  });
  if (!row) return null;
  const detected = getCaseAutomationSource({ type: row.type, custom_fields: row.custom_fields });
  return detected === 'postman' || detected === 'datadog' ? detected : null;
}

/**
 * Resolve the execution lane (provider) of many test cases in one query.
 * `null` means the case has no in-app runner and is never dispatched.
 */
async function classifyProviders(
  testCaseIds: string[]
): Promise<Map<string, Provider | null>> {
  const map = new Map<string, Provider | null>();
  const unique = Array.from(new Set(testCaseIds.filter(Boolean)));
  if (unique.length === 0) return map;
  const rows = await prisma.testCase.findMany({
    where: { id: { in: unique } },
    select: { id: true, type: true, custom_fields: true },
  });
  for (const row of rows) {
    const source = getCaseAutomationSource({
      type: row.type,
      custom_fields: row.custom_fields,
    });
    map.set(row.id, source === 'postman' || source === 'datadog' ? source : null);
  }
  return map;
}

function buildRunnerInput(
  run: NonNullable<RunRow>,
  result: ResultRow,
  testCase: { custom_fields: unknown },
  provider: Provider,
  overrides?: RunCaseOverrides
): Record<string, any> {
  const config = readConfig(run.run_context);
  const cf = (testCase.custom_fields as any) || {};
  const postmanCfg = cf._postman || {};
  const datadogCfg = cf._datadog || {};

  const runPostman = { ...(config.postman || {}), ...stripUndefined(overrides?.postman || {}) };
  const runDatadog = { ...(config.datadog || {}), ...stripUndefined(overrides?.datadog || {}) };

  const customVariables = {
    ...((run.resolved_variables as Record<string, string>) || {}),
    ...(config.customVariables || {}),
    ...(overrides?.customVariables || {}),
  };

  const base: Record<string, any> = {
    projectId: run.project_id,
    testCaseId: result.test_case_id,
    runResultId: result.id,
    provider,
    environmentName: run.environment,
    datasetParams: overrides?.datasetParams,
    customVariables,
    expectedAttemptNumber: result.attempt_number,
    expectedGeneration: result.execution_generation,
    __systemActor: createSystemActor(run.created_by, 'execution-coordinator'),
  };

  if (provider === 'postman') {
    base.postman = {
      collectionUid: postmanCfg.collectionUid,
      folderOrRequestFilter:
        Array.isArray(postmanCfg.selectedRequestOrders) && postmanCfg.selectedRequestOrders.length > 0
          ? undefined
          : postmanCfg.folderOrRequestFilter,
      selectedRequestOrders: postmanCfg.selectedRequestOrders,
      postmanEnvUidOverride: runPostman.postmanEnvUidOverride,
      iterations: runPostman.iterations ?? postmanCfg.iterations,
      delayMs: runPostman.delayMs ?? postmanCfg.delayMs,
      timeoutMs: runPostman.timeoutMs ?? postmanCfg.timeoutMs,
      maxLatencyMs: runPostman.maxLatencyMs,
      bailOnFailure: runPostman.bailOnFailure ?? postmanCfg.bailOnFailure,
      persistResponses: runPostman.persistResponses ?? postmanCfg.persistResponses,
      turnOffLogs: runPostman.turnOffLogs ?? postmanCfg.turnOffLogs,
      keepVariableValues: runPostman.keepVariableValues ?? postmanCfg.keepVariableValues,
      ignoreCookies: runPostman.ignoreCookies ?? postmanCfg.ignoreCookies,
      saveCookies: runPostman.saveCookies ?? postmanCfg.saveCookies,
      skipStepOrders: runPostman.skipStepOrders,
    };
  } else {
    base.datadog = {
      publicIds: datadogCfg.publicIds || [],
      startUrlOverride: runDatadog.startUrlOverride ?? datadogCfg.startUrlOverride,
      executionRule: runDatadog.executionRule ?? datadogCfg.executionRule,
      delayMs: runDatadog.delayMs ?? datadogCfg.delayMs,
      retryCount: runDatadog.retryCount ?? datadogCfg.retryCount,
    };
  }

  return base;
}

async function markSettled(resultId: string): Promise<void> {
  const row = await prisma.runResult.findUnique({
    where: { id: resultId },
    select: { status: true, provider_execution_id: true },
  });
  if (!row) return;
  if (row.status === 'PENDING') return; // still owned by a provider monitor
  await prisma.runResult
    .updateMany({
      where: { id: resultId, status: { not: 'PENDING' } },
      data: {
        execution_state: EXECUTION_STATE.SETTLED,
        finished_at: new Date(),
        lease_owner: null,
        lease_expires_at: null,
      },
    })
    .catch(() => {});
}

async function dispatchClaimedResult(
  run: NonNullable<RunRow>,
  result: ResultRow,
  actorId: number,
  overrides?: RunCaseOverrides
): Promise<{ ok: boolean; pending: boolean; failed: boolean; payload?: any }> {
  const testCase = await prisma.testCase.findUnique({
    where: { id: result.test_case_id },
    select: { id: true, type: true, custom_fields: true },
  });
  if (!testCase) {
    await prisma.runResult
      .updateMany({
        where: { id: result.id, status: 'PENDING', execution_state: EXECUTION_STATE.RUNNING },
        data: {
          status: 'INVALID',
          execution_state: EXECUTION_STATE.SETTLED,
          finished_at: new Date(),
          notes: 'Test case no longer exists',
          source: 'automated',
          lease_owner: null,
          lease_expires_at: null,
        },
      })
      .catch(() => {});
    return { ok: false, pending: false, failed: false };
  }

  const provider =
    (overrides?.provider as Provider | undefined) ||
    (await providerForCase(run, result.test_case_id));
  if (!provider) {
    await prisma.runResult
      .updateMany({
        where: { id: result.id, status: 'PENDING', execution_state: EXECUTION_STATE.RUNNING },
        data: {
          status: 'SKIP',
          execution_state: EXECUTION_STATE.SETTLED,
          finished_at: new Date(),
          notes: 'No in-app runner linked to this automated case',
          source: 'automated',
          lease_owner: null,
          lease_expires_at: null,
        },
      })
      .catch(() => {});
    return { ok: false, pending: false, failed: false };
  }

  const input = buildRunnerInput(run, result, testCase, provider, overrides);
  const stopHeartbeat = startHeartbeat(run.id, result.id);

  try {
    const { executeTestCaseExternalRunnerAction } = await import(
      '@/app/actions/integrations'
    );
    const execRes = await executeTestCaseExternalRunnerAction(input as any);

    const after = await prisma.runResult.findUnique({
      where: { id: result.id },
      select: { status: true },
    });
    const pending = String(after?.status || '').toUpperCase() === 'PENDING';
    if (pending) {
      const monitor = await getMonitorForResult(result.id).catch(() => null);
      await prisma.runResult
        .updateMany({
          where: { id: result.id, status: 'PENDING', execution_state: EXECUTION_STATE.RUNNING },
          data: {
            execution_state: EXECUTION_STATE.WAITING,
            provider_execution_id: monitor?.id ?? null,
            lease_owner: null,
            lease_expires_at: null,
          },
        })
        .catch(() => {});
    } else {
      await markSettled(result.id);
    }

    publishExecutionEvent(run.id, {
      type: 'CASE',
      resultId: result.id,
      attemptNumber: result.attempt_number,
      status: String(execRes?.overallStatus || after?.status || '').toLowerCase(),
      executionState: pending ? EXECUTION_STATE.WAITING : EXECUTION_STATE.SETTLED,
    });

    return {
      ok: true,
      pending,
      failed: String(execRes?.overallStatus || '').toUpperCase() === 'FAIL',
      payload: execRes,
    };
  } catch (e: any) {
    // A thrown error means the provider could not be triggered/executed at all
    // (integration, auth, network). Per-request assertion failures are recorded
    // inside `execRes` instead, so this is never a test assertion failure.
    const unavailable = true;
    await prisma.runResult
      .updateMany({
        where: {
          id: result.id,
          status: 'PENDING',
          execution_state: EXECUTION_STATE.RUNNING,
        },
        data: {
          status: unavailable ? 'UNAVAILABLE' : 'FAIL',
          execution_state: EXECUTION_STATE.SETTLED,
          executed_at: new Date(),
          finished_at: new Date(),
          lease_owner: null,
          lease_expires_at: null,
          source: 'automated',
          last_execution_error: e?.message || 'Execution failed',
          notes: unavailable
            ? `Result unavailable — ${e?.message || 'Datadog execution could not be started'}`
            : e?.message || 'Execution failed',
        } as any,
      })
      .catch(() => {});
    publishExecutionEvent(run.id, {
      type: 'CASE',
      resultId: result.id,
      attemptNumber: result.attempt_number,
      status: unavailable ? 'unavailable' : 'fail',
      executionState: EXECUTION_STATE.SETTLED,
    });
    logger.warn('Coordinator dispatch failed', {
      runId: run.id,
      resultId: result.id,
      provider,
      error: e?.message,
    });
    return { ok: false, pending: false, failed: !unavailable };
  } finally {
    stopHeartbeat();
  }
}

/* ------------------------------------------------------------------ */
/* Scheduler tick                                                     */
/* ------------------------------------------------------------------ */

const ticking = new Set<string>();

export async function tickRun(
  runId: string,
  opts: { actorId?: number } = {}
): Promise<TickResult> {
  if (ticking.has(runId)) return { ok: true, busy: true, dispatched: 0, active: true };
  ticking.add(runId);
  let locked = false;
  try {
    locked = await acquireRunLock(runId);
    if (!locked) return { ok: true, busy: true, dispatched: 0, active: true };
    return await tickRunInner(runId, opts);
  } finally {
    if (locked) await releaseRunLock(runId);
    ticking.delete(runId);
  }
}

async function tickRunInner(
  runId: string,
  opts: { actorId?: number }
): Promise<TickResult> {
  let run = await loadRun(runId);
  if (!run) return { ok: false, dispatched: 0, active: false };

  await adoptLegacyQueueState(run);
  await reconcileStaleCaseLeases(runId);
  await advanceMonitorsForRun(runId).catch(() => {});

  run = (await loadRun(runId)) as NonNullable<RunRow>;
  const config = readConfig(run.run_context);
  const stopped = Boolean(run.stop_requested_at) || run.status === 'ABORTED';

  // A persisted stop request immediately disqualifies not-yet-started cases.
  if (stopped) {
    await cancelCases(
      runId,
      run.status === 'ABORTED'
        ? 'Cancelled — run was aborted before this case started'
        : 'Cancelled — run was stopped before this case started'
    );
    await detachInFlightProviderExecutions(
      runId,
      'Cancelled — run was stopped; the Datadog test was not cancelled at Datadog'
    );
    run = (await loadRun(runId)) as NonNullable<RunRow>;
  }

  let latest = latestAttempts(run.results);
  const latestIds = new Set(latest.map((row) => row.id));

  // Stop-on-first-failure applies to the current generation only.
  if (config.stopOnFirstFailure) {
    const failed = latest.some(
      (row) => String(row.status).toUpperCase() === 'FAIL' && latestIds.has(row.id)
    );
    if (failed && !stopped) {
      await cancelCases(runId, 'Cancelled — run stopped on first failure');
      await detachInFlightProviderExecutions(
        runId,
        'Cancelled — run stopped on first failure; the Datadog test was not cancelled at Datadog'
      );
      run = (await loadRun(runId)) as NonNullable<RunRow>;
      latest = latestAttempts(run.results);
      await reconcileRunState(runId).catch(() => {});
      return {
        ok: true,
        dispatched: 0,
        active: false,
        lifecycle: deriveRunLifecycle(run, latest),
      };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Execution lanes                                                    */
  /* ------------------------------------------------------------------ */
  // One session, two lanes:
  //   Postman lane — always sequential, in list order, gated by the
  //                  "delay between cases" setting.
  //   Datadog lane — up to N tests in flight (default 3); the next one starts
  //                  as each finishes. A Datadog test waiting for its provider
  //                  never blocks the Postman lane.
  const datadogConfig = config.datadog || {};
  const datadogMode = datadogConfig.mode === 'sequential' ? 'sequential' : 'together';
  const datadogLimit =
    datadogMode === 'sequential' ? 1 : clampDatadogConcurrency(datadogConfig.concurrency);
  const postmanDelayActive = Boolean(
    run.next_dispatch_at && run.next_dispatch_at.getTime() > Date.now()
  );

  const isInFlight = (row: ResultRow) =>
    row.status === 'PENDING' &&
    ([EXECUTION_STATE.RUNNING, EXECUTION_STATE.WAITING] as string[]).includes(
      row.execution_state as string
    );

  // Resolve the lane of any in-flight case that predates the persisted
  // provider column, so lane occupancy is always accurate.
  const inFlight = latest.filter(isInFlight);
  const unresolved = inFlight.filter((row) => !row.provider);
  if (unresolved.length > 0) {
    const resolved = await classifyProviders(unresolved.map((row) => row.test_case_id));
    for (const row of unresolved) {
      const provider = resolved.get(row.test_case_id) || null;
      if (!provider) continue;
      await prisma.runResult
        .update({ where: { id: row.id }, data: { provider } })
        .catch(() => {});
      row.provider = provider;
    }
  }

  const datadogInFlight = inFlight.filter((row) => row.provider === 'datadog').length;
  const postmanInFlight = inFlight.filter((row) => row.provider === 'postman').length;

  if (stopped) {
    await reconcileRunState(runId).catch(() => {});
    const after = (await loadRun(runId)) as NonNullable<RunRow>;
    return {
      ok: true,
      dispatched: 0,
      active: false,
      lifecycle: deriveRunLifecycle(after, latestAttempts(after.results)),
    };
  }

  const queued = latest.filter(
    (row) => row.status === 'PENDING' && row.execution_state === EXECUTION_STATE.QUEUED
  );
  if (queued.length === 0) {
    await reconcileRunState(runId).catch(() => {});
    const after = (await loadRun(runId)) as NonNullable<RunRow>;
    return {
      ok: true,
      dispatched: 0,
      active: inFlight.length > 0,
      lifecycle: deriveRunLifecycle(after, latestAttempts(after.results)),
    };
  }

  // Persist the lane of every queued case once, so later ticks classify
  // without an extra join.
  const providerMap = await classifyProviders(queued.map((row) => row.test_case_id));
  for (const row of queued) {
    if (row.provider) continue;
    const provider = providerMap.get(row.test_case_id) || null;
    if (!provider) continue;
    await prisma.runResult
      .update({ where: { id: row.id }, data: { provider } })
      .catch(() => {});
    row.provider = provider;
  }

  const budgetStart = Date.now();
  let dispatched = 0;

  const claimNext = async (
    current: NonNullable<RunRow>,
    lane: Provider | null
  ): Promise<ResultRow | null> => {
    const currentLatest = latestAttempts(current.results);
    const next = currentLatest.find((row) => {
      if (row.status !== 'PENDING') return false;
      if (row.execution_state !== EXECUTION_STATE.QUEUED) return false;
      const rowProvider = row.provider || providerMap.get(row.test_case_id) || null;
      return rowProvider === lane;
    });
    if (!next) return null;

    const now = new Date();
    const claim = await prisma.runResult.updateMany({
      where: {
        id: next.id,
        run_id: runId,
        status: 'PENDING',
        execution_state: EXECUTION_STATE.QUEUED,
        execution_generation: current.execution_generation,
        OR: [{ lease_expires_at: null }, { lease_expires_at: { lt: now } }],
      },
      data: {
        execution_state: EXECUTION_STATE.RUNNING,
        lease_owner: WORKER_ID,
        lease_expires_at: new Date(now.getTime() + CASE_LEASE_TTL_MS),
        started_at: now,
        provider: lane,
      },
    });
    if (claim.count === 0) return null; // claimed by another worker

    publishExecutionEvent(runId, {
      type: 'CASE',
      resultId: next.id,
      attemptNumber: next.attempt_number,
      executionState: EXECUTION_STATE.RUNNING,
    });
    return next;
  };

  /* --- Datadog lane: starts first, up to N tests in flight ---------- */
  let datadogSlots = datadogLimit - datadogInFlight;
  if (datadogSlots > 0) {
    const batch: Array<{ runSnapshot: NonNullable<RunRow>; row: ResultRow }> = [];
    for (let i = 0; i < datadogSlots; i++) {
      const current = (await loadRun(runId)) as NonNullable<RunRow>;
      const next = await claimNext(current, 'datadog');
      if (!next) break;
      batch.push({ runSnapshot: current, row: next });
      if (Date.now() - budgetStart > TICK_BUDGET_MS) break;
    }
    if (batch.length > 0) {
      // Each Datadog dispatch only *starts* the test; the provider result
      // arrives later through the durable monitor.
      const outcomes = await Promise.all(
        batch.map(({ runSnapshot, row }) =>
          dispatchClaimedResult(runSnapshot, row, opts.actorId || runSnapshot.created_by)
        )
      );
      dispatched += outcomes.length;
    }
  }

  /* --- Postman lane: strictly sequential, delayed between cases ----- */
  if (postmanInFlight === 0 && !postmanDelayActive) {
    const current = (await loadRun(runId)) as NonNullable<RunRow>;
    const next = await claimNext(current, 'postman');
    if (next) {
      await dispatchClaimedResult(current, next, opts.actorId || current.created_by);
      dispatched += 1;

      // "Delay between cases" applies to the Postman lane only.
      const delayMs = Math.max(0, Number(config.interTestDelayMs) || 0);
      if (delayMs > 0) {
        await prisma.testRun
          .update({
            where: { id: runId },
            data: { next_dispatch_at: new Date(Date.now() + delayMs) },
          })
          .catch(() => {});
      }
    }
  }

  /* --- Cases without an in-app runner: claimed so they settle ----- */
  // They are never dispatched to a provider; the dispatch settles them as
  // SKIP with the reason, exactly as before the lanes existed.
  const unclassified = queued.filter((row) => !row.provider);
  if (unclassified.length > 0) {
    const current = (await loadRun(runId)) as NonNullable<RunRow>;
    const next = await claimNext(current, null);
    if (next) {
      await dispatchClaimedResult(current, next, opts.actorId || current.created_by);
      dispatched += 1;
    }
  }

  run = (await loadRun(runId)) as NonNullable<RunRow>;
  latest = latestAttempts(run.results);
  const active = latest.some(
    (row) =>
      row.status === 'PENDING' &&
      ([EXECUTION_STATE.RUNNING, EXECUTION_STATE.WAITING] as string[]).includes(
        row.execution_state as string
      )
  );
  const monitors = await getActiveMonitorsForRun(runId).catch(() => []);
  if (!active && monitors.length === 0) {
    await reconcileRunState(runId).catch(() => {});
    const after = (await loadRun(runId)) as NonNullable<RunRow>;
    return {
      ok: true,
      dispatched,
      active: false,
      lifecycle: deriveRunLifecycle(after, latestAttempts(after.results)),
    };
  }

  const refreshed = (await loadRun(runId)) as NonNullable<RunRow>;
  return {
    ok: true,
    dispatched,
    active: true,
    lifecycle: deriveRunLifecycle(refreshed, latestAttempts(refreshed.results)),
  };
}

/* ------------------------------------------------------------------ */
/* Stop / skip / abort                                               */
/* ------------------------------------------------------------------ */

export async function stopRun(input: {
  runId: string;
  actorId: number;
  abort?: boolean;
  reason?: string;
}): Promise<{ ok: true; skipped: number }> {
  const { runId, actorId } = input;
  await requireProjectMemberByRunId(runId, actorId);
  const run = await prisma.testRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, name: true, project_id: true },
  });
  if (!run) throw new Error('Run not found');
  if (run.status === 'COMPLETED' || run.status === 'FAILED') {
    throw new Error('This run is already complete and cannot be stopped.');
  }

  const abort = Boolean(input.abort);
  await prisma.testRun.update({
    where: { id: runId },
    data: {
      stop_requested_at: new Date(),
      ...(abort ? { status: 'ABORTED' as const, completed_at: new Date() } : {}),
    },
  });

  const reason =
    input.reason ||
    (abort
      ? 'Cancelled — run was aborted before this case started'
      : 'Cancelled — run was stopped before this case started');
  const skipped = await cancelCases(runId, reason);
  const detached = await detachInFlightProviderExecutions(
    runId,
    'Cancelled — run was stopped; the Datadog test was not cancelled at Datadog'
  );

  publishExecutionEvent(runId, {
    type: 'RUN',
    status: abort ? 'aborted' : 'stopping',
  });

  // Do NOT finalize active monitors here: a provider result may still arrive.
  // The scheduler keeps reconciling them until the provider or the deadline
  // settles the case.
  if (!abort) {
    await tickRun(runId, { actorId }).catch(() => {});
  }

  logger.info('Execution stop requested', { runId, abort, skipped, detached });
  return { ok: true, skipped };
}

export async function skipRemainingCases(input: {
  runId: string;
  actorId: number;
}): Promise<{ ok: true; skipped: number }> {
  await requireProjectMemberByRunId(input.runId, input.actorId);
  const skipped = await skipCases(
    input.runId,
    'Skipped — skipped by a user before this case started'
  );
  publishExecutionEvent(input.runId, { type: 'RUN', status: 'skipped-remaining' });
  await tickRun(input.runId, { actorId: input.actorId }).catch(() => {});
  return { ok: true, skipped };
}

/* ------------------------------------------------------------------ */
/* Single-case execution from the Execution Console                   */
/* ------------------------------------------------------------------ */

export interface ExecuteRunCaseInput {
  runId: string;
  resultId: string;
  actorId: number;
  overrides?: RunCaseOverrides;
}

export async function executeRunCase(input: ExecuteRunCaseInput): Promise<{
  resultId: string;
  createdAttempt: boolean;
  overallStatus?: string;
  summary?: string;
  stepResults?: Record<string, any>;
  automationLog?: string;
  pending?: boolean;
}> {
  const { runId, resultId, actorId } = input;
  await requireProjectMemberByRunId(runId, actorId);

  // Serialize explicit console executions with the durable scheduler so two
  // paths can never dispatch the same case (or two cases) at once.
  const locked = await acquireRunLock(runId);
  if (!locked) {
    throw new Error('The run scheduler is busy finishing a case. Try again in a moment.');
  }

  let claimedTarget: ResultRow | null = null;
  let createdAttempt = false;
  let outcome: Awaited<ReturnType<typeof dispatchClaimedResult>>;

  try {
    let run = await loadRun(runId);
    if (!run) throw new Error('Run not found');
    if (run.status === 'ABORTED') throw new Error('Cannot execute a case in an aborted run');

    let target = run.results.find((row) => row.id === resultId);
    if (!target || target.run_id !== runId) throw new Error('Run result not found');

    // A newer attempt exists: never execute a historical row.
    if (
      run.results.some(
        (row) =>
          row.test_case_id === target!.test_case_id &&
          row.attempt_number > target!.attempt_number
      )
    ) {
      throw new Error('This attempt is historical. Open the latest attempt to execute it.');
    }

    const state = String(target.execution_state || '').toUpperCase();
    if (target.status === 'PENDING' && state === EXECUTION_STATE.QUEUED) {
      throw new Error('This case is already queued. Run Deck owns the queue.');
    }
    if (
      target.status === 'PENDING' &&
      (state === EXECUTION_STATE.RUNNING || state === EXECUTION_STATE.WAITING)
    ) {
      throw new Error('This case is already running. View the live execution instead.');
    }

    const latest = latestAttempts(run.results);
    const otherActive = latest.some(
      (row) =>
        row.id !== target!.id &&
        row.status === 'PENDING' &&
        (
          [EXECUTION_STATE.RUNNING, EXECUTION_STATE.WAITING, EXECUTION_STATE.QUEUED] as string[]
        ).includes(row.execution_state as string)
    );
    if (otherActive) {
      throw new Error(
        'Another case in this run is queued or running. Wait for it to finish, or use the Run Deck queue.'
      );
    }

    if (isTerminalResultStatus(target.status)) {
      const created = await createRetryAttempts({
        runId,
        resultIds: [target.id],
        mode: 'rerun-all',
      });
      if (created.createdIds.length === 0) {
        throw new Error('Could not create a new attempt for this case.');
      }
      createdAttempt = true;
      run = (await loadRun(runId)) as NonNullable<RunRow>;
      target = run.results.find((row) => row.id === created.createdIds[0])!;
    }

    // Claim directly from IDLE; this execution is explicit and does not wait in
    // the run queue, but it still uses the same lease/attempt machinery.
    const now = new Date();
    const claim = await prisma.runResult.updateMany({
      where: {
        id: target.id,
        run_id: runId,
        status: 'PENDING',
        execution_state: EXECUTION_STATE.IDLE,
      },
      data: {
        execution_state: EXECUTION_STATE.RUNNING,
        lease_owner: WORKER_ID,
        lease_expires_at: new Date(now.getTime() + CASE_LEASE_TTL_MS),
        started_at: now,
        queued_at: now,
        execution_generation: run.execution_generation,
      },
    });
    if (claim.count === 0) {
      throw new Error('This case was just claimed by the scheduler. Refresh to view it.');
    }

    await prisma.testRun.update({
      where: { id: runId },
      data: {
        status: 'IN_PROGRESS',
        started_at: run.started_at || now,
        completed_at: null,
      },
    });

    publishExecutionEvent(runId, {
      type: 'CASE',
      resultId: target.id,
      attemptNumber: target.attempt_number,
      executionState: EXECUTION_STATE.RUNNING,
    });

    // The claim may have moved the row to the current generation; the executor
    // fences on the value that is now persisted.
    claimedTarget = { ...target, execution_generation: run.execution_generation };
    outcome = await dispatchClaimedResult(run, claimedTarget, actorId, input.overrides);
  } finally {
    await releaseRunLock(runId);
  }

  await tickRun(runId, { actorId }).catch(() => {});

  return {
    resultId: claimedTarget?.id || resultId,
    createdAttempt,
    overallStatus: outcome.payload?.overallStatus,
    summary: outcome.payload?.summary,
    stepResults: outcome.payload?.stepResults,
    automationLog: outcome.payload?.automationLog,
    pending: outcome.pending,
  };
}

/* ------------------------------------------------------------------ */
/* Durable scheduler + recovery                                       */
/* ------------------------------------------------------------------ */

export async function tickActiveRuns(limit = 5): Promise<{ ticked: number }> {
  const due = await prisma.runResult.findMany({
    where: {
      status: 'PENDING',
      OR: [
        { execution_state: { in: [EXECUTION_STATE.QUEUED, EXECUTION_STATE.WAITING] } },
        {
          execution_state: EXECUTION_STATE.RUNNING,
          lease_expires_at: { lt: new Date() },
        },
      ],
    },
    distinct: ['run_id'],
    select: { run_id: true },
    take: limit,
  });

  let ticked = 0;
  for (const row of due) {
    try {
      const result = await tickRun(row.run_id);
      if (!result.busy) ticked += 1;
    } catch (e: any) {
      logger.warn('Execution scheduler tick failed', { runId: row.run_id, error: e?.message });
    }
  }
  return { ticked };
}

/** Called once at backend start; also safe to call repeatedly. */
export async function recoverInterruptedRuns(limit = 10): Promise<{ recovered: number }> {
  const stale = await prisma.runResult.findMany({
    where: {
      status: 'PENDING',
      OR: [
        {
          execution_state: EXECUTION_STATE.RUNNING,
          lease_expires_at: { lt: new Date() },
        },
        { execution_state: EXECUTION_STATE.WAITING },
      ],
    },
    distinct: ['run_id'],
    select: { run_id: true },
    take: limit,
  });

  let recovered = 0;
  for (const row of stale) {
    try {
      await tickRun(row.run_id);
      recovered += 1;
    } catch (e: any) {
      logger.warn('Interrupted run recovery failed', { runId: row.run_id, error: e?.message });
    }
  }
  return { recovered };
}

export { computeQueuePositions };
