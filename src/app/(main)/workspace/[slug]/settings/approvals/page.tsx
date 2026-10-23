import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';

export default async function WorkspaceApprovalsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ws = await prisma.workspace.findUnique({
    where: { slug },
    include: { organization: { select: { slug: true } } },
  });
  const orgSlug = ws?.organization?.slug || 'inka-insurance';
  redirect(`/org/${orgSlug}/approvals`);
}
