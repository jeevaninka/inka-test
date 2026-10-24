import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { getProjectBySlug, getTestRuns } from '@/lib/dal/projects';
import { getProjectReleasesAction } from '@/app/actions/releases';
import { RunsClient } from './RunsClient';
import { mapPrismaRunToMock } from '@/lib/dal/mappers';

export default async function RunsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string;

  const project = await getProjectBySlug(workspaceId, slug);
  if (!project) return <p className="p-8 text-muted-foreground">Project not found</p>;

  // Fetch initial runs scoped to project
  const initialRunsRaw = await getTestRuns(project.id);
  const initialRuns = initialRunsRaw.map(mapPrismaRunToMock);
  
  // Fetch initial releases
  const initialProjectReleases = await getProjectReleasesAction(project.id);

  return <RunsClient initialRuns={initialRuns} projectReleases={initialProjectReleases} />;
}
