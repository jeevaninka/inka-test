import { StepLibraryPage } from '@/components/configuration/StepLibraryPage';

export default async function ConfigurationStepLibraryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <StepLibraryPage slug={slug} />;
}
