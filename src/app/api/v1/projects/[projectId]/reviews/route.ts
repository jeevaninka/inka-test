import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/apiHandler';
import { requireProjectMember } from '@/lib/permissions';
import { getReviewQueueAction } from '@/app/actions/reviews';

export const GET = createApiHandler<{ projectId: string }>(async (req, { params, userId }) => {
  const { projectId: projectIdOrSlug } = await params;

  if (!projectIdOrSlug) {
    return NextResponse.json({ error: 'Project ID or slug is required' }, { status: 400 });
  }

  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);
  const { searchParams } = new URL(req.url);
  const viewMode = (searchParams.get('filter') || 'all') as 'mine' | 'all';

  const reviews = await getReviewQueueAction(actualProjectId, viewMode, userId);
  return NextResponse.json(reviews);
});
