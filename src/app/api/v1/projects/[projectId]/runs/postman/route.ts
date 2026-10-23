import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { generateTestRunId } from '@/lib/ids';
import { apiErrorResponse } from '@/lib/apiHandler';
import { ErrorCodes } from '@/lib/errors';

/**
 * POST /api/v1/projects/:projectId/runs/postman
 * Ingests Postman CLI / Newman JSON reports or CI Postman execution summaries
 * and records them as a TestRun (source: 'postman') in InkaTest.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();

  try {
    const apiKey =
      request.headers.get('x-api-key') ||
      request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

    if (!apiKey) {
      return apiErrorResponse(
        'API key required via X-Api-Key or Authorization: Bearer <key>',
        401,
        ErrorCodes.UNAUTHORIZED,
        requestId
      );
    }

    const { projectId } = await params;
    const project = await prisma.project.findFirst({
      where: {
        OR: [{ id: projectId }, { slug: projectId }],
        deleted_at: null,
      },
      select: { id: true, key: true, api_secret: true, created_by: true },
    });

    if (!project) {
      return apiErrorResponse('Project not found', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    if (!project.api_secret || project.api_secret !== apiKey) {
      return apiErrorResponse('Invalid API key', 401, ErrorCodes.UNAUTHORIZED, requestId);
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return apiErrorResponse('Invalid JSON payload', 400, ErrorCodes.VALIDATION, requestId);
    }

    const cases = await prisma.testCase.findMany({
      where: { project_id: project.id, deleted_at: null },
      select: { id: true, display_id: true, title: true, current_version: true },
    });
    const byDisplayId = new Map(cases.map((c) => [c.display_id.toUpperCase(), c]));

    const parsedResults: Array<{
      testCaseId: string;
      versionNumber: number;
      status: 'PASS' | 'FAIL' | 'SKIP';
      durationSec: number;
      notes: string;
      automationLog: string;
    }> = [];

    // Format A: Newman / Postman CLI JSON reporter payload ({ collection, run: { executions: [...] } })
    if (Array.isArray(body?.run?.executions)) {
      const keyRegex = new RegExp(`\\b(${project.key}-\\d+|[A-Z]{2,4}-\\d+)\\b`, 'i');
      for (const exec of body.run.executions) {
        const itemName = String(exec?.item?.name || '');
        const match = itemName.match(keyRegex);
        const key = match ? match[1].toUpperCase() : null;
        const tc = key ? byDisplayId.get(key) : null;
        if (!tc) continue;

        const assertions: any[] = Array.isArray(exec?.assertions) ? exec.assertions : [];
        const hasAssertionError = assertions.some((a) => Boolean(a?.error));
        const statusCode = Number(exec?.response?.code || 0);
        const isPass = !hasAssertionError && statusCode >= 200 && statusCode < 400;
        const durationMs = Number(exec?.response?.responseTime || 0);

        parsedResults.push({
          testCaseId: tc.id,
          versionNumber: tc.current_version || 1,
          status: isPass ? 'PASS' : 'FAIL',
          durationSec: Math.max(1, Math.round(durationMs / 1000)),
          notes: `Postman CI: ${itemName} -> HTTP ${statusCode} (${durationMs}ms)`,
          automationLog: JSON.stringify(
            {
              item: itemName,
              statusCode,
              responseTimeMs: durationMs,
              assertions: assertions.map((a) => ({
                assertion: a.assertion,
                error: a.error?.message || null,
              })),
            },
            null,
            2
          ),
        });
      }
    }

    // Format B: Direct results array ({ results: [{ caseKey, status, durationMs, notes, automationLog }] })
    if (Array.isArray(body?.results)) {
      for (const r of body.results) {
        const rawKey = String(r?.caseKey || r?.displayId || r?.testCaseId || '').trim().toUpperCase();
        const tc =
          byDisplayId.get(rawKey) ||
          cases.find((c) => c.id === r?.testCaseId);
        if (!tc) continue;

        const normStatus = String(r?.status || 'PASS').toUpperCase();
        const status: 'PASS' | 'FAIL' | 'SKIP' =
          normStatus === 'FAIL' || normStatus === 'FAILED'
            ? 'FAIL'
            : normStatus === 'SKIP' || normStatus === 'SKIPPED'
            ? 'SKIP'
            : 'PASS';

        parsedResults.push({
          testCaseId: tc.id,
          versionNumber: tc.current_version || 1,
          status,
          durationSec: Math.max(1, Math.round(Number(r?.durationMs || 1000) / 1000)),
          notes: r?.notes || `Postman CI (${status})`,
          automationLog:
            typeof r?.automationLog === 'string'
              ? r.automationLog
              : JSON.stringify(r, null, 2),
        });
      }
    }

    if (parsedResults.length === 0) {
      return apiErrorResponse(
        'No matching project test cases found in Postman payload. Include case keys (e.g. INK-1) in request names or results[].caseKey.',
        400,
        ErrorCodes.VALIDATION,
        requestId
      );
    }

    const runId = await generateTestRunId();
    const now = new Date();
    const hasFailure = parsedResults.some((r) => r.status === 'FAIL');
    const runName =
      body.runName ||
      body?.collection?.info?.name ||
      `Postman CI Run (${new Date().toLocaleDateString()})`;

    const createdRun = await prisma.testRun.create({
      data: {
        id: runId,
        project_id: project.id,
        name: String(runName),
        environment: String(body.environment || 'STAGING').toUpperCase(),
        build_version: body.buildVersion ? String(body.buildVersion) : null,
        trigger_ref: body.triggerRef ? String(body.triggerRef) : null,
        source: 'postman',
        status: hasFailure ? 'FAILED' : 'COMPLETED',
        started_at: now,
        completed_at: now,
        created_by: project.created_by,
        results: {
          create: parsedResults.map((pr, idx) => ({
            test_case_id: pr.testCaseId,
            order_index: idx + 1,
            status: pr.status,
            source: 'automated',
            executed_at: now,
            time_spent_seconds: pr.durationSec,
            notes: pr.notes,
            automation_log: pr.automationLog,
          })),
        },
      },
    });

    return NextResponse.json(
      {
        runId: createdRun.id,
        status: createdRun.status,
        matchedCases: parsedResults.length,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return apiErrorResponse(
      err?.message || 'Failed to ingest Postman run',
      500,
      ErrorCodes.INTERNAL,
      requestId
    );
  }
}
