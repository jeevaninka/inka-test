/**
 * Backend worker registration.
 *
 * Execution progression (queue dispatch, Datadog monitor polling, lease
 * recovery) is owned by durable server-side state in the database. This
 * process-level interval is the default driver; the authenticated cron route
 * (`/api/v1/internal/execution/tick`) can drive the same functions on hosts
 * where a long-lived Node process is not guaranteed.
 *
 * The browser is only a consumer: it may request a low-frequency snapshot, but
 * closing it can never stop a run.
 */
const TICK_INTERVAL_MS = 10_000;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const globalRef = globalThis as unknown as { __inkaMonitorWorker?: boolean };
  if (globalRef.__inkaMonitorWorker) return; // avoid duplicate ticks under HMR
  globalRef.__inkaMonitorWorker = true;

  const { processDueExternalMonitors } = await import('@/lib/integrations/execution-monitor');
  const { tickActiveRuns, recoverInterruptedRuns } = await import('@/lib/execution/coordinator');
  const { logger } = await import('@/lib/logger');

  const tick = async () => {
    try {
      // 1) Provider monitors that are due (durable, locked, idempotent).
      const monitors = await processDueExternalMonitors(5);
      // 2) Queued/active runs (atomic claims; no duplicate dispatch).
      const runs = await tickActiveRuns(5);
      if (monitors > 0 || runs.ticked > 0) {
        logger.info('Execution scheduler tick', {
          monitors,
          runs: runs.ticked,
        });
      }
    } catch (e: any) {
      logger.warn('Execution scheduler tick failed', { error: e?.message });
    }
  };

  // Recover any execution that was in flight when the process last stopped.
  try {
    await recoverInterruptedRuns(10);
  } catch {
    // the regular tick retries
  }
  void tick();
  setInterval(() => void tick(), TICK_INTERVAL_MS);
  logger.info('Execution scheduler worker started', { intervalMs: TICK_INTERVAL_MS });
}
