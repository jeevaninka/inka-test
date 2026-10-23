import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/apiHandler';
import { prisma } from '@/lib/db';
import { requireProjectViewer } from '@/lib/permissions';

export const GET = createApiHandler<{ projectId: string }>(async (req, { params, userId }) => {
  const { projectId: projectIdOrSlug } = await params;

  if (!projectIdOrSlug) {
    return NextResponse.json({ error: 'Project ID or slug is required' }, { status: 400 });
  }

  const actualProjectId = await requireProjectViewer(projectIdOrSlug, userId);

  const [pendingReviews, openDefects, pendingReleases] = await Promise.all([
    // Review queue pending count (both awaiting review and changes requested)
    prisma.reviewRequest.count({
      where: {
        test_case: {
          project_id: actualProjectId,
          deleted_at: null,
        },
        status: { in: ['PENDING', 'CHANGES_REQUESTED'] },
      },
    }),

    // Open/in-progress defects count
    prisma.defect.count({
      where: {
        deleted_at: null,
        local_status: { in: ['OPEN', 'IN_PROGRESS'] },
        run_result: {
          run: {
            project_id: actualProjectId,
            deleted_at: null,
          },
        },
      },
    }),

    // Releases awaiting sign-off count
    prisma.release.count({
      where: {
        project_id: actualProjectId,
        decision: null,
      },
    }),
  ]);

  return NextResponse.json({
    pendingReviews,
    openDefects,
    pendingReleases,
  });
});
