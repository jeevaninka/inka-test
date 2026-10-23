import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchDatadogSyntheticResultDetail,
  executeDatadogSyntheticsRun,
  type DatadogIntegrationConfig,
} from '@/lib/integrations/tool-clients';
import { deriveCaseStatus } from '@/app/(main)/p/[slug]/runs/[runId]/ExecutionConsole';
import type { StepItem } from '@/lib/types';

const config: DatadogIntegrationConfig = {
  site: 'datadoghq.com',
  apiKey: 'dd-api-key-test',
  appKey: 'dd-app-key-test',
};

const browserPayload = {
  data: {
    attributes: {
      result: {
        id: 'rid-1',
        duration: 4200,
        failure: null,
        steps: [
          {
            description: 'Navigate to login page',
            duration: 900,
            bucket_keys: { screenshot: '2/e2e/shot-1.png' },
          },
          {
            description: 'Click submit',
            duration: 1200,
            failure: { message: 'Element #submit not found' },
            bucket_keys: { screenshot: '2/e2e/shot-2.png' },
            assertions: [
              { type: 'assertElementPresent', valid: false, error_message: 'missing #submit' },
            ],
          },
        ],
      },
    },
  },
};

const apiPayload = {
  result: {
    duration: 300,
    failure: { message: 'Assertion failed: status code equals 200' },
    assertions: [{ type: 'statusCode', operator: 'equals', target: 200, valid: false }],
  },
};

function ok(json: any) {
  return { ok: true, status: 200, json: async () => json, text: async () => JSON.stringify(json) };
}
function notFound() {
  return { ok: false, status: 404, json: async () => null, text: async () => 'not found' };
}

describe('Datadog Synthetic result detail ingestion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps a browser (v2) result into step-level detail with screenshot bucket keys', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      calls.push(String(url));
      return ok(browserPayload);
    });

    const detail = await fetchDatadogSyntheticResultDetail(config, 'pub-1', 'rid-1', 'browser');

    expect(detail).not.toBeNull();
    expect(detail!.hasStepDetail).toBe(true);
    expect(detail!.testType).toBe('browser');
    expect(detail!.overallStatus).toBe('fail');
    expect(detail!.steps).toHaveLength(2);
    expect(detail!.steps[0].status).toBe('pass');
    expect(detail!.steps[0].screenshotBucketKey).toBe('2/e2e/shot-1.png');
    expect(detail!.steps[1].status).toBe('fail');
    expect(detail!.steps[1].failureMessage).toBe('Element #submit not found');
    expect(detail!.steps[1].assertions?.[0].passed).toBe(false);
    expect(detail!.externalResultUrl).toContain('/synthetics/details/pub-1');
    expect(detail!.externalResultUrl).toContain('resultId=rid-1');
    // Browser tests must hit the v2 endpoint first.
    expect(calls[0]).toContain('/api/v2/synthetics/tests/browser/pub-1/results/rid-1');
  });

  it('maps an API (v1) result with a test-level failure and no fabricated steps', async () => {
    vi.stubGlobal('fetch', async () => ok(apiPayload));

    const detail = await fetchDatadogSyntheticResultDetail(config, 'pub-2', 'rid-2', 'api');

    expect(detail).not.toBeNull();
    expect(detail!.hasStepDetail).toBe(false);
    expect(detail!.steps).toHaveLength(0);
    expect(detail!.overallStatus).toBe('fail');
    expect(detail!.failureMessage).toBe('Assertion failed: status code equals 200');
  });

  it('ingests sub-steps into the run result without losing the aggregate result', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('/trigger/ci')) {
        return ok({ batch_id: 'batch-1' });
      }
      if (u.includes('/ci/batch/')) {
        return ok({
          data: {
            status: 'completed',
            results: [
              {
                public_id: 'pub-1',
                result_id: 'rid-1',
                status: 'failed',
                test_name: 'Checkout journey',
                duration: 5000,
                test_type: 'browser',
              },
            ],
          },
        });
      }
      return ok(browserPayload);
    });

    const result = await executeDatadogSyntheticsRun(config, {
      publicIds: ['pub-1'],
      executionRule: 'blocking',
      pollingIntervalMs: 1500,
      pollingTimeoutMs: 8000,
    });

    expect(result.overallStatus).toBe('FAIL');
    expect(result.steps).toHaveLength(1);
    const step = result.steps[0];
    expect(step.name).toBe('Checkout journey');
    expect(step.status).toBe('fail');
    expect(step.subSteps).toHaveLength(2);
    expect(step.failureMessage).toBe('Element #submit not found');
    expect(result.externalUrl).toContain('resultId=rid-1');
    expect(result.automationLog).toContain('Element #submit not found');
    expect(result.stepResults['1'].subSteps).toHaveLength(2);

    // The primary test case step must still be a single, aggregated result.
    expect(Object.keys(result.stepResults)).toEqual(['1']);
  });

  it('keeps the aggregate result when the detail endpoint is unavailable', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      const u = String(url);
      if (u.includes('/trigger/ci')) return ok({ batch_id: 'batch-2' });
      if (u.includes('/ci/batch/')) {
        return ok({
          data: {
            status: 'completed',
            results: [
              { public_id: 'pub-9', result_id: 'rid-9', status: 'failed', test_name: 'Health check' },
            ],
          },
        });
      }
      return notFound();
    });

    const result = await executeDatadogSyntheticsRun(config, {
      publicIds: ['pub-9'],
      executionRule: 'blocking',
      pollingIntervalMs: 1500,
      pollingTimeoutMs: 8000,
    });

    expect(result.overallStatus).toBe('FAIL');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe('fail');
    expect(result.steps[0].subSteps).toBeUndefined();
    expect(result.steps[0].externalResultUrl).toContain('resultId=rid-9');
  });
});

describe('Execution console status regression (reopen completed case)', () => {
  it('keeps a completed external case at pass/fail — never regresses to "started"/pending on reopen', () => {
    const steps: StepItem[] = [
      { order: 1, step: 'Execute GET /health', expected_result: 'Status code is 2xx', id: 's1', data: null, image_url: null, reusable_step_id: null, reusable_step_item_id: null, is_outdated: false },
      { order: 2, step: 'Verify: statusCode equals 200', expected_result: 'Status code is 200', id: 's2', data: null, image_url: null, reusable_step_id: null, reusable_step_item_id: null, is_outdated: false },
      { order: 3, step: 'Verify: body.healthy equals true', expected_result: 'body.healthy equals true', id: 's3', data: null, image_url: null, reusable_step_id: null, reusable_step_item_id: null, is_outdated: false },
    ];

    // First open: all steps executed, case passed
    const stepResultsPass = {
      '1': { status: 'pass' },
      '2': { status: 'pass' },
      '3': { status: 'pass' },
    };
    expect(deriveCaseStatus(steps, stepResultsPass)).toBe('pass');

    // Second open (reopen simulation): same data, status must not change
    expect(deriveCaseStatus(steps, stepResultsPass)).toBe('pass');

    // A failed step must still resolve to fail, not pending
    const stepResultsFail = {
      '1': { status: 'pass' },
      '2': { status: 'fail' },
      '3': { status: 'pass' },
    };
    expect(deriveCaseStatus(steps, stepResultsFail)).toBe('fail');

    // Empty stepResults (no execution yet) is the only legitimate pending case
    expect(deriveCaseStatus(steps, {})).toBe('pending');
  });
});
