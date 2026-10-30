import { prisma } from '@/lib/db';
import {
  normalizeExecutionState,
  computeQueuePositions,
  isTerminalResultStatus,
  EXECUTION_STATE,
} from '@/lib/execution/state';

/**
 * Load every result for a run, one row per case (latest attempt wins).
 *
 * This module is deliberately NOT a `'use server'` action: it performs no
 * authorization, so it must never be reachable directly from the client.
 * Callers authorize the run first (see `getRunResultsAction` for the
 * server-action entry point and the `/api/v1/runs/:runId/results` route for
 * the HTTP one).
 */
export async function loadRunResults(runId: string) {
  // The run header is only needed for legacy queue-state fallbacks, so it is
  // fetched alongside the results instead of after them.
  const [results, runHeader] = await Promise.all([
    prisma.runResult.findMany({
      where: { run_id: runId },
      orderBy: [{ test_case_id: 'asc' }, { attempt_number: 'desc' }],
      include: {
        test_case: true,
        test_version: { select: { version_number: true, snapshot_at: true } },
        defects: true,
      },
    }),
    prisma.testRun.findUnique({
      where: { id: runId },
      select: { run_context: true },
    }),
  ]);

  // Deduplicate: one row per case. Normally that is the highest attempt, but
  // bad imports/legacy writers can leave two rows for the same attempt (one
  // PASS and one PENDING). A terminal outcome must win: the run did execute.
  const byCase = new Map<string, (typeof results)[number]>();
  for (const row of results) {
    const current = byCase.get(row.test_case_id);
    if (!current) {
      byCase.set(row.test_case_id, row);
      continue;
    }
    const currentAttempt = current.attempt_number || 1;
    const nextAttempt = row.attempt_number || 1;
    if (nextAttempt > currentAttempt) {
      byCase.set(row.test_case_id, row);
      continue;
    }
    if (nextAttempt < currentAttempt) continue;
    const currentSettled = isTerminalResultStatus(current.status);
    const nextSettled = isTerminalResultStatus(row.status);
    if (!currentSettled && nextSettled) {
      byCase.set(row.test_case_id, row);
      continue;
    }
    if (currentSettled === nextSettled) {
      const currentAt = new Date(current.executed_at || current.started_at || 0).getTime();
      const nextAt = new Date(row.executed_at || row.started_at || 0).getTime();
      if (nextAt > currentAt) byCase.set(row.test_case_id, row);
    }
  }
  const latestResults = Array.from(byCase.values());

  // Sort by order_index for display
  latestResults.sort((a, b) => a.order_index - b.order_index);

  // Canonical queue/lease state lives on the RunResult row. The legacy
  // run_context.caseStates map is only a read-only fallback for runs that were
  // created before the coordinator migration.
  const legacyCaseStates = (((runHeader?.run_context as any)?.caseStates || {}) as Record<
    string,
    'QUEUED' | 'RUNNING'
  >);
  const queuePositions = computeQueuePositions(latestResults);

  // Aggregate cumulative time & max attempt per test_case_id across all attempts
  const totalTimeByCase = new Map<string, number>();
  const attemptsByCase = new Map<string, number>();
  const attemptHistoryByCase = new Map<string, Array<{ attemptNumber: number; timeSpentSeconds: number; status: string }>>();
  for (const r of results) {
    totalTimeByCase.set(r.test_case_id, (totalTimeByCase.get(r.test_case_id) || 0) + (r.time_spent_seconds || 0));
    attemptsByCase.set(r.test_case_id, Math.max(attemptsByCase.get(r.test_case_id) || 0, r.attempt_number || 1));
    if (!attemptHistoryByCase.has(r.test_case_id)) {
      attemptHistoryByCase.set(r.test_case_id, []);
    }
    attemptHistoryByCase.get(r.test_case_id)!.push({
      attemptNumber: r.attempt_number || 1,
      timeSpentSeconds: r.time_spent_seconds || 0,
      status: r.status.toLowerCase(),
    });
  }

  const assigneeIds = [...new Set(latestResults.map((r) => r.assigned_to).filter(Boolean))] as number[];
  const assignees = assigneeIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true, email: true, image: true } })
    : [];
  const assigneeMap = new Map(assignees.map((u) => [u.id, u]));

  return latestResults.map((r) => {
    const assignee = r.assigned_to ? assigneeMap.get(r.assigned_to) : null;
    const caseAttempts = (attemptHistoryByCase.get(r.test_case_id) || []).sort((a, b) => b.attemptNumber - a.attemptNumber);
    return {
      id: r.id,
      runId: r.run_id,
      testCaseId: r.test_case_id,
      testVersionId: r.test_version_id,
      orderIndex: r.order_index,
      attemptNumber: r.attempt_number,
      status: r.status.toLowerCase(),
      caseState: (() => {
        const executionState = normalizeExecutionState(r.execution_state);
        if (executionState === EXECUTION_STATE.QUEUED) return 'QUEUED';
        if (
          executionState === EXECUTION_STATE.RUNNING ||
          executionState === EXECUTION_STATE.WAITING
        ) {
          return 'RUNNING';
        }
        return legacyCaseStates[r.id] || null;
      })(),
      executionState: normalizeExecutionState(r.execution_state),
      queuePosition: queuePositions[r.id] ?? null,
      queuedAt: r.queued_at?.toISOString() ?? null,
      startedAt: r.started_at?.toISOString() ?? null,
      finishedAt: r.finished_at?.toISOString() ?? null,
      lastExecutionError: r.last_execution_error ?? null,
      notes: r.notes,
      evidenceUrl: r.evidence_url,
      executedBy: r.executed_by,
      executedAt: r.executed_at?.toISOString(),
      stepResults: r.step_results,
      iterationResults: r.iteration_results,
      failureReason: r.failure_reason,
      source: r.source,
      automationLog: r.automation_log,
      assignedTo: r.assigned_to,
      assignedToName: assignee?.name ?? null,
      assignedToAvatar: assignee?.image ?? null,
      timeSpentSeconds: r.time_spent_seconds ?? 0,
      totalTimeSpentSeconds: totalTimeByCase.get(r.test_case_id) ?? (r.time_spent_seconds ?? 0),
      totalAttempts: attemptsByCase.get(r.test_case_id) ?? (r.attempt_number ?? 1),
      attempts: caseAttempts,
      /**
       * The case as it exists today plus the version this run locked. The deck
       * uses it to (a) keep rendering a case that was deleted or archived and
       * (b) flag "case updated since added" without an extra request.
       */
      caseSnapshot: r.test_case
        ? {
            id: r.test_case.id,
            displayId: r.test_case.display_id,
            title: r.test_case.title,
            priority: r.test_case.priority,
            type: r.test_case.type,
            status: r.test_case.status,
            moduleId: r.test_case.module_id,
            tags: r.test_case.tags,
            labels: r.test_case.labels,
            customFields: r.test_case.custom_fields,
            deletedAt: r.test_case.deleted_at?.toISOString() ?? null,
            currentVersion: r.test_case.current_version,
            updatedAt: r.test_case.updated_at.toISOString(),
            snapshotVersion: r.test_version?.version_number ?? null,
            snapshotAt: r.test_version?.snapshot_at?.toISOString() ?? null,
          }
        : null,
      defects: r.defects.map((d) => ({
        id: d.id,
        runResultId: d.run_result_id,
        testCaseId: d.test_case_id,
        title: d.title,
        description: d.description,
        severity: d.severity.toLowerCase(),
        ticketUrl: d.ticket_url,
        externalTicketId: d.external_ticket_id,
        ticketStatus: d.ticket_status,
        raisedBy: d.raised_by,
        raisedAt: d.raised_at.toISOString(),
      })),
    };
  });
}
