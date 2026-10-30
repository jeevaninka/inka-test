/**
 * Execution coordinator integration tests (live local Postgres).
 *
 * Only queue/claim/stop/recovery semantics are exercised here; provider HTTP is
 * never called because these tests never dispatch (`startImmediately: false`).
 * Every row created is deleted in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { createRetryAttempts } from '@/lib/execution/attempts';
import { startRunCases, stopRun, tickRun } from '@/lib/execution/coordinator';

const PROJECT_ID = process.env.INKA_TEST_PROJECT || 'PRJ-1';
const TEMP = `ITCOORD-${Date.now()}`;
const runIds: string[] = [];
let actorId = 0;
let caseIds: string[] = [];

async function findActor(): Promise<number> {
  const member = await prisma.projectMember.findFirst({
    where: { project_id: PROJECT_ID, role: { not: 'VIEWER' } },
    select: { user_id: true },
  });
  if (member) return member.user_id;
  const wsMember = await prisma.workspaceMember.findFirst({
    where: {
      role: { in: ['OWNER', 'ADMIN', 'MEMBER'] },
      workspace: { projects: { some: { id: PROJECT_ID } } },
    },
    select: { user_id: true },
  });
  if (!wsMember) throw new Error('Integration test requires a project member');
  return wsMember.user_id;
}

async function seedRun(opts: {
  label: string;
  statuses: Array<'PENDING' | 'PASS' | 'FAIL' | 'SKIP'>;
  config?: Record<string, any>;
  executionStates?: string[];
  source?: string;
  /** Explicit execution lane per result. */
  providers?: Array<'postman' | 'datadog' | null>;
}) {
  const runId = `${TEMP}-${opts.label}`;
  runIds.push(runId);
  const run = await prisma.testRun.create({
    data: {
      id: runId,
      project_id: PROJECT_ID,
      name: `[integration] coordinator ${opts.label}`,
      environment: 'UAT',
      status: 'IN_PROGRESS',
      source: opts.source || 'postman',
      started_at: new Date(),
      created_by: actorId,
      run_context: { external: true, provider: 'postman', config: opts.config || {} } as any,
      results: {
        create: opts.statuses.map((status, index) => ({
          test_case_id: caseIds[index % caseIds.length],
          order_index: index,
          status,
          source: 'automated',
          execution_state: opts.executionStates?.[index] || 'IDLE',
          execution_generation: 1,
          provider: opts.providers?.[index] ?? undefined,
        })),
      },
    },
    include: { results: { orderBy: { order_index: 'asc' } } },
  });
  return run;
}

/** A waiting case is only left alone while a provider monitor owns it. */
async function attachMonitor(runId: string, resultId: string) {
  await prisma.externalExecutionMonitor.create({
    data: {
      provider: 'datadog',
      project_id: PROJECT_ID,
      run_id: runId,
      run_result_id: resultId,
      status: 'PENDING',
      deadline_at: new Date(Date.now() + 30 * 60_000),
      next_poll_at: new Date(Date.now() + 10 * 60_000),
    },
  });
}

beforeAll(async () => {
  const project = await prisma.project.findUnique({ where: { id: PROJECT_ID } });
  if (!project) throw new Error(`Integration test requires project ${PROJECT_ID}`);
  actorId = await findActor();
  const cases = await prisma.testCase.findMany({
    where: { project_id: PROJECT_ID, deleted_at: null },
    select: { id: true },
    take: 4,
  });
  caseIds = cases.map((c) => c.id);
  if (caseIds.length < 3) throw new Error('Integration test requires at least 3 test cases');
});

afterAll(async () => {
  await prisma.externalExecutionMonitor.deleteMany({ where: { run_id: { in: runIds } } }).catch(() => {});
  await prisma.activityLog.deleteMany({ where: { entity_type: 'test_run', entity_id: { in: runIds } } }).catch(() => {});
  await prisma.runResult.deleteMany({ where: { run_id: { in: runIds } } }).catch(() => {});
  await prisma.testRun.deleteMany({ where: { id: { in: runIds } } }).catch(() => {});
});

describe('execution coordinator (live DB)', () => {
  it('queues cases and is idempotent under concurrent duplicate starts', async () => {
    const run = await seedRun({ label: 'concurrent', statuses: ['PENDING', 'PENDING', 'PENDING'] });

    const [first, second] = await Promise.all([
      startRunCases({ runId: run.id, actorId, startImmediately: false }),
      startRunCases({ runId: run.id, actorId, startImmediately: false }),
    ]);

    expect(first.queued + second.queued).toBe(3);

    const rows = await prisma.runResult.findMany({ where: { run_id: run.id } });
    expect(rows.every((r) => r.execution_state === 'QUEUED')).toBe(true);
    expect(rows.every((r) => r.queued_at !== null)).toBe(true);
  });

  it('auto-assigns unassigned cases to the starter and logs the start', async () => {
    const run = await seedRun({ label: 'assign', statuses: ['PENDING', 'PENDING', 'PENDING'] });
    const otherAssignee = actorId === 1 ? 2 : 1;
    await prisma.runResult.updateMany({
      where: { run_id: run.id, order_index: 0 },
      data: { assigned_to: otherAssignee },
    });

    await startRunCases({ runId: run.id, actorId, startImmediately: false });

    const rows = await prisma.runResult.findMany({
      where: { run_id: run.id },
      orderBy: { order_index: 'asc' },
    });
    expect(rows[0].assigned_to).toBe(otherAssignee); // existing assignment untouched
    expect(rows[1].assigned_to).toBe(actorId);
    expect(rows[2].assigned_to).toBe(actorId);

    const log = await prisma.activityLog.findFirst({
      where: { entity_type: 'test_run', entity_id: run.id, user_id: actorId },
    });
    expect(log?.action).toBe('Started test run');
  });

  it('rerun-all creates new attempts and bumps the generation instead of resetting history', async () => {
    const run = await seedRun({ label: 'rerunall', statuses: ['PASS', 'FAIL', 'PASS'] });

    const result = await startRunCases({
      runId: run.id,
      actorId,
      mode: 'rerun-all',
      startImmediately: false,
    });

    expect(result.queued).toBe(3);
    expect(result.generation).toBe(2);

    const persisted = await prisma.testRun.findUnique({ where: { id: run.id } });
    expect(persisted?.execution_generation).toBe(2);

    const rows = await prisma.runResult.findMany({ where: { run_id: run.id } });
    expect(rows).toHaveLength(6); // 3 original attempts preserved + 3 new ones

    const latest = rows.filter((r) => r.attempt_number === 2);
    expect(latest).toHaveLength(3);
    expect(latest.every((r) => r.status === 'PENDING')).toBe(true);
    expect(latest.every((r) => r.execution_state === 'QUEUED')).toBe(true);
    expect(latest.every((r) => r.execution_generation === 2)).toBe(true);

    // Original attempts keep their outcome and evidence.
    expect(rows.filter((r) => r.attempt_number === 1 && r.status === 'FAIL')).toHaveLength(1);
  });

  it('does not create duplicate attempts for a case that is still pending', async () => {
    const run = await seedRun({ label: 'rerunpending', statuses: ['PENDING'] });
    const created = await createRetryAttempts({
      runId: run.id,
      mode: 'rerun-all',
      bumpGeneration: true,
    });
    expect(created.createdIds).toHaveLength(0);
    expect(created.skippedPending).toBe(1);
  });

  it('recovers an expired execution lease as UNAVAILABLE instead of retrying side effects', async () => {
    const run = await seedRun({
      label: 'stalelase',
      statuses: ['PENDING'],
      executionStates: ['RUNNING'],
    });
    await prisma.runResult.updateMany({
      where: { run_id: run.id },
      data: {
        lease_owner: 'dead-worker',
        lease_expires_at: new Date(Date.now() - 60_000),
      },
    });

    const tick = await tickRun(run.id);
    expect(tick.ok).toBe(true);

    const result = await prisma.runResult.findFirst({ where: { run_id: run.id } });
    expect(result?.status).toBe('UNAVAILABLE');
    expect(result?.execution_state).toBe('SETTLED');
    expect(result?.last_execution_error).toMatch(/lease/i);
    expect(result?.notes).toMatch(/not retried automatically/i);
  });

  it('claims a queued case atomically and skips cases without an in-app runner', async () => {
    const run = await seedRun({
      label: 'claim',
      statuses: ['PENDING'],
      executionStates: ['QUEUED'],
      source: 'mixed',
    });

    const tick = await tickRun(run.id);
    expect(tick.ok).toBe(true);
    expect(tick.dispatched).toBe(1);

    const result = await prisma.runResult.findFirst({ where: { run_id: run.id } });
    expect(result?.status).toBe('SKIP');
    expect(result?.execution_state).toBe('SETTLED');
    expect(result?.notes).toMatch(/No in-app runner/i);
    expect(result?.lease_owner).toBeNull();

    // No PENDING case remains, so the run is closed.
    const persisted = await prisma.testRun.findUnique({ where: { id: run.id } });
    expect(persisted?.status).toBe('COMPLETED');
  });

  it('stop cancels queued cases but leaves a running case to finish', async () => {
    const run = await seedRun({
      label: 'stop',
      statuses: ['PENDING', 'PENDING'],
      executionStates: ['RUNNING', 'QUEUED'],
    });
    await prisma.runResult.updateMany({
      where: { run_id: run.id, execution_state: 'RUNNING' },
      data: {
        started_at: new Date(),
        lease_owner: 'live-worker',
        lease_expires_at: new Date(Date.now() + 10 * 60_000),
      },
    });

    const stopped = await stopRun({ runId: run.id, actorId });
    expect(stopped.skipped).toBe(1);

    const rows = await prisma.runResult.findMany({
      where: { run_id: run.id },
      orderBy: { order_index: 'asc' },
    });
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].execution_state).toBe('RUNNING');
    expect(rows[1].status).toBe('CANCELLED');
    expect(rows[1].execution_state).toBe('SETTLED');
    expect(rows[1].notes).toMatch(/stopped before this case started/i);
  });

  it('a Datadog case waiting for its provider does not block the Postman lane', async () => {
    const run = await seedRun({
      label: 'lanes',
      source: 'mixed',
      statuses: ['PENDING', 'PENDING'],
      executionStates: ['WAITING', 'QUEUED'],
      providers: ['datadog', 'postman'],
    });
    // The Datadog case is owned by a live provider monitor.
    await prisma.runResult.updateMany({
      where: { run_id: run.id, execution_state: 'WAITING' },
      data: {
        started_at: new Date(),
        lease_owner: 'live-worker',
        lease_expires_at: new Date(Date.now() + 10 * 60_000),
      },
    });
    const waiting = await prisma.runResult.findFirst({
      where: { run_id: run.id, execution_state: 'WAITING' },
    });
    await attachMonitor(run.id, waiting!.id);

    const tick = await tickRun(run.id);
    expect(tick.ok).toBe(true);
    expect(tick.dispatched).toBe(1);

    const rows = await prisma.runResult.findMany({
      where: { run_id: run.id },
      orderBy: { order_index: 'asc' },
    });
    // The waiting Datadog case is untouched.
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].execution_state).toBe('WAITING');
    // The Postman lane ran even though a Datadog test was still in flight.
    expect(rows[1].execution_state).toBe('SETTLED');
    expect(rows[1].notes).toMatch(/No in-app runner/i);
  });

  it('the Datadog lane never exceeds its concurrency limit', async () => {
    const run = await seedRun({
      label: 'lanecap',
      source: 'mixed',
      statuses: ['PENDING', 'PENDING', 'PENDING'],
      executionStates: ['WAITING', 'WAITING', 'QUEUED'],
      providers: ['datadog', 'datadog', 'datadog'],
      config: { datadog: { mode: 'together', concurrency: 2 } },
    });
    await prisma.runResult.updateMany({
      where: { run_id: run.id, execution_state: 'WAITING' },
      data: {
        started_at: new Date(),
        lease_owner: 'live-worker',
        lease_expires_at: new Date(Date.now() + 10 * 60_000),
      },
    });
    const waiting = await prisma.runResult.findMany({
      where: { run_id: run.id, execution_state: 'WAITING' },
    });
    for (const row of waiting) {
      await attachMonitor(run.id, row.id);
    }

    const tick = await tickRun(run.id);
    expect(tick.ok).toBe(true);
    expect(tick.dispatched).toBe(0);

    const queued = await prisma.runResult.findFirst({
      where: { run_id: run.id, execution_state: 'QUEUED' },
    });
    expect(queued).not.toBeNull();
  });

  it('resume continues the cases that a stop cancelled, as new attempts', async () => {
    const run = await seedRun({
      label: 'resume',
      statuses: ['PENDING', 'PENDING'],
      executionStates: ['QUEUED', 'QUEUED'],
    });

    const stopped = await stopRun({ runId: run.id, actorId });
    expect(stopped.skipped).toBe(2);

    const cancelled = await prisma.runResult.findMany({ where: { run_id: run.id } });
    expect(cancelled.every((r) => r.status === 'CANCELLED')).toBe(true);

    const resumed = await startRunCases({
      runId: run.id,
      actorId,
      mode: 'resume',
      startImmediately: false,
    });
    expect(resumed.queued).toBe(2);

    const rows = await prisma.runResult.findMany({
      where: { run_id: run.id },
      orderBy: [{ attempt_number: 'asc' }],
    });
    // The cancelled attempts are kept as history.
    expect(rows.filter((r) => r.attempt_number === 1)).toHaveLength(2);
    expect(rows.filter((r) => r.attempt_number === 1).every((r) => r.status === 'CANCELLED')).toBe(
      true
    );
    // The resumed cases are fresh attempts.
    const fresh = rows.filter((r) => r.attempt_number === 2);
    expect(fresh).toHaveLength(2);
    expect(fresh.every((r) => r.status === 'PENDING')).toBe(true);
    expect(fresh.every((r) => r.execution_state === 'QUEUED')).toBe(true);
  });
});
