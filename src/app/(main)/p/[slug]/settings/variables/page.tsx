import { redirect } from 'next/navigation';

export default async function VariablesSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/p/${slug}/configuration/variables`);
}
