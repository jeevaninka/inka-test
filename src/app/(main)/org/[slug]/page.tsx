import { redirect } from 'next/navigation';

export default async function OrgIndexPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/org/${slug}/members`);
}
