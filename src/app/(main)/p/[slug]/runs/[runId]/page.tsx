"use client";

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { apiClient } from '@/lib/apiClient';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ExecutionConsole } from './ExecutionConsole';
import { RunDeck } from './RunDeck';
import { getTestRunByIdAction } from '@/app/actions/runs';

const TERMINAL_STATUSES = new Set([
  'pass',
  'fail',
  'error',
  'blocked',
  'skip',
  'invalid',
  'unavailable',
  'cancelled',
]);

/**
 * One visible row per case. The API already dedupes, but stale rows and
 * same-attempt duplicates (a PASS and a PENDING row for the same case) used to
 * surface as two rows. Keep the newest attempt; on a tie prefer a terminal
 * outcome over a pending one.
 */
function dedupeRunResults(rows: any[]): any[] {
  const byCase = new Map<string, any>();
  for (const row of rows || []) {
    const key = row.testCaseId || row.test_case_id;
    if (!key) continue;
    const current = byCase.get(key);
    if (!current) {
      byCase.set(key, row);
      continue;
    }
    const currentAttempt = Number(current.attemptNumber ?? current.attempt_number ?? 1);
    const nextAttempt = Number(row.attemptNumber ?? row.attempt_number ?? 1);
    if (nextAttempt > currentAttempt) {
      byCase.set(key, row);
      continue;
    }
    if (nextAttempt === currentAttempt) {
      const currentSettled = TERMINAL_STATUSES.has(String(current.status || '').toLowerCase());
      const nextSettled = TERMINAL_STATUSES.has(String(row.status || '').toLowerCase());
      if (!currentSettled && nextSettled) byCase.set(key, row);
    }
  }
  return [...byCase.values()].sort(
    (a, b) => Number(a.orderIndex ?? a.order_index ?? 0) - Number(b.orderIndex ?? b.order_index ?? 0)
  );
}

export default function RunExecutionPage() {
  const params = useParams();
  const { slug, runId } = params as Record<string, string>;
  const searchParams = useSearchParams();
  const router = useRouter();

  const projectData = useProjectData();
  const project = projectData.project;
  const cases = projectData.cases || [];
  const suites = projectData.suites || [];
  const modules = projectData.modules || [];
  const members = projectData.members || [];
  const runs = projectData.runs || [];
  const currentUser = projectData.currentUser;
  const contextRun = runs.find((r: any) => r.id === runId) as any;

  const queryClient = useQueryClient();

  // Single source of truth for the run header: the project context snapshot is
  // used instantly when present, otherwise one scoped fetch fills the gap.
  const runQuery = useQuery({
    queryKey: ['run', runId],
    queryFn: () => getTestRunByIdAction(runId),
    enabled: !!runId,
    initialData: contextRun ?? undefined,
    staleTime: 30_000,
  });
  const run = runQuery.data ?? contextRun;

  // Results are the cockpit's hot data: one query key shared by the deck and
  // the console so concurrent mounts dedupe into a single request.
  const resultsQuery = useQuery({
    queryKey: ['run-results', runId],
    queryFn: async () => {
      const data = await apiClient.get<any[]>(
        `/api/v1/runs/${encodeURIComponent(runId)}/results`,
        undefined,
        { forceRefresh: true }
      );
      return dedupeRunResults(data || []);
    },
    enabled: !!runId,
    staleTime: 30_000,
  });
  const results = useMemo(() => resultsQuery.data ?? [], [resultsQuery.data]);
  const loading = resultsQuery.isLoading;

  const setResults = useCallback(
    (next: any[]) => queryClient.setQueryData(['run-results', runId], next),
    [queryClient, runId]
  );

  const getCase = useCallback((id: string) => cases.find((c: any) => c.id === id), [cases]);

  const refetchResults = useCallback(async () => {
    apiClient.invalidate(`/api/v1/runs/${encodeURIComponent(runId)}/results`);
    const { data } = await resultsQuery.refetch();
    if (data) setResults(data);
  }, [resultsQuery, runId, setResults]);

  const refreshRun = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['run', runId] });
  }, [queryClient, runId]);

  const isExternalRun =
    run?.source === 'postman' ||
    run?.source === 'datadog' ||
    run?.source === 'mixed' ||
    run?.source === 'automated';
  const hasLiveCases = results.some(
    (r) =>
      String(r.status).toLowerCase() === 'pending' &&
      ['RUNNING', 'QUEUED'].includes(String(r.caseState || '').toUpperCase())
  );

  // Real-time updates: authenticated SSE carries invalidation events; the
  // database snapshot (fetched on every event) stays authoritative. A 15s
  // fallback poll covers multi-instance deployments and reconnect gaps.
  // Execution itself is server-side — this effect never dispatches work.
  useEffect(() => {
    if (!isExternalRun || !runId) return;
    let cancelled = false;
    let lastVersion = '';

    const applySnapshot = async () => {
      if (cancelled) return;
      try {
        await refetchResults();
        await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      } catch {
        // transient failures are expected; the next tick retries
      }
    };

    const source = new EventSource(
      `/api/v1/runs/${encodeURIComponent(runId)}/events`
    );
    source.addEventListener('snapshot', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data);
        if (payload?.version && payload.version === lastVersion) return;
        lastVersion = String(payload?.version || '');
      } catch {
        // malformed event: still refresh
      }
      void applySnapshot();
    });
    // Browser reconnects automatically and the next snapshot repairs state.
    source.addEventListener('error', () => {});

    if (hasLiveCases) void applySnapshot();
    const fallback = hasLiveCases ? setInterval(() => void applySnapshot(), 15000) : null;

    return () => {
      cancelled = true;
      source.close();
      if (fallback) clearInterval(fallback);
    };
  }, [isExternalRun, hasLiveCases, refetchResults, runId, queryClient]);

  useEffect(() => {
    if (!isExternalRun || hasLiveCases || results.length === 0) return;
    void queryClient.invalidateQueries({ queryKey: ['run', runId] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExternalRun, hasLiveCases]);

  const progress = useMemo(() => {
    return {
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      error: results.filter((r) => r.status === 'error').length,
      blocked: results.filter((r) => r.status === 'blocked').length,
      skip: results.filter((r) => r.status === 'skip').length,
      invalid: results.filter((r) => r.status === 'invalid').length,
      cancelled: results.filter((r) => r.status === 'cancelled').length,
      started: results.filter(
        (r) =>
          r.status === 'pending' &&
          (String(r.caseState || '').toUpperCase() === 'RUNNING' ||
            (r.timeSpentSeconds || 0) > 0)
      ).length,
      pending: results.filter(
        (r) =>
          r.status === 'pending' &&
          String(r.caseState || '').toUpperCase() !== 'RUNNING' &&
          !(r.timeSpentSeconds && r.timeSpentSeconds > 0)
      ).length,
      rerun: results.filter((r) => r.status === 'pending' && r.attemptNumber && r.attemptNumber > 1).length,
    };
  }, [results]);

  const resultId = searchParams.get('resultId');

  useEffect(() => {
    if (resultId && results.length > 0) {
      const foundResult = results.find((r) => r.id === resultId);
      if (foundResult) {
        const c = getCase(foundResult.testCaseId);
        const targetKey = c?.displayId || c?.id || foundResult.id;
        router.replace(`/p/${slug}/runs/${runId}/${targetKey}`);
      }
    }
  }, [resultId, results, slug, runId, getCase, router]);

  useEffect(() => {
    if (!resultId && typeof window !== 'undefined') {
      const savedY = sessionStorage.getItem('run_deck_scroll_y');
      if (savedY) {
        const y = parseInt(savedY, 10);
        if (!isNaN(y) && y > 0) {
          requestAnimationFrame(() => {
            window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
          });
        }
      }
    }
  }, [resultId]);

  if (!project || !run || loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden">
      <RunDeck
        slug={slug}
        runId={runId}
        run={run}
        results={results}
        onResultsChange={setResults}
        refetchResults={refetchResults}
        getCase={getCase}
        progress={progress}
        currentUser={currentUser}
        members={members}
        suites={suites as any[]}
        cases={cases as any[]}
        modules={modules as any[]}
        runs={runs}
        onRunUpdated={refreshRun}
      />

      <Dialog
        open={!!resultId}
        onOpenChange={(open) => {
          if (!open) {
            apiClient.invalidate(`/api/v1/runs/${encodeURIComponent(runId)}/results`);
            router.push(`/p/${slug}/runs/${runId}`, { scroll: false });
            refetchResults();
          }
        }}
      >
        <DialogContent hideClose className="max-w-[1600px] w-[94vw] h-[90vh] max-h-[90vh] p-0 overflow-hidden flex flex-col border-white/10 bg-background/95 backdrop-blur-xl shadow-2xl rounded-2xl">
          {resultId && (
            <ExecutionConsole
              slug={slug}
              runId={runId}
              run={run}
              resultId={resultId}
              results={results}
              resultsLoaded={!loading}
              onResultsChange={setResults}
              refetchResults={refetchResults}
              getCase={getCase}
              progress={progress}
              currentUser={currentUser}
              members={members}
              suites={suites as any[]}
              modules={modules as any[]}
              onClose={() => {
                apiClient.invalidate(`/api/v1/runs/${encodeURIComponent(runId)}/results`);
                router.push(`/p/${slug}/runs/${runId}`, { scroll: false });
                refetchResults();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
