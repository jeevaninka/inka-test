/**
 * In-process execution event bus. The database stays authoritative: events only
 * carry a monotonic sequence and a small invalidating payload, and every client
 * can always recover by refetching the persisted snapshot.
 *
 * This is intentionally dependency-free. Multiple server instances do not share
 * the bus, so the SSE endpoint also sends a low-frequency persisted snapshot.
 */
export interface ExecutionEvent {
  seq: number;
  runId: string;
  /** RUN | CASE | STEP | EVIDENCE */
  type: string;
  resultId?: string;
  attemptNumber?: number;
  status?: string;
  executionState?: string;
  at: string;
}

type Listener = (event: ExecutionEvent) => void;

const globalRef = globalThis as unknown as {
  __inkaExecutionBus?: {
    seq: number;
    listeners: Map<string, Set<Listener>>;
  };
};

function bus() {
  if (!globalRef.__inkaExecutionBus) {
    globalRef.__inkaExecutionBus = { seq: 0, listeners: new Map() };
  }
  return globalRef.__inkaExecutionBus;
}

export function publishExecutionEvent(
  runId: string,
  event: Omit<ExecutionEvent, 'seq' | 'runId' | 'at'>
): ExecutionEvent {
  const store = bus();
  store.seq += 1;
  const payload: ExecutionEvent = {
    ...event,
    seq: store.seq,
    runId,
    at: new Date().toISOString(),
  };
  const listeners = store.listeners.get(runId);
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // A slow/failed subscriber must never break execution.
      }
    }
  }
  return payload;
}

export function subscribeRunEvents(runId: string, listener: Listener): () => void {
  const store = bus();
  let set = store.listeners.get(runId);
  if (!set) {
    set = new Set();
    store.listeners.set(runId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) store.listeners.delete(runId);
  };
}

/** Current sequence, used by the SSE route for gap detection. */
export function currentExecutionSeq(): number {
  return bus().seq;
}
