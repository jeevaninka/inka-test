/**
 * Persisted view filters for a single test run.
 *
 * The run deck (list view) and the execution console (case view) share this
 * state so a tester who narrows to "Manual · Assigned to me" keeps that view
 * while moving between the two surfaces, across refreshes, until they clear it.
 */

export type RunCaseTypeFilter = 'all' | 'manual' | 'automated';

export type RunGroupBy = 'flat' | 'module' | 'suite' | 'status' | 'priority' | 'assignee';

export interface RunViewFilters {
  /** Manual / automated / all cases. */
  caseType: RunCaseTypeFilter;
  /** Only cases assigned to the signed-in user. */
  assignedToMe: boolean;
  /** Legacy single assignee user id ('' = anyone). */
  assignee: string;
  /** Legacy single priority key P0…P3 ('' = any). */
  priority: string;
  /** Legacy single result status key ('' = any). */
  status: string;
  /** Multi-select assignees: user ids plus the `unassigned` sentinel. */
  assignees: string[];
  /** Multi-select priority keys, e.g. ['P0', 'P2']. */
  priorities: string[];
  /** Multi-select result status keys, e.g. ['fail', 'pending']. */
  statuses: string[];
  /** Grouping mode for the case list. */
  groupBy: RunGroupBy;
}

export const RUN_GROUP_OPTIONS: { value: RunGroupBy; label: string }[] = [
  { value: 'flat', label: 'Flat' },
  { value: 'module', label: 'Module' },
  { value: 'suite', label: 'Suite' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
];

export const RUN_PRIORITY_OPTIONS = [
  { value: '', label: 'Any priority' },
  { value: 'P0', label: 'P0' },
  { value: 'P1', label: 'P1' },
  { value: 'P2', label: 'P2' },
  { value: 'P3', label: 'P3' },
];

export function defaultRunViewFilters(groupBy: RunGroupBy = 'flat'): RunViewFilters {
  return {
    caseType: 'all',
    assignedToMe: false,
    assignee: '',
    priority: '',
    status: '',
    assignees: [],
    priorities: [],
    statuses: [],
    groupBy,
  };
}

function storageKey(runId: string): string {
  return `inka_run_view_${runId}`;
}

const CASE_TYPES: RunCaseTypeFilter[] = ['all', 'manual', 'automated'];
const GROUP_BY: RunGroupBy[] = ['flat', 'module', 'suite', 'status', 'priority', 'assignee'];

/** Read a persisted multi-select, falling back to the legacy single value. */
function readSelection(value: unknown, legacy: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  if (typeof legacy === 'string' && legacy.length > 0) return [legacy];
  return [];
}

export function loadRunViewFilters(
  runId: string,
  fallbackGroupBy: RunGroupBy = 'flat'
): RunViewFilters {
  const defaults = defaultRunViewFilters(fallbackGroupBy);
  if (typeof window === 'undefined') return defaults;

  try {
    const raw = window.sessionStorage.getItem(storageKey(runId));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<RunViewFilters>;
    return {
      caseType: CASE_TYPES.includes(parsed.caseType as RunCaseTypeFilter)
        ? (parsed.caseType as RunCaseTypeFilter)
        : defaults.caseType,
      assignedToMe: Boolean(parsed.assignedToMe),
      assignee: typeof parsed.assignee === 'string' ? parsed.assignee : '',
      priority: typeof parsed.priority === 'string' ? parsed.priority : '',
      status: typeof parsed.status === 'string' ? parsed.status : '',
      assignees: readSelection(parsed.assignees, parsed.assignee),
      priorities: readSelection(parsed.priorities, parsed.priority),
      statuses: readSelection(parsed.statuses, parsed.status),
      groupBy: GROUP_BY.includes(parsed.groupBy as RunGroupBy)
        ? (parsed.groupBy as RunGroupBy)
        : defaults.groupBy,
    };
  } catch {
    return defaults;
  }
}

export function saveRunViewFilters(runId: string, filters: RunViewFilters): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(storageKey(runId), JSON.stringify(filters));
  } catch {
    // Storage can be unavailable (private mode, quota); filtering still works.
  }
}

/** Merge a partial change into the stored filters without dropping other fields. */
export function patchRunViewFilters(
  runId: string,
  patch: Partial<RunViewFilters>,
  fallbackGroupBy: RunGroupBy = 'flat'
): RunViewFilters {
  const next = { ...loadRunViewFilters(runId, fallbackGroupBy), ...patch };
  saveRunViewFilters(runId, next);
  return next;
}
