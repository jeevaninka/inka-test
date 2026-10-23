/**
 * Canonical execution-state vocabulary shared by the coordinator, the durable
 * scheduler, the monitor finalizer and the read models used by the UI.
 *
 * `RunResult.status` is the canonical *outcome* (PENDING/PASS/FAIL/...).
 * `RunResult.execution_state` is the canonical *queue/lease* state. The old
 * `run_context.caseStates` map is legacy and only read for migration.
 */

export const EXECUTION_STATE = {
  IDLE: 'IDLE',
  QUEUED: 'QUEUED',
  RUNNING: 'RUNNING',
  /** Provider accepted the execution and the durable monitor owns it. */
  WAITING: 'WAITING',
  /** A terminal outcome has been persisted. */
  SETTLED: 'SETTLED',
} as const;

export type ExecutionState = (typeof EXECUTION_STATE)[keyof typeof EXECUTION_STATE];

/** Outcome statuses that no longer need scheduling. */
export const TERMINAL_RESULT_STATUSES = [
  'PASS',
  'FAIL',
  'ERROR',
  'BLOCKED',
  'SKIP',
  'INVALID',
  'UNAVAILABLE',
  'CANCELLED',
] as const;

export type TerminalResultStatus = (typeof TERMINAL_RESULT_STATUSES)[number];

/** Statuses considered "failed" for rerun-failed semantics. */
export const FAILED_RESULT_STATUSES = ['FAIL', 'ERROR', 'BLOCKED', 'INVALID', 'UNAVAILABLE'] as const;

export function isTerminalResultStatus(status: unknown): boolean {
  return TERMINAL_RESULT_STATUSES.includes(
    String(status || '').toUpperCase() as TerminalResultStatus
  );
}

export function isFailedResultStatus(status: unknown): boolean {
  return FAILED_RESULT_STATUSES.includes(
    String(status || '').toUpperCase() as (typeof FAILED_RESULT_STATUSES)[number]
  );
}

export function normalizeExecutionState(value: unknown): ExecutionState {
  const raw = String(value || '').toUpperCase();
  if (raw === 'QUEUED') return EXECUTION_STATE.QUEUED;
  if (raw === 'RUNNING') return EXECUTION_STATE.RUNNING;
  if (raw === 'WAITING') return EXECUTION_STATE.WAITING;
  if (raw === 'SETTLED') return EXECUTION_STATE.SETTLED;
  return EXECUTION_STATE.IDLE;
}

/** One latest attempt per test case; older attempts are immutable history. */
export function latestAttempts<T extends { test_case_id: string; attempt_number: number }>(
  results: T[]
): T[] {
  const byCase = new Map<string, T>();
  for (const row of results) {
    const current = byCase.get(row.test_case_id);
    if (!current || (row.attempt_number || 1) > (current.attempt_number || 1)) {
      byCase.set(row.test_case_id, row);
    }
  }
  return Array.from(byCase.values()).sort((a, b) => {
    const orderA = (a as { order_index?: number }).order_index ?? 0;
    const orderB = (b as { order_index?: number }).order_index ?? 0;
    if (orderA !== orderB) return orderA - orderB;
    return String((a as { id?: string }).id).localeCompare(String((b as { id?: string }).id));
  });
}

export type RunLifecycle =
  | 'READY'
  | 'QUEUED'
  | 'RUNNING'
  | 'STOPPING'
  | 'COMPLETED'
  | 'FAILED'
  | 'ABORTED';

/**
 * Presentation-level lifecycle. The persisted `TestRun.status` enum is not
 * extended; STOPPING/QUEUED/READY are derived from persisted case state and the
 * stop request so there is still exactly one stored queue representation.
 */
export function deriveRunLifecycle(
  run: { status?: string | null; stop_requested_at?: Date | string | null },
  latest: Array<{ status: string; execution_state?: string | null }>
): RunLifecycle {
  const persisted = String(run.status || '').toUpperCase();
  if (persisted === 'ABORTED') return 'ABORTED';

  const hasActive = latest.some((r) =>
    ['RUNNING', 'WAITING'].includes(String(r.execution_state || '').toUpperCase())
  );
  const hasQueued = latest.some(
    (r) =>
      String(r.execution_state || '').toUpperCase() === 'QUEUED' &&
      String(r.status || '').toUpperCase() === 'PENDING'
  );
  const hasPending = latest.some((r) => String(r.status || '').toUpperCase() === 'PENDING');

  if (run.stop_requested_at && (hasActive || hasQueued)) return 'STOPPING';
  if (hasActive) return 'RUNNING';
  if (hasQueued) return 'QUEUED';
  if (persisted === 'COMPLETED') return 'COMPLETED';
  if (persisted === 'FAILED') return 'FAILED';
  if (hasPending) return 'READY';
  return persisted === 'IN_PROGRESS' ? 'READY' : 'READY';
}

/** Queue position (1-based) for queued cases in dispatch order. */
export function computeQueuePositions(
  latest: Array<{ id: string; status: string; execution_state?: string | null; order_index?: number }>
): Record<string, number> {
  const queued = latest
    .filter(
      (r) =>
        String(r.execution_state || '').toUpperCase() === 'QUEUED' &&
        String(r.status || '').toUpperCase() === 'PENDING'
    )
    .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  const positions: Record<string, number> = {};
  queued.forEach((row, index) => {
    positions[row.id] = index + 1;
  });
  return positions;
}
