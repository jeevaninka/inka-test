import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/apiHandler';
import { prisma } from '@/lib/db';
import { requireProjectMember } from '@/lib/permissions';
import type { ProjectDefectItem } from '@/app/actions/defects';

export const GET = createApiHandler<{ projectId: string }>(async (req, { params, userId }) => {
  const { projectId: projectIdOrSlug } = await params;

  if (!projectIdOrSlug) {
    return NextResponse.json({ error: 'Project ID or slug is required' }, { status: 400 });
  }

  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  const defects = await prisma.defect.findMany({
    where: {
      deleted_at: null,
      run_result: {
        run: {
          project_id: actualProjectId,
          deleted_at: null,
        },
      },
    },
    orderBy: { raised_at: 'desc' },
    include: {
      run_result: {
        include: {
          test_case: {
            select: { id: true, display_id: true, title: true },
          },
          run: {
            select: { id: true, name: true, environment: true },
          },
        },
      },
    },
  });

  const userIds = [...new Set(defects.map((d) => d.raised_by))];
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, display_name: true },
      })
    : [];

  const userMap = new Map(users.map((u) => [u.id, u.display_name || u.name || `User #${u.id}`]));

  const mapped: ProjectDefectItem[] = defects.map((d) => ({
    id: d.id,
    runResultId: d.run_result_id,
    testCaseId: d.test_case_id,
    testCaseDisplayId: d.run_result?.test_case?.display_id ?? undefined,
    testCaseTitle: d.run_result?.test_case?.title ?? undefined,
    runId: d.run_result?.run?.id ?? '',
    runName: d.run_result?.run?.name ?? undefined,
    environment: d.run_result?.run?.environment ?? undefined,
    title: d.title,
    description: d.description,
    severity: d.severity,
    localStatus: d.local_status,
    ticketUrl: d.ticket_url,
    externalTicketId: d.external_ticket_id,
    ticketStatus: d.ticket_status,
    raisedBy: d.raised_by,
    raisedByName: userMap.get(d.raised_by) || `User #${d.raised_by}`,
    raisedAt: d.raised_at.toISOString(),
    lastSyncedAt: d.last_synced_at?.toISOString() ?? null,
  }));

  return NextResponse.json(mapped);
});
