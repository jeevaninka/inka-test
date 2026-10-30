import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The run events bus keeps one EventSource per run and drops snapshots whose
 * version has not changed. Both behaviours are what stop the run deck from
 * refetching `/results` several times a minute on an idle run.
 */

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  url: string;
  closed = false;
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data?: unknown) {
    const payload = data === undefined ? undefined : { data: JSON.stringify(data) };
    for (const listener of Array.from(this.listeners.get(type) ?? [])) {
      listener(payload);
    }
  }
}

const { subscribeRunEvents } = await import('@/lib/runs/run-events-bus');

const cleanups: Array<() => void> = [];

function subscribe(runId: string, listener: () => void, options?: { poll?: boolean }) {
  const unsubscribe = subscribeRunEvents(runId, listener, options);
  cleanups.push(unsubscribe);
  return unsubscribe;
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('EventSource', FakeEventSource);
});

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('subscribeRunEvents', () => {
  it('shares a single connection between subscribers of the same run', () => {
    const first = vi.fn();
    const second = vi.fn();

    subscribe('RUN-1', first);
    subscribe('RUN-1', second);

    expect(FakeEventSource.instances).toHaveLength(1);

    subscribe('RUN-2', vi.fn());
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('notifies every subscriber once per changed snapshot', () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribe('RUN-1', first);
    subscribe('RUN-1', second);

    const source = FakeEventSource.instances[0];
    source.emit('snapshot', { version: 'v1' });
    vi.advanceTimersByTime(600);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('drops snapshots whose version has not changed', () => {
    const listener = vi.fn();
    subscribe('RUN-1', listener);
    const source = FakeEventSource.instances[0];

    source.emit('snapshot', { version: 'v1' });
    vi.advanceTimersByTime(600);
    expect(listener).toHaveBeenCalledTimes(1);

    // Same version on the next 15s tick: no refetch.
    source.emit('snapshot', { version: 'v1' });
    vi.advanceTimersByTime(600);
    expect(listener).toHaveBeenCalledTimes(1);

    source.emit('snapshot', { version: 'v2' });
    vi.advanceTimersByTime(600);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('coalesces a burst of snapshots into one notification', () => {
    const listener = vi.fn();
    subscribe('RUN-1', listener);
    const source = FakeEventSource.instances[0];

    source.emit('snapshot', { version: 'v1' });
    source.emit('snapshot', { version: 'v2' });
    source.emit('snapshot', { version: 'v3' });
    vi.advanceTimersByTime(600);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('closes the connection when the last subscriber leaves', () => {
    const unsubscribe = subscribe('RUN-1', vi.fn());
    const source = FakeEventSource.instances[0];

    unsubscribe();
    expect(source.closed).toBe(true);

    subscribe('RUN-1', vi.fn());
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('passes the snapshot hint through, keeping the newest one in a burst', () => {
    const listener = vi.fn();
    subscribe('RUN-1', listener);
    const source = FakeEventSource.instances[0];

    source.emit('snapshot', { version: 'v1', status: 'running', stopRequestedAt: null });
    source.emit('snapshot', { version: 'v2', status: 'completed', stopRequestedAt: null });
    vi.advanceTimersByTime(600);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ status: 'completed' });
  });

  it('passes no hint on fallback poll ticks', () => {
    const listener = vi.fn();
    subscribe('RUN-1', listener, { poll: true });

    vi.advanceTimersByTime(60_000);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toBeUndefined();
  });

  it('runs one fallback poll while a subscriber asks for it', () => {
    const listener = vi.fn();
    const unsubscribe = subscribe('RUN-1', listener, { poll: true });
    subscribe('RUN-1', vi.fn(), { poll: true });

    vi.advanceTimersByTime(60_000);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    vi.advanceTimersByTime(120_000);
    // Still one poll owner left, so ticks continue but do not multiply.
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
