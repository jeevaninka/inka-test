/**
 * LIVE Datadog verification (opt-in only).
 *
 * Skipped unless INKA_LIVE_DATADOG=1. This test performs REAL network calls
 * against the workspace's Datadog account using the stored integration keys.
 * It is read-only by default; set INKA_LIVE_DATADOG_TRIGGER=1 to also trigger a
 * real synthetic execution (this consumes Datadog usage and runs the test's
 * real steps against its configured target).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/db';
import { decrypt } from '@/lib/crypto';
import { normalizeDatadogSite, detectDatadogVariables } from '@/lib/integrations/tool-clients';

const LIVE = process.env.INKA_LIVE_DATADOG === '1';
const TRIGGER = process.env.INKA_LIVE_DATADOG_TRIGGER === '1';
const PUBLIC_ID = process.env.INKA_LIVE_DATADOG_TEST || 'yeh-sxw-6nu';

let cfg: { site: string; apiKey: string; appKey: string } | null = null;

beforeAll(async () => {
  const row = await prisma.integration.findFirst({
    where: { provider: 'datadog', enabled: true },
  });
  if (!row) return;
  const raw = row.config as any;
  cfg = {
    site: normalizeDatadogSite(raw?.site),
    apiKey: decrypt((raw?.apiKey || '').trim()),
    appKey: decrypt((raw?.appKey || '').trim()),
  };
});

describe.skipIf(!LIVE)('live Datadog integration', () => {
  it('decrypts stored credentials and reads the linked test definition', async () => {
    expect(cfg?.apiKey, 'datadog apiKey present').toBeTruthy();
    expect(cfg?.appKey, 'datadog appKey present').toBeTruthy();

    const res = await fetch(
      `https://api.${cfg!.site}/api/v1/synthetics/tests/${PUBLIC_ID}`,
      {
        headers: {
          'DD-API-KEY': cfg!.apiKey,
          'DD-APPLICATION-KEY': cfg!.appKey,
          Accept: 'application/json',
        },
      }
    );
    expect(res.status, `GET /synthetics/tests/${PUBLIC_ID}`).toBe(200);
    const json: any = await res.json();
    const test = json?.test || json;
    console.log('[live] test type:', test?.type, 'name:', test?.name, 'status:', test?.status);

    const isBrowser = String(test?.type || '').toLowerCase() === 'browser';
    let config = test?.config;
    if (isBrowser) {
      // The browser definition endpoint is v1; its steps live at the top level.
      const bres = await fetch(
        `https://api.${cfg!.site}/api/v1/synthetics/tests/browser/${PUBLIC_ID}`,
        {
          headers: {
            'DD-API-KEY': cfg!.apiKey,
            'DD-APPLICATION-KEY': cfg!.appKey,
            Accept: 'application/json',
          },
        }
      );
      if (bres.ok) {
        const bjson: any = await bres.json();
        const t = bjson?.test || bjson?.data?.attributes || bjson;
        config = { ...(t?.config || {}), steps: Array.isArray(t?.steps) ? t.steps : [] };
        console.log('[live] browser def keys:', Object.keys(t || {}), 'http status:', bres.status);
      } else {
        console.log('[live] browser def HTTP:', bres.status);
      }
    }

    const vars = detectDatadogVariables(config, []);
    console.log('[live] overridable variables:', vars.map((v) => `${v.name}${v.example ? `=${v.example}` : ''}`).join(', ') || '(none)');

    // Structure probe (no secrets): what fields does each real step carry?
    console.log('[live] config keys:', JSON.stringify(Object.keys(config || {})), 'startUrl:', JSON.stringify((config as any)?.request?.url));
    const probeSteps: any[] = Array.isArray(config?.steps) ? config.steps : [];
    console.log('[live] step count:', probeSteps.length, 'subTests:', Array.isArray(config?.subTests) ? config.subTests.length : 0);
    probeSteps.slice(0, 40).forEach((s: any, i: number) => {
      const el = s?.params?.element;
      let co: any[] = [];
      try {
        co = typeof el?.multiLocator?.co === 'string' ? JSON.parse(el.multiLocator.co) : el?.multiLocator?.co || [];
      } catch {
        co = [];
      }
      console.log(
        `[live] step[${i}]`,
        JSON.stringify({
          type: s?.type,
          name: s?.name,
          stepId: s?.public_id || s?.id,
          value: s?.params?.value,
          check: s?.params?.check,
          at: el?.multiLocator?.at,
          ro: el?.multiLocator?.ro,
          co: co.map((c: any) => ({ text: c?.text, textType: c?.textType, tagName: c?.tagName })),
          flags: {
            allowFailure: s?.allowFailure,
            isCritical: s?.isCritical,
            alwaysExecute: s?.alwaysExecute,
            exitIfSucceed: s?.exitIfSucceed,
          },
        })
      );
    });
    console.log('[live] sanitized definition keys:', Object.keys(test || {}));

    const { buildDatadogPreConditions, buildDatadogSteps } = await import('@/lib/integrations/datadog-steps');
    const built = buildDatadogSteps({ ...(test || {}), config });
    console.log('[live] pre-conditions:\n' + buildDatadogPreConditions({ ...(test || {}), config }, built));
    console.log(
      '[live] built steps:\n' +
        built
          .map((s) => `${s.order}. ${s.step}${s.expectedResult ? ` -> ${s.expectedResult}` : ''}`)
          .join('\n')
    );

    const globalRes = await fetch(`https://api.${cfg!.site}/api/v1/synthetics/variables`, {
      headers: {
        'DD-API-KEY': cfg!.apiKey,
        'DD-APPLICATION-KEY': cfg!.appKey,
        Accept: 'application/json',
      },
    });
    console.log('[live] global variables endpoint status:', globalRes.status);
    if (globalRes.ok) {
      const gj: any = await globalRes.json();
      console.log('[live] global variables:', (gj?.variables || []).map((v: any) => v.name).join(', ') || '(none)');
    }
  });

  it.skipIf(!TRIGGER)('triggers a real execution and observes a terminal state', async () => {
    const { triggerDatadogSyntheticsTests, fetchDatadogSyntheticExecutionState } = await import(
      '@/lib/integrations/tool-clients'
    );
    const trigger = await triggerDatadogSyntheticsTests(cfg as any, {
      publicIds: [PUBLIC_ID],
      environmentName: 'uat',
      executionRule: 'blocking',
      delayMs: 0,
      retryCount: 0,
    });
    console.log('[live] batch:', trigger.batchId, 'executions:', JSON.stringify(trigger.executions));
    expect(trigger.executions.length).toBeGreaterThan(0);

    const exec = trigger.executions[0];
    let state: any = { state: 'pending' };
    const deadline = Date.now() + 8 * 60 * 1000;
    while (Date.now() < deadline) {
      state = await fetchDatadogSyntheticExecutionState(
        cfg as any,
        exec.publicId,
        exec.resultId,
        exec.testType || 'browser'
      );
      console.log('[live] poll:', state.state, state.state === 'terminal' ? state.detail?.overallStatus : '');
      if (state.state === 'terminal' || state.state === 'auth_error' || state.state === 'error') break;
      await new Promise((r) => setTimeout(r, 15000));
    }
    console.log('[live] final state:', state.state, state.state === 'terminal' ? state.detail?.overallStatus : '');
    expect(state.state).not.toBe('error');
  }, 9 * 60 * 1000);
});
