import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { triggerProjectWebhooks } from '@/lib/webhook';
import { createApiHandler, apiErrorResponse } from '@/lib/apiHandler';
import { requireProjectMemberByRunId } from '@/lib/permissions';
import { getRunResultsAction } from '@/app/actions/runs';
import { logger } from '@/lib/logger';
import { ErrorCodes, normalizeError } from '@/lib/errors';

// GET /api/v1/runs/:runId/results
// Authenticated session user endpoint returning all execution results for this run
export const GET = createApiHandler<{ runId: string }>(async (req, { params, userId, requestId }) => {
  const { runId } = await params;

  if (!runId) {
    return apiErrorResponse('Run ID is required', 400, ErrorCodes.VALIDATION, requestId);
  }

  await requireProjectMemberByRunId(runId, userId);
  const results = await getRunResultsAction(runId);
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

    const run = await prisma.testRun.findUnique({
      where: { id: runId },
      include: { project: { select: { id: true, api_secret: true } } },
    });

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

    // Find the RunResult for this run + testCase
    const runResult = await prisma.runResult.findFirst({
      where: { run_id: runId, test_case_id: testCaseId },
    });

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

    // Return run progress
    const allResults = await prisma.runResult.findMany({
      where: { run_id: runId },
      select: { status: true },
    });

    const progress = {
      total: allResults.length,
      pass: allResults.filter((r) => r.status === 'PASS').length,
      fail: allResults.filter((r) => r.status === 'FAIL').length,
      error: allResults.filter((r) => r.status === 'ERROR').length,
      blocked: allResults.filter((r) => r.status === 'BLOCKED').length,
      skip: allResults.filter((r) => r.status === 'SKIP').length,
      invalid: allResults.filter((r) => r.status === 'INVALID').length,
      pending: allResults.filter((r) => r.status === 'PENDING').length,
      cancelled: allResults.filter((r) => r.status === 'CANCELLED').length,
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
