import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { FAILED_RESULT_STATUSES, latestAttempts } from './state';

export type RetryMode = 'all' | 'failed_only';

export interface CreateRetryAttemptsInput {
  runId: string;
  /** Restrict to these result ids (latest attempt rows). Omit for the whole run. */
  resultIds?: string[];
  /**
   * `rerun-all` targets every settled case; `rerun-failed` only failed ones;
   * `resume` only the cases that were cancelled by a stop, so a stopped run
   * can be continued without losing the previous attempts.
   */
  mode: 'rerun-all' | 'rerun-failed' | 'resume';
  /** Only used by `rerun-all`: starts a new run generation. */
  bumpGeneration?: boolean;
  /**
   * Iteration retry policy. `failed_only` keeps passing iterations and resets
   * the rest; `all` (default) starts every iteration fresh.
   */
  retryMode?: RetryMode;
}

export interface CreateRetryAttemptsResult {
  createdIds: string[];
  skippedPending: number;
  generation: number;
}

/**
 * Create fresh attempts instead of destructively resetting previous evidence.
 *
 * The whole operation is serialized per run with a Postgres advisory lock so two
 * concurrent Rerun clicks cannot create duplicate attempts. Older attempts are
 * left untouched and remain available as history.
 */
export async function createRetryAttempts(
  input: CreateRetryAttemptsInput
): Promise<CreateRetryAttemptsResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.runId}))`;

    const run = await tx.testRun.findUnique({
      where: { id: input.runId },
      select: {
        id: true,
        source: true,
        execution_generation: true,
        status: true,
      },
    });
    if (!run) throw new Error('Run not found');
    if (run.status === 'ABORTED') throw new Error('Cannot re-run in an aborted run');

    const all = await tx.runResult.findMany({
      where: { run_id: input.runId },
      orderBy: [{ order_index: 'asc' }, { attempt_number: 'asc' }],
    });
    let latest = latestAttempts(all);
    if (input.resultIds && input.resultIds.length > 0) {
      const wanted = new Set(input.resultIds);
      latest = latest.filter((row) => wanted.has(row.id));
    }

    if (input.mode === 'rerun-failed') {
      const failed = new Set<string>(FAILED_RESULT_STATUSES as unknown as string[]);
      latest = latest.filter((row) => failed.has(String(row.status).toUpperCase()));
    } else if (input.mode === 'resume') {
      // Only the cases that a stop cancelled can be continued.
      latest = latest.filter((row) => String(row.status).toUpperCase() === 'CANCELLED');
    }

    // Never create a second attempt for a case that is still in flight.
    const pending = latest.filter((row) => String(row.status).toUpperCase() === 'PENDING');
    const targets = latest.filter((row) => String(row.status).toUpperCase() !== 'PENDING');

    const generation = input.bumpGeneration
      ? run.execution_generation + 1
      : run.execution_generation;

    if (input.bumpGeneration) {
      // A new generation must not swallow an execution that is already owned by
      // a provider/worker; require the run to be idle first.
      const active = await tx.runResult.count({
        where: {
          run_id: run.id,
          status: 'PENDING',
          execution_state: { in: ['RUNNING', 'WAITING'] },
        },
      });
      if (active > 0) {
        throw new Error('Stop the active case before rerunning all cases');
      }

      // Pending cases that were never executed stay part of the run; move them
      // to the new generation so they remain claimable.
      await tx.runResult.updateMany({
        where: {
          run_id: run.id,
          status: 'PENDING',
          execution_state: { in: ['IDLE', 'QUEUED'] },
        },
        data: { execution_generation: generation },
      });

      await tx.testRun.update({
        where: { id: run.id },
        data: {
          execution_generation: generation,
          stop_requested_at: null,
          next_dispatch_at: null,
        },
      });
    }

    const createdIds: string[] = [];
    for (const original of targets) {
      const maxAttempt = await tx.runResult.aggregate({
        where: { run_id: run.id, test_case_id: original.test_case_id },
        _max: { attempt_number: true },
      });
      const nextAttempt = (maxAttempt._max.attempt_number ?? 0) + 1;

      let initialIterationResults: any = undefined;
      if (
        (input.retryMode || 'all') === 'failed_only' &&
        original.iteration_results &&
        Array.isArray(original.iteration_results) &&
        original.iteration_results.length > 0
      ) {
        initialIterationResults = (original.iteration_results as any[]).map((iter: any) => {
          if (String(iter?.status || '').toLowerCase() === 'pass') return iter;
          return { ...iter, status: 'pending', step_results: {}, executed_at: undefined };
        });
      }

      const created = await tx.runResult.create({
        data: {
          run_id: run.id,
          test_case_id: original.test_case_id,
          test_version_id: original.test_version_id,
          order_index: original.order_index,
          attempt_number: nextAttempt,
          status: 'PENDING',
          execution_state: 'IDLE',
          execution_generation: generation,
          assigned_to: original.assigned_to,
          provider: original.provider,
          source: ['postman', 'datadog', 'mixed', 'automated'].includes(
            String(run.source || '')
          )
            ? 'automated'
            : 'manual',
          iteration_results: initialIterationResults
            ? (initialIterationResults as any)
            : Prisma.DbNull,
        },
      });
      createdIds.push(created.id);
    }

    return { createdIds, skippedPending: pending.length, generation };
  });
}
