"use client";

import { useParams, useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { CaseDetailView } from '../CaseDetailView';

export default function CaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { slug, caseId } = params as Record<string, string>;
  const { cases } = useProjectData();

  const currentIndex = useMemo(() => {
    if (!caseId || !cases || cases.length === 0) return -1;
    return cases.findIndex(
      (c) => c.id === caseId || c.displayId === caseId || (c as any).display_id === caseId
    );
  }, [caseId, cases]);

  const handlePrev = currentIndex > 0 ? () => {
    const prevCase = cases[currentIndex - 1];
    if (prevCase) {
      router.push(`/p/${slug}/repository/${prevCase.displayId || (prevCase as any).display_id || prevCase.id}`);
    }
  } : undefined;

  const handleNext = currentIndex >= 0 && currentIndex < cases.length - 1 ? () => {
    const nextCase = cases[currentIndex + 1];
    if (nextCase) {
      router.push(`/p/${slug}/repository/${nextCase.displayId || (nextCase as any).display_id || nextCase.id}`);
    }
  } : undefined;

  return (
    <div className="w-full min-h-screen bg-background flex flex-col">
      <CaseDetailView
        key={caseId}
        caseId={caseId}
        onClose={() => router.push(`/p/${slug}/repository`)}
        isFullPage={true}
        onNavigatePrev={handlePrev}
        onNavigateNext={handleNext}
        currentIndex={currentIndex >= 0 ? currentIndex : undefined}
        totalCount={cases?.length}
      />
    </div>
  );
}