import { redirect } from 'next/navigation';

export default async function ConfigurationIndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/p/${slug}/configuration/step-library`);
}
