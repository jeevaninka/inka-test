"use client";

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { apiClient } from '@/lib/apiClient';
import { subscribeRunEvents, type RunSnapshotHint } from '@/lib/runs/run-events-bus';
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
    // The context snapshot is a paint aid only. Treat it as already stale so the
    // server copy always wins on mount: an optimistically inserted run would
    // otherwise keep the header on the client's guess (and show different
    // Start/Finish actions) until the 30s window expired.
    initialDataUpdatedAt: 0,
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

  // Live events, the fallback poll and manual actions can all request a
  // refresh at once; collapse them into a single in-flight request. `refetch`
  // is referentially stable, so this callback does not churn the subscription
  // effect that depends on it.
  const refetchResultsQuery = resultsQuery.refetch;
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const refetchResults = useCallback(async () => {
    apiClient.invalidate(`/api/v1/runs/${encodeURIComponent(runId)}/results`);
    if (refreshInFlight.current) return refreshInFlight.current;
    const pending = (async () => {
      try {
        const { data } = await refetchResultsQuery();
        if (data) setResults(data);
      } finally {
        refreshInFlight.current = null;
      }
    })();
    refreshInFlight.current = pending;
    return pending;
  }, [refetchResultsQuery, runId, setResults]);

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

  // Live updates: a single shared SSE connection per run carries snapshot
  // invalidations; the database snapshot stays authoritative. Identical
  // snapshot versions are dropped inside the bus, so an idle run costs nothing.
  // Results are refetched on every change, but the run header (a separate
  // server-action round-trip) only when the run's own status moved.
  // Execution itself is server-side — this effect never dispatches work.
  const lastRunHint = useRef<{ status: string | null; stopRequestedAt: string | null } | null>(null);
  const resultsFetchingRef = useRef(false);
  resultsFetchingRef.current = resultsQuery.isFetching;
  const resultsUpdatedAtRef = useRef(0);
  resultsUpdatedAtRef.current = resultsQuery.dataUpdatedAt;

  useEffect(() => {
    if (!isExternalRun || !runId) return;
    let cancelled = false;

    const applySnapshot = async (snapshot?: RunSnapshotHint) => {
      if (cancelled) return;
      // The snapshot the server sends on connect usually lands right after the
      // initial query fetch; refetching again would double the page-load calls.
      const alreadyFetching = resultsFetchingRef.current;
      const dataIsFresh = Date.now() - resultsUpdatedAtRef.current < 1500;
      if (!alreadyFetching && !dataIsFresh) {
        try {
          await refetchResults();
        } catch {
          // transient failures are expected; the next tick retries
        }
      }
      if (cancelled || !snapshot) return;

      const next = {
        status: snapshot.status ?? null,
        stopRequestedAt: snapshot.stopRequestedAt ?? null,
      };
      const previous = lastRunHint.current;
      if (
        previous &&
        previous.status === next.status &&
        previous.stopRequestedAt === next.stopRequestedAt
      ) {
        return;
      }
      lastRunHint.current = next;

      try {
        await queryClient.invalidateQueries({ queryKey: ['run', runId] });
      } catch {
        // header refresh is best effort; the next status change retries
      }
    };

    const unsubscribe = subscribeRunEvents(runId, (snapshot) => {
      void applySnapshot(snapshot);
    }, { poll: hasLiveCases });

    // No initial fetch here: the results query fetches on mount, and the bus
    // delivers the snapshot the server sends on connect.
    return () => {
      cancelled = true;
      unsubscribe();
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

  // Closing the console is announced twice — Radix `onOpenChange(false)` and the
  // console's own close handler (Escape fires both). Run the side effects once.
  const closingConsole = useRef(false);
  useEffect(() => {
    if (resultId) closingConsole.current = false;
  }, [resultId]);
  const closeConsole = useCallback(() => {
    if (closingConsole.current) return;
    closingConsole.current = true;
    apiClient.invalidate(`/api/v1/runs/${encodeURIComponent(runId)}/results`);
    router.push(`/p/${slug}/runs/${runId}`, { scroll: false });
    void refetchResults();
  }, [refetchResults, router, runId, slug]);

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
          if (!open) closeConsole();
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
                closeConsole();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
