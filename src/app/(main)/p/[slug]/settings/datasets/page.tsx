import { redirect } from 'next/navigation';

export default async function DatasetsSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/p/${slug}/configuration/datasets`);
}
