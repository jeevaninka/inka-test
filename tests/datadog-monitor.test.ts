import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectDatadogVariables,
  mapDatadogResultPayload,
  fetchDatadogSyntheticExecutionState,
  triggerDatadogSyntheticsTests,
  type DatadogIntegrationConfig,
} from '@/lib/integrations/tool-clients';
import {
  computePollBackoffMs,
  isMonitorExpired,
  deriveOverallFromExecutions,
  buildExternalResultFromExecutions,
  DEFAULT_POLL_INTERVAL_MS,
  MAX_POLL_INTERVAL_MS,
  type MonitorExecutionRecord,
} from '@/lib/integrations/execution-monitor';

const config: DatadogIntegrationConfig = {
  site: 'datadoghq.com',
  apiKey: 'dd-api-key-test',
  appKey: 'dd-app-key-test',
};

const record = (over: Partial<MonitorExecutionRecord> = {}): MonitorExecutionRecord => ({
  publicId: 'pub-1',
  resultId: 'rid-1',
  testName: 'Checkout journey',
  status: 'pending',
  ...over,
});

describe('detectDatadogVariables', () => {
  it('reads declared test variables, `{{ }}` references and globals without braces', () => {
    const vars = detectDatadogVariables(
      {
        variables: [{ name: 'API_TOKEN', example: 'abc' }],
        request: { url: 'https://{{ BASE_URL }}/health', headers: { auth: '{{API_TOKEN}}' } },
      },
      [{ name: 'GLOBAL_ENV' }]
    );

    expect(vars.map((v) => v.name)).toEqual(['API_TOKEN', 'BASE_URL', 'GLOBAL_ENV']);
    expect(vars.find((v) => v.name === 'API_TOKEN')).toMatchObject({
      source: 'test',
      example: 'abc',
    });
    expect(vars.find((v) => v.name === 'GLOBAL_ENV')?.source).toBe('global');
  });

  it('supports object-style variables and de-duplicates', () => {
    const vars = detectDatadogVariables({ variables: { TOKEN: 'x' }, url: '{{ TOKEN }}' });
    expect(vars).toHaveLength(1);
    expect(vars[0]).toMatchObject({ name: 'TOKEN', example: 'x', source: 'test' });
  });

  it('returns an empty list for a test without variables', () => {
    expect(detectDatadogVariables({ steps: [] })).toEqual([]);
  });
});

describe('mapDatadogResultPayload', () => {
  it('returns null while a v2 browser result is still running', () => {
    expect(
      mapDatadogResultPayload(
        { data: { attributes: { status: 'in_progress' } } },
        'pub-1',
        'rid-1',
        'browser'
      )
    ).toBeNull();
  });

  it('returns null when the result status is not terminal', () => {
    expect(
      mapDatadogResultPayload(
        { result: { status: 'in_progress', steps: [] } },
        'pub-1',
        'rid-1',
        'api'
      )
    ).toBeNull();
  });

  it('maps a failed browser result with steps and screenshots', () => {
    const detail = mapDatadogResultPayload(
      {
        data: {
          attributes: {
            result: {
              status: 'failed',
              duration: 4200,
              steps: [
                {
                  description: 'Click submit',
                  duration: 800,
                  failure: { message: 'Element #submit not found' },
                  bucket_keys: { screenshot: '2/e2e/shot-2.png' },
                },
              ],
            },
          },
        },
      },
      'pub-1',
      'rid-1',
      'browser',
      'https://app.datadoghq.com'
    );

    expect(detail?.overallStatus).toBe('fail');
    expect(detail?.steps[0]).toMatchObject({
      name: 'Click submit',
      status: 'fail',
      failureMessage: 'Element #submit not found',
      screenshotBucketKey: '2/e2e/shot-2.png',
    });
    expect(detail?.externalResultUrl).toContain('/synthetics/details/pub-1');
  });

  it('treats a failed provider status as fail even without a failure object', () => {
    const detail = mapDatadogResultPayload(
      { result: { status: 'failed', duration: 100, steps: [] } },
      'pub-1',
      'rid-1',
      'api'
    );
    expect(detail?.overallStatus).toBe('fail');
  });

  it('treats a passed provider status as pass', () => {
    const detail = mapDatadogResultPayload(
      { result: { status: 'passed', duration: 100, steps: [] } },
      'pub-1',
      'rid-1',
      'api'
    );
    expect(detail?.overallStatus).toBe('pass');
  });
});

describe('fetchDatadogSyntheticExecutionState', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('reports pending on 404 instead of failing', async () => {
    global.fetch = vi.fn(async () => new Response('{}', { status: 404 })) as any;
    const state = await fetchDatadogSyntheticExecutionState(config, 'pub-1', 'rid-1', 'api');
    expect(state.state).toBe('pending');
  });

  it('reports an auth error without treating it as a test failure', async () => {
    global.fetch = vi.fn(async () => new Response('{}', { status: 403 })) as any;
    const state = await fetchDatadogSyntheticExecutionState(config, 'pub-1', 'rid-1', 'api');
    expect(state.state).toBe('auth_error');
  });

  it('reports rate limiting with a retry hint', async () => {
    global.fetch = vi.fn(
      async () => new Response('{}', { status: 429, headers: { 'retry-after': '30' } })
    ) as any;
    const state = await fetchDatadogSyntheticExecutionState(config, 'pub-1', 'rid-1', 'api');
    expect(state.state).toBe('rate_limited');
    if (state.state === 'rate_limited') expect(state.retryAfterMs).toBe(30000);
  });

  it('returns a terminal detail when the provider result is available', async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { status: 'passed', duration: 10, steps: [] } }), {
          status: 200,
        })
    ) as any;
    const state = await fetchDatadogSyntheticExecutionState(config, 'pub-1', 'rid-1', 'api');
    expect(state.state).toBe('terminal');
    if (state.state === 'terminal') expect(state.detail.overallStatus).toBe('pass');
  });

  it('does not fetch when no result id exists yet', async () => {
    const spy = vi.fn();
    global.fetch = spy as any;
    const state = await fetchDatadogSyntheticExecutionState(config, 'pub-1', '', 'api');
    expect(state.state).toBe('pending');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('triggerDatadogSyntheticsTests', () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          batch_id: 'batch-1',
          results: [{ public_id: 'pub-1', result_id: 'rid-1', test_name: 'Checkout' }],
        }),
        { status: 200 }
      )
    ) as any;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends variable overrides and returns immediately with result ids', async () => {
    const result = await triggerDatadogSyntheticsTests(config, {
      publicIds: ['pub-1'],
      environmentName: 'uat',
      inkaVariables: { API_TOKEN: 'abc' },
      executionRule: 'blocking',
      retryCount: 2,
    });

    expect(result.batchId).toBe('batch-1');
    expect(result.executions[0]).toMatchObject({ publicId: 'pub-1', resultId: 'rid-1' });

    const [, init] = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.tests[0]).toMatchObject({
      public_id: 'pub-1',
      executionRule: 'blocking',
      variables: { API_TOKEN: 'abc' },
      retry: { count: 2 },
    });
  });

  it('surfaces a permission error with a clear diagnostic', async () => {
    global.fetch = vi.fn(async () => new Response('forbidden', { status: 403 })) as any;
    await expect(
      triggerDatadogSyntheticsTests(config, { publicIds: ['pub-1'] })
    ).rejects.toThrow(/synthetics_write/);
  });
});

describe('monitor policy helpers', () => {
  it('backs off exponentially with a ceiling', () => {
    expect(computePollBackoffMs(0)).toBe(DEFAULT_POLL_INTERVAL_MS);
    expect(computePollBackoffMs(1)).toBe(DEFAULT_POLL_INTERVAL_MS * 2);
    expect(computePollBackoffMs(10)).toBe(MAX_POLL_INTERVAL_MS);
  });

  it('honours Retry-After when it is longer than the backoff', () => {
    expect(computePollBackoffMs(0, DEFAULT_POLL_INTERVAL_MS, 45_000)).toBe(45_000);
  });

  it('detects expiry', () => {
    expect(isMonitorExpired(new Date(Date.now() - 1000))).toBe(true);
    expect(isMonitorExpired(new Date(Date.now() + 60_000))).toBe(false);
  });

  it('derives the aggregate outcome without inventing results', () => {
    expect(deriveOverallFromExecutions([])).toBe('UNAVAILABLE');
    expect(deriveOverallFromExecutions([record()])).toBe('PENDING');
    expect(deriveOverallFromExecutions([record({ status: 'fail' }), record({ status: 'pending' })])).toBe(
      'PENDING'
    );
    expect(deriveOverallFromExecutions([record({ status: 'pass' }), record({ status: 'fail' })])).toBe(
      'FAIL'
    );
    expect(deriveOverallFromExecutions([record({ status: 'skip' })])).toBe('SKIP');
    expect(deriveOverallFromExecutions([record({ status: 'pass' })])).toBe('PASS');
  });
});

describe('buildExternalResultFromExecutions', () => {
  const startedAtMs = Date.now() - 5000;

  it('builds a pending result that is not a failure', () => {
    const result = buildExternalResultFromExecutions({
      executions: [record()],
      batchId: 'batch-1',
      environment: 'UAT',
      executionRule: 'blocking',
      startedAtMs,
    });
    expect(result.overallStatus).toBe('PENDING');
    expect(result.stepResults['1'].status).toBe('pending');
    expect(result.summary).toMatch(/awaiting results/i);
  });

  it('preserves sub-steps, failures and links for a terminal result', () => {
    const result = buildExternalResultFromExecutions({
      executions: [
        record({
          status: 'fail',
          durationMs: 1200,
          failureMessage: 'Assertion failed',
          externalResultUrl: 'https://app.datadoghq.com/synthetics/details/pub-1?resultId=rid-1',
          subSteps: [
            {
              order: 1,
              name: 'Click submit',
              status: 'fail',
              durationMs: 200,
              detail: 'failed',
              failureMessage: 'Element not found',
              screenshotBucketKey: '2/e2e/shot.png',
            },
          ],
        }),
      ],
      batchId: 'batch-1',
      environment: 'UAT',
      executionRule: 'blocking',
      startedAtMs,
    });

    expect(result.overallStatus).toBe('FAIL');
    expect(result.stepResults['1'].status).toBe('fail');
    expect(result.stepResults['1'].subSteps?.[0]).toMatchObject({
      name: 'Click submit',
      screenshotBucketKey: '2/e2e/shot.png',
    });
    expect(result.externalUrl).toContain('resultId=rid-1');
    expect(result.automationLog).toContain('Click submit');
  });

  it('marks an expired monitor as unavailable, never failed', () => {
    const result = buildExternalResultFromExecutions({
      executions: [record()],
      batchId: 'batch-1',
      environment: 'UAT',
      executionRule: 'blocking',
      startedAtMs,
      expired: true,
      unavailableReason: 'No terminal result after 30 minutes of monitoring.',
    });

    expect(result.overallStatus).toBe('UNAVAILABLE');
    expect(result.stepResults['1'].status).toBe('unavailable');
    expect(result.summary).toMatch(/result unavailable/i);
    expect(result.summary).not.toMatch(/failed/i);
  });
});
