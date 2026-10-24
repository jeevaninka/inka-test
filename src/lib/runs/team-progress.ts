/**
 * Team progress roll-up for a single run.
 *
 * Derived from the run results the run page already loads (the `/results`
 * endpoint carries `assignedTo` per case), so this adds no tables and no extra
 * request. Callers pass manual results only — automated cases have no human
 * owner to track. Everyone who can open the run sees the same rows because the
 * source query is already permission-guarded.
 *
 * Only leaf executable cases are counted: when a case resolves a dataset, each
 * iteration row is a leaf and the parent case row is a container, not a case.
 */

export type TeamProgressBucket = 'passed' | 'failed' | 'blocked' | 'pending';

export interface TeamProgressRow {
  /** Assignee user id as a string, or `unassigned`. */
  id: string;
  name: string;
  /** Kept for the "email under name" tooltip in the overview drawer. */
  email: string | null;
  avatarUrl: string | null;
  total: number;
  passed: number;
  failed: number;
  blocked: number;
  /** Everything not executed: not run, queued, running, skipped, cancelled. */
  pending: number;
  /** Executed = passed + failed + blocked. */
  executed: number;
  /** Most recent leaf `executedAt` for this assignee (ISO string). */
  lastActivity: string | null;
  /** Total time spent on this assignee's leaf cases, in seconds. */
  executedSeconds: number;
  /** Raw status counts for the bar tooltip. */
  counts: Record<string, number>;
}

export interface TeamProgressAssignee {
  id: string;
  name: string;
  email?: string | null;
  avatarUrl?: string | null;
}

/**
 * One executable case: a whole run-result row, or one iteration child of it.
 * `resultId` + `iterationIndex` identify the row the assign actions target.
 */
export interface TeamProgressLeaf {
  resultId: string;
  /** Iteration number for dataset children, `null` for a plain case row. */
  iterationIndex: number | null;
  assignedTo: string | null;
  status: string | null;
  caseState: string | null;
  executedAt: string | null;
  timeSpentSeconds: number;
  /** Parent result's assignee, for identifying the fallback identity below. */
  parentAssigneeId: string | null;
  /** Parent result's joined name/avatar, used when the id cannot be resolved. */
  parentName: string | null;
  parentAvatar: string | null;
}

/** One iteration child as stored on `RunResult.iteration_results`. */
export interface TeamProgressIteration {
  iteration_index?: number | null;
  iterationIndex?: number | null;
  assigned_to?: number | string | null;
  assignedTo?: number | string | null;
  status?: string | null;
  caseState?: string | null;
  execution_state?: string | null;
  executed_at?: string | null;
  executedAt?: string | null;
  time_spent_seconds?: number | null;
  timeSpentSeconds?: number | null;
}

/** Minimal shape of a run result used for the roll-up. */
export interface TeamProgressResult {
  id: string;
  status?: string | null;
  caseState?: string | null;
  executionState?: string | null;
  execution_state?: string | null;
  executedAt?: string | null;
  executed_at?: string | null;
  timeSpentSeconds?: number | null;
  totalTimeSpentSeconds?: number | null;
  assignedTo?: number | string | null;
  assignedToName?: string | null;
  assignedToAvatar?: string | null;
  iterationResults?: TeamProgressIteration[] | null;
  iteration_results?: TeamProgressIteration[] | null;
}

/** Tooltip order: the four buckets first, then their raw statuses. */
export const TEAM_PROGRESS_STATUS_ORDER = [
  'pass',
  'fail',
  'blocked',
  'error',
  'invalid',
  'unavailable',
  'skip',
  'cancelled',
  'running',
  'queued',
  'not_run',
] as const;

const BLOCKED_STATUSES = new Set(['blocked', 'error', 'invalid', 'unavailable']);

function readStatusKey(input: {
  status?: string | null;
  caseState?: string | null;
  executionState?: string | null;
  execution_state?: string | null;
}): string {
  const status = String(input?.status || '').toLowerCase();
  if (!status || status === 'pending') {
    const state = String(
      input?.caseState || input?.executionState || input?.execution_state || ''
    ).toUpperCase();
    if (state === 'RUNNING' || state === 'WAITING') return 'running';
    if (state === 'QUEUED') return 'queued';
    return 'not_run';
  }
  return status;
}

export function statusKeyForResult(result: {
  status?: string | null;
  caseState?: string | null;
  executionState?: string | null;
  execution_state?: string | null;
}): string {
  return readStatusKey(result);
}

export function bucketForStatusKey(statusKey: string): TeamProgressBucket {
  if (statusKey === 'pass') return 'passed';
  if (statusKey === 'fail') return 'failed';
  if (BLOCKED_STATUSES.has(statusKey)) return 'blocked';
  // Pending is everything not executed, so Passed + Failed + Blocked +
  // Pending always adds up to Total (skip/cancelled included).
  return 'pending';
}

function readTimestamp(value?: string | null): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Flatten run results into executable leaves.
 *
 * A result that carries iteration children contributes one leaf per iteration
 * (parent excluded). Any other result is a single leaf. Iteration assignees win
 * over the parent assignee, as in the case table.
 */
export function flattenTeamLeaves(results: TeamProgressResult[]): TeamProgressLeaf[] {
  const leaves: TeamProgressLeaf[] = [];

  for (const result of results || []) {
    const parentAssigneeId =
      result.assignedTo != null ? String(result.assignedTo) : null;
    const parentName = result.assignedToName ?? null;
    const parentAvatar = result.assignedToAvatar ?? null;
    const iterations = result.iterationResults ?? result.iteration_results;

    if (Array.isArray(iterations) && iterations.length > 0) {
      for (const iteration of iterations) {
        const index = Number(iteration?.iteration_index ?? iteration?.iterationIndex ?? 0);
        leaves.push({
          resultId: result.id,
          iterationIndex: Number.isFinite(index) && index > 0 ? index : null,
          assignedTo:
            iteration?.assigned_to != null
              ? String(iteration.assigned_to)
              : result.assignedTo != null
                ? String(result.assignedTo)
                : null,
          status: iteration?.status ?? 'pending',
          caseState: iteration?.caseState ?? iteration?.execution_state ?? null,
          executedAt: iteration?.executed_at ?? iteration?.executedAt ?? null,
          timeSpentSeconds:
            Number(iteration?.time_spent_seconds ?? iteration?.timeSpentSeconds ?? 0) || 0,
          parentAssigneeId,
          parentName,
          parentAvatar,
        });
      }
      continue;
    }

    leaves.push({
      resultId: result.id,
      iterationIndex: null,
      assignedTo: result.assignedTo != null ? String(result.assignedTo) : null,
      status: result.status ?? 'pending',
      caseState: result.caseState ?? result.executionState ?? result.execution_state ?? null,
      executedAt: result.executedAt ?? result.executed_at ?? null,
      timeSpentSeconds:
        Number(result.totalTimeSpentSeconds ?? result.timeSpentSeconds ?? 0) || 0,
      parentAssigneeId,
      parentName,
      parentAvatar,
    });
  }

  return leaves;
}

/**
 * Group leaf cases by assignee.
 *
 * Rows are ordered by pending cases descending — never by cases completed —
 * with the Unassigned row always last.
 */
export function buildTeamProgress(
  results: TeamProgressResult[],
  resolveAssignee?: (leaf: TeamProgressLeaf) => TeamProgressAssignee | null
): TeamProgressRow[] {
  const rows = new Map<string, TeamProgressRow>();

  for (const leaf of flattenTeamLeaves(results)) {
    const isUnassigned = leaf.assignedTo == null;
    const resolved = isUnassigned ? null : resolveAssignee?.(leaf) ?? null;
    const id = isUnassigned ? 'unassigned' : String(resolved?.id ?? leaf.assignedTo);
    // The parent's joined identity is only a fallback for the parent's own
    // assignee; an iteration owned by someone else must not borrow it.
    const fromParent = leaf.assignedTo === leaf.parentAssigneeId;
    const name = isUnassigned
      ? 'Unassigned'
      : resolved?.name ||
        (fromParent ? leaf.parentName : null) ||
        (leaf.assignedTo ? `User #${leaf.assignedTo}` : 'Unassigned');
    const avatarUrl = isUnassigned
      ? null
      : resolved?.avatarUrl ?? (fromParent ? leaf.parentAvatar : null) ?? null;
    const email = isUnassigned ? null : resolved?.email ?? null;

    let row = rows.get(id);
    if (!row) {
      row = {
        id,
        name,
        email,
        avatarUrl,
        total: 0,
        passed: 0,
        failed: 0,
        blocked: 0,
        pending: 0,
        executed: 0,
        lastActivity: null,
        executedSeconds: 0,
        counts: {},
      };
      rows.set(id, row);
    }

    // The resolved identity wins (it is the freshest name/avatar); fill gaps
    // when the first leaf for this person had no joined user row.
    if (!isUnassigned) {
      if (resolved?.name) row.name = resolved.name;
      if (resolved?.email) row.email = resolved.email;
      if (resolved?.avatarUrl) row.avatarUrl = resolved.avatarUrl;
    }

    const statusKey = readStatusKey(leaf);
    const bucket = bucketForStatusKey(statusKey);

    row.total += 1;
    row.counts[statusKey] = (row.counts[statusKey] || 0) + 1;
    if (bucket === 'passed') row.passed += 1;
    else if (bucket === 'failed') row.failed += 1;
    else if (bucket === 'blocked') row.blocked += 1;
    else row.pending += 1;

    const executedAt = readTimestamp(leaf.executedAt);
    if (executedAt > 0) {
      const previous = readTimestamp(row.lastActivity);
      if (executedAt > previous) row.lastActivity = new Date(executedAt).toISOString();
    }

    if (leaf.timeSpentSeconds > 0) row.executedSeconds += leaf.timeSpentSeconds;
  }

  for (const row of rows.values()) row.executed = row.passed + row.failed + row.blocked;

  return [...rows.values()].sort((a, b) => {
    if (a.id === 'unassigned') return 1;
    if (b.id === 'unassigned') return -1;
    if (b.pending !== a.pending) return b.pending - a.pending;
    return a.name.localeCompare(b.name);
  });
}

/** Assign leaves to members round-robin, in list order, for preview + submit. */
export function distributeEvenly<T>(
  items: T[],
  memberIds: string[]
): Array<{ memberId: string; items: T[] }> {
  if (memberIds.length === 0) return [];
  const buckets = memberIds.map((memberId) => ({ memberId, items: [] as T[] }));
  items.forEach((item, index) => {
    buckets[index % memberIds.length].items.push(item);
  });
  return buckets;
}
