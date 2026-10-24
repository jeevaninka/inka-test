import { describe, expect, it } from 'vitest';
import {
  bucketForStatusKey,
  buildTeamProgress,
  distributeEvenly,
  flattenTeamLeaves,
  statusKeyForResult,
} from '@/lib/runs/team-progress';

describe('statusKeyForResult', () => {
  it('splits pending cases by queue state', () => {
    expect(statusKeyForResult({ status: 'pending', caseState: 'RUNNING' })).toBe('running');
    expect(statusKeyForResult({ status: 'pending', caseState: 'QUEUED' })).toBe('queued');
    expect(statusKeyForResult({ status: 'PENDING' })).toBe('not_run');
    expect(statusKeyForResult({ status: 'pass', caseState: 'RUNNING' })).toBe('pass');
  });

  it('maps statuses to the four bar buckets', () => {
    expect(bucketForStatusKey('pass')).toBe('passed');
    expect(bucketForStatusKey('fail')).toBe('failed');
    expect(bucketForStatusKey('blocked')).toBe('blocked');
    expect(bucketForStatusKey('error')).toBe('blocked');
    expect(bucketForStatusKey('invalid')).toBe('blocked');
    expect(bucketForStatusKey('skip')).toBe('pending');
    expect(bucketForStatusKey('queued')).toBe('pending');
  });
});

describe('flattenTeamLeaves', () => {
  it('keeps one leaf per iteration child and drops the parent container', () => {
    const leaves = flattenTeamLeaves([
      {
        id: 'r1',
        assignedTo: 7,
        assignedToName: 'Ada',
        status: 'pass',
        iterationResults: [
          { iteration_index: 1, status: 'pass', assigned_to: 7 },
          { iteration_index: 2, status: 'pending' },
        ],
      },
      { id: 'r2', assignedTo: 9, status: 'fail' },
    ]);

    expect(leaves).toHaveLength(3);
    expect(leaves[0]).toMatchObject({ resultId: 'r1', iterationIndex: 1, assignedTo: '7' });
    // Iteration without its own assignee falls back to the parent.
    expect(leaves[1]).toMatchObject({ resultId: 'r1', iterationIndex: 2, assignedTo: '7' });
    expect(leaves[2]).toMatchObject({ resultId: 'r2', iterationIndex: null, assignedTo: '9' });
  });
});

describe('buildTeamProgress', () => {
  const results = [
    { id: '1', assignedTo: 7, assignedToName: 'Ada', status: 'pass' },
    { id: '2', assignedTo: 7, status: 'fail' },
    { id: '3', assignedTo: 7, status: 'blocked' },
    { id: '4', assignedTo: 7, status: 'pending' },
    { id: '5', assignedTo: 9, status: 'pass' },
    { id: '6', assignedTo: 9, status: 'pass' },
    { id: '7', assignedTo: 9, status: 'pending', caseState: 'QUEUED' },
    { id: '8', assignedTo: null, status: 'skip' },
  ];

  it('groups by assignee and counts each bucket', () => {
    const rows = buildTeamProgress(results);
    const ada = rows.find((row) => row.id === '7')!;

    expect(ada).toMatchObject({
      name: 'Ada',
      total: 4,
      passed: 1,
      failed: 1,
      blocked: 1,
      pending: 1,
      executed: 3,
    });
    expect(ada.counts).toMatchObject({ pass: 1, fail: 1, blocked: 1, not_run: 1 });
  });

  it('adds an unassigned row with a friendly name', () => {
    const rows = buildTeamProgress(results);
    expect(rows.find((row) => row.id === 'unassigned')).toMatchObject({
      name: 'Unassigned',
      total: 1,
      pending: 1,
      executed: 0,
    });
  });

  it('counts iteration children instead of the parent row', () => {
    const rows = buildTeamProgress([
      {
        id: 'r1',
        assignedTo: 7,
        assignedToName: 'Ada',
        status: 'pass',
        iterationResults: [
          { iteration_index: 1, status: 'pass', assigned_to: 7 },
          { iteration_index: 2, status: 'fail', assigned_to: 9 },
          { iteration_index: 3, status: 'pending' },
        ],
      },
    ]);
    const ada = rows.find((row) => row.id === '7')!;
    const other = rows.find((row) => row.id === '9')!;

    expect(ada).toMatchObject({ total: 2, passed: 1, pending: 1, executed: 1 });
    expect(other).toMatchObject({ total: 1, failed: 1, executed: 1 });
    // The parent container is not a case of its own.
    expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(3);
  });

  it('sorts by pending cases descending, never by completed cases', () => {
    const rows = buildTeamProgress([
      { id: 'a', assignedTo: 1, status: 'pass' },
      { id: 'b', assignedTo: 1, status: 'pass' },
      { id: 'c', assignedTo: 1, status: 'pass' },
      { id: 'd', assignedTo: 2, status: 'pending' },
      { id: 'e', assignedTo: 2, status: 'fail' },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['2', '1']);
  });

  it('keeps Unassigned last regardless of pending count', () => {
    const rows = buildTeamProgress([
      { id: 'a', assignedTo: 3, status: 'pass' },
      { id: 'b', assignedTo: null, status: 'pending' },
      { id: 'c', assignedTo: null, status: 'pending' },
    ]);
    expect(rows.map((row) => row.id)).toEqual(['3', 'unassigned']);
  });

  it('tracks the latest activity and total executed time', () => {
    const rows = buildTeamProgress([
      {
        id: 'a',
        assignedTo: 4,
        status: 'pass',
        executedAt: '2026-10-20T10:00:00.000Z',
        timeSpentSeconds: 30,
      },
      {
        id: 'b',
        assignedTo: 4,
        status: 'fail',
        executedAt: '2026-10-20T12:00:00.000Z',
        timeSpentSeconds: 45,
      },
      {
        id: 'c',
        assignedTo: 4,
        status: 'pending',
        timeSpentSeconds: 5,
      },
    ]);
    expect(rows[0]).toMatchObject({
      lastActivity: '2026-10-20T12:00:00.000Z',
      executedSeconds: 80,
      executed: 2,
      pending: 1,
      total: 3,
    });
  });

  it('resolves avatars and names from the project member map', () => {
    const rows = buildTeamProgress([{ id: 'a', assignedTo: 42, status: 'pass' }], () => ({
      id: '42',
      name: 'Grace Hopper',
      avatarUrl: '/grace.png',
    }));
    expect(rows[0]).toMatchObject({
      name: 'Grace Hopper',
      avatarUrl: '/grace.png',
    });
  });

  it('falls back to a generated name when no identity is available', () => {
    const rows = buildTeamProgress([{ id: 'a', assignedTo: 5, status: 'pass' }]);
    expect(rows[0].name).toBe('User #5');
  });
});

describe('distributeEvenly', () => {
  it('splits leaves round-robin in list order', () => {
    expect(distributeEvenly([1, 2, 3, 4, 5], ['a', 'b'])).toEqual([
      { memberId: 'a', items: [1, 3, 5] },
      { memberId: 'b', items: [2, 4] },
    ]);
  });

  it('returns nothing without members', () => {
    expect(distributeEvenly([1, 2], [])).toEqual([]);
  });
});
