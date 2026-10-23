import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/apiHandler';
import { prisma } from '@/lib/db';
import { requireProjectMemberByRunId } from '@/lib/permissions';
import { getRunResultStepsAction, getRunResultHistoryAction } from '@/app/actions/runs';
import { getAttachmentsAction } from '@/app/actions/attachments';

export const GET = createApiHandler<{ runId: string; resultId: string }>(async (req, { params, userId }) => {
  const { runId, resultId } = await params;

  if (!runId || !resultId) {
    return NextResponse.json({ error: 'Run ID and Result ID are required' }, { status: 400 });
  }

  await requireProjectMemberByRunId(runId, userId);

  // Find result by CUID, test_case_id, or test_case display_id (e.g. "INK-298")
  const result = await prisma.runResult.findFirst({
    where: {
      run_id: runId,
      OR: [
        { id: resultId },
        { test_case_id: resultId },
        { test_case: { display_id: { equals: resultId, mode: 'insensitive' } } },
      ],
    },
    include: {
      test_case: {
        select: { id: true, display_id: true },
      },
    },
  });

  if (!result) {
    return NextResponse.json({ error: 'Run result not found' }, { status: 404 });
  }

  const [steps, history, attachments] = await Promise.all([
    getRunResultStepsAction(result.id).catch(() => []),
    getRunResultHistoryAction(result.test_case_id, runId).catch(() => []),
    getAttachmentsAction(result.id, 'run_result').catch(() => ({ attachments: [] })),
  ]);

  return NextResponse.json({
    resultId: result.id,
    testCaseId: result.test_case_id,
    steps: steps || [],
    history: history || [],
    attachments: (attachments as any)?.attachments || attachments || [],
  });
});
