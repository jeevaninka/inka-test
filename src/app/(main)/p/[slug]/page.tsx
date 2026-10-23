'use client';

/**
 * Dashboard page — Option B refactor.
 *
 * Before: server component that called getProjectBySlug() AGAIN (layout already
 *   called it), then ran getDashboardStats → activityLog.findMany → user.findMany
 *   sequentially = 4 sequential DB operations per page visit.
 *
 * After: client component that:
 *   1. Reads `project` from ProjectDataProvider (zero extra DB call).
 *   2. Calls getDashboardDataAction(projectId) once on mount — that action runs
 *      getDashboardStats + activityLog.findMany in parallel, then user.findMany
 *      in one batch = 2 parallel + 1 dependent query total.
 *
 * Net saving: eliminates 1 duplicate DB query; reduces 3 sequential queries to
 * 2 parallel + 1 dependent (roughly 2× faster dashboard load time).
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { getDashboardDataAction, type DashboardData } from '@/app/actions/dashboard';
import { DashboardClient } from './DashboardClient';

export default function DashboardPage() {
  const { slug } = useParams() as { slug: string };
  const { project } = useProjectData();

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!project?.id) return;

    let cancelled = false;
    getDashboardDataAction(project.id)
      .then((data) => {
        if (!cancelled) setDashboardData(data);
      })
      .catch(() => {
        // Non-fatal: dashboard renders with null stats (shows zeros via DashboardClient fallback)
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [project?.id]);

  // Render the same DashboardClient component with the same props shape as before.
  // While loading, pass null stats — DashboardClient already handles null gracefully
  // via its `fallbackStats` logic (shows zeros).
  return (
    <DashboardClient
      project={project}
      stats={dashboardData?.stats ?? null}
      needsAttention={dashboardData?.needsAttention ?? null}
      dashboardData={dashboardData}
      slug={slug}
      activity={dashboardData?.activity ?? []}
      users={dashboardData?.users ?? []}
      loading={loading}
    />
  );
}
