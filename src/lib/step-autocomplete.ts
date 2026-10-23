import type { StepAutocompleteRow } from '@/app/actions/steps';

export interface IndexedActionEntry {
  action: string;
  normAction: string;
  expectedResult: string | null;
  freq: number;
  lastSeenMs: number;
}

export interface IndexedExpectedEntry {
  text: string;
  normText: string;
  freq: number;
  lastSeenMs: number;
}

export interface StepAutocompleteIndex {
  /** 2-char lowercase prefix -> sorted IndexedActionEntry[] */
  actionBuckets: Map<string, IndexedActionEntry[]>;
  /** Full normalized lowercase action -> IndexedActionEntry */
  actionExactMap: Map<string, IndexedActionEntry>;
  /** 2-char lowercase prefix -> sorted IndexedExpectedEntry[] */
  expectedBuckets: Map<string, IndexedExpectedEntry[]>;
}

export interface ActionPrefixMatch {
  entry: IndexedActionEntry;
  ghostSuffix: string;
  completedAction: string;
  isExact: boolean;
}

export interface ExpectedPrefixMatch {
  text: string;
  ghostSuffix: string;
  completedText: string;
}

const MAX_CLIENT_SCAN_CASES = 500;
const MAX_BUCKETS_PER_PREFIX = 100;

// Module-level cache per project so switching between test cases in a huge repo
// never re-fetches or rebuilds from scratch.
const projectRowsCache = new Map<string, StepAutocompleteRow[]>();
const projectIndexCache = new Map<string, StepAutocompleteIndex>();

export function getCachedProjectAutocompleteIndex(projectId: string): StepAutocompleteIndex | null {
  if (!projectId) return null;
  return projectIndexCache.get(projectId) || null;
}

export function setCachedProjectAutocompleteRows(
  projectId: string,
  rows: StepAutocompleteRow[]
): StepAutocompleteIndex {
  projectRowsCache.set(projectId, rows);
  const index = buildStepAutocompleteIndexFromRows(rows);
  projectIndexCache.set(projectId, index);
  return index;
}

export function recordStepsIntoProjectCache(
  projectId: string,
  steps: Array<{ step?: string | null; expected_result?: string | null; expectedResult?: string | null }>
): StepAutocompleteIndex | null {
  if (!projectId) return null;
  const existingRows = projectRowsCache.get(projectId) || [];
  const byNorm = new Map<string, StepAutocompleteRow>();

  for (const r of existingRows) {
    const norm = r.action.trim().toLowerCase();
    if (norm.length >= 2) {
      byNorm.set(norm, { ...r });
    }
  }

  const now = Date.now();
  let changed = false;

  for (const s of steps) {
    const action = (s.step || '').trim();
    if (action.length < 2) continue;
    const norm = action.toLowerCase();
    const exp = (s.expected_result ?? s.expectedResult ?? '').trim() || null;

    const current = byNorm.get(norm);
    if (current) {
      if (exp && current.expectedResult !== exp) {
        current.expectedResult = exp;
        current.lastSeenMs = now;
        changed = true;
      }
    } else {
      byNorm.set(norm, {
        action,
        expectedResult: exp,
        freq: 1,
        lastSeenMs: now,
      });
      changed = true;
    }
  }

  if (!changed && projectIndexCache.has(projectId)) {
    return projectIndexCache.get(projectId)!;
  }

  const nextRows = Array.from(byNorm.values());
  return setCachedProjectAutocompleteRows(projectId, nextRows);
}

/**
 * Extracts aggregated StepAutocompleteRow[] from in-memory cases and library steps.
 * Bounded by MAX_CLIENT_SCAN_CASES so even huge in-memory arrays never block the UI thread.
 */
export function extractAutocompleteRowsFromCases(
  cases: any[] = [],
  librarySteps: any[] = []
): StepAutocompleteRow[] {
  const statsMap = new Map<
    string,
    {
      casingCounts: Map<string, number>;
      expectedCounts: Map<string, { text: string; count: number; lastSeenMs: number }>;
      freq: number;
      lastSeenMs: number;
    }
  >();

  const recordPair = (rawAction: string, rawExpected: string | null | undefined, timestampMs: number) => {
    const action = (rawAction || '').trim();
    if (action.length < 2) return;
    const norm = action.toLowerCase();
    const exp = (rawExpected || '').trim();

    let entry = statsMap.get(norm);
    if (!entry) {
      entry = {
        casingCounts: new Map(),
        expectedCounts: new Map(),
        freq: 0,
        lastSeenMs: timestampMs,
      };
      statsMap.set(norm, entry);
    }

    entry.freq += 1;
    if (timestampMs > entry.lastSeenMs) {
      entry.lastSeenMs = timestampMs;
    }

    entry.casingCounts.set(action, (entry.casingCounts.get(action) || 0) + 1);

    if (exp.length > 0) {
      const normExp = exp.toLowerCase();
      const prevExp = entry.expectedCounts.get(normExp);
      if (prevExp) {
        prevExp.count += 1;
        if (timestampMs >= prevExp.lastSeenMs) {
          prevExp.lastSeenMs = timestampMs;
          prevExp.text = exp;
        }
      } else {
        entry.expectedCounts.set(normExp, {
          text: exp,
          count: 1,
          lastSeenMs: timestampMs,
        });
      }
    }
  };

  const limit = Math.min(cases.length, MAX_CLIENT_SCAN_CASES);
  for (let i = 0; i < limit; i++) {
    const c = cases[i];
    if (!c) continue;
    const rawTs = c.updatedAt || c.updated_at || c.createdAt || c.created_at;
    const ts = rawTs ? new Date(rawTs).getTime() || 0 : 0;
    const steps = Array.isArray(c.steps) ? c.steps : Array.isArray(c.test_case_steps) ? c.test_case_steps : [];
    for (let j = 0; j < steps.length; j++) {
      const s = steps[j];
      if (!s) continue;
      recordPair(s.step, s.expected_result ?? s.expectedResult, ts);
    }
  }

  for (let i = 0; i < librarySteps.length; i++) {
    const rs = librarySteps[i];
    if (!rs) continue;
    const rawTs = rs.updated_at || rs.updatedAt || rs.created_at || rs.createdAt;
    const ts = rawTs ? new Date(rawTs).getTime() || 0 : 0;
    if (Array.isArray(rs.steps) && rs.steps.length > 0) {
      for (const gs of rs.steps) {
        recordPair(gs?.step, gs?.expectedResult ?? gs?.expected_result, ts);
      }
    } else if (rs.step) {
      recordPair(rs.step, rs.expected_result ?? rs.expectedResult, ts);
    }
  }

  const rows: StepAutocompleteRow[] = [];
  for (const [, stat] of statsMap.entries()) {
    let bestAction = '';
    let bestActionCount = -1;
    for (const [casing, count] of stat.casingCounts.entries()) {
      if (count > bestActionCount) {
        bestActionCount = count;
        bestAction = casing;
      }
    }

    let bestExpected: string | null = null;
    let bestExpCount = -1;
    let bestExpTs = -1;
    for (const expStat of stat.expectedCounts.values()) {
      if (
        expStat.count > bestExpCount ||
        (expStat.count === bestExpCount && expStat.lastSeenMs > bestExpTs)
      ) {
        bestExpCount = expStat.count;
        bestExpTs = expStat.lastSeenMs;
        bestExpected = expStat.text;
      }
    }

    rows.push({
      action: bestAction,
      expectedResult: bestExpected,
      freq: stat.freq,
      lastSeenMs: stat.lastSeenMs,
    });
  }

  return rows;
}

/**
 * Merges server-aggregated rows with local in-memory rows.
 */
export function mergeAutocompleteRows(
  primaryRows: StepAutocompleteRow[],
  secondaryRows: StepAutocompleteRow[]
): StepAutocompleteRow[] {
  const byNorm = new Map<string, StepAutocompleteRow>();

  for (const r of primaryRows) {
    const action = (r.action || '').trim();
    if (action.length < 2) continue;
    byNorm.set(action.toLowerCase(), {
      action,
      expectedResult: r.expectedResult ? r.expectedResult.trim() : null,
      freq: r.freq || 1,
      lastSeenMs: r.lastSeenMs || 0,
    });
  }

  for (const r of secondaryRows) {
    const action = (r.action || '').trim();
    if (action.length < 2) continue;
    const norm = action.toLowerCase();
    const existing = byNorm.get(norm);
    if (!existing) {
      byNorm.set(norm, {
        action,
        expectedResult: r.expectedResult ? r.expectedResult.trim() : null,
        freq: r.freq || 1,
        lastSeenMs: r.lastSeenMs || 0,
      });
    } else {
      if (!existing.expectedResult && r.expectedResult) {
        existing.expectedResult = r.expectedResult.trim();
      }
      if ((r.lastSeenMs || 0) > existing.lastSeenMs) {
        existing.lastSeenMs = r.lastSeenMs;
      }
      if ((r.freq || 0) > existing.freq) {
        existing.freq = r.freq;
      }
    }
  }

  return Array.from(byNorm.values());
}

/**
 * Builds a compact 2-character prefix bucket index for O(1) bucket access
 * and sub-millisecond prefix matching without Trie node allocation overhead.
 */
export function buildStepAutocompleteIndexFromRows(
  rows: StepAutocompleteRow[]
): StepAutocompleteIndex {
  const actionBuckets = new Map<string, IndexedActionEntry[]>();
  const actionExactMap = new Map<string, IndexedActionEntry>();
  const expectedMap = new Map<string, IndexedExpectedEntry>();

  const entries: IndexedActionEntry[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const action = (r.action || '').trim();
    if (action.length < 2) continue;
    const normAction = action.toLowerCase();
    if (actionExactMap.has(normAction)) continue;

    const expectedResult = (r.expectedResult || '').trim() || null;
    const entry: IndexedActionEntry = {
      action,
      normAction,
      expectedResult,
      freq: r.freq || 1,
      lastSeenMs: r.lastSeenMs || 0,
    };

    actionExactMap.set(normAction, entry);
    entries.push(entry);

    if (expectedResult && expectedResult.length >= 2) {
      const normExp = expectedResult.toLowerCase();
      const prevExp = expectedMap.get(normExp);
      if (prevExp) {
        prevExp.freq += entry.freq;
        if (entry.lastSeenMs > prevExp.lastSeenMs) {
          prevExp.lastSeenMs = entry.lastSeenMs;
        }
      } else {
        expectedMap.set(normExp, {
          text: expectedResult,
          normText: normExp,
          freq: entry.freq,
          lastSeenMs: entry.lastSeenMs,
        });
      }
    }
  }

  // Sort globally by (freq DESC, lastSeenMs DESC, length ASC)
  entries.sort((a, b) => {
    if (b.freq !== a.freq) return b.freq - a.freq;
    if (b.lastSeenMs !== a.lastSeenMs) return b.lastSeenMs - a.lastSeenMs;
    return a.normAction.length - b.normAction.length;
  });

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const prefix2 = entry.normAction.slice(0, 2);
    let bucket = actionBuckets.get(prefix2);
    if (!bucket) {
      bucket = [];
      actionBuckets.set(prefix2, bucket);
    }
    if (bucket.length < MAX_BUCKETS_PER_PREFIX) {
      bucket.push(entry);
    }
  }

  const expectedEntries = Array.from(expectedMap.values()).sort((a, b) => {
    if (b.freq !== a.freq) return b.freq - a.freq;
    if (b.lastSeenMs !== a.lastSeenMs) return b.lastSeenMs - a.lastSeenMs;
    return a.normText.length - b.normText.length;
  });

  const expectedBuckets = new Map<string, IndexedExpectedEntry[]>();
  for (let i = 0; i < expectedEntries.length; i++) {
    const entry = expectedEntries[i];
    const prefix2 = entry.normText.slice(0, 2);
    let bucket = expectedBuckets.get(prefix2);
    if (!bucket) {
      bucket = [];
      expectedBuckets.set(prefix2, bucket);
    }
    if (bucket.length < MAX_BUCKETS_PER_PREFIX) {
      bucket.push(entry);
    }
  }

  return {
    actionBuckets,
    actionExactMap,
    expectedBuckets,
  };
}

/**
 * Prefix-matches the user's Action input against the 2-char bucket index.
 * Returns both the inline ghostSuffix for Action and the paired Expected Result.
 */
export function matchActionPrefix(
  index: StepAutocompleteIndex | null | undefined,
  rawInput: string
): ActionPrefixMatch | null {
  if (!index || !rawInput) return null;
  // Do not show ghost completion if user is typing a variable/parameter token
  const lastOpenBrace = rawInput.lastIndexOf('{');
  const lastCloseBrace = rawInput.lastIndexOf('}');
  if (lastOpenBrace !== -1 && lastCloseBrace <= lastOpenBrace) {
    return null;
  }

  const trimmed = rawInput.trimStart();
  if (trimmed.length < 2) return null;

  const normInput = trimmed.toLowerCase();
  const prefix2 = normInput.slice(0, 2);
  const bucket = index.actionBuckets.get(prefix2);
  if (!bucket || bucket.length === 0) return null;

  // Find best strictly-longer prefix match
  let bestPrefixMatch: IndexedActionEntry | null = null;
  for (let i = 0; i < bucket.length; i++) {
    const candidate = bucket[i];
    if (candidate.normAction.length > normInput.length && candidate.normAction.startsWith(normInput)) {
      bestPrefixMatch = candidate;
      break;
    }
  }

  const exactMatch = index.actionExactMap.get(normInput) || null;

  // If the user typed an exact known action and there's no higher-frequency longer action,
  // return the exact match (ghostSuffix = '') so its paired Expected Result is still suggested live.
  if (exactMatch && (!bestPrefixMatch || exactMatch.freq >= bestPrefixMatch.freq)) {
    return {
      entry: exactMatch,
      ghostSuffix: '',
      completedAction: exactMatch.action,
      isExact: true,
    };
  }

  if (bestPrefixMatch) {
    const ghostSuffix = bestPrefixMatch.action.slice(trimmed.length);
    const leadingSpaces = rawInput.slice(0, rawInput.length - trimmed.length);
    return {
      entry: bestPrefixMatch,
      ghostSuffix,
      completedAction: leadingSpaces + bestPrefixMatch.action,
      isExact: false,
    };
  }

  if (exactMatch) {
    return {
      entry: exactMatch,
      ghostSuffix: '',
      completedAction: exactMatch.action,
      isExact: true,
    };
  }

  return null;
}

/**
 * Matches expected result prefix when the user is typing in the Expected Result field directly.
 */
export function matchExpectedResultPrefix(
  index: StepAutocompleteIndex | null | undefined,
  rawExpectedInput: string,
  currentActionText?: string
): ExpectedPrefixMatch | null {
  if (!index) return null;

  const lastOpenBrace = rawExpectedInput.lastIndexOf('{');
  const lastCloseBrace = rawExpectedInput.lastIndexOf('}');
  if (lastOpenBrace !== -1 && lastCloseBrace <= lastOpenBrace) {
    return null;
  }

  const actionNorm = (currentActionText || '').trim().toLowerCase();
  const pairedExpected = actionNorm ? index.actionExactMap.get(actionNorm)?.expectedResult || null : null;

  // If expected result is empty and current action has a paired expected result, suggest the full paired result
  if (!rawExpectedInput) {
    if (pairedExpected) {
      return {
        text: pairedExpected,
        ghostSuffix: pairedExpected,
        completedText: pairedExpected,
      };
    }
    return null;
  }

  const trimmed = rawExpectedInput.trimStart();
  if (trimmed.length < 2) return null;
  const normInput = trimmed.toLowerCase();
  const leadingSpaces = rawExpectedInput.slice(0, rawExpectedInput.length - trimmed.length);

  // First check if the paired expected result for this step's action matches the typed prefix
  if (
    pairedExpected &&
    pairedExpected.length > trimmed.length &&
    pairedExpected.toLowerCase().startsWith(normInput)
  ) {
    return {
      text: pairedExpected,
      ghostSuffix: pairedExpected.slice(trimmed.length),
      completedText: leadingSpaces + pairedExpected,
    };
  }

  const prefix2 = normInput.slice(0, 2);
  const bucket = index.expectedBuckets.get(prefix2);
  if (!bucket || bucket.length === 0) return null;

  for (let i = 0; i < bucket.length; i++) {
    const candidate = bucket[i];
    if (candidate.normText.length > normInput.length && candidate.normText.startsWith(normInput)) {
      return {
        text: candidate.text,
        ghostSuffix: candidate.text.slice(trimmed.length),
        completedText: leadingSpaces + candidate.text,
      };
    }
  }

  return null;
}
