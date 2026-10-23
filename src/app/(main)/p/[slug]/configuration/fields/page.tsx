import { CustomFieldsPage } from '@/components/configuration/CustomFieldsPage';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { getProjectBySlug } from '@/lib/dal/projects';

export default async function ConfigurationFieldsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string;
  const project = await getProjectBySlug(workspaceId, slug);
  if (!project) return <p className="text-xs text-muted-foreground p-4">Project not found</p>;
  return <CustomFieldsPage projectId={project.id} />;
}
