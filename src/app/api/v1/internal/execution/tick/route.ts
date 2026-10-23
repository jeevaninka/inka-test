import { NextRequest, NextResponse } from 'next/server';
import { processDueExternalMonitors } from '@/lib/integrations/execution-monitor';
import { recoverInterruptedRuns, tickActiveRuns } from '@/lib/execution/coordinator';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Durable scheduler entry point for external cron/worker hosts. Protected by a
 * shared secret so it can never be used to trigger executions anonymously.
 * The in-process worker (src/instrumentation.ts) calls the same functions.
 */
function authorized(request: NextRequest): boolean {
  const secret = process.env.EXECUTION_TICK_SECRET;
  if (!secret) return false;
  const header =
    request.headers.get('x-execution-tick-secret') ||
    request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  return Boolean(header) && header === secret;
}

async function tick() {
  const monitors = await processDueExternalMonitors(10);
  const recovered = await recoverInterruptedRuns(10);
  const runs = await tickActiveRuns(10);
  return { monitors, recovered: recovered.recovered, runs: runs.ticked };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await tick();
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    logger.error('Execution scheduler endpoint failed', { error: e?.message });
    return NextResponse.json({ error: 'Scheduler tick failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
