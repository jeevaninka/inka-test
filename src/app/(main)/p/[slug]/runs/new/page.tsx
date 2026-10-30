"use client";

import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { CreateRunModal } from '@/components/runs/CreateRunModal';

export default function NewRunPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { slug } = params as Record<string, string>;
  const router = useRouter();

  const urlSuiteId = searchParams.get('suiteId');
  const urlReleaseId = searchParams.get('releaseId');
  const urlType = searchParams.get('type');
  const urlCases = searchParams.get('cases');
  const initialCaseIds = (urlCases || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const runType: 'manual' | 'postman' | 'datadog' =
    urlType === 'postman' || urlType === 'datadog' ? urlType : 'manual';

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      if (urlSuiteId) {
        router.push(`/p/${slug}/suites`);
      } else {
        router.push(`/p/${slug}/runs`);
      }
    }
  };

  return (
    <CreateRunModal
      open={true}
      onOpenChange={handleOpenChange}
      slug={slug}
      runType={runType}
      initialSuiteId={urlSuiteId}
      initialReleaseId={urlReleaseId}
      initialCaseIds={initialCaseIds}
    />
  );
}
