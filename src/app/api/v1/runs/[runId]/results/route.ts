import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { triggerProjectWebhooks } from '@/lib/webhook';
import { createApiHandler, apiErrorResponse } from '@/lib/apiHandler';
import { requireProjectMemberByRunId } from '@/lib/permissions';
import { loadRunResults } from '@/lib/runs/load-results';
import { logger } from '@/lib/logger';
import { ErrorCodes, normalizeError } from '@/lib/errors';

// GET /api/v1/runs/:runId/results
// Authenticated session user endpoint returning all execution results for this run
export const GET = createApiHandler<{ runId: string }>(async (req, { params, userId, requestId }) => {
  const { runId } = await params;

  if (!runId) {
    return apiErrorResponse('Run ID is required', 400, ErrorCodes.VALIDATION, requestId);
  }

  // Authorization happens once, here; loadRunResults performs no checks.
  await requireProjectMemberByRunId(runId, userId);
  const results = await loadRunResults(runId);
  return NextResponse.json(results);
});

// PATCH /api/v1/runs/:runId/results
// Headers: X-Api-Key or Authorization: Bearer <key>
// Body: { testCaseId, status, notes?, stepResults?, automationLog? }
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  const startTime = performance.now();

  try {
    const apiKey =
      request.headers.get('x-api-key') ||
      request.headers.get('authorization')?.replace(/^Bearer\s+/, '');

    if (!apiKey) {
      return apiErrorResponse(
        'API key required. Provide via X-Api-Key header or Authorization: Bearer <key>',
        401,
        ErrorCodes.UNAUTHORIZED,
        requestId
      );
    }

    const { runId } = await params;

    // Parse first (no I/O) so the run + result lookups can be issued together.
    const body = await request.json().catch(() => null);
    if (!body) {
      return apiErrorResponse('Invalid JSON body', 400, ErrorCodes.VALIDATION, requestId);
    }

    const { testCaseId, status, notes, stepResults, automationLog, triggerRef } = body;

    if (!testCaseId) {
      return apiErrorResponse('testCaseId is required', 400, ErrorCodes.VALIDATION, requestId);
    }

    if (!status) {
      return apiErrorResponse('status is required', 400, ErrorCodes.VALIDATION, requestId);
    }

    // Independent lookups: one round-trip instead of two.
    const [run, runResult] = await Promise.all([
      prisma.testRun.findUnique({
        where: { id: runId },
        include: { project: { select: { id: true, api_secret: true } } },
      }),
      prisma.runResult.findFirst({
        where: { run_id: runId, test_case_id: testCaseId },
      }),
    ]);

    if (!run) {
      return apiErrorResponse('Run not found', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    if (!run.project.api_secret) {
      return apiErrorResponse(
        'Project API secret not configured. Generate one in Project Settings > Integrations.',
        403,
        ErrorCodes.FORBIDDEN,
        requestId
      );
    }

    if (run.project.api_secret !== apiKey) {
      logger.warn('Invalid API key for automated run result update', {
        module: 'RunResultsAPI',
        action: 'patchResult',
        runId,
        projectId: run.project_id,
        requestId,
      });
      return apiErrorResponse('Invalid API key', 401, ErrorCodes.UNAUTHORIZED, requestId);
    }

    if (!runResult) {
      return apiErrorResponse(
        'RunResult not found for this run and test case',
        404,
        ErrorCodes.NOT_FOUND,
        requestId
      );
    }

    // Update the result
    const updateData: any = {
      status: status.toUpperCase(),
      executed_at: new Date(),
      source: 'automated',
    };

    if (notes !== undefined) updateData.notes = notes;
    if (stepResults !== undefined) updateData.step_results = stepResults;
    if (automationLog !== undefined) updateData.automation_log = automationLog;

    await prisma.runResult.update({
      where: { id: runResult.id },
      data: updateData,
    });


    // Optionally update the run trigger ref
    if (triggerRef) {
      await prisma.testRun.update({
        where: { id: runId },
        data: { trigger_ref: triggerRef },
      });
    }

    // Fire webhook in background without blocking API response
    triggerProjectWebhooks(run.project_id, 'result.updated', {
      runId,
      runResultId: runResult.id,
      testCaseId,
      status: status.toUpperCase(),
      source: 'automated',
    }).catch((err) => {
      logger.error('Failed to trigger project webhook on automated result update', {
        module: 'RunResultsAPI',
        action: 'triggerWebhook',
        runId,
        projectId: run.project_id,
        errorCode: ErrorCodes.WEBHOOK_DELIVERY,
        error: err,
      });
    });

    // Return run progress. A grouped count keeps the row count O(statuses)
    // instead of transferring every result of the run.
    const statusCounts = await prisma.runResult.groupBy({
      by: ['status'],
      where: { run_id: runId },
      _count: { _all: true },
    });

    const countsByStatus = new Map<string, number>();
    let totalResults = 0;
    for (const row of statusCounts) {
      countsByStatus.set(row.status, row._count._all);
      totalResults += row._count._all;
    }
    const countOf = (s: string) => countsByStatus.get(s) ?? 0;

    const progress = {
      total: totalResults,
      pass: countOf('PASS'),
      fail: countOf('FAIL'),
      error: countOf('ERROR'),
      blocked: countOf('BLOCKED'),
      skip: countOf('SKIP'),
      invalid: countOf('INVALID'),
      pending: countOf('PENDING'),
      cancelled: countOf('CANCELLED'),
    };

    logger.info('Automated run result updated via API key', {
      module: 'RunResultsAPI',
      action: 'patchResult',
      runId,
      projectId: run.project_id,
      testCaseId,
      resultId: runResult.id,
      verdict: status.toUpperCase(),
      durationMs: Math.round(performance.now() - startTime),
      requestId,
    });

    return NextResponse.json({
      success: true,
      resultId: runResult.id,
      runProgress: progress,
    });
  } catch (err: any) {
    const normalized = normalizeError(err, ErrorCodes.INTERNAL, 'Failed to update run result');
    logger.error('Automated run result update failed', {
      module: 'RunResultsAPI',
      action: 'patchResult',
      requestId,
      durationMs: Math.round(performance.now() - startTime),
      errorCode: normalized.code,
      error: err,
    });
    return apiErrorResponse(normalized.message, normalized.status, normalized.code, requestId);
  }
}
