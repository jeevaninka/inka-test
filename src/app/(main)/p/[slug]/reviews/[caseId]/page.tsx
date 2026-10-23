import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { getProjectBySlug } from '@/lib/dal/projects';
import { CaseReviewPageView } from '@/components/reviews/CaseReviewPageView';

export default async function TestCaseReviewPage({
  params,
}: {
  params: Promise<{ slug: string; caseId: string }>;
}) {
  const { slug, caseId } = await params;
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string;
  const project = await getProjectBySlug(workspaceId, slug);

  if (!project) {
    return (
      <div className="p-12 text-center text-sm text-muted-foreground">
        Project not found
      </div>
    );
  }

  return <CaseReviewPageView slug={slug} caseIdParam={caseId} />;
}
