import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { requireProjectMember } from '@/lib/permissions';
import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { apiErrorResponse } from '@/lib/apiHandler';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; key: string }> }
) {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return apiErrorResponse('Unauthorized', 401, ErrorCodes.UNAUTHORIZED, requestId);
    }

    const userId = Number((session.user as any).id);
    const { projectId, key } = await params;
    const actualProjectId = await requireProjectMember(projectId, userId);
    const variableKey = key;

    // Find the variable
    const variable = await prisma.variable.findFirst({
      where: {
        project_id: actualProjectId,
        key: variableKey,
        scope: 'GLOBAL',
      },
    });

    if (!variable) {
      return apiErrorResponse('Variable not found', 404, ErrorCodes.NOT_FOUND, requestId);
    }

    // Find test cases that reference this variable in their steps
    const testCases = await prisma.testCase.findMany({
      where: {
        project_id: actualProjectId,
        deleted_at: null,
      },
      include: {
        test_case_steps: true,
      },
    });

    // Filter test cases that use this variable
    const matchingCases = testCases
      .map((tc) => {
        const matchingSteps = tc.test_case_steps.filter((step) => {
          return step.step.includes(`{{${variableKey}}}`) || 
                 step.expected_result?.includes(`{{${variableKey}}}`);
        });
        return matchingSteps.length > 0 ? {
          id: tc.id,
          title: tc.title,
          step_order: matchingSteps[0]?.order || 0,
          step_text: matchingSteps[0]?.step || '',
        } : null;
      })
      .filter(Boolean);

    return NextResponse.json(matchingCases);
  } catch (error) {
    const normalized = normalizeError(error, ErrorCodes.INTERNAL, 'Failed to fetch variable usage');
    logger.error('Failed to fetch variable usage', {
      module: 'VariablesAPI',
      action: 'getVariableUsage',
      requestId,
      errorCode: normalized.code,
      error,
    });
    return apiErrorResponse(normalized.message, normalized.status, normalized.code, requestId);
  }
}