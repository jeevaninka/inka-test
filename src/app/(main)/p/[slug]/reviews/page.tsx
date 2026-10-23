import { ReviewQueueTable } from '@/components/reviews/ReviewQueueTable';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { getProjectBySlug } from '@/lib/dal/projects';

export default async function ReviewsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string;
  const project = await getProjectBySlug(workspaceId, slug);
  if (!project) return <p className="p-8 text-muted-foreground">Project not found</p>;

  return (
    <div className="p-4 sm:p-6">
      <ReviewQueueTable projectId={project.id} slug={slug} />
    </div>
  );
}
