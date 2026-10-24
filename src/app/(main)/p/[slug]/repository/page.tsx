import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { getProjectBySlug, getTestCases, getModules } from '@/lib/dal/projects';
import { prisma } from '@/lib/db';
import { RepositoryClient } from './RepositoryClient';
import { mapPrismaCaseToMock, mapPrismaModuleToMock } from '@/lib/dal/mappers';

export default async function RepositoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string;

  const project = await getProjectBySlug(workspaceId, slug);
  if (!project) return <p className="p-8 text-muted-foreground">Project not found</p>;

  const [
    prismaCases,
    prismaArchivedCases,
    prismaModules,
    prismaCustomFieldDefs,
  ] = await Promise.all([
    getTestCases(project.id),
    prisma.testCase.findMany({
      where: { project_id: project.id, deleted_at: { not: null } },
      orderBy: { deleted_at: 'desc' },
      select: {
        id: true,
        display_id: true,
        project_id: true,
        module_id: true,
        title: true,
        priority: true,
        type: true,
        status: true,
        tags: true,
        labels: true,
        ai_generated: true,
        created_by: true,
        created_at: true,
        deleted_at: true,
      },
    }),
    getModules(project.id),
    prisma.customFieldDefinition.findMany({
      where: { project_id: project.id, entity_type: 'TEST_CASE' },
      orderBy: [{ order: 'asc' }, { created_at: 'asc' }],
    }),
  ]);

  const initialCases = prismaCases.map(mapPrismaCaseToMock);
  const initialArchivedCases = prismaArchivedCases.map((c) => ({
    id: c.id,
    displayId: c.display_id,
    projectId: c.project_id,
    moduleId: c.module_id,
    title: c.title,
    steps: [],
    priority: c.priority,
    type: c.type.toLowerCase(),
    status: c.status.toLowerCase(),
    tags: c.tags,
    labels: c.labels || [],
    aiGenerated: c.ai_generated,
    createdBy: c.created_by,
    createdAt: c.created_at.toISOString(),
    deletedAt: c.deleted_at?.toISOString() || null,
  }));
  const initialModules = prismaModules.map(mapPrismaModuleToMock);
  const initialCustomFieldDefs = prismaCustomFieldDefs;

  return (
    <RepositoryClient
      initialCases={initialCases}
      initialArchivedCases={initialArchivedCases}
      initialModules={initialModules}
      initialCustomFieldDefs={initialCustomFieldDefs}
    />
  );
}
