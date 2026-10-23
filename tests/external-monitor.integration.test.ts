/**
 * Durable background-monitor integration test.
 *
 * Runs against the REAL local database and the REAL Prisma client, with only the
 * Datadog HTTP layer stubbed. It proves: claim -> poll -> finalize, status
 * transitions, artifact/idempotency guarantees, and that provider/integration
 * failures never become assertion failures.
 *
 * All rows it creates are deleted in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import {
  enqueueDatadogMonitor,
  processDueExternalMonitors,
  getActiveMonitorsForRun,
  type MonitorExecutionRecord,
} from '@/lib/integrations/execution-monitor';

const PROJECT_ID = process.env.INKA_TEST_PROJECT || 'PRJ-1';
// An existing case in the project; only referenced, never modified.
const TEST_CASE_ID = process.env.INKA_TEST_CASE || 'cmvdw3yc10007bdt1k8siwawb';
const TEMP = `ITMON-${Date.now()}`;
const runIds: string[] = [];

async function seedRun(opts: {
  label: string;
  resultStatus?: string;
  runContext?: Record<string, any>;
  deadlineOffsetMs?: number;
  executions: MonitorExecutionRecord[];
}) {
  const runId = `${TEMP}-${opts.label}`;
  runIds.push(runId);
  const run = await prisma.testRun.create({
    data: {
      id: runId,
      project_id: PROJECT_ID,
      name: `[integration] ${opts.label}`,
      environment: 'UAT',
      status: 'IN_PROGRESS',
      source: 'datadog',
      started_at: new Date(),
      created_by: 2,
      run_context: (opts.runContext || { external: true, provider: 'datadog' }) as any,
      results: {
        create: [
          {
            test_case_id: TEST_CASE_ID,
            order_index: 1,
            status: (opts.resultStatus as any) || 'PENDING',
            source: 'automated',
            step_results: {
              1: { status: 'pending', note: 'Awaiting results' },
            } as any,
          },
        ],
      },
    },
    include: { results: true },
  });

  const monitor = await enqueueDatadogMonitor({
    projectId: PROJECT_ID,
    runId,
    runResultId: run.results[0].id,
    environment: 'UAT',
    batchId: 'it-batch-1',
    executions: opts.executions,
    executionRule: 'blocking',
  });

  if (opts.deadlineOffsetMs !== undefined) {
    await prisma.externalExecutionMonitor.update({
      where: { id: monitor.id },
      data: {
        deadline_at: new Date(Date.now() + opts.deadlineOffsetMs),
        created_at: new Date(Date.now() - 35 * 60 * 1000),
      },
    });
  }
  return { runId, resultId: run.results[0].id, monitorId: monitor.id };
}

const pendingExec: MonitorExecutionRecord = {
  publicId: 'it-pub-1',
  resultId: 'it-rid-1',
  testType: 'browser',
  testName: 'Integration journey',
  status: 'pending',
};

const resultResponse = (overall: 'passed' | 'failed') => ({
  data: {
    attributes: {
      result: {
        status: overall,
        duration: 4200,
        steps: [
          {
            description: 'Open checkout',
            duration: 900,
            bucket_keys: { screenshot: 'it/shot-1.png' },
          },
          {
            description: 'Submit order',
            duration: 500,
            failure: overall === 'failed' ? { message: 'Order not confirmed' } : undefined,
            bucket_keys: { screenshot: `it/shot-2-${overall}.png` },
          },
        ],
      },
    },
  },
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

beforeAll(async () => {
  const project = await prisma.project.findUnique({ where: { id: PROJECT_ID } });
  if (!project) throw new Error(`Integration test requires project ${PROJECT_ID}`);
});

afterAll(async () => {
  // Clean up every row this file created.
  await prisma.externalExecutionMonitor.deleteMany({ where: { run_id: { in: runIds } } }).catch(() => {});
  await prisma.runResult.deleteMany({ where: { run_id: { in: runIds } } }).catch(() => {});
  await prisma.testRun.deleteMany({ where: { id: { in: runIds } } }).catch(() => {});
});

describe('ExternalExecutionMonitor (live DB)', () => {
  it('finalizes a passing execution once, attaches evidence, and completes the run', async () => {
    const { runId, resultId, monitorId } = await seedRun({
      label: 'pass',
      executions: [pendingExec],
    });

    global.fetch = vi.fn(
      async () => new Response(JSON.stringify(resultResponse('passed')), { status: 200 })
    ) as any;

    const processedFirst = await processDueExternalMonitors(10, [monitorId]);
    expect(processedFirst).toBe(1);

    const monitor = await prisma.externalExecutionMonitor.findUnique({ where: { id: monitorId } });
    expect(monitor?.status).toBe('COMPLETED');

    const result = await prisma.runResult.findUnique({ where: { id: resultId } });
    expect(result?.status).toBe('PASS');
    expect(result?.notes).toMatch(/passed/i);
    const sr: any = result?.step_results;
    expect(sr['1'].status).toBe('pass');
    expect(sr['1'].subSteps?.[0]).toMatchObject({ name: 'Open checkout' });
    expect(sr['1'].subSteps?.[1].screenshotBucketKey).toBe('it/shot-2-passed.png');
    expect(sr['_externalMonitor'].status).toBe('PASS');

    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe('COMPLETED');
    expect(run?.completed_at).toBeTruthy();

    // Idempotency: a second sweep must not touch anything.
    const before = await prisma.runResult.findUnique({ where: { id: resultId } });
    const processedAgain = await processDueExternalMonitors(10, [monitorId]);
    expect(processedAgain).toBe(0);
    const after = await prisma.runResult.findUnique({ where: { id: resultId } });
    expect(after?.executed_at?.toISOString()).toBe(before?.executed_at?.toISOString());
    expect(await getActiveMonitorsForRun(runId)).toHaveLength(0);
  });

  it('records a genuine provider failure as FAIL with the failing step', async () => {
    const { runId, resultId, monitorId } = await seedRun({
      label: 'fail',
      executions: [pendingExec],
    });

    global.fetch = vi.fn(
      async () => new Response(JSON.stringify(resultResponse('failed')), { status: 200 })
    ) as any;

    await processDueExternalMonitors(10, [monitorId]);

    const result = await prisma.runResult.findUnique({ where: { id: resultId } });
    expect(result?.status).toBe('FAIL');
    const sr: any = result?.step_results;
    expect(sr['1'].failureMessage).toBe('Order not confirmed');
    expect(sr['1'].subSteps.filter((s: any) => s.status === 'fail')).toHaveLength(1);

    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe('FAILED');
  });

  it('keeps an unfinished execution pending and backs off instead of failing', async () => {
    const { resultId, monitorId } = await seedRun({ label: 'pending', executions: [pendingExec] });

    global.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as any;

    await processDueExternalMonitors(10, [monitorId]);

    const monitor = await prisma.externalExecutionMonitor.findUnique({ where: { id: monitorId } });
    expect(monitor?.status).toBe('POLLING');
    expect(monitor?.attempts).toBe(1);
    expect(monitor?.next_poll_at.getTime()).toBeGreaterThan(Date.now());

    const result = await prisma.runResult.findUnique({ where: { id: resultId } });
    expect(result?.status).toBe('PENDING');
  });

  it('marks an expired execution UNAVAILABLE (not failed) and completes the run', async () => {
    const { runId, resultId, monitorId } = await seedRun({
      label: 'expired',
      executions: [pendingExec],
      deadlineOffsetMs: -60_000,
    });

    let fetchCalls = 0;
    global.fetch = vi.fn(async () => {
      fetchCalls++;
      return new Response('{}', { status: 404 });
    }) as any;

    await processDueExternalMonitors(10, [monitorId]);

    const monitor = await prisma.externalExecutionMonitor.findUnique({ where: { id: monitorId } });
    expect(monitor?.status).toBe('UNAVAILABLE');

    const result = await prisma.runResult.findUnique({ where: { id: resultId } });
    expect(result?.status).toBe('UNAVAILABLE');
    expect(result?.notes).toMatch(/unavailable/i);
    const sr: any = result?.step_results;
    expect(sr['1'].status).toBe('unavailable');

    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe('COMPLETED');
    expect(fetchCalls).toBeGreaterThan(0);
  });

  it('treats an auth/permission failure as a diagnostic, never a test failure', async () => {
    const { resultId, monitorId } = await seedRun({ label: 'auth', executions: [pendingExec] });

    global.fetch = vi.fn(async () => new Response('{"errors":["Forbidden"]}', { status: 403 })) as any;

    await processDueExternalMonitors(10, [monitorId]);

    const monitor = await prisma.externalExecutionMonitor.findUnique({ where: { id: monitorId } });
    expect(monitor?.status).toBe('UNAVAILABLE');
    expect(monitor?.last_error).toMatch(/permission|forbidden|synthetics_read/i);

    const result = await prisma.runResult.findUnique({ where: { id: resultId } });
    expect(result?.status).toBe('UNAVAILABLE');
    expect(result?.status).not.toBe('FAIL');
  });

  it('honours Retry-After on rate limiting without failing the execution', async () => {
    const { resultId, monitorId } = await seedRun({ label: 'ratelimit', executions: [pendingExec] });

    global.fetch = vi.fn(
      async () => new Response('{}', { status: 429, headers: { 'retry-after': '45' } })
    ) as any;

    await processDueExternalMonitors(10, [monitorId]);

    const monitor = await prisma.externalExecutionMonitor.findUnique({ where: { id: monitorId } });
    expect(monitor?.status).toBe('POLLING');
    const delayMs = monitor!.next_poll_at.getTime() - Date.now();
    expect(delayMs).toBeGreaterThan(40_000);

    const result = await prisma.runResult.findUnique({ where: { id: resultId } });
    expect(result?.status).toBe('PENDING');
  });

  it('cancels remaining cases when stop-on-first-failure and a case failed', async () => {
    const { runId, resultId, monitorId } = await seedRun({
      label: 'stoponfail',
      executions: [pendingExec],
      runContext: {
        external: true,
        provider: 'datadog',
        config: { stopOnFirstFailure: true },
      },
    });

    // A second, still-pending case that must be cancelled.
    const second = await prisma.runResult.create({
      data: {
        run_id: runId,
        test_case_id: TEST_CASE_ID,
        order_index: 2,
        status: 'PENDING',
        source: 'automated',
      },
    });

    global.fetch = vi.fn(
      async () => new Response(JSON.stringify(resultResponse('failed')), { status: 200 })
    ) as any;

    await processDueExternalMonitors(10, [monitorId]);

    const first = await prisma.runResult.findUnique({ where: { id: resultId } });
    expect(first?.status).toBe('FAIL');
    const cancelled = await prisma.runResult.findUnique({ where: { id: second.id } });
    expect(cancelled?.status).toBe('CANCELLED');

    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    expect(run?.status).toBe('FAILED');
  });
});
