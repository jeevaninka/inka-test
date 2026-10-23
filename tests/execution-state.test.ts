import { describe, expect, it } from 'vitest';
import {
  computeQueuePositions,
  deriveRunLifecycle,
  isFailedResultStatus,
  isTerminalResultStatus,
  latestAttempts,
  normalizeExecutionState,
} from '@/lib/execution/state';

describe('execution state model', () => {
  it('normalizes unknown states to IDLE', () => {
    expect(normalizeExecutionState('queued')).toBe('QUEUED');
    expect(normalizeExecutionState(undefined)).toBe('IDLE');
    expect(normalizeExecutionState('nonsense')).toBe('IDLE');
  });

  it('selects one latest attempt per case', () => {
    const rows = [
      { id: 'a1', test_case_id: 'a', attempt_number: 1, order_index: 0, status: 'FAIL' },
      { id: 'a2', test_case_id: 'a', attempt_number: 2, order_index: 0, status: 'PENDING' },
      { id: 'b1', test_case_id: 'b', attempt_number: 1, order_index: 1, status: 'PASS' },
    ];
    const latest = latestAttempts(rows);
    expect(latest.map((r) => r.id)).toEqual(['a2', 'b1']);
  });

  it('derives 1-based queue positions in dispatch order', () => {
    const positions = computeQueuePositions([
      { id: 'c', status: 'PENDING', execution_state: 'QUEUED', order_index: 3 },
      { id: 'a', status: 'PENDING', execution_state: 'QUEUED', order_index: 1 },
      { id: 'b', status: 'PASS', execution_state: 'SETTLED', order_index: 0 },
    ]);
    expect(positions).toEqual({ a: 1, c: 2 });
  });

  it('derives run lifecycle from persisted case state', () => {
    const now = new Date();
    expect(
      deriveRunLifecycle({ status: 'ABORTED' }, [
        { status: 'PENDING', execution_state: 'RUNNING' },
      ])
    ).toBe('ABORTED');

    expect(
      deriveRunLifecycle({ status: 'IN_PROGRESS' }, [
        { status: 'PENDING', execution_state: 'RUNNING' },
      ])
    ).toBe('RUNNING');

    expect(
      deriveRunLifecycle({ status: 'IN_PROGRESS' }, [
        { status: 'PENDING', execution_state: 'QUEUED' },
      ])
    ).toBe('QUEUED');

    expect(
      deriveRunLifecycle({ status: 'IN_PROGRESS', stop_requested_at: now }, [
        { status: 'PENDING', execution_state: 'RUNNING' },
      ])
    ).toBe('STOPPING');

    expect(
      deriveRunLifecycle({ status: 'IN_PROGRESS' }, [
        { status: 'PENDING', execution_state: 'IDLE' },
      ])
    ).toBe('READY');

    expect(
      deriveRunLifecycle({ status: 'COMPLETED' }, [
        { status: 'PASS', execution_state: 'SETTLED' },
      ])
    ).toBe('COMPLETED');
  });

  it('separates infrastructure outcomes from assertion failures', () => {
    expect(isTerminalResultStatus('UNAVAILABLE')).toBe(true);
    expect(isTerminalResultStatus('PENDING')).toBe(false);
    expect(isFailedResultStatus('FAIL')).toBe(true);
    expect(isFailedResultStatus('UNAVAILABLE')).toBe(true);
    expect(isFailedResultStatus('PASS')).toBe(false);
  });
});
