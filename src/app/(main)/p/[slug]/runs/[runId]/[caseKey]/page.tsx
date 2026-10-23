'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { apiClient } from '@/lib/apiClient';
import { ExecutionConsole } from '../ExecutionConsole';
import { RunDeck } from '../RunDeck';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getTestRunByIdAction } from '@/app/actions/runs';

/** Hard ceiling on any single load so the page can never hang on a spinner. */
const LOAD_TIMEOUT_MS = 15_000;

type RunLookup = 'idle' | 'loading' | 'ready' | 'missing';
type ResultsStatus = 'loading' | 'ready' | 'error';

export default function TestCaseExecutionPage() {
  const params = useParams();
  const { slug, runId, caseKey } = params as Record<string, string>;
  const router = useRouter();

  const [results, setResults] = useState<any[]>([]);
  const [resultsStatus, setResultsStatus] = useState<ResultsStatus>('loading');
  const [resultsError, setResultsError] = useState<string>('');
  const [retryToken, setRetryToken] = useState(0);
  const [liveRun, setLiveRun] = useState<any>(null);
  const [runLookup, setRunLookup] = useState<RunLookup>('idle');
  const [open, setOpen] = useState(true);

  const handleClose = useCallback(() => {
    setOpen(false);
    apiClient.invalidate(`/api/v1/runs/${encodeURIComponent(runId)}/results`);
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('run_deck_scroll_y', String(window.scrollY));
      router.push(`/p/${slug}/runs/${runId}`, { scroll: false });
      setTimeout(() => {
        if (window.location.pathname.startsWith(`/p/${slug}/runs/${runId}/`)) {
          window.location.href = `/p/${slug}/runs/${runId}`;
        }
      }, 150);
    }
  }, [slug, runId, router]);

  const projectData = useProjectData();
  const project = projectData.project;
  const cases = projectData.cases || [];
  const suites = projectData.suites || [];
  const modules = projectData.modules || [];
  const members = projectData.members || [];
  const runs = projectData.runs || [];
  const currentUser = projectData.currentUser;
  const contextRun = runs.find((r: any) => r.id === runId) as any;
  const run = liveRun || contextRun;

  /**
   * The run may be missing from the project context (freshly created async
   * external runs, or a stale layout payload). Fetch it directly instead of
   * spinning forever.
   */
  useEffect(() => {
    if (contextRun || !runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    setRunLookup('loading');
    timer = setTimeout(() => {
      if (!cancelled) setRunLookup('missing');
    }, LOAD_TIMEOUT_MS);

    getTestRunByIdAction(runId)
      .then((data) => {
        if (cancelled) return;
        if (data) {
          setLiveRun(data);
          setRunLookup('ready');
        } else {
          setRunLookup('missing');
        }
      })
      .catch(() => {
        if (!cancelled) setRunLookup('missing');
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [contextRun, runId, retryToken]);

  /**
   * Load the run results. The request is bounded by a timeout and always
   * resolves to an explicit state, so a slow or failed request can never
   * leave the page on a permanent spinner.
   */
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    setResultsStatus('loading');
    setResultsError('');

    timer = setTimeout(() => {
      if (cancelled) return;
      setResultsStatus('error');
      setResultsError('Loading execution results timed out. The run may still be executing.');
    }, LOAD_TIMEOUT_MS);

    apiClient.get<any[]>(`/api/v1/runs/${encodeURIComponent(runId)}/results`, undefined, { forceRefresh: true })
      .then((data) => {
        if (cancelled) return;
        if (timer) clearTimeout(timer);
        setResults(data || []);
        setResultsStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        if (timer) clearTimeout(timer);
        const message = err?.message || 'Failed to load execution results';
        setResultsError(message);
        setResultsStatus('error');
        toast.error(message);
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [runId, retryToken]);

  const getCase = useCallback((id: string) => cases.find((c: any) => c.id === id), [cases]);

  const refetchResults = useCallback(async () => {
    const data = await apiClient.get<any[]>(
      `/api/v1/runs/${encodeURIComponent(runId)}/results`,
      undefined,
      { forceRefresh: true }
    );
    if (data) setResults(data);
  }, [runId]);

  const progress = useMemo(() => {
    return {
      pass: results.filter((r) => r.status === 'pass').length,
      fail: results.filter((r) => r.status === 'fail').length,
      error: results.filter((r) => r.status === 'error').length,
      blocked: results.filter((r) => r.status === 'blocked').length,
      skip: results.filter((r) => r.status === 'skip').length,
      invalid: results.filter((r) => r.status === 'invalid').length,
      cancelled: results.filter((r) => r.status === 'cancelled').length,
      started: results.filter((r) => r.status === 'pending' && (r.timeSpentSeconds || 0) > 0).length,
      pending: results.filter((r) => r.status === 'pending' && !(r.timeSpentSeconds && r.timeSpentSeconds > 0)).length,
      rerun: results.filter((r) => r.status === 'pending' && r.attemptNumber && r.attemptNumber > 1).length,
    };
  }, [results]);

  // Run not found (or not resolvable) — offer a way out instead of spinning.
  if (!run && runLookup === 'missing') {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-56px)] bg-background gap-3 px-6 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Run not found</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            This run could not be loaded. It may have been deleted, or you may not have access to it.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => router.push(`/p/${slug}/runs`)}
            className="h-8 px-3 text-xs gap-1.5 cursor-pointer"
          >
            <span>Go to Runs</span>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setRunLookup('idle');
              setLiveRun(null);
              setRetryToken((t) => t + 1);
            }}
            className="h-8 px-3 text-xs gap-1.5 cursor-pointer"
          >
            <RotateCw className="h-3.5 w-3.5" />
            <span>Retry</span>
          </Button>
        </div>
      </div>
    );
  }

  if (!project || !run) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-56px)] bg-background gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Loading run…</p>
      </div>
    );
  }

  // Results are still loading (bounded by the timeout above).
  if (resultsStatus === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-56px)] bg-background gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Loading execution results…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)] overflow-hidden bg-background relative">
      {resultsStatus === 'error' && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400 shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 min-w-0">{resultsError || 'Failed to load execution results.'}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRetryToken((t) => t + 1)}
            className="h-6 px-2 text-[11px] gap-1 cursor-pointer shrink-0"
          >
            <RotateCw className="h-3 w-3" />
            <span>Retry</span>
          </Button>
        </div>
      )}

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
      />

      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            handleClose();
          }
        }}
      >
        <DialogContent hideClose className="max-w-[1600px] w-[94vw] h-[90vh] max-h-[90vh] p-0 overflow-hidden flex flex-col border-white/10 bg-background/95 backdrop-blur-xl shadow-2xl rounded-2xl">
          <ExecutionConsole
            slug={slug}
            runId={runId}
            run={run}
            caseKey={caseKey}
            results={results}
            resultsLoaded
            onResultsChange={setResults}
            refetchResults={refetchResults}
            getCase={getCase}
            progress={progress}
            currentUser={currentUser}
            members={members}
            suites={suites as any[]}
            modules={modules as any[]}
            onClose={handleClose}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
