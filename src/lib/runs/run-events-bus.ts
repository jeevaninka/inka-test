'use client';

/**
 * One EventSource per run per browser tab.
 *
 * Before this module every live surface opened its own stream (run page,
 * overview drawer, team progress modal), so a single server snapshot event
 * fanned out into N refetches of the same query. This bus keeps exactly one
 * connection, drops snapshots whose `version` has not changed, and coalesces
 * bursty notifications into one callback per window.
 */

/**
 * The subset of the server snapshot that consumers need to decide whether a
 * cheap refetch is enough or the run header must also be refreshed.
 */
export interface RunSnapshotHint {
  version?: string;
  status?: string;
  lifecycle?: string;
  stopRequestedAt?: string | null;
}

type SnapshotListener = (snapshot?: RunSnapshotHint) => void;

interface BusEntry {
  source: EventSource;
  listeners: Set<SnapshotListener>;
  /** Last snapshot version delivered to listeners; identical versions are skipped. */
  lastVersion: string | null;
  /** Payload of the pending notification, so coalesced bursts keep their hint. */
  pendingSnapshot: RunSnapshotHint | undefined;
  notifyTimer: ReturnType<typeof setTimeout> | null;
  lastNotifyAt: number;
  pollTimer: ReturnType<typeof setInterval> | null;
  pollCount: number;
}

/** Notifications inside this window are merged into a single callback pass. */
const NOTIFY_THROTTLE_MS = 500;
/**
 * Safety net for proxies that buffer SSE. The server already pushes a snapshot
 * on connect and on every change, so this only runs for active runs.
 */
const FALLBACK_POLL_MS = 60_000;

const entries = new Map<string, BusEntry>();

function notify(entry: BusEntry, snapshot?: RunSnapshotHint) {
  entry.lastNotifyAt = Date.now();
  for (const listener of Array.from(entry.listeners)) {
    try {
      listener(snapshot);
    } catch {
      // one bad listener must not break the others
    }
  }
}

function scheduleNotify(entry: BusEntry, snapshot?: RunSnapshotHint) {
  // A newer snapshot wins over an older pending hint within the same window.
  if (snapshot) entry.pendingSnapshot = snapshot;
  if (entry.notifyTimer) return;
  const wait = Math.max(0, NOTIFY_THROTTLE_MS - (Date.now() - entry.lastNotifyAt));
  entry.notifyTimer = setTimeout(() => {
    entry.notifyTimer = null;
    if (entry.listeners.size === 0) {
      entry.pendingSnapshot = undefined;
      return;
    }
    const pending = entry.pendingSnapshot;
    entry.pendingSnapshot = undefined;
    notify(entry, pending);
  }, wait);
}

function syncPolling(entry: BusEntry) {
  if (entry.pollCount > 0 && !entry.pollTimer) {
    entry.pollTimer = setInterval(() => {
      if (entry.listeners.size > 0) notify(entry);
    }, FALLBACK_POLL_MS);
  } else if (entry.pollCount === 0 && entry.pollTimer) {
    clearInterval(entry.pollTimer);
    entry.pollTimer = null;
  }
}

function createEntry(runId: string): BusEntry {
  const source = new EventSource(`/api/v1/runs/${encodeURIComponent(runId)}/events`);
  const entry: BusEntry = {
    source,
    listeners: new Set(),
    lastVersion: null,
    pendingSnapshot: undefined,
    notifyTimer: null,
    lastNotifyAt: 0,
    pollTimer: null,
    pollCount: 0,
  };

  source.addEventListener('snapshot', (event) => {
    const current = entries.get(runId);
    if (!current || current !== entry) return;

    let hint: RunSnapshotHint = {};
    try {
      const payload = JSON.parse((event as MessageEvent).data) as RunSnapshotHint;
      hint = {
        version: payload?.version != null ? String(payload.version) : undefined,
        status: payload?.status != null ? String(payload.status) : undefined,
        lifecycle: payload?.lifecycle != null ? String(payload.lifecycle) : undefined,
        stopRequestedAt: payload?.stopRequestedAt ?? null,
      };
    } catch {
      // malformed payload: treat it as a change and let the listener refetch
    }

    const version = hint.version ?? null;
    if (version && version === entry.lastVersion) return;
    if (version) entry.lastVersion = version;
    scheduleNotify(entry, hint);
  });

  // The browser reconnects automatically; the snapshot sent on connect repairs
  // whatever was missed, so errors need no handling here.
  source.addEventListener('error', () => {});

  entries.set(runId, entry);
  return entry;
}

/**
 * Subscribe to live invalidation hints for one run.
 *
 * @param onSnapshot Called when the run changed (or on a fallback poll tick).
 *   Receives the snapshot hint when one is available; fallback polls pass
 *   `undefined`, which means "refresh data but the run header may be unchanged".
 * @param options.poll Request the shared slow fallback poll (active runs only).
 * @returns Unsubscribe function; the connection closes with the last listener.
 */
export function subscribeRunEvents(
  runId: string,
  onSnapshot: SnapshotListener,
  options: { poll?: boolean } = {}
): () => void {
  if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
    return () => {};
  }

  const entry = entries.get(runId) ?? createEntry(runId);
  entry.listeners.add(onSnapshot);

  const wantsPoll = Boolean(options.poll);
  if (wantsPoll) {
    entry.pollCount += 1;
    syncPolling(entry);
  }

  return () => {
    const current = entries.get(runId);
    if (!current) return;

    current.listeners.delete(onSnapshot);

    if (wantsPoll) {
      current.pollCount = Math.max(0, current.pollCount - 1);
      syncPolling(current);
    }

    if (current.listeners.size === 0) {
      current.source.close();
      if (current.notifyTimer) clearTimeout(current.notifyTimer);
      if (current.pollTimer) clearInterval(current.pollTimer);
      entries.delete(runId);
    }
  };
}
