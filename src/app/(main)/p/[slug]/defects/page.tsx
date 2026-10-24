import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { getProjectDefectsAction } from '@/app/actions/defects';
import { DefectsClient } from './DefectsClient';

export default async function DefectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { slug } = await params;
  const { run } = await searchParams;
  const initialDefects = await getProjectDefectsAction(slug);

  return (
    <DefectsClient
      initialDefects={initialDefects}
      initialRunFilter={typeof run === 'string' && run ? run : 'ALL'}
    />
  );
}
