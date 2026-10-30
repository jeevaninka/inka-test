"use client";

import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn, formatDuration } from '@/lib/utils';
import { toast } from 'sonner';
import {
  CheckCircle, XCircle, AlertOctagon, Ban, Bug, SkipForward, AlertTriangle,
  ChevronDown, ChevronRight, ChevronLeft, Loader2, Search,
  RotateCcw, ExternalLink, MoreVertical, Trash2, Plus, Copy, UserPlus,
  LinkIcon, Upload, X, Clock, Keyboard, User,
  PanelLeftClose, PanelLeftOpen,
  Paperclip, Check, FileText, History, Sparkles, ShieldAlert, ListChecks, HelpCircle,
  FileSpreadsheet, FileCode, Image as ImageIcon, Edit, Sliders, Play,
  Columns2, Rows2, Database, Link2, ChevronsUpDown
} from 'lucide-react';
import { apiClient } from '@/lib/apiClient';
import { logger } from '@/lib/logger.client';
import { interpolateStepText } from '@/lib/variables';
import { LinkifiedText } from '@/components/common/LinkifiedText';
import {
  updateRunResultAction,
  assignRunResultAction, unassignRunResultAction,
  resetSingleResultAction,
  startManualResultAction,
  deleteRunResultAction
} from '@/app/actions/runs';
import dynamic from 'next/dynamic';

const RaiseDefectModal = dynamic(() => import('@/components/runs/RaiseDefectModal').then(m => m.RaiseDefectModal), { ssr: false });
const DefectDetailModal = dynamic(() => import('@/components/runs/DefectDetailModal').then(m => m.DefectDetailModal), { ssr: false });
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { motion } from 'framer-motion';
import { MOTION } from '@/lib/motion';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { getTestCaseStepsAction } from '@/app/actions/steps';
import { getEnvironmentsAction } from '@/app/actions/variables';
import { deleteAttachmentAction, uploadFileAction } from '@/app/actions/attachments';
import { syncTestCaseFromDatadogAction, startExternalRunCasesAction, executeRunCaseAction } from '@/app/actions/integrations';
import { Tooltip } from '@/components/ui/tooltip';
import { UserAvatar } from '@/components/common/UserAvatar';
import { AiBadge } from '@/components/common/AiBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { ResultStatusBadge } from '@/components/common/ResultStatusBadge';
import { StatusPill } from '@/components/common/StatusPill';
import type { StepItem, ResultStatus } from '@/lib/types';
import { RunProgressStrip } from '@/components/runs/execution/RunProgressStrip';
import { StepVerdictControl } from '@/components/runs/execution/StepVerdictControl';
import {
  StepEvidenceControl,
  StepEvidenceExpandedRow,
  isImageAttachment,
} from '@/components/runs/execution/StepEvidenceControls';
import { ShortcutOverlay } from '@/components/runs/execution/ShortcutOverlay';
import { AssigneeDropdown } from '@/components/runs/execution/AssigneeDropdown';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import type { StepApiExecutionRecord, PostmanAssertionResult } from '@/lib/integrations/tool-clients';
import { parseDatadogStepMeta } from '@/lib/integrations/datadog-steps';
import { UnmatchedProviderResults, VariableChipsText } from '@/components/cases/DatadogStepsTable';
import { matchDatadogResults } from '@/lib/integrations/datadog-steps';
import { CaseSourceIcon } from '@/components/common/CaseSourceIcon';
import { PostmanLogo, DatadogLogo } from '@/components/icons/IntegrationLogos';
import {
  getCaseAutomationSource,
  getCaseCustomFields,
  isAutomatedCase,
} from '@/lib/cases/automation-source';
import {
  loadRunViewFilters,
  patchRunViewFilters,
  RUN_GROUP_OPTIONS,
  RUN_PRIORITY_OPTIONS,
  type RunCaseTypeFilter,
  type RunGroupBy,
} from '@/lib/runs/run-view-filters';

export { isImageAttachment, AssigneeDropdown };

export interface StepResultData {
  status?: string;
  note?: string;
  attachments?: Array<{ id: string; filename: string; key: string }>;
  apiExecution?: StepApiExecutionRecord;
  /** Provider-native sub-steps (e.g. Datadog Synthetic browser/API steps). */
  subSteps?: ProviderSubStep[];
  /** Provider failure diagnostics for this step. */
  failureMessage?: string;
  /** Direct link to the provider's result page for this execution. */
  externalResultUrl?: string;
}

export interface ProviderSubStep {
  order: number;
  /** Provider step id, used to match the imported InkaTest step. */
  stepId?: string;
  name: string;
  status?: string;
  durationMs?: number;
  detail?: string;
  failureMessage?: string;
  screenshotBucketKey?: string;
  screenshotUrl?: string;
  assertions?: PostmanAssertionResult[];
}

/** Machine-written execution summaries are metadata, not user observations. */
export function isAutoGeneratedSummary(text?: string | null): boolean {
  if (!text) return false;
  return /^\s*[^:\n]{1,80}:\s*\d+\s+passed,\s*\d+\s+failed\b/i.test(text);
}

/** Parse the compact KEY=VALUE override text used by the one-off runner popover. */
function parseLinkedRunnerOverrides(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (!key) continue;
    out[key] = line.slice(idx + 1).trim();
  }
  return out;
}

function optionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Case-level filters shared by the sidebar list, counters and next/prev nav. */
function matchesRailCaseFilters(
  result: any,
  getCase: (id: string) => any,
  opts: {
    caseType: RunCaseTypeFilter;
    assignedToMe: boolean;
    priority: string;
    userId?: number | string | null;
  }
): boolean {
  const testCase = getCase(result.testCaseId);
  if (!testCase) return false;

  const automated = isAutomatedCase(testCase);
  if (opts.caseType === 'manual' && automated) return false;
  if (opts.caseType === 'automated' && !automated) return false;
  if (opts.assignedToMe) {
    if (result.assignedTo == null || String(result.assignedTo) !== String(opts.userId)) return false;
  }
  if (opts.priority && testCase.priority !== opts.priority) return false;
  return true;
}

export function formatExpectedChecklistText(raw?: string | null): string {
  if (!raw) return '';
  let text = raw.replace(/\bisbelow\b/gi, 'is below').replace(/\bisabove\b/gi, 'is above');
  if (text.includes(' · ') && !text.includes('\n')) {
    return text
      .split(' · ')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith('✓') || s.startsWith('•') ? s : `✓ ${s}`))
      .join('\n');
  }
  return text;
}

export function cleanStepDataDisplay(raw?: string | null): string {
  if (!raw) return '';
  return raw.replace(/^URL:\s*[^|]+\|\s*Body:\s*/i, '').trim();
}

export function extractStepApiExecution(
  sr?: StepResultData,
  expectedResultText?: string | null
): { apiExec: StepApiExecutionRecord | null; manualNote: string } {
  if (!sr) return { apiExec: null, manualNote: '' };

  const deriveAssertionsFromExpected = (passedStatus: boolean): PostmanAssertionResult[] => {
    if (!expectedResultText) return [];
    const lines = formatExpectedChecklistText(expectedResultText)
      .split(/\r?\n/)
      .map((l) => l.replace(/^[✓✗•\-*]\s*/, '').trim())
      .filter(Boolean);
    return lines.map((name) => ({ name, passed: passedStatus }));
  };

  if (sr.apiExecution) {
    const assertions =
      sr.apiExecution.assertions && sr.apiExecution.assertions.length > 0
        ? sr.apiExecution.assertions
        : deriveAssertionsFromExpected(sr.status === 'pass');
    return {
      apiExec: { ...sr.apiExecution, assertions },
      manualNote: sr.note || '',
    };
  }

  const rawNote = (sr.note || '').trim();
  const legacyMatch = rawNote.match(
    /^\[(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+([^\]]+)\]\s*HTTP\s+(\d+)\s*([^(]*)\((\d+)ms\)(?:.*?\bBody:\s*([\s\S]+))?$/i
  );
  if (legacyMatch) {
    const method = legacyMatch[1].toUpperCase();
    const url = legacyMatch[2].trim();
    const statusCode = parseInt(legacyMatch[3], 10);
    const statusText = (legacyMatch[4] || '').trim() || 'OK';
    const durationMs = parseInt(legacyMatch[5], 10);
    let responseBody = (legacyMatch[6] || '').trim();
    if (responseBody && !responseBody.endsWith('...')) {
      try {
        responseBody = JSON.stringify(JSON.parse(responseBody), null, 2);
      } catch {
        // keep as is
      }
    }
    return {
      apiExec: {
        method,
        url,
        statusCode,
        statusText,
        durationMs,
        assertions: deriveAssertionsFromExpected(sr.status === 'pass'),
        responseBody: responseBody || undefined,
      },
      manualNote: '',
    };
  }

  return { apiExec: null, manualNote: rawNote };
}

export const statusDotConfig: Record<string, { dot: string; bg: string; text: string; border: string; label: string }> = {
  pass:    { dot: 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]', bg: 'bg-emerald-600', text: 'text-white', border: 'border-emerald-600', label: 'Pass' },
  fail:    { dot: 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]', bg: 'bg-red-600', text: 'text-white', border: 'border-red-600', label: 'Fail' },
  blocked: { dot: 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]', bg: 'bg-amber-600', text: 'text-white', border: 'border-amber-600', label: 'Blocked' },
  skip:    { dot: 'bg-zinc-400', bg: 'bg-zinc-600', text: 'text-white', border: 'border-zinc-600', label: 'Skip' },
  invalid: { dot: 'bg-violet-500 shadow-[0_0_6px_rgba(139,92,246,0.5)]', bg: 'bg-violet-600', text: 'text-white', border: 'border-violet-600', label: 'Invalid' },
  started: { dot: 'bg-[#4aa8ff] shadow-[0_0_8px_rgba(74,168,255,0.7)] animate-pulse', bg: 'bg-[#4aa8ff]', text: 'text-white', border: 'border-[#4aa8ff]', label: 'Running' },
  pending: { dot: 'border border-muted-foreground/40 bg-transparent', bg: 'bg-muted/40', text: 'text-muted-foreground', border: 'border-border/50', label: 'Not Run' },
};

export function renderTextWithLinks(text?: string | null) {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      // Detach trailing punctuation and quotes from URL
      const match = part.match(/^(.*?)(['".,!?:;)>]+)$/);
      const cleanUrl = match ? match[1] : part;
      const trailing = match ? match[2] : '';

      return (
        <React.Fragment key={index}>
          <a
            href={cleanUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-primary hover:underline font-mono inline-flex items-center gap-0.5 break-all font-medium transition-colors"
            title={`Open ${cleanUrl}`}
          >
            <span>{cleanUrl}</span>
            <ExternalLink className="h-2.5 w-2.5 inline-block shrink-0 opacity-75" />
          </a>
          {trailing}
        </React.Fragment>
      );
    }
    return part;
  });
}

function parseRawStepResults(raw: any): Record<string, StepResultData> {
  if (!raw || typeof raw !== 'object') return {};
  const parsed: Record<string, StepResultData> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'string') {
      parsed[key] = { status: val };
    } else if (val && typeof val === 'object') {
      parsed[key] = val as StepResultData;
    }
  }
  return parsed;
}

export function deriveCaseStatus(
  steps: StepItem[],
  stepResults: Record<string, StepResultData>
): ResultStatus {
  if (!steps || steps.length === 0) return 'pending';

  let hasFail = false;
  let hasBlocked = false;
  let passCount = 0;
  let skipCount = 0;
  let invalidCount = 0;
  let unavailableCount = 0;
  let errorCount = 0;
  let executedCount = 0;

  for (const step of steps) {
    const sr = stepResults[step.order.toString()];
    const status = sr?.status?.toLowerCase();
    if (status && status !== 'pending') {
      executedCount++;
      if (status === 'fail') hasFail = true;
      else if (status === 'blocked') hasBlocked = true;
      else if (status === 'pass') passCount++;
      else if (status === 'skip') skipCount++;
      else if (status === 'error') errorCount++;
      else if (status === 'invalid') invalidCount++;
      else if (status === 'unavailable') unavailableCount++;
    }
  }

  // 1. Failures always take highest priority
  if (hasFail) return 'fail';

  // 2. Blockers halt execution
  if (hasBlocked) return 'blocked';

  // 2b. Runner/script limitations are reported as Error, never Fail.
  if (errorCount > 0) return 'error';

  // 3. If any steps are still unexecuted, the case is still in progress
  if (executedCount < steps.length) {
    return 'pending';
  }

  // 4. All steps are executed (executedCount === steps.length):
  if (passCount > 0) {
    return 'pass';
  }

  if (skipCount === steps.length) {
    return 'skip';
  }

  if (invalidCount === steps.length) {
    return 'invalid';
  }

  if (unavailableCount > 0) {
    return 'unavailable';
  }

  if (skipCount + invalidCount === steps.length) {
    return 'skip';
  }

  return 'pending';
}

/**
 * Asymmetric Status Rollup for Parameterized Iterations:
 * - Fail is sticky per-iteration and immediately propagates to the case status.
 * - Blocked halts execution if no fails exist.
 * - Pass requires all iterations to complete and pass.
 */
export function deriveOverallCaseStatusWithIterations(
  iterationResults: Array<{ status?: string }>
): ResultStatus {
  if (!iterationResults || iterationResults.length === 0) return 'pending';

  let hasFail = false;
  let hasBlocked = false;
  let passCount = 0;
  let skipCount = 0;
  let invalidCount = 0;
  let executedCount = 0;

  for (const it of iterationResults) {
    const s = it.status?.toLowerCase();
    if (s && s !== 'pending') {
      executedCount++;
      if (s === 'fail') hasFail = true;
      else if (s === 'blocked') hasBlocked = true;
      else if (s === 'pass') passCount++;
      else if (s === 'skip') skipCount++;
      else if (s === 'invalid') invalidCount++;
    }
  }

  if (hasFail) return 'fail';
  if (hasBlocked) return 'blocked';
  if (invalidCount === iterationResults.length) return 'invalid';
  if (skipCount === iterationResults.length) return 'skip';
  if (passCount > 0 && passCount + skipCount === iterationResults.length) return 'pass';
  if (passCount === iterationResults.length) return 'pass';
  if (executedCount > 0) return 'pending';
  return 'pending';
}

export interface ExecutionConsoleProps {
  slug: string;
  runId: string;
  run: any;
  resultId?: string;
  caseKey?: string;
  results: any[];
  /**
   * True once the results request has settled (loaded or failed). When false
   * the console waits for results; when true a missing result/case is a real
   * "not found" and is reported instead of spinning forever.
   */
  resultsLoaded?: boolean;
  onResultsChange: (r: any[]) => void;
  refetchResults: () => Promise<void>;
  getCase: (id: string) => any;
  progress: Record<string, number>;
  currentUser: any;
  members: any[];
  suites: any[];
  modules: any[];
  onClose?: () => void;
}

export function ExecutionConsole(props: ExecutionConsoleProps) {
  const { slug, runId, run, resultId, caseKey, results, resultsLoaded = false, onResultsChange, refetchResults, getCase, progress, currentUser, members, suites, modules, onClose } = props;
  const router = useRouter();
  const { project: pj, workspaceName } = useProjectData();

  const [selectedCaseKey, setSelectedCaseKey] = useState<string>(caseKey || resultId || '');

  // Keep in sync if caseKey prop changes from external navigation
  useEffect(() => {
    if (caseKey) {
      setSelectedCaseKey(caseKey);
    }
  }, [caseKey]);

  const effectiveCaseKey = selectedCaseKey || caseKey;

  // Selected result resolution by effectiveCaseKey, resultId, or fallback
  const currentResult = useMemo(() => {
    if (effectiveCaseKey) {
      // 1. Match by case displayId (e.g. "INK-2")
      const byDisplayId = results.find((r) => {
        const c = getCase(r.testCaseId);
        return c?.displayId?.toLowerCase() === effectiveCaseKey.toLowerCase();
      });
      if (byDisplayId) return byDisplayId;

      // 2. Match by case displayId with attempt number (e.g. "INK-2.2")
      if (effectiveCaseKey.includes('.')) {
        const [baseKey, attemptStr] = effectiveCaseKey.split('.');
        const attempt = parseInt(attemptStr, 10);
        const byAttempt = results.find((r) => {
          const c = getCase(r.testCaseId);
          return (
            c?.displayId?.toLowerCase() === baseKey.toLowerCase() &&
            r.attemptNumber === attempt
          );
        });
        if (byAttempt) return byAttempt;
      }

      // 3. Match by testCaseId directly (CUID)
      const byCaseId = results.find((r) => r.testCaseId === effectiveCaseKey);
      if (byCaseId) return byCaseId;

      // 4. Match by result.id (CUID)
      const byResultId = results.find((r) => r.id === effectiveCaseKey);
      if (byResultId) return byResultId;
    }

    if (resultId) {
      return results.find((r) => r.id === resultId) || results[0] || null;
    }

    return results[0] || null;
  }, [results, effectiveCaseKey, resultId, getCase]);

  const currentCase = useMemo(() => (currentResult ? getCase(currentResult.testCaseId) : null), [currentResult, getCase]);

  // Load project environments for badge and base URL display
  const environmentsQuery = useQuery({
    queryKey: ['project-environments', slug],
    queryFn: () => getEnvironmentsAction(slug),
    enabled: Boolean(slug),
    staleTime: 60_000,
  });
  const environments = environmentsQuery.data ?? [];

  // Dataset & Iteration Detection
  const datasetInfo = useMemo(() => {
    if (!currentCase) return null;
    const snap = run?.resolved_datasets?.[currentCase.id];
    if (snap && Array.isArray(snap.rows) && snap.rows.length > 0) {
      return snap;
    }
    if (currentCase.dataset && Array.isArray(currentCase.dataset.rows) && currentCase.dataset.rows.length > 0) {
      return {
        datasetName: currentCase.dataset.name,
        parameters: currentCase.dataset.parameters || [],
        rows: currentCase.dataset.rows,
      };
    }
    const localDs = currentCase.local_dataset || (currentCase as any).localDataset;
    if (localDs && Array.isArray(localDs.rows) && localDs.rows.length > 0) {
      return {
        datasetName: 'Case Parameters',
        parameters: localDs.parameters || [],
        rows: localDs.rows,
      };
    }
    return null;
  }, [currentCase, run?.resolved_datasets]);

  const searchParams = useSearchParams();
  const urlIteration = searchParams.get('iteration') ? parseInt(searchParams.get('iteration')!, 10) - 1 : undefined;

  const [activeIterationIdx, setActiveIterationIdx] = useState<number>(() => {
    if (urlIteration !== undefined && urlIteration >= 0) return urlIteration;
    return 0;
  });

  const [iterationElapsedSeconds, setIterationElapsedSeconds] = useState<number>(0);
  const iterationElapsedRef = useRef(iterationElapsedSeconds);
  useEffect(() => {
    iterationElapsedRef.current = iterationElapsedSeconds;
  }, [iterationElapsedSeconds]);

  useEffect(() => {
    const iterParam = searchParams.get('iteration');
    if (iterParam) {
      const parsed = parseInt(iterParam, 10) - 1;
      if (parsed >= 0) {
        setActiveIterationIdx(parsed);
        setDecisionScope('iteration');
        return;
      }
    }
    setActiveIterationIdx(0);
    setDecisionScope('iteration');
  }, [currentResult?.id, searchParams]);

  const activeIterationRow = useMemo(() => {
    if (!datasetInfo?.rows || datasetInfo.rows.length === 0) return null;
    return datasetInfo.rows[activeIterationIdx] || null;
  }, [datasetInfo, activeIterationIdx]);

  const rawIterationResults = useMemo(() => {
    return (currentResult?.iterationResults as any[]) || [];
  }, [currentResult?.iterationResults]);

  const allVariablesList = useMemo(() => {
    if (!run?.resolved_variables) return [];
    return Object.entries(run.resolved_variables).map(([k, v]) => ({
      key: k,
      scope: 'GLOBAL' as const,
      default_value: String(v),
    }));
  }, [run?.resolved_variables]);

  const datasetParamsList = useMemo(() => {
    if (!activeIterationRow) return [];
    return Object.entries(activeIterationRow).map(([k, v]) => ({
      key: k,
      datasetName: datasetInfo?.datasetName,
      sampleValue: String(v),
    }));
  }, [activeIterationRow, datasetInfo?.datasetName]);

  const stripContainerRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [runnerOverridesOpen, setRunnerOverridesOpen] = useState(false);
  const [runningLinkedCase, setRunningLinkedCase] = useState(false);
  // Re-run goes through the same queue/lock as a normal run. While anything is
  // running or queued, it is disabled with a tooltip instead of silently
  // overwriting the current attempt.
  const runBusy = useMemo(
    () =>
      (results || []).some((r: any) => {
        if (String(r.status || '').toLowerCase() !== 'pending') return false;
        const state = String(r.caseState || r.executionState || '').toUpperCase();
        return state === 'RUNNING' || state === 'QUEUED' || state === 'WAITING';
      }),
    [results]
  );
  const [overrideVarsText, setOverrideVarsText] = useState('');
  const [overrideRows, setOverrideRows] = useState<Array<{ key: string; value: string }>>([]);
  // Keep the free-text form and the row editor in sync: the runner still takes
  // KEY=value lines, but the UI picks keys from resolved variables.
  const applyOverrideRows = (next: Array<{ key: string; value: string }>) => {
    setOverrideRows(next);
    setOverrideVarsText(
      next
        .filter((r) => r.key.trim())
        .map((r) => `${r.key.trim()}=${r.value}`)
        .join('\n')
    );
  };
  const [postmanOverrideIterations, setPostmanOverrideIterations] = useState('');
  const [postmanOverrideDelay, setPostmanOverrideDelay] = useState('');
  const [postmanOverrideTimeout, setPostmanOverrideTimeout] = useState('');
  const [datadogOverrideStartUrl, setDatadogOverrideStartUrl] = useState('');
  const [datadogOverrideExecutionRule, setDatadogOverrideExecutionRule] = useState('');
  const [datadogOverrideDelay, setDatadogOverrideDelay] = useState('');
  const [datadogOverrideRetry, setDatadogOverrideRetry] = useState('');
  const [expandedRawResponses, setExpandedRawResponses] = useState<Record<number, boolean>>({});
  const bulkMenuRef = useRef<HTMLDivElement>(null);

  // One-off overrides belong to the case currently in view; never leak them to
  // the next case the user opens.
  useEffect(() => {
    setRunnerOverridesOpen(false);
    setOverrideVarsText('');
    setPostmanOverrideIterations('');
    setPostmanOverrideDelay('');
    setPostmanOverrideTimeout('');
    setDatadogOverrideStartUrl('');
    setDatadogOverrideExecutionRule('');
    setDatadogOverrideDelay('');
    setDatadogOverrideRetry('');
  }, [currentCase?.id]);

  // Auto-scroll horizontal strip to keep active iteration pill visible and centered
  useEffect(() => {
    if (activeTabRef.current) {
      activeTabRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [activeIterationIdx]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (bulkMenuRef.current && !bulkMenuRef.current.contains(e.target as Node)) {
        setShowBulkMenu(false);
      }
    }
    if (showBulkMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showBulkMenu]);

  const [failedOnlyFilter, setFailedOnlyFilter] = useState(false);
  const [decisionScope, setDecisionScope] = useState<'iteration' | 'all'>('iteration');
  const [showIterationDropdown, setShowIterationDropdown] = useState(false);
  const iterationDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (iterationDropdownRef.current && !iterationDropdownRef.current.contains(e.target as Node)) {
        setShowIterationDropdown(false);
      }
    }
    if (showIterationDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showIterationDropdown]);

  const failedIterationIndices = useMemo(() => {
    if (!datasetInfo?.rows) return [];
    const list: number[] = [];
    datasetInfo.rows.forEach((_: any, idx: number) => {
      const ir = rawIterationResults.find((r: any) => r.iteration_index === idx + 1);
      const s = ir?.status?.toLowerCase();
      if (s === 'fail' || s === 'blocked') {
        list.push(idx);
      }
    });
    return list;
  }, [datasetInfo?.rows, rawIterationResults]);

  const handlePrevIteration = () => {
    if (!datasetInfo?.rows) return;
    if (failedOnlyFilter) {
      const prevFailed = [...failedIterationIndices].reverse().find(i => i < activeIterationIdx);
      if (prevFailed !== undefined) {
        handleSelectIteration(prevFailed);
      }
    } else {
      if (activeIterationIdx > 0) {
        handleSelectIteration(activeIterationIdx - 1);
      }
    }
  };

  const handleNextIteration = () => {
    if (!datasetInfo?.rows) return;
    if (failedOnlyFilter) {
      const nextFailed = failedIterationIndices.find(i => i > activeIterationIdx);
      if (nextFailed !== undefined) {
        handleSelectIteration(nextFailed);
      }
    } else {
      if (activeIterationIdx < datasetInfo.rows.length - 1) {
        handleSelectIteration(activeIterationIdx + 1);
      }
    }
  };

  const hasPrevIteration = failedOnlyFilter
    ? failedIterationIndices.some(i => i < activeIterationIdx)
    : activeIterationIdx > 0;

  const hasNextIteration = failedOnlyFilter
    ? failedIterationIndices.some(i => i > activeIterationIdx)
    : datasetInfo?.rows ? activeIterationIdx < datasetInfo.rows.length - 1 : false;

  const activeIterationResult = useMemo(() => {
    return rawIterationResults.find((ir: any) => ir.iteration_index === activeIterationIdx + 1);
  }, [rawIterationResults, activeIterationIdx]);

  const rawActiveStatus = (activeIterationResult?.status?.toLowerCase() || 'pending') as ResultStatus;
  const isIterationStarted = rawActiveStatus === 'pending' && ((activeIterationResult?.time_spent_seconds && activeIterationResult.time_spent_seconds > 0) || iterationElapsedSeconds > 0);
  const activeIterationStatus: ResultStatus | 'started' = isIterationStarted ? 'started' : rawActiveStatus;

  const handleScrollStrip = (direction: 'left' | 'right') => {
    if (!stripContainerRef.current) return;
    const scrollAmount = 240;
    stripContainerRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  const passedIterationsCount = useMemo(() => {
    return rawIterationResults.filter((ir: any) => ir.status?.toLowerCase() === 'pass').length;
  }, [rawIterationResults]);

  const failedIterationsCount = useMemo(() => {
    return rawIterationResults.filter((ir: any) => ir.status?.toLowerCase() === 'fail').length;
  }, [rawIterationResults]);

  const blockedIterationsCount = useMemo(() => {
    return rawIterationResults.filter((ir: any) => ir.status?.toLowerCase() === 'blocked').length;
  }, [rawIterationResults]);

  const skippedIterationsCount = useMemo(() => {
    return rawIterationResults.filter((ir: any) => ir.status?.toLowerCase() === 'skip').length;
  }, [rawIterationResults]);

  const invalidIterationsCount = useMemo(() => {
    return rawIterationResults.filter((ir: any) => ir.status?.toLowerCase() === 'invalid').length;
  }, [rawIterationResults]);

  const pendingIterationsCount = useMemo(() => {
    if (!datasetInfo?.rows) return 0;
    const executedCount = passedIterationsCount + failedIterationsCount + blockedIterationsCount;
    return Math.max(0, datasetInfo.rows.length - executedCount);
  }, [datasetInfo?.rows, passedIterationsCount, failedIterationsCount, blockedIterationsCount]);

  // Core state - initialized synchronously from currentCase and currentResult
  const [steps, setSteps] = useState<StepItem[]>(() => (currentCase?.steps || []) as StepItem[]);
  const [stepResults, setStepResults] = useState<Record<string, any>>(() => parseRawStepResults(currentResult?.stepResults));
  const [notes, setNotes] = useState(() => currentResult?.notes || '');
  const [evidenceUrl, setEvidenceUrl] = useState(() => currentResult?.evidenceUrl || '');
  const [failureReason, setFailureReason] = useState(() => currentResult?.failureReason || '');
  // Tracks whether the user explicitly started execution in this session. The timer
  // only runs/persists after an explicit start — never automatically on mount or on
  // viewing an already-completed case (fixes completed runs reverting to "started").
  const [sessionStarted, setSessionStarted] = useState(false);
  const [showDefectModal, setShowDefectModal] = useState(false);
  const [viewingDefect, setViewingDefect] = useState<any | null>(null);
  const [defectStepContext, setDefectStepContext] = useState<{
    order?: number;
    instruction?: string;
    expectedResult?: string;
    attachments?: Array<{ id: string; filename: string; url?: string; source?: string }>;
  }>({});
  const [autosaving, setAutosaving] = useState(false);
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Split history into current run retries vs previous runs
  const currentRunRetries = useMemo(() => {
    return runHistory.filter((h) => h.runId === runId && h.id !== currentResult?.id);
  }, [runHistory, runId, currentResult?.id]);

  const previousRunsHistory = useMemo(() => {
    return runHistory.filter((h) => h.runId !== runId);
  }, [runHistory, runId]);

  const [sidebarGroupBy, setSidebarGroupBy] = useState<RunGroupBy>('flat');
  const [railCaseType, setRailCaseType] = useState<RunCaseTypeFilter>('all');
  const [railAssignedToMe, setRailAssignedToMe] = useState(false);
  const [railPriority, setRailPriority] = useState('');
  const [expandedSidebarCaseIters, setExpandedSidebarCaseIters] = useState<Set<string>>(new Set());

  // Consolidated Main Column Tabs: Execution | History
  const [mainTab, setMainTab] = useState<'test_case' | 'history'>('test_case');
  const [showNotesDrawer, setShowNotesDrawer] = useState(false);
  const [resyncingDatadog, setResyncingDatadog] = useState(false);
  const [openStepNotes, setOpenStepNotes] = useState<Record<number, boolean>>({});
  const [previewAttachment, setPreviewAttachment] = useState<{ id: string; filename: string } | null>(null);
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const [isPreExpanded, setIsPreExpanded] = useState(false);
  const [isPostExpanded, setIsPostExpanded] = useState(false);

  // Auto-expand accordions on console if they contain content
  useEffect(() => {
    if (currentCase?.description?.trim()) setIsDescExpanded(true);
    if (currentCase?.preConditions?.trim()) setIsPreExpanded(true);
    if (currentCase?.postConditions?.trim()) setIsPostExpanded(true);
  }, [currentCase?.description, currentCase?.preConditions, currentCase?.postConditions]);
  const [collapsedSteps, setCollapsedSteps] = useState<Record<number, boolean>>({});
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [confirmConfig, setConfirmConfig] = useState<{ open: boolean; title: string; description: React.ReactNode; confirmLabel?: string; onConfirm: () => void; variant?: 'default' | 'destructive' } | null>(null);

  // Normalize browser URL to friendly displayId (e.g. ADMN-7 instead of CUID) without route reloads
  useEffect(() => {
    if (currentCase?.displayId && effectiveCaseKey && effectiveCaseKey.toLowerCase() !== currentCase.displayId.toLowerCase() && !effectiveCaseKey.includes('.')) {
      setSelectedCaseKey(currentCase.displayId);
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `/p/${slug}/runs/${runId}/${currentCase.displayId}`);
      }
    }
  }, [currentCase?.displayId, effectiveCaseKey, slug, runId]);

  // Deduplicated left rail results
  const uniqueResults = useMemo(() => {
    const seen = new Set<string>();
    return results.filter((r) => {
      if (!r.testCaseId || seen.has(r.testCaseId)) return false;
      seen.add(r.testCaseId);
      return true;
    });
  }, [results]);

  // Real-time status breakdown for progress bars
  const statusCounts = useMemo(() => {
    const counts = { pass: 0, fail: 0, blocked: 0, invalid: 0, skip: 0, pending: 0 };
    uniqueResults.forEach((r) => {
      const s = (r.status?.toLowerCase() || 'pending') as keyof typeof counts;
      if (counts[s] !== undefined) {
        counts[s]++;
      } else {
        counts.pending++;
      }
    });
    return counts;
  }, [uniqueResults]);

  // Disclosure sections state (DEFAULT OPEN)
  const [showPreconditions, setShowPreconditions] = useState<boolean>(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('inka_cockpit_pre') !== 'false';
    return true;
  });
  const [showPostconditions, setShowPostconditions] = useState<boolean>(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('inka_cockpit_post') !== 'false';
    return true;
  });

  const togglePreconditions = (val: boolean) => {
    setShowPreconditions(val);
    if (typeof window !== 'undefined') sessionStorage.setItem('inka_cockpit_pre', val ? 'true' : 'false');
  };

  const togglePostconditions = (val: boolean) => {
    setShowPostconditions(val);
    if (typeof window !== 'undefined') sessionStorage.setItem('inka_cockpit_post', val ? 'true' : 'false');
  };

  // Step layout mode: 'table' (side-by-side) or 'stacked' (full-width flow)
  const [stepLayout, setStepLayout] = useState<'table' | 'stacked'>(() => {
    if (typeof window !== 'undefined') return (sessionStorage.getItem('inka_step_layout') as any) || 'table';
    return 'table';
  });

  const toggleStepLayout = (layout: 'table' | 'stacked') => {
    setStepLayout(layout);
    if (typeof window !== 'undefined') sessionStorage.setItem('inka_step_layout', layout);
  };

  // Live status derivation & manual override with fallback to existing result status
  const derivedStatus = useMemo(() => deriveCaseStatus(steps, stepResults), [steps, stepResults]);

  /**
   * Datadog results carry a provider step id. Match them to the imported steps
   * by that id only — never by name or position. Steps that no longer exist in
   * the imported case are surfaced separately (see UnmatchedProviderResults).
   */
  const providerStepIndex = useMemo(() => {
    const metaByStepId = new Map<string, StepItem>();
    for (const step of steps) {
      const meta = parseDatadogStepMeta(step.meta);
      if (meta?.stepId) metaByStepId.set(meta.stepId, step);
    }
    return metaByStepId;
  }, [steps]);
  const overrideData = stepResults._override as { status: string; overrodeStatus: string; timestamp: string; userName: string } | undefined;
  const overrideStatus = overrideData?.status ? (overrideData.status.toLowerCase() as ResultStatus) : null;
  const effectiveStatus = (
    overrideStatus ||
    (derivedStatus !== 'pending' ? derivedStatus : null) ||
    (currentResult?.status?.toLowerCase() as ResultStatus) ||
    'pending'
  );
  // Datadog execution is asynchronous: while the durable monitor waits for the
  // provider result the case is explicitly "Awaiting Results" (never a failure).
  const isAwaitingExternal =
    currentCase && getCaseAutomationSource(currentCase) === 'datadog' && effectiveStatus === 'pending' && ['RUNNING', 'QUEUED', 'WAITING'].includes(String(currentResult?.caseState || currentResult?.executionState || '').toUpperCase());
  const auditLogs = useMemo(() => (stepResults._auditLog as any[]) || [], [stepResults._auditLog]);

  const [isExecutingExternalLocal, setIsExecutingExternalLocal] = useState(false);
  useEffect(() => {
    if (effectiveStatus !== 'pending') setIsExecutingExternalLocal(false);
  }, [effectiveStatus]);

  // Accent bar color mapping to case result
  const accentBarColor = useMemo(() => {
    switch (effectiveStatus) {
      case 'fail':
        return 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]';
      case 'error':
        return 'bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.4)]';
      case 'pass':
        return 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]';
      case 'blocked':
        return 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]';
      case 'invalid':
        return 'bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.4)]';
      case 'unavailable':
        return 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]';
      case 'skip':
      case 'cancelled':
        return 'bg-zinc-400';
      case 'pending':
      default:
        return 'bg-zinc-500';
    }
  }, [effectiveStatus]);

  // Cockpit view options
  const [leftRailOpen, setLeftRailOpen] = useState(true);
  // The 370px rail costs a third of a 1024px screen. Collapse it by default
  // there and open it on demand as an overlay.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      setLeftRailOpen(false);
    }
  }, []);
  const [railSearch, setRailSearch] = useState('');
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Restore the tester's last view for this run (shared with the run deck).
  useEffect(() => {
    const saved = loadRunViewFilters(runId, 'flat');
    // Restoring the persisted view is a one-time sync from sessionStorage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRailCaseType(saved.caseType);
    setRailAssignedToMe(saved.assignedToMe);
    setRailPriority(saved.priority);
    setSidebarGroupBy(saved.groupBy);
  }, [runId]);

  const filteredRailResults = useMemo(() => {
    const q = railSearch.trim().toLowerCase();
    return uniqueResults.filter((r) => {
      if (
        !matchesRailCaseFilters(r, getCase, {
          caseType: railCaseType,
          assignedToMe: railAssignedToMe,
          priority: railPriority,
          userId: currentUser?.id,
        })
      ) {
        return false;
      }
      if (!q) return true;
      const c = getCase(r.testCaseId);
      return Boolean(c?.title?.toLowerCase().includes(q) || c?.displayId?.toLowerCase().includes(q));
    });
  }, [uniqueResults, railSearch, railCaseType, railAssignedToMe, railPriority, currentUser?.id, getCase]);

  const railCaseTypeCounts = useMemo(() => {
    let manual = 0;
    let automated = 0;
    for (const r of uniqueResults) {
      const c = getCase(r.testCaseId);
      if (!c) continue;
      if (isAutomatedCase(c)) automated += 1;
      else manual += 1;
    }
    return { all: manual + automated, manual, automated };
  }, [uniqueResults, getCase]);

  const railAssignedToMeCount = useMemo(
    () =>
      uniqueResults.filter(
        (r) => r.assignedTo != null && String(r.assignedTo) === String(currentUser?.id)
      ).length,
    [uniqueResults, currentUser?.id]
  );

  const railGroups = useMemo(() => {
    type RailGroup = { key: string; name: string; results: any[] };
    if (sidebarGroupBy === 'flat') {
      return [{ key: 'all', name: 'All cases', results: filteredRailResults }] as RailGroup[];
    }

    if (sidebarGroupBy === 'priority') {
      return ['P0', 'P1', 'P2', 'P3']
        .map((p) => ({
          key: `priority-${p}`,
          name: `Priority ${p}`,
          results: filteredRailResults.filter((r) => getCase(r.testCaseId)?.priority === p),
        }))
        .filter((group) => group.results.length > 0);
    }

    if (sidebarGroupBy === 'status') {
      const buckets: { key: string; name: string; matches: (status: string) => boolean }[] = [
        { key: 'failed', name: 'Failed', matches: (s) => s === 'fail' },
        { key: 'error', name: 'Script error', matches: (s) => s === 'error' },
        {
          key: 'blocked',
          name: "Couldn't run",
          matches: (s) => s === 'blocked' || s === 'invalid' || s === 'unavailable',
        },
        { key: 'not-run', name: 'Not run', matches: (s) => s === 'pending' },
        { key: 'passed', name: 'Passed', matches: (s) => s === 'pass' || s === 'skip' },
      ];
      return buckets
        .map((bucket) => ({
          key: bucket.key,
          name: bucket.name,
          results: filteredRailResults.filter((r) =>
            bucket.matches(String(r.status || '').toLowerCase())
          ),
        }))
        .filter((group) => group.results.length > 0);
    }

    if (sidebarGroupBy === 'suite') {
      const map = new Map<string, RailGroup>();
      for (const r of filteredRailResults) {
        const c = getCase(r.testCaseId);
        const matchedSuite = suites.find((s: any) =>
          s.suite_cases?.some(
            (sc: any) => sc.test_case_id === c?.id || sc.test_case?.id === c?.id
          )
        );
        const key = matchedSuite?.id || '__no-suite';
        if (!map.has(key)) {
          map.set(key, {
            key,
            name: matchedSuite?.name || 'No suite',
            results: [],
          });
        }
        map.get(key)!.results.push(r);
      }
      return [...map.values()].sort((a, b) => {
        if (a.key === '__no-suite') return 1;
        if (b.key === '__no-suite') return -1;
        return a.name.localeCompare(b.name);
      });
    }

    const map = new Map<string, RailGroup>();
    for (const r of filteredRailResults) {
      const c = getCase(r.testCaseId);
      const mod = modules.find((m: any) => m.id === c?.moduleId);
      const key = mod?.id || '__no-module';
      if (!map.has(key)) {
        map.set(key, { key, name: mod?.name || 'No module', results: [] });
      }
      map.get(key)!.results.push(r);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [filteredRailResults, sidebarGroupBy, getCase, suites, modules]);


  // Attachments state
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);

  useEffect(() => {
    // Auto-generated execution summaries are metadata, not authored notes, so
    // they must not force the notes editor open on a passing case.
    const hasUserNotes = Boolean(notes && notes.trim() && !isAutoGeneratedSummary(notes));
    if (hasUserNotes || evidenceUrl || failureReason || attachments.length > 0) {
      setShowNotesDrawer(true);
    }
  }, [notes, evidenceUrl, failureReason, attachments.length]);

  // Timer with Inactivity Tracking & Resilient Storage
  const AWAY_GRACE_MS = 30 * 1000;
  const INACTIVITY_TIMEOUT_MS = 30 * 1000;

  const getStoredTimer = (resId?: string): number => {
    if (!resId || typeof window === 'undefined') return 0;
    try {
      const raw = localStorage.getItem(`inka_timer_${resId}`);
      return raw ? parseInt(raw, 10) || 0 : 0;
    } catch {
      return 0;
    }
  };

  const setStoredTimer = (resId: string | undefined, secs: number) => {
    if (!resId || typeof window === 'undefined') return;
    try {
      localStorage.setItem(`inka_timer_${resId}`, String(secs));
    } catch {}
  };

  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() => {
    if (!currentResult?.id) return 0;
    const stored = getStoredTimer(currentResult.id);
    return Math.max(currentResult.timeSpentSeconds ?? 0, stored);
  });

  const [timerPausedReason, setTimerPausedReason] = useState<'away' | 'idle' | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const awayTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Synchronously reconcile state when currentResult changes so there is zero intermediate render/flicker
  const [activeResultId, setActiveResultId] = useState(currentResult?.id);

  if (currentResult && currentResult.id !== activeResultId) {
    setActiveResultId(currentResult.id);
    setSteps((currentCase?.steps || []) as StepItem[]);
    setStepResults(parseRawStepResults(currentResult.stepResults));
    setNotes(currentResult.notes || '');
    setEvidenceUrl(currentResult.evidenceUrl || '');
    setFailureReason(currentResult.failureReason || '');
    const stored = getStoredTimer(currentResult.id);
    setElapsedSeconds(Math.max(currentResult.timeSpentSeconds ?? 0, stored));
    setIterationElapsedSeconds(0);
    const hasNotesOrEvidence = Boolean(
      (currentResult.notes &&
        currentResult.notes.trim().length > 0 &&
        !isAutoGeneratedSummary(currentResult.notes)) ||
      (currentResult.evidenceUrl && currentResult.evidenceUrl.trim().length > 0) ||
      (currentResult.failureReason && currentResult.failureReason.trim().length > 0)
    );
    const isNeg = currentResult.status === 'fail' || currentResult.status === 'error' || currentResult.status === 'blocked' || currentResult.status === 'invalid';
    setShowNotesDrawer(isNeg || hasNotesOrEvidence);
    setOpenStepNotes({});
  }

  // Throttled User Activity Tracking (registered once on mount)
  useEffect(() => {
    let lastRecorded = 0;
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    const handler = () => {
      const now = Date.now();
      if (now - lastRecorded > 1000) {
        lastRecorded = now;
        lastActivityRef.current = now;
        setTimerPausedReason((prev) => (prev === 'idle' ? null : prev));
      }
    };
    events.forEach((evt) => window.addEventListener(evt, handler, { passive: true }));
    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handler));
    };
  }, []);

  useEffect(() => {
    const handleAway = () => {
      saveTimerToDb();
      if (awayTimerRef.current) clearTimeout(awayTimerRef.current);
      awayTimerRef.current = setTimeout(() => {
        setTimerPausedReason('away');
      }, AWAY_GRACE_MS);
    };

    const handleReturn = () => {
      if (awayTimerRef.current) clearTimeout(awayTimerRef.current);
      lastActivityRef.current = Date.now();
      setTimerPausedReason(null);
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') handleAway();
      else handleReturn();
    };

    window.addEventListener('blur', handleAway);
    window.addEventListener('focus', handleReturn);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('blur', handleAway);
      window.removeEventListener('focus', handleReturn);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (awayTimerRef.current) clearTimeout(awayTimerRef.current);
    };
  }, []);

  const isDecided = effectiveStatus !== 'pending';
  const isDecidedRef = useRef(isDecided);
  useEffect(() => {
    isDecidedRef.current = isDecided;
  }, [isDecided]);

  // Only sync/initialize elapsedSeconds when switching between test case results
  useEffect(() => {
    if (!currentResult?.id) return;
    const stored = getStoredTimer(currentResult.id);
    setElapsedSeconds((prev) => Math.max(prev, currentResult.timeSpentSeconds ?? 0, stored));
  }, [currentResult?.id]);

  // Timer ticking interval — runs only after an explicit user start (Re-run),
  // never automatically on mount or when viewing an already-completed case.
  useEffect(() => {
    if (!currentResult?.id || !sessionStarted || isDecided || timerPausedReason) return;

    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastActivityRef.current > INACTIVITY_TIMEOUT_MS) {
        setTimerPausedReason('idle');
        return;
      }
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        setStoredTimer(currentResult.id, next);
        return next;
      });
      setIterationElapsedSeconds((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [currentResult?.id, isDecided, timerPausedReason]);

  const elapsedRef = useRef(elapsedSeconds);
  useEffect(() => {
    elapsedRef.current = elapsedSeconds;
  }, [elapsedSeconds]);

  const currentResultRef = useRef(currentResult);
  useEffect(() => {
    currentResultRef.current = currentResult;
  }, [currentResult]);

  const rawIterationResultsRef = useRef(rawIterationResults);
  useEffect(() => {
    rawIterationResultsRef.current = rawIterationResults;
  }, [rawIterationResults]);

  const activeIterationIdxRef = useRef(activeIterationIdx);
  useEffect(() => {
    activeIterationIdxRef.current = activeIterationIdx;
  }, [activeIterationIdx]);

  const currentUserRef = useRef(currentUser);
  useEffect(() => {
    currentUserRef.current = currentUser;
  }, [currentUser]);

  const saveTimerToDb = useCallback(async () => {
    const target = currentResultRef.current;
    const user = currentUserRef.current;
    if (!target || !user) return;
    try {
      const iters = rawIterationResultsRef.current;
      let nextIters = iters.length > 0 ? [...iters] : undefined;
      if (nextIters && nextIters.length > 0) {
        const curIterIdx = activeIterationIdxRef.current + 1;
        const matchIdx = nextIters.findIndex((ir: any) => ir.iteration_index === curIterIdx);
        if (matchIdx >= 0) {
          nextIters[matchIdx] = {
            ...nextIters[matchIdx],
            time_spent_seconds: iterationElapsedRef.current,
          };
        }
      }

      const currentSecs = elapsedRef.current;
      setStoredTimer(target.id, currentSecs);

      await updateRunResultAction(target.id, {
        timeSpentSeconds: currentSecs,
        iterationResults: nextIters,
        executedBy: user.id,
      });
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    const timerInterval = setInterval(() => {
      if (elapsedRef.current > 0 && !isDecided) {
        saveTimerToDb();
      }
    }, 10000);
    return () => clearInterval(timerInterval);
  }, [saveTimerToDb, isDecided]);

  // Flush timer to DB and update stored timer on unmount
  useEffect(() => {
    return () => {
      const target = currentResultRef.current;
      const user = currentUserRef.current;
      const currentSecs = elapsedRef.current;
      if (target && currentSecs > 0) {
        setStoredTimer(target.id, currentSecs);

        // Only persist timer to DB when the user explicitly started execution.
        if (sessionStarted && user?.id && !isDecidedRef.current) {
          const iters = rawIterationResultsRef.current;
          let nextIters = iters.length > 0 ? [...iters] : undefined;
          if (nextIters && nextIters.length > 0) {
            const curIterIdx = activeIterationIdxRef.current + 1;
            const matchIdx = nextIters.findIndex((ir: any) => ir.iteration_index === curIterIdx);
            if (matchIdx >= 0) {
              nextIters[matchIdx] = {
                ...nextIters[matchIdx],
                time_spent_seconds: iterationElapsedRef.current,
              };
            }
          }

          updateRunResultAction(target.id, {
            timeSpentSeconds: currentSecs,
            iterationResults: nextIters,
            executedBy: user.id,
          }).catch(() => {});
          apiClient.invalidate(`/api/v1/runs/${encodeURIComponent(runId)}/results`);
        }
      }
    };
  }, [runId]);

  const fetchAttachments = useCallback(async (resultId: string) => {
    setAttachmentsLoading(true);
    try {
      const data = await apiClient.get<{ attachments: any[] }>(
        `/api/v1/runs/${encodeURIComponent(runId)}/results/${encodeURIComponent(resultId)}/details`,
        undefined,
        { forceRefresh: true }
      );
      setAttachments(data?.attachments || []);
    } catch {
      setAttachments([]);
    } finally {
      setAttachmentsLoading(false);
    }
  }, [runId]);

  const openAttachment = (attachmentId: string, filename?: string) => {
    setPreviewAttachment({
      id: attachmentId,
      filename: filename || 'Attachment Preview',
    });
  };

  const handleCaseFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentResult || !pj?.id) return;

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entityId', currentResult.id);
      formData.append('entityType', 'run_result');
      formData.append('projectId', pj.id);

      await uploadFileAction(formData);
      toast.success('Case attachment uploaded');
      fetchAttachments(currentResult.id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to upload attachment');
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    try {
      await deleteAttachmentAction(attachmentId);
      toast.success('Attachment deleted');
      if (currentResult) fetchAttachments(currentResult.id);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete attachment');
    }
  };

  const stepResultsRef = useRef(stepResults);
  const notesRef = useRef(notes);
  const evidenceRef = useRef(evidenceUrl);
  const failureRef = useRef(failureReason);

  useEffect(() => { stepResultsRef.current = stepResults; }, [stepResults]);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  useEffect(() => { evidenceRef.current = evidenceUrl; }, [evidenceUrl]);
  useEffect(() => { failureRef.current = failureReason; }, [failureReason]);

  const saveCurrentResult = useCallback(
    async (overrideObj: Partial<{
      stepResults: any;
      iterationResults: any;
      notes: string;
      evidenceUrl: string;
      failureReason: string;
      status: string;
      timeSpentSeconds: number;
    }> = {}) => {
      if (!currentResult || !currentUser) return;

      const sr = overrideObj.stepResults !== undefined ? overrideObj.stepResults : stepResultsRef.current;
      const iterResults = overrideObj.iterationResults !== undefined ? overrideObj.iterationResults : (currentResult.iterationResults || undefined);
      const n = overrideObj.notes !== undefined ? overrideObj.notes : notesRef.current;
      const ev = overrideObj.evidenceUrl !== undefined ? overrideObj.evidenceUrl : evidenceRef.current;
      const fr = overrideObj.failureReason !== undefined ? overrideObj.failureReason : failureRef.current;
      const ts = overrideObj.timeSpentSeconds !== undefined ? overrideObj.timeSpentSeconds : elapsedRef.current;

      const ov = sr?._override;
      const ovStatus = ov?.status ? (ov.status.toLowerCase() as ResultStatus) : null;
      const naturalStatus = deriveCaseStatus(steps, sr);
      const computedStatus = ovStatus || naturalStatus;
      const finalStatus = (overrideObj.status || computedStatus).toUpperCase();

      setAutosaving(true);
      try {
        await updateRunResultAction(currentResult.id, {
          stepResults: sr,
          iterationResults: iterResults,
          notes: n,
          evidenceUrl: ev,
          failureReason: fr || undefined,
          status: finalStatus as any,
          executedBy: currentUser.id,
          timeSpentSeconds: ts,
          source: 'case-detail',
        });
        props.refetchResults();
      } catch {
        // Non-fatal
      } finally {
        setAutosaving(false);
      }
    },
    [currentResult, currentUser, steps, props]
  );

  const handleStepClick = async (order: number, targetStatus: string) => {
    const key = order.toString();
    const currentStatus = stepResults[key]?.status;
    const nextStatus = currentStatus === targetStatus ? 'pending' : targetStatus;

    const nextStepResults = {
      ...stepResults,
    };

    nextStepResults[key] = {
      ...nextStepResults[key],
      status: nextStatus,
    };

    // If a step is explicitly marked FAIL or BLOCKED, remove any contradictory manual override (like PASS)
    if (nextStatus === 'fail' || nextStatus === 'blocked') {
      if (nextStepResults._override && nextStepResults._override.status !== nextStatus) {
        delete nextStepResults._override;
      }
    }

    setStepResults(nextStepResults);
    stepResultsRef.current = nextStepResults;

    if (nextStatus !== 'pending') {
      setCollapsedSteps((prev) => ({
        ...prev,
        [order]: true,
        [order + 1]: false,
      }));
    }

    // If case has dataset iterations, track step status per iteration and propagate
    if (datasetInfo && datasetInfo.rows && datasetInfo.rows.length > 0) {
      const iterIdx = activeIterationIdx + 1;
      const nextIterationResults = [...rawIterationResults];
      const iterStatus = deriveCaseStatus(steps, nextStepResults);
      const rowItem = datasetInfo.rows[activeIterationIdx] || {};

      const existingIdx = nextIterationResults.findIndex((ir: any) => ir.iteration_index === iterIdx);
      const entry = {
        iteration_index: iterIdx,
        row_id: rowItem.id || String(iterIdx),
        parameters: rowItem,
        status: iterStatus,
        step_results: nextStepResults,
        executed_at: new Date().toISOString(),
      };

      if (existingIdx >= 0) {
        nextIterationResults[existingIdx] = entry;
      } else {
        nextIterationResults.push(entry);
      }

      for (let i = 1; i <= datasetInfo.rows.length; i++) {
        if (!nextIterationResults.some((ir: any) => ir.iteration_index === i)) {
          const rObj = datasetInfo.rows[i - 1] || {};
          nextIterationResults.push({
            iteration_index: i,
            row_id: rObj.id || String(i),
            parameters: rObj,
            status: 'pending',
            step_results: {},
          });
        }
      }

      const overallIterStatus = deriveOverallCaseStatusWithIterations(nextIterationResults);
      const finalStatus = overallIterStatus.toUpperCase();

      saveCurrentResult({
        stepResults: nextStepResults,
        iterationResults: nextIterationResults,
        status: finalStatus,
      });

      if (nextStatus === 'fail') {
        toast.error(`Iteration ${iterIdx} · Step ${order} marked Fail (Case status: FAIL)`);
      } else if (nextStatus === 'blocked') {
        toast.warning(`Iteration ${iterIdx} · Step ${order} marked Blocked`);
      } else if (nextStatus === 'pass' && iterStatus === 'pass') {
        const passedCount = nextIterationResults.filter((r: any) => r.status === 'pass').length;
        if (passedCount === datasetInfo.rows.length) {
          toast.success(`All ${datasetInfo.rows.length} iterations passed! (Case status: PASS)`);
        } else {
          toast.success(`Iteration ${iterIdx} passed (${passedCount}/${datasetInfo.rows.length} passed) · Advanced to Itr #${iterIdx + 1}`);
          if (activeIterationIdx < datasetInfo.rows.length - 1) {
            handleSelectIteration(activeIterationIdx + 1);
          }
        }
      }
      return;
    }

    const naturalStatus = deriveCaseStatus(steps, nextStepResults);
    const ov = nextStepResults._override;
    const finalStatus = ov?.status ? ov.status.toUpperCase() : naturalStatus.toUpperCase();

    saveCurrentResult({ stepResults: nextStepResults, status: finalStatus });

    if (nextStatus === 'fail') {
      toast.error(`Step ${order} marked Fail (Case status: FAIL)`);
    } else if (nextStatus === 'blocked') {
      toast.warning(`Step ${order} marked Blocked (Case status: BLOCKED)`);
    } else if (nextStatus === 'pass' && naturalStatus === 'pass') {
      toast.success(`All steps passed (Case status: PASS)`);
    }
  };

  const handleSelectIteration = (idx: number) => {
    // Flush outgoing iteration time
    const outgoingIdx = activeIterationIdx + 1;
    const existingList = (currentResult?.iterationResults as any[]) || [];
    const nextList = [...existingList];
    const outMatchIdx = nextList.findIndex((ir: any) => ir.iteration_index === outgoingIdx);
    if (outMatchIdx >= 0 && iterationElapsedRef.current > 0) {
      nextList[outMatchIdx] = {
        ...nextList[outMatchIdx],
        time_spent_seconds: iterationElapsedRef.current,
      };
      saveCurrentResult({ iterationResults: nextList });
    }

    setActiveIterationIdx(idx);
    const targetEntry = nextList.find((ir: any) => ir.iteration_index === idx + 1);
    setStepResults(parseRawStepResults(targetEntry?.step_results));
    setIterationElapsedSeconds(targetEntry?.time_spent_seconds || 0);

    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('iteration', String(idx + 1));
      window.history.replaceState(null, '', url.toString());
    }
  };

  const handleMarkCurrentIteration = async (targetStatus: ResultStatus) => {
    if (!currentResult || !currentUser || !datasetInfo?.rows) return;

    const iterIdx = activeIterationIdx + 1;
    const rowItem = datasetInfo.rows[activeIterationIdx] || {};

    const currentIterStepResults = targetStatus === 'pass'
      ? steps.reduce((acc: any, s) => { acc[s.order.toString()] = { status: 'pass' }; return acc; }, {})
      : targetStatus === 'fail'
      ? { ...stepResults, [steps[0]?.order?.toString() || '1']: { status: 'fail' } }
      : targetStatus === 'blocked'
      ? { ...stepResults, [steps[0]?.order?.toString() || '1']: { status: 'blocked' } }
      : targetStatus === 'skip'
      ? { ...stepResults, [steps[0]?.order?.toString() || '1']: { status: 'skip' } }
      : { ...stepResults, [steps[0]?.order?.toString() || '1']: { status: 'invalid' } };

    const nextIterationResults = [...rawIterationResults];
    const existingIdx = nextIterationResults.findIndex((ir: any) => ir.iteration_index === iterIdx);
    const existingEntry = existingIdx >= 0 ? nextIterationResults[existingIdx] : null;
    const entry = {
      iteration_index: iterIdx,
      row_id: rowItem.id || String(iterIdx),
      parameters: rowItem,
      status: targetStatus,
      step_results: currentIterStepResults,
      executed_at: new Date().toISOString(),
      time_spent_seconds: (existingEntry?.time_spent_seconds || 0) + (iterationElapsedRef.current || 0),
      assigned_to: existingEntry?.assigned_to ?? null,
    };

    if (existingIdx >= 0) {
      nextIterationResults[existingIdx] = entry;
    } else {
      nextIterationResults.push(entry);
    }

    for (let i = 1; i <= datasetInfo.rows.length; i++) {
      if (!nextIterationResults.some((ir: any) => ir.iteration_index === i)) {
        const rObj = datasetInfo.rows[i - 1] || {};
        nextIterationResults.push({
          iteration_index: i,
          row_id: rObj.id || String(i),
          parameters: rObj,
          status: 'pending',
          step_results: {},
        });
      }
    }

    const overallIterStatus = deriveOverallCaseStatusWithIterations(nextIterationResults);
    const finalStatus = overallIterStatus.toUpperCase();

    setStepResults(currentIterStepResults);

    saveCurrentResult({
      stepResults: currentIterStepResults,
      iterationResults: nextIterationResults,
      status: finalStatus,
    });

    if (activeIterationIdx < datasetInfo.rows.length - 1) {
      handleSelectIteration(activeIterationIdx + 1);
      toast.success(`Iteration ${iterIdx} marked ${targetStatus.toUpperCase()} · Advanced to Iteration ${iterIdx + 1}`);
    } else {
      toast.success(`Iteration ${iterIdx} marked ${targetStatus.toUpperCase()} (All iterations completed)`);
    }
  };

  const handleResetCurrentIteration = async () => {
    if (!currentResult || !datasetInfo?.rows) return;
    const iterIdx = activeIterationIdx + 1;
    const nextIterationResults = [...rawIterationResults];
    const existingIdx = nextIterationResults.findIndex((ir: any) => ir.iteration_index === iterIdx);
    if (existingIdx >= 0) {
      nextIterationResults[existingIdx] = {
        ...nextIterationResults[existingIdx],
        status: 'pending',
        step_results: {},
        executed_at: undefined,
        time_spent_seconds: 0,
      };
    }
    const overallIterStatus = deriveOverallCaseStatusWithIterations(nextIterationResults);
    setStepResults({});
    setIterationElapsedSeconds(0);
    saveCurrentResult({
      stepResults: {},
      iterationResults: nextIterationResults,
      status: overallIterStatus.toUpperCase(),
    });
    toast.success(`Iteration #${iterIdx} reset to Pending`);
  };

  const handleAssignCurrentIteration = async (assigneeId: number | null) => {
    if (!currentResult || !datasetInfo?.rows) return;
    const iterIdx = activeIterationIdx + 1;
    const nextIterationResults = [...rawIterationResults];
    const existingIdx = nextIterationResults.findIndex((ir: any) => ir.iteration_index === iterIdx);
    const rowItem = datasetInfo.rows[activeIterationIdx] || {};

    if (existingIdx >= 0) {
      nextIterationResults[existingIdx] = {
        ...nextIterationResults[existingIdx],
        assigned_to: assigneeId,
      };
    } else {
      nextIterationResults.push({
        iteration_index: iterIdx,
        row_id: rowItem.id || String(iterIdx),
        parameters: rowItem,
        status: 'pending',
        step_results: {},
        assigned_to: assigneeId,
      });
    }

    saveCurrentResult({
      iterationResults: nextIterationResults,
    });

    const m = members.find((x: any) => (x.userId || x.user?.id) === assigneeId);
    toast.success(assigneeId ? `Iteration #${iterIdx} assigned to ${m?.user?.name || 'member'}` : `Iteration #${iterIdx} set to inherit case assignee`);
  };

  const handleAssignAllIterations = async (assigneeId: number | null) => {
    if (!currentResult || !datasetInfo?.rows) return;
    const nextIterationResults = datasetInfo.rows.map((row: any, idx: number) => {
      const existing = rawIterationResults.find((ir: any) => ir.iteration_index === idx + 1);
      return {
        iteration_index: idx + 1,
        row_id: row.id || String(idx + 1),
        parameters: row,
        status: existing?.status || 'pending',
        step_results: existing?.step_results || {},
        executed_at: existing?.executed_at,
        time_spent_seconds: existing?.time_spent_seconds || 0,
        assigned_to: assigneeId,
      };
    });

    saveCurrentResult({
      iterationResults: nextIterationResults,
    });
    const m = members.find((x: any) => (x.userId || x.user?.id) === assigneeId);
    toast.success(assigneeId ? `All iterations assigned to ${m?.user?.name || 'member'}` : `All iterations set to inherit case assignee`);
  };

  const [showIterAssigneeDropdown, setShowIterAssigneeDropdown] = useState(false);
  const iterAssigneeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (iterAssigneeDropdownRef.current && !iterAssigneeDropdownRef.current.contains(e.target as Node)) {
        setShowIterAssigneeDropdown(false);
      }
    }
    if (showIterAssigneeDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showIterAssigneeDropdown]);

  const handleMarkAllIterations = async (targetStatus: ResultStatus) => {
    if (!currentResult || !currentUser || !datasetInfo?.rows) return;

    const allPassedStepResults = steps.reduce((acc: any, s) => {
      acc[s.order.toString()] = { status: targetStatus };
      return acc;
    }, {});

    const nextIterationResults = datasetInfo.rows.map((row: any, idx: number) => ({
      iteration_index: idx + 1,
      row_id: row.id || String(idx + 1),
      parameters: row,
      status: targetStatus,
      step_results: targetStatus === 'pass' ? allPassedStepResults : {},
      executed_at: new Date().toISOString(),
    }));

    const overallStatus = deriveOverallCaseStatusWithIterations(nextIterationResults).toUpperCase();

    setStepResults(targetStatus === 'pass' ? allPassedStepResults : {});
    saveCurrentResult({
      stepResults: targetStatus === 'pass' ? allPassedStepResults : {},
      iterationResults: nextIterationResults,
      status: overallStatus,
    });

    toast.success(`All ${datasetInfo.rows.length} iterations marked as ${targetStatus.toUpperCase()}`);
  };

  const toggleStepCollapse = (order: number) => {
    setCollapsedSteps((prev) => ({
      ...prev,
      [order]: !prev[order],
    }));
  };

  const handleStepNote = (order: number, note: string) => {
    const key = order.toString();
    const nextStepResults = {
      ...stepResults,
      [key]: {
        ...stepResults[key],
        note,
      },
    };
    setStepResults(nextStepResults);
    stepResultsRef.current = nextStepResults;
  };

  const handleSaveNotes = () => {
    if (!currentResult || !currentUser) return;
    saveCurrentResult({});
  };

  // First-class Case Result Handler (Pass, Fail, Blocked, Skip, Invalid)
  const handleSetCaseResult = useCallback(async (targetStatus: ResultStatus) => {
    if (!currentUser || !currentResult) return;

    if (datasetInfo && datasetInfo.rows && datasetInfo.rows.length > 1) {
      setConfirmConfig({
        open: true,
        title: `Mark All ${datasetInfo.rows.length} Iterations as ${targetStatus.toUpperCase()}?`,
        description: (
          <div className="space-y-2 text-xs">
            <p className="text-foreground">
              This test case has <span className="font-bold text-primary font-mono">{datasetInfo.rows.length} iterations</span>.
            </p>
            <p className="text-muted-foreground">
              Marking the test case at the case level will set <span className="font-bold uppercase text-foreground">{targetStatus}</span> across all {datasetInfo.rows.length} iterations and their test steps.
            </p>
          </div>
        ),
        confirmLabel: `Mark All as ${targetStatus.toUpperCase()}`,
        variant: targetStatus === 'fail' ? 'destructive' : 'default',
        onConfirm: () => {
          setConfirmConfig(null);
          handleMarkAllIterations(targetStatus);
        },
      });
      return;
    }

    const newOverride = {
      status: targetStatus,
      overrodeStatus: derivedStatus,
      timestamp: new Date().toISOString(),
      userName: currentUser.name || 'User',
    };

    const auditLog = (stepResults._auditLog as any[]) || [];
    const newAuditLog = [
      ...auditLog,
      {
        type: 'case_status',
        status: targetStatus,
        overrodeStatus: derivedStatus,
        timestamp: new Date().toISOString(),
        userName: currentUser.name || 'User',
      },
    ];

    const nextStepResults = {
      ...stepResults,
      _override: newOverride,
      _auditLog: newAuditLog,
    };

    setStepResults(nextStepResults);
    stepResultsRef.current = nextStepResults;

    setAutosaving(true);
    try {
      setStoredTimer(currentResult.id, elapsedRef.current);
      if (onResultsChange && results) {
        onResultsChange(
          results.map((r) =>
            r.id === currentResult.id
              ? { ...r, status: targetStatus, timeSpentSeconds: elapsedRef.current, executedBy: currentUser.id }
              : r
          )
        );
      }

      await updateRunResultAction(currentResult.id, {
        status: targetStatus.toUpperCase() as any,
        executedBy: currentUser.id,
        assignedTo: currentResult.assignedTo || currentUser.id,
        notes: notesRef.current,
        evidenceUrl: evidenceRef.current,
        stepResults: nextStepResults,
        failureReason: failureRef.current || undefined,
        timeSpentSeconds: elapsedRef.current,
        source: 'case-detail',
      });

      apiClient.invalidate(`/api/v1/runs/${encodeURIComponent(runId)}/results`);
      toast.success(`Marked case as ${targetStatus.toUpperCase()}`);
      props.refetchResults();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update case status');
    } finally {
      setAutosaving(false);
    }
  }, [currentUser, currentResult, derivedStatus, stepResults, props, datasetInfo, handleMarkAllIterations]);

  // Manual Override Handler (preserved for backward-compatibility)
  const handleOverride = handleSetCaseResult;

  const handleClearOverride = useCallback(async () => {
    if (!currentUser || !currentResult) return;

    const nextStepResults = { ...stepResults };
    delete nextStepResults._override;

    const auditLog = (nextStepResults._auditLog as any[]) || [];
    nextStepResults._auditLog = [
      ...auditLog,
      {
        type: 'clear_override',
        status: derivedStatus,
        timestamp: new Date().toISOString(),
        userName: currentUser.name || 'User',
      },
    ];

    setStepResults(nextStepResults);
    stepResultsRef.current = nextStepResults;

    setAutosaving(true);
    try {
      await updateRunResultAction(currentResult.id, {
        status: derivedStatus.toUpperCase() as any,
        executedBy: currentUser.id,
        notes: notesRef.current,
        evidenceUrl: evidenceRef.current,
        stepResults: nextStepResults,
        failureReason: failureRef.current || undefined,
        timeSpentSeconds: elapsedRef.current,
        source: 'case-detail',
      });

      toast.success('Manual override cleared');
      props.refetchResults();
    } catch (err: any) {
      toast.error(err.message || 'Failed to clear override');
    } finally {
      setAutosaving(false);
    }
  }, [currentUser, currentResult, derivedStatus, stepResults, props]);

  const executeRerun = async (mode: 'all' | 'failed_only' = 'all') => {
    if (!currentResult) return;
    try {
      const result = await resetSingleResultAction(currentResult.id, mode);
      toast.success(mode === 'failed_only' ? 'Created new attempt (retrying failed iterations only)' : 'Created new attempt (re-running all iterations)');
      await props.refetchResults();
      if (result.newResultId) {
        navigateToCaseById(result.newResultId);
      }
      // Explicit user-initiated execution: only now is the timer allowed to run/persist.
      setSessionStarted(true);

      // ── Trigger external execution ──
      const automatedFlow =
        run?.source === 'postman' ||
        run?.source === 'datadog' ||
        ((run?.source === 'mixed' || run?.source === 'automated') &&
          Boolean(currentCase && isAutomatedCase(currentCase)));
      if (automatedFlow) {
        setIsExecutingExternalLocal(true);
        // Queue only this fresh attempt; the deck/page polling updates the UI
        void startExternalRunCasesAction(run.id, [result.newResultId]).catch(() => {});
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to re-run test case');
    }
  };

  const hasDatadogLink = Boolean(
    ((currentCase?.customFields || currentCase?.custom_fields)?._datadog?.publicIds || []).length
  );

  const linkedProvider = currentCase ? getCaseAutomationSource(currentCase) : 'manual';
  const hasLinkedRunner = linkedProvider === 'postman' || linkedProvider === 'datadog';

  // Opening a manual, undecided case starts the session: the timer runs and the
  // case is marked as started once. Automated cases stay provider-owned.
  const autoStartedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const result = currentResult;
    if (!result?.id || !currentCase) return;
    if (linkedProvider !== 'manual' || isDecided) return;
    if (String(run?.status || '').toLowerCase() === 'aborted') return;
    if (String(result.status || '').toLowerCase() !== 'pending') return;
    const state = String(result.caseState || result.executionState || '').toUpperCase();
    if (['RUNNING', 'QUEUED', 'WAITING'].includes(state)) return;
    if (autoStartedRef.current.has(result.id)) return;

    autoStartedRef.current.add(result.id);
    setSessionStarted(true);

    // Persist the start marker (drives the "In Progress" pill in the deck).
    void startManualResultAction(result.id).catch(() => {});
  }, [currentCase, currentResult?.id, currentResult?.status, isDecided, linkedProvider]);

  const linkedCaseFields = currentCase ? getCaseCustomFields(currentCase) : {};
  const postmanCaseCfg = linkedCaseFields._postman || {};
  const datadogCaseCfg = linkedCaseFields._datadog || {};
  const linkedRunAny = run as any;
  const linkedRunConfig =
    linkedRunAny?.runContext?.config || linkedRunAny?.run_context?.config || {};
  const linkedRunPostmanCfg = linkedRunConfig.postman || {};
  const linkedRunDatadogCfg = linkedRunConfig.datadog || {};

  const handleRunLinkedCase = async (useOverrides = false) => {
    if (
      !pj?.id ||
      !currentCase?.id ||
      !currentResult?.id ||
      !run?.id ||
      !hasLinkedRunner ||
      runningLinkedCase
    )
      return;
    const provider = linkedProvider as 'postman' | 'datadog';
    const cf = getCaseCustomFields(currentCase);
    const postmanCfg = cf._postman || {};
    const datadogCfg = cf._datadog || {};
    const runCfg = linkedRunConfig;
    const runPostmanCfg = linkedRunPostmanCfg;
    const runDatadogCfg = linkedRunDatadogCfg;
    const customVariables = {
      ...((run?.resolved_variables as Record<string, string>) || {}),
      ...(runCfg.customVariables || {}),
      ...(useOverrides ? parseLinkedRunnerOverrides(overrideVarsText) : {}),
    };
    const datasetParams = activeIterationRow
      ? Object.fromEntries(
          Object.entries(activeIterationRow).map(([key, value]) => [key, String(value ?? '')])
        )
      : undefined;

    setRunningLinkedCase(true);
    try {
      const execRes = await executeRunCaseAction({
        runId: run.id,
        resultId: currentResult.id,
        overrides: {
          provider,
          datasetParams,
          customVariables,
          postman:
          provider === 'postman'
            ? {
                collectionUid: postmanCfg.collectionUid,
                folderOrRequestFilter:
                  Array.isArray(postmanCfg.selectedRequestOrders) &&
                  postmanCfg.selectedRequestOrders.length > 0
                    ? undefined
                    : postmanCfg.folderOrRequestFilter,
                selectedRequestOrders: postmanCfg.selectedRequestOrders,
                postmanEnvUidOverride: runPostmanCfg.postmanEnvUidOverride,
                iterations:
                  (useOverrides ? optionalNumber(postmanOverrideIterations) : undefined) ??
                  runPostmanCfg.iterations ??
                  postmanCfg.iterations,
                delayMs:
                  (useOverrides ? optionalNumber(postmanOverrideDelay) : undefined) ??
                  runPostmanCfg.delayMs ??
                  postmanCfg.delayMs,
                timeoutMs:
                  (useOverrides ? optionalNumber(postmanOverrideTimeout) : undefined) ??
                  runPostmanCfg.timeoutMs ??
                  postmanCfg.timeoutMs,
                bailOnFailure: runPostmanCfg.bailOnFailure ?? postmanCfg.bailOnFailure,
                persistResponses: runPostmanCfg.persistResponses ?? postmanCfg.persistResponses,
                turnOffLogs: runPostmanCfg.turnOffLogs ?? postmanCfg.turnOffLogs,
                keepVariableValues: runPostmanCfg.keepVariableValues ?? postmanCfg.keepVariableValues,
                ignoreCookies: runPostmanCfg.ignoreCookies ?? postmanCfg.ignoreCookies,
                saveCookies: runPostmanCfg.saveCookies ?? postmanCfg.saveCookies,
              }
            : undefined,
        datadog:
          provider === 'datadog'
            ? {
                publicIds: datadogCfg.publicIds || [],
                startUrlOverride:
                  (useOverrides ? datadogOverrideStartUrl.trim() : '') ||
                  runDatadogCfg.startUrlOverride ||
                  datadogCfg.startUrlOverride,
                executionRule:
                  ((useOverrides
                    ? (datadogOverrideExecutionRule as
                        | 'blocking'
                        | 'non_blocking'
                        | 'skipped'
                        | '')
                    : '') ||
                    runDatadogCfg.executionRule ||
                    datadogCfg.executionRule),
                delayMs:
                  (useOverrides ? optionalNumber(datadogOverrideDelay) : undefined) ??
                  runDatadogCfg.delayMs ??
                  datadogCfg.delayMs,
                retryCount:
                  (useOverrides ? optionalNumber(datadogOverrideRetry) : undefined) ??
                  runDatadogCfg.retryCount ??
                  datadogCfg.retryCount,
              }
            : undefined,
        },
      });

      if (execRes.createdAttempt) {
        await props.refetchResults();
        navigateToCaseById(execRes.resultId);
      }

      if (currentResult?.id) {
        setStepResults((prev) => ({
          ...prev,
          ...execRes.stepResults,
        }));
        onResultsChange(
          results.map((r: any) =>
            r.id === currentResult.id
              ? {
                  ...r,
                  status: String(execRes.overallStatus).toLowerCase(),
                  notes: execRes.summary,
                  step_results: {
                    ...(typeof r.step_results === 'object' ? r.step_results : {}),
                    ...execRes.stepResults,
                  },
                  automation_log: execRes.automationLog,
                }
              : r
          )
        );
      }

      const status = String(execRes.overallStatus).toUpperCase();
      if (status === 'PENDING') {
        toast.info('Datadog execution started — results will appear when the monitor completes');
      } else if (status === 'PASS') {
        toast.success(`${provider === 'postman' ? 'Postman' : 'Datadog'} run passed`);
      } else {
        toast.error(`${provider === 'postman' ? 'Postman' : 'Datadog'} run did not pass`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to run linked automation');
    } finally {
      setRunningLinkedCase(false);
    }
  };

  const handleResyncDatadog = async () => {
    if (!pj?.id || !currentCase?.id) {
      toast.error('Project or test case unavailable');
      return;
    }
    setResyncingDatadog(true);
    try {
      await syncTestCaseFromDatadogAction({ projectId: pj.id, testCaseId: currentCase.id });
      toast.success('Steps re-synced from Datadog');
      window.location.reload();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to re-sync from Datadog');
    } finally {
      setResyncingDatadog(false);
    }
  };

  const handleRerunCase = async () => {
    if (!currentResult) return;

    const hasFailedIterations = rawIterationResults.some((ir: any) => ir.status?.toLowerCase() === 'fail' || ir.status?.toLowerCase() === 'blocked');
    const hasPassedIterations = rawIterationResults.some((ir: any) => ir.status?.toLowerCase() === 'pass');

    if (datasetInfo && datasetInfo.rows && datasetInfo.rows.length > 1 && hasFailedIterations && hasPassedIterations) {
      setConfirmConfig({
        open: true,
        title: 'Choose Retry Strategy',
        description: (
          <div className="space-y-3 text-xs">
            <p className="text-foreground">
              This parameterized test case has both passed and failed iterations. How would you like to re-run it?
            </p>
            <div className="grid grid-cols-1 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setConfirmConfig(null);
                  executeRerun('failed_only');
                }}
                className="p-3 text-left rounded-xl border border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors cursor-pointer group"
              >
                <div className="font-semibold text-foreground flex items-center justify-between">
                  <span>Retry Failed Iterations Only</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-mono font-bold">Recommended</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Carries over already passed iterations. Only resets failed/blocked iterations to pending.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmConfig(null);
                  executeRerun('all');
                }}
                className="p-3 text-left rounded-xl border border-border/60 bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer"
              >
                <div className="font-semibold text-foreground">Re-run All Iterations</div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Clears all iteration results and starts a completely fresh execution for all {datasetInfo.rows.length} rows.
                </p>
              </button>
            </div>
          </div>
        ),
        confirmLabel: 'Cancel',
        variant: 'default',
        onConfirm: () => {},
      });
      return;
    }

    await executeRerun('all');
  };

  const handleRemoveFromRun = async () => {
    if (!currentResult) return;
    setConfirmConfig({
      open: true,
      title: 'Remove Test Case from Run',
      description: `Are you sure you want to remove "${currentCase?.title || 'this test case'}" from this run? Historical execution data for this case in this run will be deleted.`,
      confirmLabel: 'Remove from Run',
      variant: 'destructive',
      onConfirm: async () => {
        try {
          await deleteRunResultAction(currentResult.id);
          toast.success('Test case removed from run');
          await props.refetchResults();
          const remaining = results.filter((r) => r.id !== currentResult.id);
          if (remaining.length > 0) {
            navigateToCase(getCaseKeyForResult(remaining[0]));
          } else {
            router.push(`/p/${slug}/runs/${runId}`);
          }
        } catch (err: any) {
          toast.error(err.message || 'Failed to remove test case from run');
        }
      },
    });
  };

  // Step attachment helpers
  const handleStepFileAttach = async (order: number, file: File) => {
    if (!currentResult || !pj?.id) return;
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entityId', currentResult.id);
      formData.append('entityType', 'run_result');
      formData.append('projectId', pj.id);

      const res = await uploadFileAction(formData);
      if (res?.attachmentId) {
        const att = { id: res.attachmentId, filename: file.name, key: res.key || '' };
        const key = order.toString();
        const existing = stepResults[key] || {};
        const existingAtts = existing.attachments || [];
        const next = { ...stepResults, [key]: { ...existing, attachments: [...existingAtts, att] } };
        setStepResults(next);
        stepResultsRef.current = next;
        saveCurrentResult({ stepResults: next });
        toast.success(`Attached ${file.name}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to attach file');
    }
  };

  const handleStepFileDelete = (order: number, attachmentId: string) => {
    const key = order.toString();
    const existing = stepResults[key] || {};
    const existingAtts = existing.attachments || [];
    const next = { ...stepResults, [key]: { ...existing, attachments: existingAtts.filter((a: any) => a.id !== attachmentId) } };
    setStepResults(next);
    stepResultsRef.current = next;
    saveCurrentResult({ stepResults: next });
  };

  const handleStepPaste = async (e: React.ClipboardEvent, order: number) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          toast.info('Uploading screenshot from clipboard...');
          await handleStepFileAttach(order, file);
          break;
        }
      }
    }
  };

  const lastFetchedResultIdRef = useRef<string | null>(null);

  // Load background data: custom run steps override, history & attachments on result change
  useEffect(() => {
    const targetResultId = currentResult?.id;
    if (!targetResultId) return;

    // Prevent duplicate firing for the exact same result
    if (lastFetchedResultIdRef.current === targetResultId) return;
    lastFetchedResultIdRef.current = targetResultId;

    let cancelled = false;
    setHistoryLoading(true);

    apiClient
      .get<{ steps: StepItem[]; history: any[]; attachments: any[] }>(
        `/api/v1/runs/${encodeURIComponent(runId)}/results/${encodeURIComponent(targetResultId)}/details`
      )
      .then((data) => {
        if (cancelled || !data) return;
        if (data.steps && data.steps.length > 0) {
          setSteps(data.steps as StepItem[]);
        }
        if (data.history) {
          setRunHistory(data.history || []);
        }
        if (data.attachments) {
          setAttachments(data.attachments || []);
        }
      })
      .catch((err) => {
        logger.error('Failed to load run result details', {
          component: 'ExecutionConsole',
          action: 'loadResultDetails',
          runId,
          resultId: targetResultId,
          error: err,
        });
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentResult?.id, runId]);

  const handleStepDefect = (order: number, stepText: string, expectedResult?: string, stepAttachments?: any[]) => {
    const formattedAttachments = (stepAttachments || []).map((att: any) => ({
      id: att.id,
      filename: att.filename,
      url: `/api/v1/attachments/${att.id}/download`,
      source: `Step ${order} Evidence`,
    }));

    setDefectStepContext({
      order,
      instruction: stepText,
      expectedResult: expectedResult || '',
      attachments: formattedAttachments,
    });
    setShowDefectModal(true);
  };

  const handleCaseDefect = () => {
    const firstFailedStep = steps.find(
      (s) => stepResults[s.order.toString()]?.status?.toLowerCase() === 'fail'
    );
    const failedStepSr = firstFailedStep
      ? stepResults[firstFailedStep.order.toString()]
      : undefined;

    const stepAtts = (failedStepSr?.attachments || []).map((att: any) => ({
      id: att.id,
      filename: att.filename,
      url: `/api/v1/attachments/${att.id}/download`,
      source: `Step ${firstFailedStep!.order} Evidence`,
    }));

    const caseAtts = (attachments || []).map((att: any) => ({
      id: att.id,
      filename: att.filename,
      url: `/api/v1/attachments/${att.id}/download`,
      source: 'Case Evidence',
    }));

    const seenIds = new Set<string>();
    const mergedAttachments = [...stepAtts, ...caseAtts].filter((a) => {
      if (!a.id || seenIds.has(a.id)) return false;
      seenIds.add(a.id);
      return true;
    });

    setDefectStepContext({
      order: firstFailedStep?.order,
      instruction: firstFailedStep ? (firstFailedStep.step || (firstFailedStep as any).description) : undefined,
      expectedResult: firstFailedStep ? (firstFailedStep.expected_result || (firstFailedStep as any).expectedResult || '') : undefined,
      attachments: mergedAttachments,
    });
    setShowDefectModal(true);
  };

  // Listen for Clipboard Paste (Cmd+V / Ctrl+V for screenshots on case level)
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // Don't intercept if user is typing text into an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (!currentResult || !pj?.id) return;

      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1 || item.type.indexOf('video') !== -1) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            try {
              const formData = new FormData();
              formData.append('file', file);
              formData.append('entityId', currentResult.id);
              formData.append('entityType', 'run_result');
              formData.append('projectId', pj.id);

              await uploadFileAction(formData);
              toast.success('Screenshot attached to test case');
              fetchAttachments(currentResult.id);
            } catch (err: any) {
              toast.error(err.message || 'Failed to attach screenshot');
            }
            break;
          }
        }
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [currentResult?.id, pj?.id, fetchAttachments]);

  // Navigation helpers using independent URLs
  const getCaseKeyForResult = useCallback((res: any) => {
    const c = getCase(res?.testCaseId);
    return c?.displayId || c?.id || res?.id;
  }, [getCase]);

  const navigateToCase = useCallback((targetKey: string) => {
    setSelectedCaseKey(targetKey);
    if (typeof window !== 'undefined') {
      const targetUrl = `/p/${slug}/runs/${runId}/${targetKey}`;
      window.history.pushState({ targetKey }, '', targetUrl);
    }
  }, [slug, runId]);

  // Synchronize with browser Back/Forward navigation
  useEffect(() => {
    const handlePopState = () => {
      if (typeof window !== 'undefined') {
        const segments = window.location.pathname.split('/');
        const lastSeg = segments[segments.length - 1];
        if (lastSeg && lastSeg !== runId) {
          setSelectedCaseKey(lastSeg);
        }
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [runId]);

  const navigateToCaseById = useCallback((resId: string) => {
    const targetResult = results.find((r) => r.id === resId);
    if (targetResult) {
      navigateToCase(getCaseKeyForResult(targetResult));
    } else {
      navigateToCase(resId);
    }
  }, [results, getCaseKeyForResult, navigateToCase]);

  /**
   * Apply a sidebar filter, persist it for this run, and never leave the tester
   * looking at a case their new filter hides.
   */
  const applyRailFilters = (patch: {
    caseType?: RunCaseTypeFilter;
    assignedToMe?: boolean;
    priority?: string;
    groupBy?: RunGroupBy;
  }) => {
    const nextCaseType = patch.caseType ?? railCaseType;
    const nextAssignedToMe = patch.assignedToMe ?? railAssignedToMe;
    const nextPriority = patch.priority ?? railPriority;
    const nextGroupBy = patch.groupBy ?? sidebarGroupBy;

    setRailCaseType(nextCaseType);
    setRailAssignedToMe(nextAssignedToMe);
    setRailPriority(nextPriority);
    setSidebarGroupBy(nextGroupBy);
    patchRunViewFilters(
      runId,
      {
        caseType: nextCaseType,
        assignedToMe: nextAssignedToMe,
        priority: nextPriority,
        groupBy: nextGroupBy,
      },
      'flat'
    );

    // Changing the grouping alone never hides a case, so skip the nav check.
    if (
      patch.groupBy !== undefined &&
      patch.caseType === undefined &&
      patch.assignedToMe === undefined &&
      patch.priority === undefined
    ) {
      return;
    }

    const nextList = uniqueResults.filter((r) =>
      matchesRailCaseFilters(r, getCase, {
        caseType: nextCaseType,
        assignedToMe: nextAssignedToMe,
        priority: nextPriority,
        userId: currentUser?.id,
      })
    );
    if (
      currentResult &&
      nextList.length > 0 &&
      !nextList.some((r) => r.id === currentResult.id)
    ) {
      navigateToCase(getCaseKeyForResult(nextList[0]));
    }
  };

  const handleClose = useCallback(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('run_deck_scroll_y', String(window.scrollY));
    }
    if (onClose) {
      onClose();
    } else {
      router.push(`/p/${slug}/runs/${runId}`, { scroll: false });
    }
  }, [onClose, router, slug, runId]);

  // Keyboard shortcut listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (showDefectModal || viewingDefect || showShortcuts || previewAttachment || (confirmConfig && confirmConfig.open)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [handleClose, showDefectModal, viewingDefect, showShortcuts, previewAttachment, confirmConfig]);

  if (!currentResult || !currentCase) {
    // Once the results are loaded, a missing result/case is a genuine
    // "not found" — report it instead of spinning forever.
    if (resultsLoaded) {
      return (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground space-y-3 bg-background">
          <AlertTriangle className="h-6 w-6 text-amber-500" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {currentResult
                ? 'Test case is no longer available'
                : 'No execution result found for this case'}
            </p>
            <p className="text-xs max-w-sm">
              {currentResult
                ? 'This test case is not part of the current project data. It may have been archived or removed.'
                : 'This run has no result for the requested test case. It may not have been executed.'}
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center text-muted-foreground space-y-3 bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm font-medium">Loading test case details...</p>
      </div>
    );
  }

  const resultIndex = filteredRailResults.findIndex((r) => r.id === currentResult.id);
  const total = filteredRailResults.length;
  const executedCount = filteredRailResults.filter((r) => r.status && r.status !== 'pending').length;
  const isCaseMarked = effectiveStatus !== 'pending';

  const areAllStepsCollapsed = useMemo(() => {
    if (steps.length === 0) return false;
    return steps.every((step) => {
      const sr = stepResults[step.order.toString()];
      const isStepMarked = Boolean(sr?.status && sr.status !== 'pending');
      const collapsed = stepLayout === 'stacked'
        ? (collapsedSteps[step.order] !== undefined ? collapsedSteps[step.order] : (isStepMarked || isCaseMarked))
        : Boolean(collapsedSteps[step.order]);
      return collapsed;
    });
  }, [steps, stepResults, stepLayout, collapsedSteps, isCaseMarked, stepLayout]);

  const toggleAllStepsCollapse = () => {
    const nextState = !areAllStepsCollapsed;
    const next: Record<number, boolean> = {};
    steps.forEach((s) => {
      next[s.order] = nextState;
    });
    setCollapsedSteps(next);
  };

  const suiteForCase = suites.find((s: any) =>
    s.suite_cases?.some((sc: any) => sc.test_case_id === currentCase.id || sc.test_case?.id === currentCase.id)
  );
  const moduleName = modules.find((m: any) => m.id === currentCase.moduleId)?.name;

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const executionKey = `${run.id}:${currentCase.displayId || currentCase.id}${
    currentResult.attemptNumber && currentResult.attemptNumber > 1 ? `.${currentResult.attemptNumber}` : ''
  }`;

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden font-sans relative">
      {/* ── Top Header Bar (Divided cleanly: Sidebar rail header + Main Window header) ── */}
      <header className="h-12 border-b border-white/10 bg-card/70 flex items-center shrink-0 z-30">
        {/* Left Column: Matches Sidebar Width when open */}
        {leftRailOpen ? (
          <div className="w-60 xl:w-64 border-r border-white/10 shrink-0 h-12 flex items-center justify-between px-3">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
              Cases
            </span>
            <Tooltip content="Collapse cases sidebar" side="bottom" align="end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLeftRailOpen(false)}
                aria-label="Collapse cases sidebar"
                title="Collapse cases sidebar"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg hover:bg-white/10 transition-colors"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
        ) : (
          <div className="pl-3 pr-2 shrink-0 flex items-center">
            <Tooltip content="Expand cases sidebar" side="bottom" align="start">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLeftRailOpen(true)}
                aria-label="Expand cases sidebar"
                title="Expand cases sidebar"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg hover:bg-white/10 transition-colors"
              >
                <PanelLeftOpen className="h-4 w-4 text-primary" />
              </Button>
            </Tooltip>
            <div className="h-4 w-px bg-white/10 ml-2.5 shrink-0" />
          </div>
        )}

        {/* Right Section: Directly above Main Execution Window */}
        <div className="flex-1 min-w-0 h-12 flex items-center justify-between px-4 gap-3 relative">
          {/* Vertical accent bar at the edge before key, strictly within header (h-12) */}
          <div
            className={cn(
              "absolute left-0 top-0 bottom-0 w-1 z-40 transition-colors duration-200 pointer-events-none",
              accentBarColor
            )}
            aria-hidden="true"
          />

          {/* Test Case Key & Title strictly above main window */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Link
              href={`/p/${slug}/repository/${currentCase.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-primary font-semibold hover:underline bg-primary/10 px-2 py-0.5 rounded border border-primary/25 text-xs inline-block shrink-0"
              title="Open test case specification in repository (new tab)"
            >
              {currentCase.displayId}
            </Link>
            <h1 className="font-bold text-sm text-foreground truncate max-w-xs sm:max-w-md lg:max-w-xl" title={currentCase.title}>
              {currentCase.title}
            </h1>
            {currentCase.priority && (
              <PriorityBadge priority={currentCase.priority} className="text-xs px-2 py-0.5 shrink-0" />
            )}
            {currentCase.aiGenerated && <AiBadge className="shrink-0" />}
            <CaseSourceIcon testCase={currentCase} className="shrink-0" />
          </div>

        {/* Right: Navigation Controls & Close Button */}
        <div className="flex items-center gap-2 shrink-0">
          {run?.status !== 'aborted' && hasLinkedRunner && (
            <div className="flex items-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRunLinkedCase(false)}
                disabled={runningLinkedCase || isAwaitingExternal}
                className="h-7 px-2.5 text-xs font-semibold gap-1.5 cursor-pointer border-primary/30 text-primary hover:bg-primary/10 rounded-r-none"
                title={
                  runningLinkedCase
                    ? 'Wait for the current execution to finish before running'
                    : isAwaitingExternal
                    ? 'Wait for results from the provider'
                    : 'Queue a new attempt through the run queue'
                }
              >
                {runningLinkedCase ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : currentResult?.status === 'pending' && !isAwaitingExternal ? (
                  <Play className="h-3.5 w-3.5" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                <span>{currentResult?.status === 'pending' && !isAwaitingExternal ? 'Run' : 'Re-run'}</span>
              </Button>
              <Popover open={runnerOverridesOpen} onOpenChange={setRunnerOverridesOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={runningLinkedCase || isAwaitingExternal}
                    className="h-7 w-6 p-0 cursor-pointer border-primary/30 text-primary hover:bg-primary/10 rounded-l-none border-l-0"
                    aria-label={`${currentResult?.status === 'pending' && !isAwaitingExternal ? 'Run' : 'Re-run'} with different ${linkedProvider} settings`}
                    title="${currentResult?.status === 'pending' && !isAwaitingExternal ? 'Run' : 'Re-run'} with different settings…"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[340px] p-3 space-y-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold">
                      {linkedProvider === 'postman' ? (
                        <PostmanLogo className="h-3.5 w-3.5" />
                      ) : (
                        <DatadogLogo className="h-3.5 w-3.5" />
                      )}
                      <span>{currentResult?.status === 'pending' && !isAwaitingExternal ? 'Run' : 'Re-run'} with different settings…</span>
                    </div>
                    <p className="text-[10.5px] leading-snug text-muted-foreground">
                      {linkedProvider === 'postman' ? 'Postman' : 'Datadog'} overrides for this
                      attempt only. Uses run environment{' '}
                      <span className="font-semibold text-foreground">{run?.environment}</span>.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Variable overrides
                    </label>
                    {overrideRows.length === 0 && (
                      <p className="text-[10.5px] text-muted-foreground">
                        No overrides. Pick a variable to change it for this attempt only.
                      </p>
                    )}
                    {overrideRows.map((row, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <select
                          value={row.key}
                          onChange={(e) => {
                            const next = [...overrideRows];
                            next[idx] = { ...next[idx], key: e.target.value };
                            applyOverrideRows(next);
                          }}
                          className="h-7 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-1 text-[11px] text-foreground"
                        >
                          <option value="">Select variable…</option>
                          {allVariablesList.map((v) => (
                            <option key={v.key} value={v.key}>
                              {v.key}
                            </option>
                          ))}
                        </select>
                        <Input
                          value={row.value}
                          onChange={(e) => {
                            const next = [...overrideRows];
                            next[idx] = { ...next[idx], value: e.target.value };
                            applyOverrideRows(next);
                          }}
                          placeholder="value"
                          className="h-7 w-28 text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() => applyOverrideRows(overrideRows.filter((_, i) => i !== idx))}
                          className="h-7 w-6 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                          title="Remove override"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => applyOverrideRows([...overrideRows, { key: '', value: '' }])}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer"
                    >
                      <Plus className="h-3 w-3" /> Add variable
                    </button>
                  </div>

                  {linkedProvider === 'postman' ? (
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <label className="text-[10.5px] font-medium text-muted-foreground">Iterations</label>
                        <Input
                          type="number"
                          min={1}
                          value={postmanOverrideIterations}
                          onChange={(e) => setPostmanOverrideIterations(e.target.value)}
                          placeholder={String(
                            linkedRunPostmanCfg.iterations ?? postmanCaseCfg.iterations ?? 1
                          )}
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10.5px] font-medium text-muted-foreground">
                          Delay between requests (ms)
                        </label>
                        <Input
                          type="number"
                          min={0}
                          value={postmanOverrideDelay}
                          onChange={(e) => setPostmanOverrideDelay(e.target.value)}
                          placeholder={String(
                            linkedRunPostmanCfg.delayMs ?? postmanCaseCfg.delayMs ?? 0
                          )}
                          className="h-7 text-xs"
                        />
                        {(() => {
                          const effective =
                            linkedRunPostmanCfg.delayMs ?? postmanCaseCfg.delayMs ?? 0;
                          const source =
                            linkedRunPostmanCfg.delayMs !== undefined
                              ? 'run settings'
                              : postmanCaseCfg.delayMs !== undefined
                              ? 'case settings'
                              : 'default';
                          return (
                            <p className="text-[9.5px] leading-snug text-muted-foreground">
                              Effective: {(effective / 1000).toFixed(effective % 1000 === 0 ? 0 : 1)}s,
                              from {source}. Applies between requests 2, 3, 4 — never before the first.
                            </p>
                          );
                        })()}
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10.5px] font-medium text-muted-foreground">Timeout ms</label>
                        <Input
                          type="number"
                          min={0}
                          value={postmanOverrideTimeout}
                          onChange={(e) => setPostmanOverrideTimeout(e.target.value)}
                          placeholder={String(
                            linkedRunPostmanCfg.timeoutMs ?? postmanCaseCfg.timeoutMs ?? 15000
                          )}
                          className="h-7 text-xs"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <label className="text-[10.5px] font-medium text-muted-foreground">
                          Start URL override
                        </label>
                        <Input
                          value={datadogOverrideStartUrl}
                          onChange={(e) => setDatadogOverrideStartUrl(e.target.value)}
                          placeholder={
                            linkedRunDatadogCfg.startUrlOverride ||
                            datadogCaseCfg.startUrlOverride ||
                            'Use environment start URL'
                          }
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10.5px] font-medium text-muted-foreground">
                          Execution rule
                        </label>
                        <Select
                          value={datadogOverrideExecutionRule}
                          onValueChange={setDatadogOverrideExecutionRule}
                          options={[
                            { value: '', label: 'Use case default' },
                            { value: 'blocking', label: 'Run & Wait for Results' },
                            { value: 'non_blocking', label: 'Run & Continue' },
                            { value: 'skipped', label: 'Skip this case' },
                          ]}
                          className="h-7 text-xs"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10.5px] font-medium text-muted-foreground">
                            Initial wait (ms)
                          </label>
                          <Input
                            type="number"
                            min={0}
                            value={datadogOverrideDelay}
                            onChange={(e) => setDatadogOverrideDelay(e.target.value)}
                            placeholder={String(
                              linkedRunDatadogCfg.delayMs ?? datadogCaseCfg.delayMs ?? 0
                            )}
                            className="h-7 text-xs"
                          />
                          {(() => {
                            const effective =
                              linkedRunDatadogCfg.delayMs ?? datadogCaseCfg.delayMs ?? 0;
                            return (
                              <p className="text-[9.5px] leading-snug text-muted-foreground">
                                Waits before the Datadog test starts. Effective: {(effective / 1000).toFixed(effective % 1000 === 0 ? 0 : 1)}s.
                              </p>
                            );
                          })()}
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10.5px] font-medium text-muted-foreground">Retries</label>
                          <Input
                            type="number"
                            min={0}
                            value={datadogOverrideRetry}
                            onChange={(e) => setDatadogOverrideRetry(e.target.value)}
                            placeholder={String(
                              linkedRunDatadogCfg.retryCount ?? datadogCaseCfg.retryCount ?? 0
                            )}
                            className="h-7 text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setRunnerOverridesOpen(false)}
                      className="h-7 px-2.5 text-xs cursor-pointer"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setRunnerOverridesOpen(false);
                        void handleRunLinkedCase(true);
                      }}
                      disabled={runningLinkedCase}
                      className="h-7 px-2.5 text-xs font-semibold gap-1.5 cursor-pointer"
                    >
                      {runningLinkedCase ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      Run {linkedProvider === 'postman' ? 'Postman' : 'Datadog'}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          )}
          <span className="text-xs text-muted-foreground font-mono px-1">
            {resultIndex + 1} <span className="opacity-40">/</span> {total}
          </span>

          <Tooltip content="Previous test case (←)" side="bottom" align="center">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0 border-white/10 cursor-pointer"
              disabled={resultIndex <= 0}
              onClick={() => {
                const prevKey = getCaseKeyForResult(filteredRailResults[resultIndex - 1]);
                navigateToCase(prevKey);
              }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>

          <Tooltip content="Next test case (→)" side="bottom" align="center">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0 border-white/10 cursor-pointer"
              disabled={resultIndex >= total - 1}
              onClick={() => {
                const nextKey = getCaseKeyForResult(filteredRailResults[resultIndex + 1]);
                navigateToCase(nextKey);
              }}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>

          <div className="h-4 w-px bg-white/10 mx-1" />

          <div className="h-4 w-px bg-white/10 mx-1" />

            {/* Close Button Aligned to the Right */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground font-medium flex items-center gap-1.5 cursor-pointer"
            >
              <X className="h-4 w-4" />
              <span>Close</span>
              <kbd className="hidden sm:inline-block text-[10px] font-mono px-1 py-0.2 rounded bg-white/5 border border-white/10 text-muted-foreground">Esc</kbd>
            </Button>
          </div>
        </div>
      </header>

      {/* ── Main 2-Zone Workspace ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* Left Rail — overlay below xl, inline panel at xl+ */}
        {leftRailOpen && (
          <div
            className="absolute inset-0 z-30 bg-background/70 backdrop-blur-[2px] xl:hidden"
            onClick={() => setLeftRailOpen(false)}
            aria-hidden="true"
          />
        )}
        {leftRailOpen && (
          <aside className="absolute inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-white/10 bg-card/40 shadow-2xl xl:static xl:w-64 xl:shadow-none">
            <div className="p-3 border-b border-white/10 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[11px]">
                  Cases ({executedCount}/{total})
                </span>
              </div>

              {/* Multi-color status bar at top of sidebar */}
              <div
                className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden flex"
                title={`Pass: ${statusCounts.pass}, Fail: ${statusCounts.fail}, Blocked: ${statusCounts.blocked}, Pending: ${statusCounts.pending}`}
              >
                {statusCounts.pass > 0 && (
                  <div
                    className="h-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${(statusCounts.pass / (uniqueResults.length || total || 1)) * 100}%` }}
                  />
                )}
                {statusCounts.fail > 0 && (
                  <div
                    className="h-full bg-red-500 transition-all duration-300"
                    style={{ width: `${(statusCounts.fail / (uniqueResults.length || total || 1)) * 100}%` }}
                  />
                )}
                {statusCounts.blocked > 0 && (
                  <div
                    className="h-full bg-amber-500 transition-all duration-300"
                    style={{ width: `${(statusCounts.blocked / (uniqueResults.length || total || 1)) * 100}%` }}
                  />
                )}
                {statusCounts.invalid > 0 && (
                  <div
                    className="h-full bg-violet-500 transition-all duration-300"
                    style={{ width: `${(statusCounts.invalid / (uniqueResults.length || total || 1)) * 100}%` }}
                  />
                )}
                {statusCounts.skip > 0 && (
                  <div
                    className="h-full bg-zinc-400 transition-all duration-300"
                    style={{ width: `${(statusCounts.skip / (uniqueResults.length || total || 1)) * 100}%` }}
                  />
                )}
              </div>

              <div className="relative pt-0.5 space-y-1.5">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Filter cases..."
                    value={railSearch}
                    onChange={(e) => setRailSearch(e.target.value)}
                    className="pl-8 h-7 text-xs bg-background/60 border-white/10"
                  />
                </div>

                {/* Manual / Automated isolation for the execution queue */}
                <div className="flex items-center gap-0.5 bg-white/5 p-0.5 rounded-md border border-white/10 text-[10px] font-mono">
                  {([
                    { key: 'all', label: 'All' },
                    { key: 'manual', label: 'Manual' },
                    { key: 'automated', label: 'Auto' },
                  ] as const).map((mode) => {
                    const isActive = railCaseType === mode.key;
                    return (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() => applyRailFilters({ caseType: mode.key })}
                        className={cn(
                          'flex-1 px-1.5 py-0.5 rounded cursor-pointer transition-colors inline-flex items-center justify-center gap-1',
                          isActive
                            ? 'bg-white/15 text-foreground font-bold'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                        title={
                          mode.key === 'manual'
                            ? 'Only manual test cases'
                            : mode.key === 'automated'
                            ? 'Only automated test cases'
                            : 'All test cases'
                        }
                      >
                        {mode.label}
                        <span className={cn('text-[9px]', isActive ? 'text-primary' : 'opacity-60')}>
                          {railCaseTypeCounts[mode.key]}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => applyRailFilters({ assignedToMe: !railAssignedToMe })}
                    className={cn(
                      'h-7 flex-1 px-2 rounded-md border text-[10px] font-mono flex items-center justify-center gap-1 transition-colors cursor-pointer',
                      railAssignedToMe
                        ? 'bg-primary/20 border-primary/50 text-primary font-bold'
                        : 'bg-white/5 border-white/10 text-muted-foreground hover:text-foreground'
                    )}
                    title="Only cases assigned to me"
                  >
                    <User className="h-3 w-3" />
                    <span>Mine</span>
                    <span className={cn('text-[9px]', railAssignedToMe ? 'text-primary' : 'opacity-60')}>
                      {railAssignedToMeCount}
                    </span>
                  </button>
                  <Select
                    value={railPriority}
                    onValueChange={(v) => applyRailFilters({ priority: v })}
                    options={RUN_PRIORITY_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                    className="h-7 flex-1 px-2 rounded-md text-[10px] font-mono bg-white/5 border-white/10"
                  />
                </div>

                <div className="flex items-center justify-between gap-2 text-xs pt-0.5">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider select-none">Group</span>
                  <Select
                    value={sidebarGroupBy}
                    onValueChange={(v) => applyRailFilters({ groupBy: v as RunGroupBy })}
                    options={RUN_GROUP_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
                    className="h-7 w-[118px] px-2 rounded-md text-[10px] font-mono bg-white/5 border-white/10"
                  />
                </div>
              </div>
            </div>

            {/* Case List */}
            <div className="flex-1 overflow-y-auto divide-y divide-white/5 p-1 space-y-0.5">
              {filteredRailResults.length === 0 && (
                <div className="p-4 text-center text-[11px] text-muted-foreground">
                  No cases match these filters.
                </div>
              )}
              {railGroups.map((group) => (
                <div key={group.key} className="space-y-0.5">
                  {sidebarGroupBy !== 'flat' && (
                    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-2 py-1 bg-card/95 backdrop-blur-sm text-[9.5px] font-mono uppercase tracking-wider font-semibold text-muted-foreground border-b border-white/5">
                      <span className="truncate">{group.name}</span>
                      <span className="shrink-0">{group.results.length}</span>
                    </div>
                  )}
                  {group.results.map((r) => {
                    const rIdx = filteredRailResults.indexOf(r);
                const c = getCase(r.testCaseId);
                const isActive = r.id === currentResult.id;
                const rStatus = r.status?.toLowerCase() || 'pending';
                const dotStyle = statusDotConfig[rStatus] || statusDotConfig.pending;
                const targetKey = getCaseKeyForResult(r);

                const caseDataset = (run?.resolved_datasets?.[r.testCaseId] && Array.isArray(run?.resolved_datasets?.[r.testCaseId]?.rows) && run?.resolved_datasets?.[r.testCaseId]?.rows.length > 0)
                  ? run?.resolved_datasets?.[r.testCaseId]
                  : (c?.dataset && Array.isArray(c.dataset.rows) && c.dataset.rows.length > 0)
                  ? c.dataset
                  : ((c?.local_dataset || (c as any)?.localDataset) && Array.isArray((c?.local_dataset || (c as any)?.localDataset).rows) && (c?.local_dataset || (c as any)?.localDataset).rows.length > 0)
                  ? (c?.local_dataset || (c as any)?.localDataset)
                  : null;
                const hasIterations = Boolean(caseDataset && Array.isArray(caseDataset.rows) && caseDataset.rows.length > 1);

                return (
                  <div key={r.id} className="space-y-0.5">
                    <button
                      onClick={() => navigateToCase(targetKey)}
                      className={cn(
                        "w-full text-left p-2 rounded-lg text-xs flex items-start gap-2.5 transition-all group cursor-pointer",
                        isActive
                          ? "bg-muted/70 text-foreground font-medium border-l-2 border-primary"
                          : "hover:bg-primary/[0.08] dark:hover:bg-white/[0.06] text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <span className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5 transition-all", dotStyle.dot)} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-mono text-[10.5px] font-bold text-foreground/90 group-hover:text-primary transition-colors truncate">
                              #{rIdx + 1} {c?.displayId || c?.id}
                            </span>
                            {hasIterations && (
                              <span className="text-[9px] px-1 rounded bg-muted text-muted-foreground border border-border/50 font-mono font-bold shrink-0">
                                {caseDataset.rows.length} itrs
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {rStatus !== 'pending' ? (
                              <StatusPill
                                tone={
                                  rStatus === 'pass' ? 'pass' :
                                  rStatus === 'fail' ? 'fail' :
                                  rStatus === 'blocked' ? 'blocked' :
                                  rStatus === 'skip' ? 'skip' :
                                  rStatus === 'invalid' ? 'invalid' :
                                  rStatus === 'error' ? 'error' :
                                  rStatus === 'cancelled' ? 'cancelled' :
                                  'pending'
                                }
                                className="text-[9px] font-semibold uppercase tracking-wide"
                              >
                                {rStatus}
                              </StatusPill>
                            ) : (
                              <StatusPill tone="pending" className="text-[9px] font-medium">
                                Not Run
                              </StatusPill>
                            )}
                            {c?.priority && <PriorityBadge priority={c.priority} className="text-[9px] px-1 py-0" />}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                          <p className="truncate text-xs leading-snug text-foreground/80 group-hover:text-foreground transition-colors" title={c?.title}>
                            {c?.title}
                          </p>
                          <CaseSourceIcon testCase={c} className="shrink-0" />
                        </div>

                      </div>
                    </button>

                    {/* Iteration Sub-Entries in Sidebar (Max 3, then expand toggle) */}
                    {hasIterations && caseDataset?.rows?.length > 1 && (() => {
                      const isExpanded = expandedSidebarCaseIters.has(r.id);
                      const rows = caseDataset.rows;
                      const visibleRows = isExpanded ? rows : rows.slice(0, 3);
                      const remainingCount = rows.length - 3;

                      return (
                        <div className="pl-4 pr-1 py-0.5 space-y-0.5 border-l-2 border-border/40 ml-4 mb-1">
                          {visibleRows.map((row: any, iterIdx: number) => {
                            const iterResultsList = (r.iterationResults || r.iteration_results || []) as any[];
                            const iterRes = iterResultsList.find((ir: any) => ir.iteration_index === iterIdx + 1);
                            const iterStatus = iterRes?.status?.toLowerCase() || 'pending';
                            const isSubActive = isActive && activeIterationIdx === iterIdx;
                            const iterAssigneeId = iterRes?.assigned_to ?? r.assignedTo;
                            const iterMember = members.find((m: any) => (m.userId || m.user?.id) === iterAssigneeId);
                            const iterUser = iterMember?.user || iterMember;

                            const isItrStarted = iterStatus === 'pending' && ((iterRes?.time_spent_seconds && iterRes.time_spent_seconds > 0) || (isSubActive && iterationElapsedSeconds > 0));
                            const subDisplayStatus = isItrStarted ? 'started' : iterStatus;

                            const paramEntries = Object.entries(row)
                              .filter(([k]) => k !== 'id')
                              .slice(0, 2)
                              .map(([k, v]) => `${k}:${v}`)
                              .join(', ');

                            return (
                              <button
                                key={row.id || iterIdx}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!isActive) navigateToCase(targetKey);
                                  handleSelectIteration(iterIdx);
                                }}
                                className={cn(
                                  "w-full text-left px-2 py-1 rounded-md text-[11px] font-mono flex items-center justify-between gap-1.5 transition-colors cursor-pointer select-none group/itr",
                                  isSubActive
                                    ? "bg-primary/15 text-primary font-bold border border-primary/30"
                                    : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
                                )}
                              >
                                <div className="flex items-center gap-1.5 truncate min-w-0">
                                  <span className={cn(
                                    "h-1.5 w-1.5 rounded-full shrink-0",
                                    subDisplayStatus === 'pass' && "bg-emerald-500",
                                    subDisplayStatus === 'fail' && "bg-red-500",
                                    subDisplayStatus === 'blocked' && "bg-amber-500",
                                    subDisplayStatus === 'skip' && "bg-zinc-400",
                                    subDisplayStatus === 'invalid' && "bg-violet-500",
                                    subDisplayStatus === 'started' && "bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.5)] animate-pulse",
                                    subDisplayStatus === 'pending' && "border border-muted-foreground/40 bg-transparent"
                                  )} />
                                  <span className="font-semibold shrink-0">#{iterIdx + 1}</span>
                                  {paramEntries && (
                                    <span className="truncate text-[10px] text-muted-foreground/70 font-normal">
                                      {paramEntries}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  {iterUser && (
                                    <UserAvatar
                                      name={iterUser.name}
                                      imageUrl={iterUser.avatarUrl || iterUser.image}
                                      size="sm"
                                      className="h-3.5 w-3.5 text-[8px]"
                                    />
                                  )}
                                  <span className={cn(
                                    "text-[8.5px] px-1 rounded uppercase font-bold tracking-wider shrink-0",
                                    subDisplayStatus === 'pass' && "text-emerald-400 bg-emerald-500/15 border border-emerald-500/30",
                                    subDisplayStatus === 'fail' && "text-red-400 bg-red-500/15 border border-red-500/30 font-bold",
                                    subDisplayStatus === 'blocked' && "text-amber-400 bg-amber-500/15 border border-amber-500/30",
                                    subDisplayStatus === 'skip' && "text-zinc-400 bg-zinc-500/15 border border-zinc-500/30",
                                    subDisplayStatus === 'invalid' && "text-violet-400 bg-violet-500/15 border border-violet-500/30",
                                    subDisplayStatus === 'started' && "text-blue-400 bg-blue-500/15 border border-blue-500/30",
                                    subDisplayStatus === 'pending' && "text-muted-foreground/50"
                                  )}>
                                    {subDisplayStatus === 'pending' ? 'Not Run' : subDisplayStatus}
                                  </span>
                                </div>
                              </button>
                            );
                          })}

                          {remainingCount > 0 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedSidebarCaseIters((prev) => {
                                  const next = new Set(prev);
                                  if (isExpanded) next.delete(r.id);
                                  else next.add(r.id);
                                  return next;
                                });
                              }}
                              className="w-full text-left px-2 py-1 rounded text-[10px] font-mono text-muted-foreground hover:text-foreground flex items-center gap-1.5 transition-colors cursor-pointer"
                            >
                              <MoreVertical className="h-3 w-3" />
                              <span>{isExpanded ? 'Show less' : `+${remainingCount} more`}</span>
                            </button>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
                  })}
                </div>
              ))}
            </div>
          </aside>
        )}

        {/* ── Center Main Execution Canvas ── */}
        <main className="flex-1 min-w-0 flex flex-col overflow-y-auto bg-background/50">
          {/* Sub-Header Toolbar: Priority, Status, Assignee, Actions */}
          <div className="px-5 py-2.5 border-b border-white/10 space-y-2 bg-background/80 backdrop-blur shrink-0 relative z-30">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap text-xs">
                {/* Navigation Breadcrumb: Runs > Run Name > Module Name */}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium select-none">
                  <span>Runs</span>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                  <span className="truncate max-w-[140px]" title={run?.name || 'Run'}>{run?.name || 'Run'}</span>
                  {modules.find((m: any) => m.id === currentCase?.moduleId)?.name && (
                    <>
                      <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                      <span className="text-foreground/80 truncate max-w-[140px] font-semibold">
                        {modules.find((m: any) => m.id === currentCase?.moduleId)?.name}
                      </span>
                    </>
                  )}
                </div>

                {/* 1. Priority with Label */}
                {currentCase.priority && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Priority:</span>
                    <PriorityBadge priority={currentCase.priority} className="text-xs px-2 py-0.5" />
                  </div>
                )}

                {/* Where this case actually runs */}
                {currentCase && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Source:</span>
                    <span className="text-xs font-medium text-foreground/90 capitalize">
                      {(() => {
                        const source = getCaseAutomationSource(currentCase);
                        return source === 'manual' ? 'Manual' : source;
                      })()}
                    </span>
                  </div>
                )}

                {/* Attempt detail */}
                {(currentResult.attemptNumber || 1) > 1 && (
                  <span
                    className="text-xs text-muted-foreground font-mono bg-white/[0.04] border border-white/10 px-2 py-0.5 rounded-md inline-flex items-center gap-1.5"
                    title={`Attempt #${currentResult.attemptNumber} · Total effort across attempts: ${formatDuration(currentResult.totalTimeSpentSeconds || currentResult.timeSpentSeconds)}`}
                  >
                    <span>Attempt #{currentResult.attemptNumber}</span>
                    {currentResult.totalTimeSpentSeconds && currentResult.totalTimeSpentSeconds > 0 && (
                      <span className="text-[10px] opacity-70">
                        (Σ {formatDuration(currentResult.totalTimeSpentSeconds)})
                      </span>
                    )}
                  </span>
                )}
              </div>

              {/* Right Side: Assignee with Label, Defect, Re-run, and Vertical 3-Dot Menu */}
              <div className="ml-auto flex items-center gap-2.5">
                {/* Assignee with Label */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Assignee:</span>
                  <AssigneeDropdown
                    resultId={currentResult.id}
                    assignedTo={currentResult.assignedTo}
                    runStatus={run.status}
                    members={props.members}
                    onAssign={async (resId, userId) => {
                      if (userId) await assignRunResultAction(resId, userId);
                      else await unassignRunResultAction(resId);
                      props.refetchResults();
                    }}
                  />
                </div>

                {/* Defect Link when marked fail */}
                {effectiveStatus !== 'pending' && currentResult.defects && currentResult.defects.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    {currentResult.defects.map((d: any) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => setViewingDefect(d)}
                        className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors shrink-0 cursor-pointer"
                        title={`View Defect: ${d.id} (${d.title})`}
                      >
                        <Bug className="h-3 w-3 text-red-400" />
                        <span>Defect {d.id}</span>
                        {d.ticketStatus && <span className="text-[10px] font-normal opacity-80 font-mono">({d.ticketStatus})</span>}
                      </button>
                    ))}
                  </div>
                )}

                {/* 3-Dot (Vertical) Menu */}
                <div 
                  className="relative inline-block text-left" 
                  ref={moreMenuRef}
                  onMouseEnter={() => setShowMoreMenu(true)}
                  onMouseLeave={() => setShowMoreMenu(false)}
                >
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowMoreMenu(!showMoreMenu)}
                    className="h-7 w-7 p-0 border-white/10 hover:bg-white/10 cursor-pointer text-muted-foreground hover:text-foreground"
                    title="More actions"
                  >
                    <MoreVertical className="h-3.5 w-3.5" />
                  </Button>

                  {showMoreMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} />
                      <div
                        className="absolute right-0 top-full mt-1.5 z-50 w-48 rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl py-1 text-xs space-y-0.5 animate-in fade-in-0 duration-100"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <a
                          href={`/p/${slug}/repository/${currentCase.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setShowMoreMenu(false)}
                          className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-2 text-foreground/90 hover:text-foreground cursor-pointer transition-colors"
                        >
                          <Edit className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>Edit Case</span>
                        </a>

                        <button
                          type="button"
                          onClick={() => {
                            const copyUrl = typeof window !== 'undefined'
                              ? `${window.location.origin}/p/${slug}/runs/${runId}/${currentCase?.displayId || currentCase?.id || ''}`
                              : '';
                            navigator.clipboard.writeText(copyUrl);
                            toast.success('Test execution link copied');
                            setShowMoreMenu(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-2 text-foreground/90 hover:text-foreground cursor-pointer transition-colors"
                        >
                          <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>Copy Link</span>
                        </button>

                        <div className="border-t border-white/10 my-0.5" />

                        {isCaseMarked && run.status !== 'aborted' && (
                          <button
                            type="button"
                            onClick={() => {
                              setShowMoreMenu(false);
                              void handleRerunCase();
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-white/5 flex items-center gap-2 text-foreground/90 hover:text-foreground cursor-pointer transition-colors"
                          >
                            <RotateCcw className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>Re-run Case</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setShowMoreMenu(false);
                            handleRemoveFromRun();
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-red-500/10 flex items-center gap-2 text-red-400 cursor-pointer transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-400" />
                          <span>Remove from Run</span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Inline 1-Line Description with Accordion Expand (Hidden if empty/nil) */}
            {Boolean(currentCase.description?.trim()) && (
              <div className="flex items-start gap-2 text-xs pt-0.5">
                <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider shrink-0 mt-0.5">
                  Description:
                </span>
                <div className={cn(
                  "text-foreground/90 leading-relaxed font-normal flex-1 min-w-0",
                  !isDescExpanded && "line-clamp-1"
                )}>
                  {renderTextWithLinks(currentCase.description)}
                </div>
                {currentCase.description.length > 160 && (
                  <button
                    type="button"
                    onClick={() => setIsDescExpanded(!isDescExpanded)}
                    className="text-muted-foreground hover:text-foreground shrink-0 p-1 rounded-md hover:bg-white/5 transition-colors cursor-pointer"
                    title={isDescExpanded ? "Show less" : "Show more"}
                  >
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", isDescExpanded && "rotate-180")} />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Sticky Tab Bar with 2 Clean Tabs (Execution · History) ── */}
          <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-white/10 px-5 shrink-0">
            <div className="flex items-center gap-4 text-xs">
              <button
                type="button"
                onClick={() => setMainTab('test_case')}
                className={cn(
                  "relative py-2.5 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer",
                  mainTab === 'test_case'
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ListChecks className="h-3.5 w-3.5" />
                <span>Execution</span>
                {currentResult.defects?.length > 0 && (
                  <span className="bg-red-500/20 text-red-300 border border-red-500/30 text-[10px] font-bold rounded-full h-4 px-1.5 flex items-center justify-center ml-0.5">
                    {currentResult.defects.length}
                  </span>
                )}
                {mainTab === 'test_case' && (
                  <motion.div
                    layoutId="console-main-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                    transition={MOTION.spring.pill}
                  />
                )}
              </button>

              <button
                type="button"
                onClick={() => setMainTab('history')}
                className={cn(
                  "relative py-2.5 font-semibold transition-colors flex items-center gap-1.5 cursor-pointer",
                  mainTab === 'history'
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <History className="h-3.5 w-3.5" />
                <span>History & Audit</span>
                {mainTab === 'history' && (
                  <motion.div
                    layoutId="console-main-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                    transition={MOTION.spring.pill}
                  />
                )}
              </button>
            </div>
          </div>

          {/* Tab Contents */}
          <div className="px-5 pt-2.5 pb-5 flex-1 space-y-2.5">
            {/* TAB 1: Execution (Steps, Inline Defects, Collapsible Notes) */}
            <div className={cn("space-y-2.5", mainTab !== 'test_case' && "hidden")}>
              {/* Primary Case Result Action Bar (Directly on canvas, no outer box) */}
              {(!datasetInfo || !datasetInfo.rows || datasetInfo.rows.length <= 1) && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in-0 duration-150">
                  {!isCaseMarked ? (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['pass', 'fail', 'blocked', 'skip', 'invalid'] as ResultStatus[]).map((s) => {
                        const isCurrent = effectiveStatus === s;
                        const isDisabled = isCaseMarked && !isCurrent;

                        const icons: Record<string, any> = {
                          pass: Check,
                          fail: X,
                          blocked: Ban,
                          skip: SkipForward,
                          invalid: AlertTriangle,
                        };
                        const Icon = icons[s] || Check;

                        const activeFills: Record<string, string> = {
                          pass: 'bg-emerald-600 border-emerald-500 text-white shadow-xs font-bold',
                          fail: 'bg-red-600 border-red-500 text-white shadow-xs font-bold',
                          blocked: 'bg-amber-600 border-amber-500 text-white shadow-xs font-bold',
                          skip: 'bg-zinc-600 border-zinc-500 text-white shadow-xs font-bold',
                          invalid: 'bg-violet-600 border-violet-500 text-white shadow-xs font-bold',
                        };

                        const idleStyles: Record<string, string> = {
                          pass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50',
                          fail: 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:border-red-500/50',
                          blocked: 'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/50',
                          skip: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20 hover:border-zinc-500/50',
                          invalid: 'border-violet-500/30 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 hover:border-violet-500/50',
                        };

                        return (
                          <Tooltip
                            key={s}
                            content={`Mark test case as ${s.toUpperCase()}`}
                            side="top"
                            align="center"
                          >
                            <button
                              type="button"
                              disabled={isDisabled}
                              onClick={() => !isCaseMarked && handleSetCaseResult(s)}
                              className={cn(
                                "h-9 px-3.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 capitalize transition-all select-none",
                                isCurrent
                                  ? activeFills[s]
                                  : isDisabled
                                  ? "opacity-50 border-white/10 bg-white/[0.02] text-muted-foreground cursor-not-allowed"
                                  : cn(idleStyles[s], "cursor-pointer")
                              )}
                            >
                              <Icon className={cn("h-3.5 w-3.5 shrink-0", (s === 'pass' || s === 'fail') && "stroke-[2.5]")} />
                              <span>{s}</span>
                            </button>
                          </Tooltip>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 flex-wrap">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Status:</span>
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <div className={cn(
                            "h-8 px-3 rounded-lg border text-xs font-bold flex items-center gap-1.5 capitalize shadow-xs select-none w-fit",
                            effectiveStatus === 'pass' ? "bg-emerald-600 border-emerald-500 text-white" :
                            effectiveStatus === 'fail' ? "bg-red-600 border-red-500 text-white" :
                            effectiveStatus === 'error' ? "bg-violet-600 border-violet-500 text-white" :
                            effectiveStatus === 'blocked' ? "bg-amber-600 border-amber-500 text-white" :
                            effectiveStatus === 'invalid' ? "bg-violet-600 border-violet-500 text-white" :
                            effectiveStatus === 'unavailable' ? "bg-amber-500/20 border-amber-500/40 text-amber-400" :
                            (isExecutingExternalLocal || isAwaitingExternal) ? "bg-blue-600 border-blue-500 text-white" :
                            "bg-zinc-600 border-zinc-500 text-white"
                          )}>
                            {effectiveStatus === 'pass' ? <Check className="h-3.5 w-3.5 stroke-[2.5]" /> :
                             effectiveStatus === 'fail' ? <X className="h-3.5 w-3.5 stroke-[2.5]" /> :
                             effectiveStatus === 'error' ? <AlertTriangle className="h-3.5 w-3.5" /> :
                             effectiveStatus === 'blocked' ? <Ban className="h-3.5 w-3.5" /> :
                             effectiveStatus === 'invalid' ? <AlertTriangle className="h-3.5 w-3.5" /> :
                             effectiveStatus === 'unavailable' ? <Clock className="h-3.5 w-3.5" /> :
                             (isExecutingExternalLocal || isAwaitingExternal) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                             <SkipForward className="h-3.5 w-3.5" />}
                            <span>
                              {effectiveStatus === 'unavailable' ? 'Result Unavailable' :
                               effectiveStatus === 'error' ? 'Error' :
                               isExecutingExternalLocal ? 'Running...' :
                               isAwaitingExternal ? 'Awaiting Results' :
                               effectiveStatus}
                            </span>
                          </div>
                          {isAwaitingExternal && (
                            <span
                              className="text-[10px] text-muted-foreground/80 font-mono flex items-center gap-1 ml-1"
                              title="Datadog results may take a few minutes to appear"
                            >
                              <Clock className="w-3 h-3 text-muted-foreground/40" />
                              <span>Datadog results may take a few minutes to appear</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* A settled case can still be re-run without switching tabs. */}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRerunCase}
                        disabled={run.status === 'aborted' || isExecutingExternalLocal}
                        className="h-8 px-2.5 text-xs font-medium border-white/10 bg-white/5 hover:bg-white/10 hover:text-amber-400 hover:border-amber-500/30 text-muted-foreground cursor-pointer flex items-center gap-1.5 transition-colors"
                        title="Create a new attempt for this test case"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Re-run</span>
                      </Button>
                    </div>
                  )}

                  {/* Right: Stopwatch Timer */}
                  <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center ml-auto">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{currentCase && getCaseAutomationSource(currentCase) !== 'manual' ? 'Duration:' : 'Manual timer:'}</span>
                      <div className="flex items-center gap-1.5 border border-white/10 px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium bg-white/[0.03] text-foreground">
                        <Clock className={cn("h-3.5 w-3.5", !isDecided && timerPausedReason ? "text-amber-400" : isDecided ? "text-muted-foreground" : "text-primary")} />
                        <span>{formatTimer(elapsedSeconds)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Inline 1-Line Preconditions with Accordion Expand (Hidden if empty/nil) */}
              {Boolean(currentCase.preConditions?.trim()) &&
                getCaseAutomationSource(currentCase) === 'manual' && (
                <div className="flex items-start gap-2 text-xs py-0.5">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider shrink-0 mt-0.5 flex items-center gap-1">
                    <ShieldAlert className="h-3 w-3 text-muted-foreground" />
                    <span>Preconditions:</span>
                  </span>
                  <div className={cn(
                    "text-foreground/90 leading-relaxed font-normal flex-1 min-w-0",
                    !isPreExpanded && "line-clamp-1"
                  )}>
                    {renderTextWithLinks(currentCase.preConditions)}
                  </div>
                  {currentCase.preConditions.length > 160 && (
                    <button
                      type="button"
                      onClick={() => setIsPreExpanded(!isPreExpanded)}
                      className="text-muted-foreground hover:text-foreground shrink-0 p-1 rounded-md hover:bg-white/5 transition-colors cursor-pointer"
                      title={isPreExpanded ? "Show less" : "Show more"}
                    >
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", isPreExpanded && "rotate-180")} />
                    </button>
                  )}
                </div>
              )}

              {/* Blocked Notice Banner */}
              {effectiveStatus === 'blocked' && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-center justify-between gap-3 animate-in fade-in-0 duration-200">
                  <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
                    <AlertOctagon className="h-4 w-4 shrink-0" />
                    <span>Test Case is BLOCKED. Step execution is locked. Click "Re-run Test Case" to reset and execute.</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleRerunCase}
                    className="h-8 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-3 shadow-md shrink-0 flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Re-run Test Case</span>
                  </Button>
                </div>
              )}

              {/* Notes & Evidence: one neutral surface, opened on demand. */}
              {(effectiveStatus === 'fail' ||
                effectiveStatus === 'error' ||
                effectiveStatus === 'blocked' ||
                effectiveStatus === 'invalid' ||
                showNotesDrawer ||
                (notes && !isAutoGeneratedSummary(notes)) ||
                evidenceUrl ||
                failureReason ||
                attachments.length > 0) && (
                <div className="rounded-lg border border-border/60 bg-card/20 overflow-hidden">
                  <div className="flex items-center justify-between px-3.5 py-2 gap-2 flex-wrap">
                    <div className="flex items-center gap-2 text-muted-foreground min-w-0">
                      <FileText
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          effectiveStatus === 'fail'
                            ? 'text-red-400'
                            : effectiveStatus === 'error'
                            ? 'text-violet-400'
                            : effectiveStatus === 'blocked'
                            ? 'text-amber-400'
                            : effectiveStatus === 'invalid'
                            ? 'text-violet-400'
                            : 'text-muted-foreground'
                        )}
                      />
                      <span className="text-[11px] font-semibold uppercase tracking-wider">
                        Notes &amp; Evidence
                      </span>
                      {effectiveStatus === 'fail' && failureReason && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/25 font-mono">
                          Failure noted
                        </span>
                      )}
                      {attachments.length > 0 && (
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-primary/10 text-primary border border-primary/25">
                          {attachments.length} file{attachments.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowNotesDrawer((v) => !v)}
                        className="h-6 px-2 rounded-md border border-border/60 hover:bg-muted text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer flex items-center gap-1"
                      >
                        <Plus className="h-3 w-3" />
                        <span>{showNotesDrawer ? 'Hide' : 'Add Notes / Files'}</span>
                      </button>
                    </div>
                  </div>

                  {showNotesDrawer && (
                    <div className="px-3.5 py-2.5 border-t border-border/60 space-y-3 text-xs">
                      <div className="space-y-1">
                        <label className="text-[10.5px] font-semibold text-muted-foreground block">
                          Notes, Observations &amp; Links
                        </label>
                        <Textarea
                          placeholder="Record observations, error logs, or paste links (https://...)..."
                          value={isAutoGeneratedSummary(notes) ? '' : notes}
                          onChange={(e) => setNotes(e.target.value)}
                          onBlur={handleSaveNotes}
                          rows={2}
                          className="min-h-[60px] resize-none text-xs bg-background/60 border-border/50"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 flex-wrap pt-1 border-t border-border/50">
                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-border/60 bg-muted/30 hover:bg-muted/50 cursor-pointer font-medium">
                            <Upload className="h-3 w-3" />
                            <span>Upload File</span>
                            <input type="file" hidden accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.log,.json,.zip,.tar,.gz,.7z" onChange={handleCaseFileAttach} />
                          </label>
                          <span className="text-[10px] text-muted-foreground/60 font-mono">
                            or paste <kbd className="px-1 py-0.2 rounded bg-muted border border-border/50 text-[9px]">Cmd+V</kbd>
                          </span>
                        </div>

                        {attachmentsLoading ? (
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                            <span>Loading files...</span>
                          </div>
                        ) : attachments.length > 0 ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {attachments.map((att) => (
                              <div key={att.id} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-border/60 bg-muted/20 text-[11px] hover:border-border transition-colors">
                                <Paperclip className="h-2.5 w-2.5 text-muted-foreground" />
                                <span className="truncate max-w-[140px] font-mono">{att.filename}</span>
                                <button type="button" onClick={() => handleDeleteAttachment(att.id)} className="text-muted-foreground hover:text-red-400 cursor-pointer ml-0.5" title="Remove attachment">
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Data-Driven Iterations Stepper Navigator (Mockup 2) */}
              {datasetInfo && datasetInfo.rows && datasetInfo.rows.length > 0 && (() => {
                const totalIters = datasetInfo.rows.length;
                const completedIters = passedIterationsCount + failedIterationsCount + blockedIterationsCount + skippedIterationsCount + invalidIterationsCount;
                const iterPct = Math.round((completedIters / totalIters) * 100);

                return (
                  <div className="p-3 rounded-xl border border-border/60 bg-card/40 space-y-2.5">
                    {/* Top Row: Stepper Navigator (Left) + 4 Decision Buttons & Actions (Right) */}
                    <div className="flex items-center justify-between flex-wrap gap-2.5">
                      {/* Left: Stepper Controls (< , Iteration N of Total ▾, >, Failed only (N)) */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Prev Iteration */}
                        <button
                          type="button"
                          disabled={!hasPrevIteration}
                          onClick={handlePrevIteration}
                          className={cn(
                            "h-7 w-7 rounded-lg border flex items-center justify-center transition-all",
                            hasPrevIteration
                              ? "bg-card hover:bg-muted border-border/70 text-foreground cursor-pointer shadow-2xs"
                              : "bg-muted/20 border-border/30 text-muted-foreground/30 cursor-not-allowed"
                          )}
                          title={failedOnlyFilter ? "Previous failed iteration" : "Previous iteration"}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>

                        {/* Iteration Selector Dropdown */}
                        <div className="relative" ref={iterationDropdownRef}>
                          <button
                            type="button"
                            onClick={() => setShowIterationDropdown(!showIterationDropdown)}
                            className="h-7 px-2.5 rounded-lg border border-border/70 bg-card hover:bg-muted flex items-center gap-2 text-xs font-mono font-medium text-foreground transition-all cursor-pointer shadow-2xs"
                          >
                            <span>Iteration {activeIterationIdx + 1} of {totalIters}</span>
                            <span className={cn(
                              "text-[9px] px-1.5 py-0.2 rounded font-sans uppercase font-bold tracking-wider",
                              activeIterationStatus === 'pass' && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                              activeIterationStatus === 'fail' && "bg-red-500/15 text-red-400 border border-red-500/30",
                              activeIterationStatus === 'blocked' && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                              activeIterationStatus === 'skip' && "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30",
                              activeIterationStatus === 'invalid' && "bg-violet-500/15 text-violet-400 border border-violet-500/30",
                              activeIterationStatus === 'started' && "bg-[#4aa8ff]/15 text-[#4aa8ff] border border-[#4aa8ff]/30",
                              activeIterationStatus === 'pending' && "bg-muted text-muted-foreground border border-border/40"
                            )}>
                              {activeIterationStatus === 'pending' ? 'Not Run' : activeIterationStatus === 'started' ? 'Running' : activeIterationStatus}
                            </span>
                            <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
                          </button>

                          {showIterationDropdown && (
                            <div className="absolute left-0 top-full mt-1 z-50 w-72 max-h-80 overflow-y-auto rounded-xl bg-popover border border-border/80 p-1.5 shadow-2xl text-xs space-y-0.5 animate-in fade-in-0 zoom-in-95 pointer-events-auto">
                              <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono border-b border-border/40 mb-1 flex items-center justify-between">
                                <span>Jump to Iteration</span>
                                <span>{totalIters} total</span>
                              </div>
                              {datasetInfo.rows.map((row: any, idx: number) => {
                                const isCurrent = activeIterationIdx === idx;
                                const ir = rawIterationResults.find((r: any) => r.iteration_index === idx + 1);
                                const s = (ir?.status?.toLowerCase() || 'pending') as ResultStatus;
                                const isItrStarted = s === 'pending' && ((ir?.time_spent_seconds && ir.time_spent_seconds > 0) || (isCurrent && iterationElapsedSeconds > 0));
                                const dropDisplayStatus = isItrStarted ? 'started' : s;

                                const previewParams = Object.entries(row)
                                  .filter(([k]) => k !== 'id')
                                  .slice(0, 2)
                                  .map(([k, v]) => k + ':' + v)
                                  .join(', ');

                                return (
                                  <button
                                    key={row.id || idx}
                                    type="button"
                                    onClick={() => {
                                      handleSelectIteration(idx);
                                      setShowIterationDropdown(false);
                                    }}
                                    className={cn(
                                      "w-full text-left px-2 py-1.5 rounded-lg text-xs font-mono flex items-center justify-between gap-2 transition-colors cursor-pointer",
                                      isCurrent
                                        ? "bg-primary/15 text-primary font-bold border border-primary/30"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                    )}
                                  >
                                    <div className="flex items-center gap-2 truncate min-w-0">
                                      <span className="shrink-0 font-bold">#{idx + 1}</span>
                                      <span className="truncate text-[11px] text-muted-foreground/80 font-normal">
                                        {previewParams}
                                      </span>
                                    </div>
                                    <span className={cn(
                                      "text-[9px] px-1.5 py-0.2 rounded uppercase font-bold shrink-0",
                                      dropDisplayStatus === 'pass' && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                                      dropDisplayStatus === 'fail' && "bg-red-500/15 text-red-400 border border-red-500/30",
                                      dropDisplayStatus === 'blocked' && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                                      dropDisplayStatus === 'skip' && "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30",
                                      dropDisplayStatus === 'invalid' && "bg-violet-500/15 text-violet-400 border border-violet-500/30",
                                      dropDisplayStatus === 'started' && "bg-blue-500/15 text-blue-400 border border-blue-500/30",
                                      dropDisplayStatus === 'pending' && "text-muted-foreground/50"
                                    )}>
                                      {dropDisplayStatus === 'pending' ? 'Not Run' : dropDisplayStatus}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>

                        {/* Next Iteration */}
                        <button
                          type="button"
                          disabled={!hasNextIteration}
                          onClick={handleNextIteration}
                          className={cn(
                            "h-7 w-7 rounded-lg border flex items-center justify-center transition-all",
                            hasNextIteration
                              ? "bg-card hover:bg-muted border-border/70 text-foreground cursor-pointer shadow-2xs"
                              : "bg-muted/20 border-border/30 text-muted-foreground/30 cursor-not-allowed"
                          )}
                          title={failedOnlyFilter ? "Next failed iteration" : "Next iteration"}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>

                        {/* Failed Only Toggle Filter */}
                        <button
                          type="button"
                          onClick={() => {
                            if (failedIterationIndices.length === 0) {
                              toast.info('No failed or blocked iterations found');
                              return;
                            }
                            const nextVal = !failedOnlyFilter;
                            setFailedOnlyFilter(nextVal);
                            if (nextVal && !failedIterationIndices.includes(activeIterationIdx)) {
                              handleSelectIteration(failedIterationIndices[0]);
                            }
                          }}
                          className={cn(
                            "h-7 px-2.5 rounded-lg border text-xs font-mono flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs",
                            failedOnlyFilter
                              ? "bg-red-500/15 border-red-500/40 text-red-400 font-bold ring-1 ring-red-500/30"
                              : failedIterationIndices.length > 0
                              ? "bg-card hover:bg-muted border-border/70 text-muted-foreground hover:text-foreground"
                              : "opacity-50 cursor-not-allowed bg-muted/20 border-border/30 text-muted-foreground/50"
                          )}
                          title="Cycle through failed iterations only"
                        >
                          <span className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            failedIterationIndices.length > 0 ? "bg-red-500" : "bg-muted-foreground/40"
                          )} />
                          <span>Failed only ({failedIterationIndices.length})</span>
                        </button>

                        {/* Active Iteration Assignee Dropdown */}
                        {(() => {
                          const activeIterAssigneeId = activeIterationResult?.assigned_to ?? null;
                          const activeIterMember = members.find((m: any) => (m.userId || m.user?.id) === activeIterAssigneeId);
                          const activeIterUser = activeIterMember?.user || activeIterMember;
                          const caseAssigneeMember = members.find((m: any) => (m.userId || m.user?.id) === currentResult.assignedTo);
                          const caseAssigneeUser = caseAssigneeMember?.user || caseAssigneeMember;

                          return (
                            <div className="relative" ref={iterAssigneeDropdownRef}>
                              <button
                                type="button"
                                onClick={() => setShowIterAssigneeDropdown(!showIterAssigneeDropdown)}
                                className="h-7 px-3 rounded-lg border border-border/70 bg-card hover:bg-muted flex items-center gap-1.5 text-xs transition-all cursor-pointer shadow-2xs"
                                title={activeIterUser ? `Iteration #${activeIterationIdx + 1} assigned to ${activeIterUser.name}` : `Iteration #${activeIterationIdx + 1} inherits case assignee (${caseAssigneeUser?.name || 'Unassigned'})`}
                              >
                                {activeIterUser ? (
                                  <>
                                    <UserAvatar
                                      name={activeIterUser.name}
                                      imageUrl={activeIterUser.avatarUrl || activeIterUser.image}
                                      size="sm"
                                      className="h-4 w-4 text-[9px]"
                                    />
                                    <span className="truncate max-w-[85px] font-sans font-medium text-foreground">{activeIterUser.name}</span>
                                  </>
                                ) : caseAssigneeUser ? (
                                  <UserAvatar
                                    name={caseAssigneeUser.name}
                                    imageUrl={caseAssigneeUser.avatarUrl || caseAssigneeUser.image}
                                    size="sm"
                                    className="h-4 w-4 text-[9px] opacity-75"
                                  />
                                ) : (
                                  <User className="h-3.5 w-3.5 text-muted-foreground/60" />
                                )}
                                <ChevronDown className="h-3 w-3 text-muted-foreground/60" />
                              </button>

                              {showIterAssigneeDropdown && (
                                <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-xl bg-popover border border-border/80 p-1 shadow-2xl text-xs space-y-0.5 animate-in fade-in-0 duration-100 pointer-events-auto">
                                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono border-b border-border/40 mb-1">
                                    Assign Iteration #{activeIterationIdx + 1}
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowIterAssigneeDropdown(false);
                                      handleAssignCurrentIteration(null);
                                    }}
                                    className={cn(
                                      "w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between text-xs transition-colors cursor-pointer",
                                      activeIterAssigneeId === null || activeIterAssigneeId === undefined
                                        ? "bg-primary/10 text-primary font-bold"
                                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                                    )}
                                  >
                                    <span className="truncate">Inherit ({caseAssigneeUser?.name || 'Unassigned'})</span>
                                    {(activeIterAssigneeId === null || activeIterAssigneeId === undefined) && <Check className="h-3.5 w-3.5 shrink-0" />}
                                  </button>

                                  <div className="border-t border-border/30 my-0.5" />

                                  <div className="max-h-44 overflow-y-auto space-y-0.5">
                                    {members.map((m: any) => {
                                      const u = m.user || m;
                                      const uId = m.userId || u.id;
                                      const isCurrent = activeIterAssigneeId === uId;
                                      return (
                                        <button
                                          key={uId}
                                          type="button"
                                          onClick={() => {
                                            setShowIterAssigneeDropdown(false);
                                            handleAssignCurrentIteration(uId);
                                          }}
                                          className={cn(
                                            "w-full px-2 py-1.5 rounded-lg text-left flex items-center justify-between text-xs transition-colors cursor-pointer",
                                            isCurrent ? "bg-primary/10 text-primary font-bold" : "hover:bg-muted text-foreground/90"
                                          )}
                                        >
                                          <div className="flex items-center gap-2 truncate min-w-0">
                                            <UserAvatar name={u.name} imageUrl={u.avatarUrl || u.image} size="sm" className="h-4 w-4 text-[9px]" />
                                            <span className="truncate">{u.name}</span>
                                          </div>
                                          {isCurrent && <Check className="h-3.5 w-3.5 shrink-0" />}
                                        </button>
                                      );
                                    })}
                                  </div>

                                  <div className="border-t border-border/30 my-0.5" />

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setShowIterAssigneeDropdown(false);
                                      handleAssignAllIterations(activeIterAssigneeId || currentResult.assignedTo || null);
                                    }}
                                    className="w-full px-2 py-1.5 rounded-lg text-left text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                                  >
                                    Apply this assignee to all iterations
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Active Iteration Stopwatch Timer & Cumulative Case Timer */}
                        <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground px-2 py-1 rounded-lg bg-white/5 border border-white/10" title="Active iteration time · Cumulative case effort">
                          <Clock className="h-3 w-3 text-primary/70" />
                          <span>{formatTimer(iterationElapsedSeconds)}</span>
                          <span className="opacity-40">·</span>
                          <span className="text-[10.5px] text-muted-foreground/75">Total: {formatTimer(elapsedSeconds)}</span>
                        </div>

                        {/* In-Place Rerun Iteration Button - only when marked with terminal status */}
                        {activeIterationStatus !== 'pending' && activeIterationStatus !== 'started' && (
                          <button
                            type="button"
                            onClick={handleResetCurrentIteration}
                            className="h-7 px-2 rounded-lg border border-border/70 bg-card hover:bg-muted hover:text-primary hover:border-primary/40 flex items-center gap-1.5 text-xs text-muted-foreground transition-all cursor-pointer shadow-2xs"
                            title={`Rerun Iteration #${activeIterationIdx + 1}`}
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Rerun</span>
                          </button>
                        )}
                      </div>

                      {/* Right: Scope Toggle + 4 Tactile Decision Buttons + Actions Dropdown */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Scope Toggle: This Itr vs All Itrs */}
                        <div className="flex items-center bg-white/5 p-0.5 rounded-lg border border-white/10 text-[10.5px] font-mono mr-0.5">
                          <button
                            type="button"
                            onClick={() => setDecisionScope('iteration')}
                            className={cn(
                              "px-2 py-0.5 rounded cursor-pointer transition-colors font-medium",
                              decisionScope === 'iteration'
                                ? "bg-white/15 text-foreground font-bold shadow-2xs"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                            title="Decision applies only to the active iteration and advances"
                          >
                            This Itr
                          </button>
                          <button
                            type="button"
                            onClick={() => setDecisionScope('all')}
                            className={cn(
                              "px-2 py-0.5 rounded cursor-pointer transition-colors font-medium",
                              decisionScope === 'all'
                                ? "bg-primary text-white font-bold shadow-2xs"
                                : "text-muted-foreground hover:text-foreground"
                            )}
                            title={`Decision applies to all ${totalIters} iterations`}
                          >
                            All ({totalIters})
                          </button>
                        </div>

                        {/* 1. Pass Button */}
                        <button
                          type="button"
                          onClick={() => {
                            if (decisionScope === 'all') {
                              handleMarkAllIterations('pass');
                            } else {
                              handleMarkCurrentIteration('pass');
                            }
                          }}
                          className={cn(
                            "h-7 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border shadow-2xs",
                            (decisionScope === 'iteration' ? activeIterationStatus === 'pass' : false)
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 ring-1 ring-emerald-500/30"
                              : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/25 hover:border-emerald-500/40"
                          )}
                          title={decisionScope === 'all' ? `Pass all ${totalIters} iterations` : "Pass active iteration and advance"}
                        >
                          <Check className="h-3 w-3 stroke-[2.5]" />
                          <span>{decisionScope === 'all' ? `Pass All (${totalIters})` : 'Pass'}</span>
                        </button>

                        {/* 2. Fail Button */}
                        <button
                          type="button"
                          onClick={() => {
                            if (decisionScope === 'all') {
                              handleMarkAllIterations('fail');
                            } else {
                              handleMarkCurrentIteration('fail');
                            }
                          }}
                          className={cn(
                            "h-7 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border shadow-2xs",
                            (decisionScope === 'iteration' ? activeIterationStatus === 'fail' : false)
                              ? "bg-red-500/20 text-red-400 border-red-500/40 ring-1 ring-red-500/30"
                              : "bg-red-500/10 hover:bg-red-500/20 text-red-400 border-red-500/25 hover:border-red-500/40"
                          )}
                          title={decisionScope === 'all' ? `Fail all ${totalIters} iterations` : "Fail active iteration"}
                        >
                          <X className="h-3 w-3 stroke-[2.5]" />
                          <span>{decisionScope === 'all' ? `Fail All (${totalIters})` : 'Fail'}</span>
                        </button>

                        {/* 3. Blocked Button */}
                        <button
                          type="button"
                          onClick={() => {
                            if (decisionScope === 'all') {
                              handleMarkAllIterations('blocked');
                            } else {
                              handleMarkCurrentIteration('blocked');
                            }
                          }}
                          className={cn(
                            "h-7 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border shadow-2xs",
                            (decisionScope === 'iteration' ? activeIterationStatus === 'blocked' : false)
                              ? "bg-amber-500/20 text-amber-400 border-amber-500/40 ring-1 ring-amber-500/30"
                              : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/25 hover:border-amber-500/40"
                          )}
                          title={decisionScope === 'all' ? `Block all ${totalIters} iterations` : "Block active iteration"}
                        >
                          <Ban className="h-3 w-3" />
                          <span>{decisionScope === 'all' ? `Block All (${totalIters})` : 'Blocked'}</span>
                        </button>

                        {/* 4. Skip Button */}
                        <button
                          type="button"
                          onClick={() => {
                            if (decisionScope === 'all') {
                              handleMarkAllIterations('skip');
                            } else {
                              handleMarkCurrentIteration('skip');
                            }
                          }}
                          className={cn(
                            "h-7 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border shadow-2xs",
                            (decisionScope === 'iteration' ? activeIterationStatus === 'skip' : false)
                              ? "bg-zinc-500/20 text-zinc-300 border-zinc-500/40 ring-1 ring-zinc-500/30"
                              : "bg-zinc-500/10 hover:bg-zinc-500/20 text-zinc-300 border-zinc-500/25 hover:border-zinc-500/40"
                          )}
                          title={decisionScope === 'all' ? `Skip all ${totalIters} iterations` : "Skip active iteration"}
                        >
                          <SkipForward className="h-3 w-3" />
                          <span>{decisionScope === 'all' ? `Skip All (${totalIters})` : 'Skip'}</span>
                        </button>

                        {/* Secondary Actions Dropdown */}
                        <div className="relative" ref={bulkMenuRef}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowBulkMenu(!showBulkMenu)}
                            className="h-7 px-2 text-xs font-medium text-muted-foreground hover:text-foreground border border-border/60 hover:bg-muted/50 cursor-pointer"
                          >
                            <span>More</span>
                            <ChevronDown className="h-3 w-3 ml-1 text-muted-foreground/60" />
                          </Button>

                          {showBulkMenu && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setShowBulkMenu(false)} />
                              <div className="absolute right-0 top-full mt-1.5 z-50 w-52 rounded-xl bg-popover border border-border/80 p-1 shadow-xl text-xs space-y-0.5 animate-in fade-in-0 zoom-in-95 pointer-events-auto">
                                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider font-mono">
                                  Bulk Operations ({totalIters} Iterations)
                                </div>
                                {decisionScope === 'iteration' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowBulkMenu(false);
                                        handleMarkAllIterations('pass');
                                      }}
                                      className="w-full px-2 py-1.5 rounded-md text-left flex items-center gap-2 text-emerald-500 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                                    >
                                      <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                                      <span>Pass All ({totalIters})</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowBulkMenu(false);
                                        handleMarkAllIterations('fail');
                                      }}
                                      className="w-full px-2 py-1.5 rounded-md text-left flex items-center gap-2 text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                                    >
                                      <XCircle className="h-3.5 w-3.5 shrink-0" />
                                      <span>Fail All ({totalIters})</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowBulkMenu(false);
                                        handleMarkAllIterations('blocked');
                                      }}
                                      className="w-full px-2 py-1.5 rounded-md text-left flex items-center gap-2 text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
                                    >
                                      <Ban className="h-3.5 w-3.5 shrink-0" />
                                      <span>Block All ({totalIters})</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowBulkMenu(false);
                                        handleMarkAllIterations('skip');
                                      }}
                                      className="w-full px-2 py-1.5 rounded-md text-left flex items-center gap-2 text-zinc-400 hover:bg-zinc-500/10 transition-colors cursor-pointer"
                                    >
                                      <SkipForward className="h-3.5 w-3.5 shrink-0" />
                                      <span>Skip All ({totalIters})</span>
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowBulkMenu(false);
                                    handleMarkAllIterations('invalid');
                                  }}
                                  className="w-full px-2 py-1.5 rounded-md text-left flex items-center gap-2 text-violet-400 hover:bg-violet-500/10 transition-colors cursor-pointer"
                                >
                                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                  <span>Mark All as Invalid ({totalIters})</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Continuous Segmented Progress Bar (Mockup 1 style) */}
                    <div className="space-y-1.5 pt-0.5">
                      <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">
                            {completedIters}/{totalIters} iterations
                          </span>
                          <span className="opacity-40">·</span>
                          <span>{iterPct}%</span>
                        </div>
                        <div className="flex items-center gap-2 text-[11px]">
                          {passedIterationsCount > 0 && <span className="text-emerald-400 font-medium">{passedIterationsCount} passed</span>}
                          {failedIterationsCount > 0 && <span className="text-red-400 font-medium">{failedIterationsCount} failed</span>}
                          {blockedIterationsCount > 0 && <span className="text-amber-400 font-medium">{blockedIterationsCount} blocked</span>}
                          {skippedIterationsCount > 0 && <span className="text-zinc-400">{skippedIterationsCount} skipped</span>}
                          {pendingIterationsCount > 0 && <span className="text-muted-foreground/60">{pendingIterationsCount} pending</span>}
                        </div>
                      </div>

                      <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden flex shadow-2xs">
                        {passedIterationsCount > 0 && (
                          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(passedIterationsCount / totalIters) * 100}%` }} />
                        )}
                        {failedIterationsCount > 0 && (
                          <div className="h-full bg-red-500 transition-all" style={{ width: `${(failedIterationsCount / totalIters) * 100}%` }} />
                        )}
                        {blockedIterationsCount > 0 && (
                          <div className="h-full bg-amber-500 transition-all" style={{ width: `${(blockedIterationsCount / totalIters) * 100}%` }} />
                        )}
                        {invalidIterationsCount > 0 && (
                          <div className="h-full bg-violet-500 transition-all" style={{ width: `${(invalidIterationsCount / totalIters) * 100}%` }} />
                        )}
                        {skippedIterationsCount > 0 && (
                          <div className="h-full bg-zinc-400 transition-all" style={{ width: `${(skippedIterationsCount / totalIters) * 100}%` }} />
                        )}
                      </div>
                    </div>

                    {/* Active Iteration Parameter Values */}
                    {activeIterationRow && (
                      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border/40 text-xs font-mono">
                        <span className="text-muted-foreground/60 select-none text-[11px]">
                          Iteration #{activeIterationIdx + 1} parameters:
                        </span>
                        {Object.entries(activeIterationRow)
                          .filter(([k]) => k !== 'id')
                          .map(([k, v]) => (
                            <span
                              key={k}
                              className="px-2 py-0.5 rounded-md bg-muted/60 text-foreground border border-border/40 text-[11px] inline-flex items-center gap-1.5 font-mono"
                            >
                              <span className="text-muted-foreground font-semibold">{k}:</span>
                              <span className="text-foreground/90 font-medium">{String(v ?? '—')}</span>
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Automated cases: one request can carry many checks. Say both,
                  so the header never contradicts the case description. */}
              {/* Result-first summary for automated cases. One sentence says what
                  happened before the request/check detail. */}
              {currentCase && getCaseAutomationSource(currentCase) !== 'manual' && (() => {
                const isRequestStep = (stepText: string) =>
                  /^Execute\b/i.test(String(stepText || ''));
                const requestCount = steps.filter((st) => isRequestStep(st.step)).length;
                const checks = steps.filter((st) => !isRequestStep(st.step));
                let passCount = 0;
                let failCount = 0;
                let errorCount = 0;
                let firstFailedRequest: number | null = null;
                let requestOrdinal = 0;
                for (const st of steps) {
                  const isRequest = isRequestStep(st.step);
                  if (isRequest) requestOrdinal += 1;
                  // Count checks only, so the sentence and the header below
                  // always report the same numbers.
                  if (isRequest) continue;
                  const stStatus = stepResults[st.order.toString()]?.status;
                  if (stStatus === 'pass') passCount += 1;
                  else if (stStatus === 'fail') {
                    failCount += 1;
                    if (firstFailedRequest === null) firstFailedRequest = Math.max(1, requestOrdinal);
                  } else if (stStatus === 'error') errorCount += 1;
                }
                const checkCount = checks.length || requestCount;
                const failed = failCount + errorCount;
                const label =
                  effectiveStatus === 'pass'
                    ? `Passed · all ${checkCount} check${checkCount === 1 ? '' : 's'} passed`
                    : effectiveStatus === 'error'
                    ? `Error · script runtime could not evaluate a check`
                    : failed > 0
                    ? `Failed · ${failed} of ${checkCount} check${checkCount === 1 ? '' : 's'} failed${
                        requestCount > 0
                          ? ` in request ${firstFailedRequest || 1} of ${requestCount}`
                          : ''
                      }`
                    : (effectiveStatus === 'pending' && !isAwaitingExternal && !['RUNNING', 'QUEUED', 'WAITING'].includes(String(currentResult?.caseState || currentResult?.executionState || '').toUpperCase())
                        ? (sessionStarted || currentResult?.startedAt ? 'In progress' : 'Not started')
                        : 'Awaiting results');
                return (
                  <div
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold',
                      effectiveStatus === 'pass'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : effectiveStatus === 'error'
                        ? 'border-violet-500/30 bg-violet-500/10 text-violet-400'
                        : 'border-red-500/30 bg-red-500/10 text-red-400'
                    )}
                  >
                    {effectiveStatus === 'pass' ? (
                      <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{label}</span>
                  </div>
                );
              })()}

              {/* Test Steps List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <ListChecks className="h-3.5 w-3.5 text-primary" />
                    <span>
                      {(() => {
                        const isAutomatedCase =
                          !!currentCase && getCaseAutomationSource(currentCase) !== 'manual';
                        if (!isAutomatedCase) return `Test Steps (${steps.length})`;
                        const isRequestStep = (stepText: string) =>
                          /^Execute\b/i.test(String(stepText || ''));
                        const requestCount = steps.filter((st) => isRequestStep(st.step)).length;
                        // A "check" is an assertion step, not an API request.
                        const checks = steps.filter((st) => !isRequestStep(st.step));
                        let pass = 0;
                        let fail = 0;
                        let error = 0;
                        for (const st of checks) {
                          const stStatus = stepResults[st.order.toString()]?.status;
                          if (stStatus === 'pass') pass++;
                          else if (stStatus === 'fail') fail++;
                          else if (stStatus === 'error') error++;
                        }
                        const parts = [`${pass} passed`, `${fail} failed`];
                        if (error > 0) parts.push(`${error} error`);
                        const checkCount = checks.length || requestCount;
                        return `${requestCount} request${requestCount === 1 ? '' : 's'} · ${checkCount} check${checkCount === 1 ? '' : 's'} (${parts.join(', ')})`;
                      })()}
                    </span>
                  </h3>

                  <div className="flex items-center gap-2">
                    {/* Expand All / Collapse All Steps Button */}
                    {steps.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleAllStepsCollapse}
                        className="p-1 px-2.5 rounded-lg text-xs font-medium border border-white/10 bg-white/5 hover:bg-white/10 hover:text-foreground text-muted-foreground flex items-center gap-1.5 transition-colors cursor-pointer select-none"
                        title={areAllStepsCollapsed ? "Expand all test steps" : "Collapse all test steps"}
                      >
                        <ChevronsUpDown className="h-3.5 w-3.5" />
                        <span>{areAllStepsCollapsed ? "Expand All" : "Collapse All"}</span>
                      </button>
                    )}

                    {/* View Mode Toggle: Table Side-by-Side vs Stacked */}
                    <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg border border-white/10 text-xs">
                    <button
                      type="button"
                      onClick={() => toggleStepLayout('table')}
                      className={cn(
                        'p-1 px-2 rounded-md font-medium text-[11px] flex items-center gap-1.5 cursor-pointer transition-all',
                        stepLayout === 'table' ? 'bg-white/15 text-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'
                      )}
                      title="Side-by-side table view"
                    >
                      <Columns2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Table</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleStepLayout('stacked')}
                      className={cn(
                        'p-1 px-2 rounded-md font-medium text-[11px] flex items-center gap-1.5 cursor-pointer transition-all',
                        stepLayout === 'stacked' ? 'bg-white/15 text-foreground font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground'
                      )}
                      title="Stacked view (Action & Expected stacked)"
                    >
                      <Rows2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Stacked</span>
                    </button>
                  </div>
                </div>
              </div>

                {steps.length === 0 ? (
                  <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                    <span>No steps imported.</span>
                    {hasDatadogLink && (
                      <button
                        type="button"
                        onClick={handleResyncDatadog}
                        disabled={resyncingDatadog}
                        className="inline-flex items-center gap-1 font-semibold text-primary hover:underline cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className={cn('h-3 w-3', resyncingDatadog && 'animate-spin')} />
                        <span>{resyncingDatadog ? 'Re-syncing…' : 'Re-sync from Datadog'}</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="border border-border/60 rounded-xl bg-card/30 shadow-xs overflow-hidden">
                    <div className={cn(stepLayout === 'table' && "overflow-x-auto")}>
                      <div className={cn(stepLayout === 'table' && "min-w-[640px]")}>
                        {/* Table Column Headers (Only in Table Mode) */}
                        {stepLayout === 'table' && (
                          <div className="grid grid-cols-[56px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_220px] items-center gap-4 px-4 py-2.5 bg-white/[0.04] border-b border-white/10 text-[11px] font-bold text-foreground/80 uppercase tracking-wider font-mono select-none">
                            <div className="text-left pl-1">Step</div>
                            <div className="text-left">Action</div>
                            <div className="text-left">Data</div>
                            <div className="text-left">Expected Result</div>
                            <div className="text-left">Status</div>
                          </div>
                        )}

                    {/* Step Rows */}
                    <div className="divide-y divide-white/5">
                      {steps.map((step) => {
                        const sr = stepResults[step.order.toString()];
                        const { apiExec, manualNote } = extractStepApiExecution(sr, step.expected_result);
                        const isNegativeStatus = sr?.status === 'fail' || sr?.status === 'error' || sr?.status === 'blocked' || sr?.status === 'invalid';
                        const hasStepNote = Boolean(manualNote && manualNote.trim().length > 0);
                        const isStepNoteOpen = Boolean(openStepNotes[step.order] || hasStepNote);
                        const isStepLocked = effectiveStatus === 'blocked';
                        const firstDefect = currentResult.defects && currentResult.defects.length > 0 ? currentResult.defects[0] : null;
                        const isStepMarked = Boolean(sr?.status && sr.status !== 'pending');
                        const formattedExpected = formatExpectedChecklistText(step.expected_result);
                        const cleanedData = cleanStepDataDisplay(step.data);

                        const isStepCollapsed = (() => {
                          if (sr?.status === 'fail' || sr?.status === 'error' || sr?.status === 'blocked' || sr?.status === 'invalid') {
                            return false;
                          }
                          if (sr?.status === 'pass') {
                            return true;
                          }
                          const manualDefault = stepLayout === 'stacked'
                            ? (collapsedSteps[step.order] !== undefined ? collapsedSteps[step.order] : (isStepMarked || isCaseMarked))
                            : Boolean(collapsedSteps[step.order]);
                          return manualDefault;
                        })();

                        return (
                          <div
                            key={step.order}
                            onPaste={(e) => handleStepPaste(e, step.order)}
                            className={cn(
                              "px-4 py-2.5 transition-colors text-xs group",
                              sr?.status === 'pass'
                                ? "bg-emerald-500/[0.02] hover:bg-emerald-500/[0.06]"
                                : sr?.status === 'fail'
                                ? "bg-red-500/[0.03] hover:bg-red-500/[0.06]"
                                : sr?.status === 'blocked'
                                ? "bg-amber-500/[0.03] hover:bg-amber-500/[0.06]"
                                : "hover:bg-primary/[0.06] dark:hover:bg-white/[0.05]"
                            )}
                          >
                            {isStepCollapsed ? (
                              /* ── Compact 1-Line Minimized Step Row ── */
                              stepLayout === 'table' ? (
                                <div
                                  className="grid grid-cols-[56px_minmax(0,1.2fr)_minmax(0,1.2fr)_220px] items-center gap-4 cursor-pointer select-none py-0.5 group/min"
                                  onClick={() => toggleStepCollapse(step.order)}
                                  title="Click to expand step details"
                                >
                                  <div className="flex items-center gap-1.5 justify-start pl-1">
                                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 -rotate-90 group-hover/min:text-foreground transition-transform shrink-0" />
                                    <span className={cn(
                                      "font-mono text-xs font-bold px-2 py-0.5 rounded border shrink-0 flex items-center gap-1",
                                      sr?.status === 'pass'
                                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                        : sr?.status === 'fail'
                                        ? "bg-red-500/15 text-red-400 border-red-500/30"
                                        : sr?.status === 'blocked'
                                        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                        : "bg-white/5 text-muted-foreground border-white/10"
                                    )}>
                                      <span>{step.order}</span>
                                      {sr?.status === 'pass' && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                                      {sr?.status === 'fail' && <X className="h-2.5 w-2.5 stroke-[3]" />}
                                    </span>
                                  </div>

                                  <div className="truncate text-xs font-normal text-foreground/90 pr-2 leading-relaxed">
                                    {step.step}
                                  </div>

                                  <div className="truncate text-xs font-normal text-foreground/80 pr-2 leading-relaxed">
                                    {step.expected_result || ''}
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0 justify-start w-[220px]" onClick={(e) => e.stopPropagation()}>
                                    {isCaseMarked ? (
                                      isStepMarked ? (
                                        <span
                                          className={cn(
                                            "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-semibold font-mono tracking-wide shadow-xs",
                                            sr?.status === 'pass' && "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
                                            sr?.status === 'fail' && "bg-red-500/15 text-red-400 border-red-500/30 font-bold",
                                            sr?.status === 'blocked' && "bg-amber-500/15 text-amber-400 border-amber-500/30",
                                            sr?.status === 'skip' && "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30",
                                            sr?.status === 'invalid' && "bg-violet-500/15 text-violet-400 border border-violet-500/30"
                                          )}
                                        >
                                          {sr?.status === 'pass' && <Check className="h-3 w-3 stroke-[2.5]" />}
                                          {sr?.status === 'fail' && <X className="h-3 w-3 stroke-[2.5]" />}
                                          {sr?.status === 'blocked' && <Ban className="h-3 w-3" />}
                                          {sr?.status === 'skip' && <SkipForward className="h-3 w-3" />}
                                          {sr?.status === 'invalid' && <AlertTriangle className="h-3 w-3" />}
                                          <span className="capitalize">{sr?.status}</span>
                                        </span>
                                      ) : null
                                    ) : (
                                      <StepVerdictControl
                                        order={step.order}
                                        activeStatus={sr?.status}
                                        onSelectStatus={(status) => handleStepClick(step.order, status)}
                                        disabled={isStepLocked}
                                      />
                                    )}
                                    <StepEvidenceControl
                                      order={step.order}
                                      attachments={sr?.attachments}
                                      disabled={isStepLocked}
                                      onAttach={(file) => handleStepFileAttach(step.order, file)}
                                      onDelete={(attId) => handleStepFileDelete(step.order, attId)}
                                      onOpenAttachment={openAttachment}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <div
                                  className="flex items-center justify-between gap-3 cursor-pointer select-none py-0.5 group/min"
                                  onClick={() => toggleStepCollapse(step.order)}
                                  title="Click to expand step details"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 -rotate-90 group-hover/min:text-foreground transition-transform shrink-0" />
                                    <span className={cn(
                                      "font-mono text-xs font-bold px-2 py-0.5 rounded border shrink-0 flex items-center gap-1",
                                      sr?.status === 'pass'
                                        ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                        : sr?.status === 'fail'
                                        ? "bg-red-500/15 text-red-400 border-red-500/30"
                                        : sr?.status === 'blocked'
                                        ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                                        : "bg-white/5 text-muted-foreground border-white/10"
                                    )}>
                                      <span>{step.order}</span>
                                      {sr?.status === 'pass' && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                                      {sr?.status === 'fail' && <X className="h-2.5 w-2.5 stroke-[3]" />}
                                    </span>
                                    <span className="truncate text-xs text-foreground/90 font-normal">
                                      {step.step}
                                    </span>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    {isCaseMarked ? (
                                      isStepMarked ? (
                                        <span
                                          className={cn(
                                            "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-semibold font-mono tracking-wide shadow-xs",
                                            sr?.status === 'pass' && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                                            sr?.status === 'fail' && "bg-red-500/15 text-red-400 border border-red-500/30 font-bold",
                                            sr?.status === 'blocked' && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                                            sr?.status === 'skip' && "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30",
                                            sr?.status === 'invalid' && "bg-violet-500/15 text-violet-400 border border-violet-500/30"
                                          )}
                                        >
                                          {sr?.status === 'pass' && <Check className="h-3 w-3 stroke-[2.5]" />}
                                          {sr?.status === 'fail' && <X className="h-3 w-3 stroke-[2.5]" />}
                                          {sr?.status === 'blocked' && <Ban className="h-3 w-3" />}
                                          {sr?.status === 'skip' && <SkipForward className="h-3 w-3" />}
                                          {sr?.status === 'invalid' && <AlertTriangle className="h-3 w-3" />}
                                          <span className="capitalize">{sr?.status}</span>
                                        </span>
                                      ) : null
                                    ) : (
                                      <StepVerdictControl
                                        order={step.order}
                                        activeStatus={sr?.status}
                                        onSelectStatus={(status) => handleStepClick(step.order, status)}
                                        disabled={isStepLocked}
                                      />
                                    )}
                                    <StepEvidenceControl
                                      order={step.order}
                                      attachments={sr?.attachments}
                                      disabled={isStepLocked}
                                      onAttach={(file) => handleStepFileAttach(step.order, file)}
                                      onDelete={(attId) => handleStepFileDelete(step.order, attId)}
                                      onOpenAttachment={openAttachment}
                                    />
                                  </div>
                                </div>
                              )
                            ) : (
                              /* ── Expanded Full Step View ── */
                              stepLayout === 'stacked' ? (
                                /* ── Stacked View (Action on top, Expected Result stacked underneath) ── */
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between gap-3">
                                    <div
                                      className="flex items-center gap-1.5 cursor-pointer select-none group/num"
                                      onClick={() => toggleStepCollapse(step.order)}
                                      title="Click to minimise step"
                                    >
                                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 group-hover/num:text-foreground transition-transform shrink-0" />
                                      <span className={cn(
                                        "font-mono text-xs font-bold px-2 py-0.5 rounded border shrink-0 flex items-center gap-1 transition-all",
                                        sr?.status === 'pass'
                                          ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 font-bold shadow-2xs"
                                          : sr?.status === 'fail'
                                          ? "bg-red-500/15 text-red-400 border-red-500/30 font-bold shadow-2xs"
                                          : "bg-white/5 text-muted-foreground border-white/10 group-hover/num:text-foreground"
                                      )}>
                                        <span>{step.order}</span>
                                        {sr?.status === 'pass' && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                                        {sr?.status === 'fail' && <X className="h-2.5 w-2.5 stroke-[3]" />}
                                      </span>
                                    </div>

                                    <div className="flex items-center gap-1.5 shrink-0">
                                      {isCaseMarked ? (
                                        isStepMarked ? (
                                          <span
                                            className={cn(
                                              "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-semibold font-mono tracking-wide shadow-xs",
                                              sr?.status === 'pass' && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                                              sr?.status === 'fail' && "bg-red-500/15 text-red-400 border border-red-500/30 font-bold",
                                              sr?.status === 'blocked' && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                                              sr?.status === 'skip' && "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30",
                                              sr?.status === 'invalid' && "bg-violet-500/15 text-violet-400 border border-violet-500/30"
                                            )}
                                          >
                                            {sr?.status === 'pass' && <Check className="h-3 w-3 stroke-[2.5]" />}
                                            {sr?.status === 'fail' && <X className="h-3 w-3 stroke-[2.5]" />}
                                            {sr?.status === 'blocked' && <Ban className="h-3 w-3" />}
                                            {sr?.status === 'skip' && <SkipForward className="h-3 w-3" />}
                                            {sr?.status === 'invalid' && <AlertTriangle className="h-3 w-3" />}
                                            <span className="capitalize">{sr?.status}</span>
                                          </span>
                                        ) : null
                                      ) : (
                                        <StepVerdictControl
                                          order={step.order}
                                          totalSteps={steps.length}
                                          activeStatus={sr?.status}
                                          onSelectStatus={(status) => handleStepClick(step.order, status)}
                                          disabled={isStepLocked}
                                        />
                                      )}
                                      <StepEvidenceControl
                                        order={step.order}
                                        attachments={sr?.attachments}
                                        disabled={isStepLocked}
                                        onAttach={(file) => handleStepFileAttach(step.order, file)}
                                        onDelete={(attId) => handleStepFileDelete(step.order, attId)}
                                        onOpenAttachment={openAttachment}
                                      />
                                    </div>
                                  </div>

                                   {/* Action */}
                                   <div className="space-y-0.5">
                                     {step.reusable_step && (
                                       <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20 text-[10px] font-mono mb-1">
                                         <Link2 className="h-2.5 w-2.5" />
                                         <span>{step.reusable_step.title || 'Reusable Step'}</span>
                                       </span>
                                     )}
                                     <span className="text-[9.5px] font-bold text-muted-foreground/70 uppercase tracking-wider block font-mono">
                                       Action
                                     </span>
                                     <div className="text-xs font-normal text-foreground/95 leading-relaxed whitespace-pre-wrap">
                                       <LinkifiedText
                                         text={interpolateStepText(step.step, run?.resolved_variables, activeIterationRow)}
                                         variables={allVariablesList}
                                         parameters={datasetParamsList}
                                       />
                                     </div>
                                     {cleanedData && (
                                       <div className="text-[11px] bg-white/[0.02] rounded p-1.5 text-foreground/85 font-mono border border-white/[0.06] mt-1">
                                         <span className="font-semibold text-muted-foreground uppercase text-[9.5px] mr-1 font-sans">Input Data: </span>
                                         <LinkifiedText
                                           text={interpolateStepText(cleanedData, run?.resolved_variables, activeIterationRow)}
                                           variables={allVariablesList}
                                           parameters={datasetParamsList}
                                         />
                                       </div>
                                     )}
                                     {step.image_url && (
                                       <img src={step.image_url} alt="" className="mt-1 rounded-lg max-h-24 object-contain border border-white/10 shadow-xs" />
                                     )}
                                   </div>

                                   {/* Expected Result — omitted for automated cases with no
                                       explicit expectation; the checks already state it. */}
                                   {(!(currentCase && getCaseAutomationSource(currentCase) !== 'manual') ||
                                     Boolean(formattedExpected)) && (
                                   <div className="pt-1.5 mt-1.5 border-t border-white/5 space-y-0.5">
                                     <span className="text-[9.5px] font-bold text-muted-foreground/70 uppercase tracking-wider block font-mono">
                                       Expected Result
                                     </span>
                                     <div className="text-xs font-normal text-foreground/90 leading-relaxed whitespace-pre-line">
                                       {formattedExpected ? (
                                         <LinkifiedText
                                           text={interpolateStepText(formattedExpected, run?.resolved_variables, activeIterationRow)}
                                           variables={allVariablesList}
                                           parameters={datasetParamsList}
                                         />
                                       ) : (
                                         <span className="text-muted-foreground/40 italic font-normal">—</span>
                                       )}
                                     </div>
                                   </div>
                                   )}
                                 </div>
                               ) : (
                                 /* ── Table View (Side-by-Side 2-Column) ── */
                                 <div className="grid grid-cols-[56px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_220px] items-start gap-4">
                                   {/* Step Number with Click-to-Minimise & Passed check */}
                                   <div
                                     className="flex items-center gap-1.5 justify-start pl-1 pt-0.5 cursor-pointer select-none group/num"
                                     onClick={() => toggleStepCollapse(step.order)}
                                     title="Click to minimise step"
                                   >
                                     <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 group-hover/num:text-foreground transition-transform shrink-0" />
                                     <span className={cn(
                                       "font-mono text-xs font-bold px-2 py-0.5 rounded border shrink-0 flex items-center gap-1 transition-all",
                                       sr?.status === 'pass'
                                         ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 font-bold shadow-2xs"
                                         : sr?.status === 'fail'
                                         ? "bg-red-500/15 text-red-400 border-red-500/30 font-bold shadow-2xs"
                                         : "bg-white/5 text-muted-foreground border-white/10 group-hover/num:text-foreground"
                                     )}>
                                       <span>{step.order}</span>
                                       {sr?.status === 'pass' && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                                       {sr?.status === 'fail' && <X className="h-2.5 w-2.5 stroke-[3]" />}
                                     </span>
                                   </div>

                                   {/* Action */}
                                   <div className="space-y-1 min-w-0 pr-2 text-left">
                                     {step.reusable_step && (
                                       <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20 text-[10px] font-mono mb-1">
                                         <Link2 className="h-2.5 w-2.5" />
                                         <span>{step.reusable_step.title || 'Reusable Step'}</span>
                                       </span>
                                     )}
                                     <div className="text-xs font-normal text-foreground/90 leading-relaxed whitespace-pre-wrap">
                                       <LinkifiedText
                                         text={interpolateStepText(step.step, run?.resolved_variables, activeIterationRow)}
                                         variables={allVariablesList}
                                         parameters={datasetParamsList}
                                       />
                                     </div>
                                     {step.image_url && (
                                       <img src={step.image_url} alt="" className="mt-1.5 rounded-lg max-h-24 object-contain border border-white/10 shadow-xs" />
                                     )}
                                   </div>

                                   {/* Data */}
                                   <div className="space-y-1 min-w-0 pr-2 text-left">
                                     {cleanedData ? (
                                       <div className="text-xs font-normal text-foreground/90 leading-relaxed whitespace-pre-wrap font-mono bg-white/[0.02] p-1.5 rounded border border-white/[0.06] overflow-x-auto">
                                         <LinkifiedText
                                           text={interpolateStepText(cleanedData, run?.resolved_variables, activeIterationRow)}
                                           variables={allVariablesList}
                                           parameters={datasetParamsList}
                                         />
                                       </div>
                                     ) : (
                                       <span className="text-muted-foreground/40 italic font-normal text-xs">—</span>
                                     )}
                                   </div>

                                   {/* Expected Result */}
                                   <div className="space-y-1 min-w-0 pr-2 text-left">
                                     <div className="text-xs font-normal text-foreground/90 leading-relaxed whitespace-pre-line">
                                       {formattedExpected ? (
                                         <LinkifiedText
                                           text={interpolateStepText(formattedExpected, run?.resolved_variables, activeIterationRow)}
                                           variables={allVariablesList}
                                           parameters={datasetParamsList}
                                         />
                                       ) : (
                                         <span className="text-muted-foreground/40 italic font-normal">—</span>
                                       )}
                                     </div>
                                   </div>

                                  {/* Status & Actions */}
                                  <div className="flex items-center gap-1.5 shrink-0 pt-0.5 justify-start w-[220px]">
                                    {isCaseMarked ? (
                                      isStepMarked ? (
                                        <span
                                          className={cn(
                                            "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-semibold font-mono tracking-wide shadow-xs",
                                            sr?.status === 'pass' && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                                            sr?.status === 'fail' && "bg-red-500/15 text-red-400 border border-red-500/30 font-bold",
                                            sr?.status === 'blocked' && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                                            sr?.status === 'skip' && "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30",
                                            sr?.status === 'invalid' && "bg-violet-500/15 text-violet-400 border border-violet-500/30"
                                          )}
                                        >
                                          {sr?.status === 'pass' && <Check className="h-3 w-3 stroke-[2.5]" />}
                                          {sr?.status === 'fail' && <X className="h-3 w-3 stroke-[2.5]" />}
                                          {sr?.status === 'blocked' && <Ban className="h-3 w-3" />}
                                          {sr?.status === 'skip' && <SkipForward className="h-3 w-3" />}
                                          {sr?.status === 'invalid' && <AlertTriangle className="h-3 w-3" />}
                                          <span className="capitalize">{sr?.status}</span>
                                        </span>
                                      ) : null
                                    ) : (
                                      <StepVerdictControl
                                        order={step.order}
                                        totalSteps={steps.length}
                                        activeStatus={sr?.status}
                                        onSelectStatus={(status) => handleStepClick(step.order, status)}
                                        disabled={isStepLocked}
                                      />
                                    )}
                                    <StepEvidenceControl
                                      order={step.order}
                                      attachments={sr?.attachments}
                                      disabled={isStepLocked}
                                      onAttach={(file) => handleStepFileAttach(step.order, file)}
                                      onDelete={(attId) => handleStepFileDelete(step.order, attId)}
                                      onOpenAttachment={openAttachment}
                                    />
                                  </div>
                                </div>
                              )
                            )}

                            {/* Step Evidence Expanded Row */}
                            <StepEvidenceExpandedRow
                              order={step.order}
                              attachments={sr?.attachments}
                              disabled={isStepLocked}
                              onDelete={(attId) => handleStepFileDelete(step.order, attId)}
                              onOpenAttachment={openAttachment}
                            />

                            {/* Run-Scoped Automated API Actual Result Panel (Assertions Checklist + Collapsible Raw Response) */}
                            {!isStepCollapsed && apiExec && (
                              <div className="mt-3 pt-3 border-t border-border/60 space-y-2.5">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                    <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                                      Actual Result
                                    </span>
                                    {apiExec.statusCode ? (
                                      <span
                                        className={cn(
                                          'px-2 py-0.5 rounded font-mono text-[10px] font-bold border',
                                          apiExec.statusCode >= 200 && apiExec.statusCode < 300
                                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                                            : 'bg-red-500/15 text-red-400 border-red-500/30'
                                        )}
                                      >
                                        HTTP {apiExec.statusCode} {apiExec.statusText || ''}
                                      </span>
                                    ) : null}
                                    <span className="font-mono text-[11px] text-muted-foreground">
                                      {apiExec.durationMs >= 1000
                                        ? `${(apiExec.durationMs / 1000).toFixed(1)}s (${apiExec.durationMs}ms)`
                                        : `${apiExec.durationMs}ms`}
                                    </span>
                                    <span className="font-mono text-[11px] text-foreground/80 truncate max-w-[420px]">
                                      <strong className="text-foreground">{apiExec.method}</strong>{' '}
                                      {renderTextWithLinks(apiExec.url)}
                                    </span>
                                  </div>

                                  {apiExec.responseBody && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedRawResponses((prev) => ({
                                          ...prev,
                                          [step.order]: !prev[step.order],
                                        }))
                                      }
                                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer shrink-0"
                                    >
                                      <span>
                                        {expandedRawResponses[step.order]
                                          ? 'Hide raw response'
                                          : 'View raw response'}
                                      </span>
                                      {expandedRawResponses[step.order] ? (
                                        <ChevronDown className="h-3.5 w-3.5" />
                                      ) : (
                                        <ChevronRight className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  )}
                                </div>

                                {apiExec.errorDetail && (
                                  <div className="p-2 rounded-lg bg-red-500/10 border border-red-500/30 font-mono text-[11px] text-red-400 break-all">
                                    {apiExec.errorDetail}
                                  </div>
                                )}

                                {sr?.status === 'fail' &&
                                  !apiExec.errorDetail &&
                                  !(apiExec.assertions || []).some((a) => !a.passed) && (
                                    <div className="p-2 rounded-lg bg-red-500/[0.08] border border-red-500/25 text-[11px] text-red-400 break-words">
                                      {sr?.failureMessage || 'No response or assertion detail captured for this failure.'}
                                    </div>
                                  )}

                                {apiExec.assertions && apiExec.assertions.length > 0 && (
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-0.5">
                                    {apiExec.assertions.map((a, aIdx) => (
                                      <div
                                        key={aIdx}
                                        className={cn(
                                          'flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-xs',
                                          a.passed
                                            ? 'bg-emerald-500/[0.04] border-emerald-500/20 text-foreground/90'
                                            : 'bg-red-500/[0.08] border-red-500/30 text-red-400'
                                        )}
                                      >
                                        {a.passed ? (
                                          <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5 stroke-[2.5]" />
                                        ) : (
                                          <X className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5 stroke-[2.5]" />
                                        )}
                                        <div className="min-w-0 flex-1">
                                          <div className="font-medium leading-snug">{a.name}</div>
                                          {a.error && (
                                            <div className="font-mono text-[10px] text-red-400/90 mt-0.5 break-all">
                                              {a.error}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {expandedRawResponses[step.order] &&
                                  apiExec.responseHeaders &&
                                  Object.keys(apiExec.responseHeaders).length > 0 && (
                                    <details className="pt-1">
                                      <summary className="text-[10px] font-mono uppercase text-muted-foreground font-semibold cursor-pointer select-none">
                                        Response Headers ({Object.keys(apiExec.responseHeaders).length})
                                      </summary>
                                      <pre className="mt-1 p-2 rounded-lg border border-white/10 bg-black/30 font-mono text-[10.5px] text-foreground/85 overflow-x-auto max-h-40 whitespace-pre-wrap break-words">
                                        {JSON.stringify(apiExec.responseHeaders, null, 2)}
                                      </pre>
                                    </details>
                                  )}

                                {expandedRawResponses[step.order] && apiExec.responseBody && (
                                  <div className="space-y-1 pt-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] font-mono uppercase text-muted-foreground font-semibold">
                                        Raw JSON Response Body
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          navigator.clipboard.writeText(apiExec.responseBody || '');
                                          toast.success('Raw response copied to clipboard');
                                        }}
                                        className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                                      >
                                        <Copy className="h-3 w-3" />
                                        <span>Copy JSON</span>
                                      </button>
                                    </div>
                                    <pre className="p-3 rounded-lg border border-white/10 bg-black/40 font-mono text-[11px] text-foreground/90 overflow-x-auto max-h-64 whitespace-pre-wrap break-words leading-relaxed">
                                      {apiExec.responseBody}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Provider (Datadog/Postman) step-level detail + external result link */}
                            {!isStepCollapsed && (sr?.subSteps?.length || sr?.externalResultUrl) && (
                              <div className="mt-3 pt-3 border-t border-border/60 space-y-2">
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-muted-foreground">
                                    Provider Result
                                    {sr?.subSteps?.length ? ` · ${sr.subSteps.length}` : ''}
                                  </span>
                                  {sr?.externalResultUrl && (
                                    <a
                                      href={sr.externalResultUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[10.5px] font-medium text-primary hover:underline cursor-pointer"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                      Open in provider
                                    </a>
                                  )}
                                </div>

                                {sr?.failureMessage && (
                                  <div className="px-2.5 py-1.5 rounded-lg border border-red-500/30 bg-red-500/[0.08] text-[11px] text-red-400 font-mono break-words">
                                    {sr.failureMessage}
                                  </div>
                                )}

                                {sr?.subSteps && sr.subSteps.length > 0 && (
                                  <div className="space-y-1">
                                    {sr.subSteps.map((sub: ProviderSubStep, sIdx: number) => {
                                      const matchedStep = sub.stepId
                                        ? providerStepIndex.get(sub.stepId)
                                        : undefined;
                                      const displayName = matchedStep?.step || sub.name;
                                      return (
                                      <div
                                        key={`${sub.order}-${sIdx}`}
                                        className={cn(
                                          'flex items-start gap-2 px-2.5 py-1.5 rounded-lg border text-xs',
                                          sub.status === 'pass'
                                            ? 'bg-emerald-500/[0.04] border-emerald-500/20 text-foreground/90'
                                            : sub.status === 'fail'
                                            ? 'bg-red-500/[0.08] border-red-500/30 text-red-400'
                                            : 'bg-white/[0.03] border-white/10 text-muted-foreground'
                                        )}
                                      >
                                        {sub.status === 'pass' ? (
                                          <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5 stroke-[2.5]" />
                                        ) : sub.status === 'fail' ? (
                                          <X className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5 stroke-[2.5]" />
                                        ) : (
                                          <SkipForward className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                        )}
                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                                              {sub.order}
                                            </span>
                                            <span className="font-medium leading-snug truncate" title={displayName}>
                                              <VariableChipsText text={displayName} />
                                            </span>
                                            {typeof sub.durationMs === 'number' && (
                                              <span className="ml-auto font-mono text-[10px] text-muted-foreground shrink-0 inline-flex items-center gap-1">
                                                <Clock className="h-2.5 w-2.5" />
                                                {sub.durationMs >= 1000
                                                  ? `${(sub.durationMs / 1000).toFixed(1)}s`
                                                  : `${sub.durationMs}ms`}
                                              </span>
                                            )}
                                          </div>
                                          {sub.failureMessage && (
                                            <div className="font-mono text-[10px] text-red-400/90 mt-0.5 break-words">
                                              {sub.failureMessage}
                                            </div>
                                          )}
                                          {sub.assertions && sub.assertions.length > 0 && (
                                            <div className="mt-1 space-y-0.5">
                                              {sub.assertions.map((a: PostmanAssertionResult, aIdx: number) => (
                                                <div key={aIdx} className="flex items-start gap-1.5 text-[10.5px]">
                                                  {a.passed ? (
                                                    <Check className="h-2.5 w-2.5 text-emerald-400 shrink-0 mt-0.5" />
                                                  ) : (
                                                    <X className="h-2.5 w-2.5 text-red-400 shrink-0 mt-0.5" />
                                                  )}
                                                  <span className="min-w-0 break-words">
                                                    {a.name}
                                                    {a.error ? ` — ${a.error}` : ''}
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                          {sub.status === 'fail' && sub.screenshotUrl && (
                                            <a
                                              href={sub.screenshotUrl}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="mt-1.5 block"
                                              title="Open captured screenshot"
                                            >
                                              <img
                                                src={sub.screenshotUrl}
                                                alt={`Screenshot for ${sub.name}`}
                                                loading="lazy"
                                                className="max-h-56 rounded-md border border-border/60 object-contain"
                                              />
                                            </a>
                                          )}
                                          {sub.status === 'fail' && sub.screenshotBucketKey && !sub.screenshotUrl && (
                                            <a
                                              href={sr?.externalResultUrl || sub.screenshotBucketKey}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="mt-1 inline-flex items-center gap-1 text-[10px] font-mono text-muted-foreground/80 hover:text-primary hover:underline"
                                            >
                                              <ImageIcon className="h-2.5 w-2.5" />
                                              <span className="truncate max-w-[280px]" title={sub.screenshotBucketKey}>
                                                Screenshot captured — open result
                                              </span>
                                            </a>
                                          )}
                                          {sub.status === 'fail' && !sub.failureMessage && !sub.screenshotUrl && !sub.screenshotBucketKey && (
                                            <div className="mt-0.5 text-[10px] text-muted-foreground/80">
                                              No step-level failure detail returned by the provider.
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {(() => {
                                  if (!sr?.subSteps?.length) return null;
                                  const { unmatched } = matchDatadogResults(steps, sr.subSteps as ProviderSubStep[]);
                                  if (unmatched.length === 0) return null;
                                  return (
                                    <UnmatchedProviderResults
                                      results={unmatched.map((sub) => ({
                                        stepId: sub.stepId,
                                        name: sub.name,
                                        status: sub.status,
                                        failureMessage: sub.failureMessage,
                                      }))}
                                      onResync={handleResyncDatadog}
                                      resyncing={resyncingDatadog}
                                    />
                                  );
                                })()}
                              </div>
                            )}

                            {/* Step observations & inline defect button */}
                            {isStepNoteOpen ? (
                              <div
                                className={cn(
                                  "rounded-lg p-2.5 space-y-2",
                                  sr?.status === 'fail'
                                    ? "mt-3 border-l-2 border-l-red-500 border border-white/10 bg-white/[0.02]"
                                    : "mt-2 pt-1.5 border-t border-white/10"
                                )}
                              >
                                {sr?.status === 'fail' && (
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10.5px] uppercase font-bold text-red-400 tracking-wider">
                                      Failure Observation & Details
                                    </span>
                                    {firstDefect && (
                                      <button
                                        type="button"
                                        onClick={() => setViewingDefect(firstDefect)}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10.5px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-colors shrink-0 cursor-pointer ml-auto"
                                      >
                                        <Bug className="h-3 w-3 text-amber-400" />
                                        <span>Defect {firstDefect.id}</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                                {/* If manual note exists, show it formatted with clickable hyperlinks */}
                                {manualNote && (
                                  <div className="p-2 rounded-lg bg-white/[0.02] border border-white/10 text-xs text-foreground/90 leading-relaxed font-normal break-words space-y-1">
                                    <div className="flex items-center justify-between text-[10.5px] text-muted-foreground font-semibold">
                                      <span>Step Observation:</span>
                                    </div>
                                    <div className="whitespace-pre-wrap">
                                      {renderTextWithLinks(manualNote)}
                                    </div>
                                  </div>
                                )}

                                <div className="flex items-center gap-2">
                                  <Input
                                    placeholder="Add step observations or paste links (https://...)..."
                                    value={manualNote}
                                    onChange={(e) => handleStepNote(step.order, e.target.value)}
                                    onBlur={handleSaveNotes}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSaveNotes();
                                        toast.success('Observation saved');
                                      }
                                    }}
                                    disabled={isStepLocked}
                                    className="h-7.5 text-xs flex-1 bg-background/60 border-white/10 placeholder:text-muted-foreground/75"
                                  />
                                  <Tooltip content="Save note" side="top" align="center">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        handleSaveNotes();
                                        toast.success('Observation saved');
                                      }}
                                      disabled={isStepLocked}
                                      className="h-7 w-7 p-0 shrink-0 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 cursor-pointer"
                                      title="Save note"
                                    >
                                      <Check className="h-3.5 w-3.5" />
                                    </Button>
                                  </Tooltip>
                                  <Tooltip content="Close step note" side="top" align="end">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => {
                                        setOpenStepNotes((prev) => ({ ...prev, [step.order]: false }));
                                      }}
                                      disabled={isStepLocked}
                                      className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-red-400 cursor-pointer"
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </Tooltip>
                                  {sr?.status === 'fail' && !firstDefect && !isStepLocked && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleStepDefect(step.order, step.step, step.expected_result || undefined, sr?.attachments)}
                                      className="h-7.5 px-2.5 text-xs text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-lg gap-1 border border-amber-500/30 cursor-pointer shrink-0"
                                    >
                                      <Bug className="h-3.5 w-3.5" />
                                      <span>Create Bug</span>
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <div className="mt-2 flex items-center justify-between gap-2 pt-1 border-t border-white/5">
                                <button
                                  type="button"
                                  onClick={() => setOpenStepNotes((prev) => ({ ...prev, [step.order]: true }))}
                                  className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
                                  title="Add step note"
                                >
                                  <Plus className="h-3 w-3" />
                                </button>
                                  <div className="flex items-center gap-2 ml-auto">
                                    {firstDefect && sr?.status === 'fail' && (
                                      <button
                                        type="button"
                                        onClick={() => setViewingDefect(firstDefect)}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10.5px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30 hover:bg-amber-500/20 transition-colors shrink-0 cursor-pointer"
                                      >
                                        <Bug className="h-3 w-3 text-amber-400" />
                                        <span>Defect {firstDefect.id}</span>
                                      </button>
                                    )}
                                    {sr?.status === 'fail' && !firstDefect && !isStepLocked && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleStepDefect(step.order, step.step, step.expected_result || undefined, sr?.attachments)}
                                        className="h-6 px-2 text-[11px] text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-md gap-1 border border-amber-500/30 cursor-pointer shrink-0"
                                      >
                                        <Bug className="h-3 w-3" />
                                        <span>Create Bug</span>
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
              </div>

              {/* Inline 1-Line Postconditions with Accordion Expand (Hidden if empty/nil) */}
              {Boolean((currentCase.postConditions || currentCase.post_conditions)?.trim()) && (
                <div className="flex items-start gap-2 text-xs py-0.5">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider shrink-0 mt-0.5 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-muted-foreground" />
                    <span>Postconditions:</span>
                  </span>
                  <div className={cn(
                    "text-foreground/90 leading-relaxed font-normal flex-1 min-w-0",
                    !isPostExpanded && "line-clamp-1"
                  )}>
                    {renderTextWithLinks(currentCase.postConditions || currentCase.post_conditions)}
                  </div>
                  {(currentCase.postConditions || currentCase.post_conditions).length > 160 && (
                    <button
                      type="button"
                      onClick={() => setIsPostExpanded(!isPostExpanded)}
                      className="text-muted-foreground hover:text-foreground shrink-0 p-1 rounded-md hover:bg-white/5 transition-colors cursor-pointer"
                      title={isPostExpanded ? "Show less" : "Show more"}
                    >
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", isPostExpanded && "rotate-180")} />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* TAB 2: History & Audit */}
            <div className={cn("space-y-4 max-w-3xl", mainTab !== 'history' && "hidden")}>
              {/* Section 1: Current Run Execution Details & Audit */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-[11px] block">
                  Current Run Execution
                </span>
                <div className="border border-white/10 rounded-xl p-4 bg-white/[0.02] text-xs space-y-3 shadow-xs">
                  <div className="flex items-start justify-between gap-3">
                    {/* Left: Eyebrow RUN + heading with run name + secondary metadata */}
                    <div className="space-y-1 min-w-0">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest block font-mono">
                        RUN
                      </span>
                      <h4 className="text-sm font-bold text-foreground truncate" title={run.name}>
                        {run.name}
                      </h4>
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-0.5">
                        <ResultStatusBadge
                          status={effectiveStatus}
                          attemptNumber={currentResult.attemptNumber || 1}
                          started={sessionStarted || Boolean(currentResult.startedAt)}
                        />
                        {currentResult.executedAt && (
                          <span suppressHydrationWarning>Executed at {new Date(currentResult.executedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        )}
                        {run.environment && (() => {
                          const envMatch = environments.find((e: any) => e.name?.toUpperCase() === run.environment?.toUpperCase());
                          return (
                            <span className="inline-flex items-center gap-1 font-mono text-[11px]">
                              <span>·</span>
                              <span className={cn(
                                "px-2 py-0.5 rounded-full font-bold uppercase border text-[10px]",
                                envMatch?.color === 'amber' ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                                envMatch?.color === 'emerald' ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                                envMatch?.color === 'purple' ? "bg-purple-500/15 text-purple-400 border-purple-500/30" :
                                envMatch?.color === 'rose' ? "bg-rose-500/15 text-rose-400 border-rose-500/30" :
                                envMatch?.color === 'sky' ? "bg-sky-500/15 text-sky-400 border-sky-500/30" :
                                "bg-blue-500/15 text-blue-400 border-blue-500/30"
                              )}>
                                {run.environment}
                              </span>
                              {envMatch?.base_url && (
                                <a
                                  href={envMatch.base_url.startsWith('http') ? envMatch.base_url : `https://${envMatch.base_url}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sky-400 hover:underline inline-flex items-center gap-0.5 ml-0.5 truncate max-w-[140px]"
                                  title={`Base URL: ${envMatch.base_url}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <span>{envMatch.base_url.replace(/^https?:\/\//, '')}</span>
                                  <ExternalLink className="h-2.5 w-2.5 opacity-70 shrink-0" />
                                </a>
                              )}
                            </span>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Right: Timer + Re-run trigger button */}
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-medium text-foreground bg-white/5 border border-white/10 px-2 py-0.5 rounded">
                          ⏱ {formatTimer(elapsedSeconds)}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRerunCase}
                          disabled={run.status === 'aborted'}
                          className="h-7 px-2.5 text-xs font-medium border-white/10 bg-white/5 hover:bg-white/10 hover:text-amber-400 hover:border-amber-500/30 text-muted-foreground cursor-pointer flex items-center gap-1.5 transition-colors"
                          title="Create a new attempt for this test case"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Re-run</span>
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Linked Defects for Current Run Result */}
                  {currentResult.defects && currentResult.defects.length > 0 && (
                    <div className="pt-2 border-t border-white/5 space-y-1.5">
                      <span className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider block">
                        Linked Defect:
                      </span>
                      {currentResult.defects.map((d: any) => (
                        <div
                          key={d.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 gap-2 flex-wrap"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Bug className="h-3.5 w-3.5 text-red-400 shrink-0" />
                            <span className="font-semibold">{d.id}</span>
                            {d.externalTicketId && (
                              <span className="font-mono font-bold text-foreground bg-white/10 px-1.5 py-0.2 rounded text-[10px]">
                                {d.externalTicketId}
                              </span>
                            )}
                            <span className="truncate max-w-sm text-foreground/80">{d.title}</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {d.ticketStatus && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-red-500/30 bg-red-500/20 text-red-200">
                                {d.ticketStatus}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => setViewingDefect(d)}
                              className="text-xs text-primary hover:underline font-sans font-medium cursor-pointer"
                            >
                              View Details
                            </button>
                            {d.ticketUrl && (
                              <a
                                href={d.ticketUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 font-sans"
                                title="Open in PM Tool"
                              >
                                <span>PM Tool</span>
                                <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {failureReason && (
                    <div className="pt-2 border-t border-white/5 text-xs">
                      <span className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider block mb-0.5">
                        Failure Observation:
                      </span>
                      <p className="text-foreground/90 leading-relaxed bg-white/5 p-2 rounded-lg border border-white/5 font-mono text-[11px]">
                        {failureReason}
                      </p>
                    </div>
                  )}

                  {/* Iterations Breakdown in Current Run */}
                  {datasetInfo && datasetInfo.rows && datasetInfo.rows.length > 1 && (
                    <div className="pt-2 border-t border-white/5 space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
                        <span className="font-semibold text-foreground">Iterations Breakdown ({datasetInfo.rows.length})</span>
                        <span>{passedIterationsCount} passed, {failedIterationsCount} failed</span>
                      </div>
                      <div className="space-y-0.5 max-h-36 overflow-y-auto">
                        {datasetInfo.rows.map((row: any, idx: number) => {
                          const ir = rawIterationResults.find((x: any) => x.iteration_index === idx + 1);
                          const s = ir?.status?.toLowerCase() || 'pending';
                          const pSummary = Object.entries(row).filter(([k]) => k !== 'id').slice(0, 2).map(([k, v]) => `${k}:${v}`).join(', ');
                          return (
                            <div key={idx} className="flex items-center justify-between text-[10.5px] font-mono px-2 py-1 rounded bg-white/[0.02]">
                              <span className="truncate">#{idx + 1} {pSummary}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {ir?.time_spent_seconds > 0 && (
                                  <span className="text-[9px] text-muted-foreground/60">{formatTimer(ir.time_spent_seconds)}</span>
                                )}
                                <span className={cn(
                                  "px-1 py-0.2 rounded uppercase font-bold text-[8.5px]",
                                  s === 'pass' && "text-emerald-400 bg-emerald-500/15",
                                  s === 'fail' && "text-red-400 bg-red-500/15",
                                  s === 'blocked' && "text-amber-400 bg-amber-500/15",
                                  s === 'pending' && "text-muted-foreground/60"
                                )}>
                                  {s}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Section 2: Current Run Retries (Previous attempts in this run) */}
              {currentRunRetries.length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-[11px] block">
                      Current Run Retries ({currentRunRetries.length})
                    </span>
                    <span className="text-[10px] text-muted-foreground font-mono">Previous attempts in {run.name}</span>
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {currentRunRetries.map((r) => {
                      const borderColor =
                        r.status === 'fail'
                          ? 'border-l-red-500'
                          : r.status === 'pass'
                          ? 'border-l-emerald-500'
                          : r.status === 'blocked'
                          ? 'border-l-amber-500'
                          : r.status === 'invalid' || r.status === 'error'
                          ? 'border-l-violet-500'
                          : 'border-l-zinc-500';

                      return (
                        <div
                          key={r.id}
                          className={cn(
                            "border border-white/10 border-l-4 rounded-xl p-2.5 bg-background text-xs space-y-1.5 shadow-xs",
                            borderColor
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">Attempt #{r.attemptNumber}</span>
                              <span className="text-[10px] text-muted-foreground">
                                {r.executedAt ? new Date(r.executedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                            <div className="flex items-center gap-2.5">
                              {r.timeSpentSeconds > 0 && (
                                <span className="font-mono text-[10.5px] text-muted-foreground">
                                  ⏱ {formatTimer(r.timeSpentSeconds)}
                                </span>
                              )}
                              <ResultStatusBadge status={r.status} attemptNumber={r.attemptNumber} timeSpentSeconds={r.timeSpentSeconds} />
                            </div>
                          </div>
                          {r.failureReason && (
                            <p className="text-[11px] text-red-400 font-mono bg-red-500/10 p-1.5 rounded border border-red-500/20">
                              {r.failureReason}
                            </p>
                          )}


                          {/* Overridden Variables */}
                          {(() => {
                            const sr = (r.stepResults || r.step_results || {}) as any;
                            const ov = sr._overrideVariables;
                            if (!ov || Object.keys(ov).length === 0) return null;
                            return (
                              <div className="pt-1.5 border-t border-white/5 space-y-1">
                                <span className="text-[10px] font-mono text-muted-foreground">Variable Overrides:</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {Object.entries(ov).map(([k, v]) => (
                                    <span key={k} className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[9.5px] font-mono text-amber-400">
                                      {k}={String(v)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}

                          {/* Iteration Breakdown in History Attempt */}
                          {(() => {
                            const itList = ((r.iterationResults || r.iteration_results) as any[]) || [];
                            if (itList.length === 0) return null;
                            const itPassed = itList.filter((x: any) => x.status?.toLowerCase() === 'pass').length;
                            const itFailed = itList.filter((x: any) => x.status?.toLowerCase() === 'fail').length;
                            const itBlocked = itList.filter((x: any) => x.status?.toLowerCase() === 'blocked').length;

                            return (
                              <div className="pt-1.5 border-t border-white/5 space-y-1">
                                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                                  <span>{itList.length} iterations: {itPassed} passed, {itFailed} failed{itBlocked > 0 ? `, ${itBlocked} blocked` : ''}</span>
                                </div>
                                <div className="space-y-0.5 max-h-32 overflow-y-auto">
                                  {itList.map((it: any, iIdx: number) => {
                                    const itStatus = it.status?.toLowerCase() || 'pending';
                                    const paramsSummary = it.parameters ? Object.entries(it.parameters).slice(0, 2).map(([k, v]) => `${k}:${v}`).join(', ') : '';
                                    return (
                                      <div key={iIdx} className="flex items-center justify-between text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-white/[0.02]">
                                        <span className="truncate">#{it.iteration_index || iIdx + 1} {paramsSummary}</span>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          {it.time_spent_seconds > 0 && (
                                            <span className="text-[9px] text-muted-foreground/60">{formatTimer(it.time_spent_seconds)}</span>
                                          )}
                                          <span className={cn(
                                            "px-1 py-0.2 rounded uppercase font-bold text-[8.5px]",
                                            itStatus === 'pass' && "text-emerald-400 bg-emerald-500/15",
                                            itStatus === 'fail' && "text-red-400 bg-red-500/15",
                                            itStatus === 'blocked' && "text-amber-400 bg-amber-500/15",
                                            itStatus === 'pending' && "text-muted-foreground/60"
                                          )}>
                                            {itStatus}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Section 3: Previous Runs History */}
              <div className="space-y-2 pt-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-[11px] block">
                  Previous Runs History ({previousRunsHistory.length})
                </span>

                {historyLoading ? (
                  <div className="p-6 text-center">
                    <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </div>
                ) : previousRunsHistory.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground/60 italic border border-dashed border-white/5 bg-white/[0.01] rounded-xl space-y-1">
                    <p>No executions in previous runs for this test case.</p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                    {previousRunsHistory.map((h) => {
                      const caseKeyOrId = currentCase?.displayId || currentCase?.id || currentResult.testCaseId;
                      const testCaseUrl = `/p/${slug}/runs/${h.runId}/${caseKeyOrId}`;

                      return (
                        <div key={h.id} className="border border-white/10 rounded-xl p-2.5 bg-background text-xs space-y-1.5 shadow-xs hover:border-white/20 transition-colors">
                          <div className="flex items-center justify-between gap-2">
                            <Link
                              href={testCaseUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-foreground hover:text-primary hover:underline flex items-center gap-1.5 truncate max-w-[280px]"
                              title={`Open test case ${caseKeyOrId} in run ${h.runName} (opens in new tab)`}
                            >
                              <span>{h.runName}</span>
                              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                            </Link>
                            <div className="flex items-center gap-2">
                              {h.timeSpentSeconds > 0 && (
                                <span className="font-mono text-[10.5px] text-muted-foreground">
                                  ⏱ {formatTimer(h.timeSpentSeconds)}
                                </span>
                              )}
                              <ResultStatusBadge status={h.status} attemptNumber={h.attemptNumber} timeSpentSeconds={h.timeSpentSeconds} />
                            </div>
                          </div>
                          {h.failureReason && (
                            <p className="text-[11px] text-red-400 font-mono bg-red-500/10 p-1.5 rounded border border-red-500/20">
                              {h.failureReason}
                            </p>
                          )}

                          {/* Overridden Variables */}
                          {(() => {
                            const sr = (h.stepResults || h.step_results || {}) as any;
                            const ov = sr._overrideVariables;
                            if (!ov || Object.keys(ov).length === 0) return null;
                            return (
                              <div className="pt-1.5 border-t border-white/5 space-y-1">
                                <span className="text-[10px] font-mono text-muted-foreground">Variable Overrides:</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {Object.entries(ov).map(([k, v]) => (
                                    <span key={k} className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-[9.5px] font-mono text-amber-400">
                                      {k}={String(v)}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}

                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>Attempt #{h.attemptNumber}</span>
                            {h.executedAt && <span suppressHydrationWarning>{new Date(h.executedAt).toLocaleDateString()}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Upgraded Raise Defect / Bug Modal */}
      <RaiseDefectModal
        open={showDefectModal}
        onOpenChange={setShowDefectModal}
        runResult={currentResult}
        currentCase={currentCase}
        allSteps={steps}
        stepOrder={defectStepContext.order}
        stepInstruction={defectStepContext.instruction}
        stepExpectedResult={defectStepContext.expectedResult}
        stepNote={
          defectStepContext.order !== undefined
            ? stepResults[defectStepContext.order.toString()]?.note
            : undefined
        }
        initialEvidenceAttachments={defectStepContext.attachments}
        failureNotes={notes || failureReason || undefined}
        buildVersion={run?.buildVersion || run?.build_version}
        projectId={pj?.id || run?.project_id || slug || ''}
        modules={modules}
        currentUser={currentUser}
        iterationIndex={datasetInfo ? activeIterationIdx + 1 : undefined}
        totalIterations={datasetInfo?.rows?.length}
        iterationParameters={activeIterationRow || undefined}
        resolvedEnvironmentUrl={run?.environment ? (environments.find((e: any) => e.name?.toUpperCase() === run.environment?.toUpperCase())?.base_url || undefined) : undefined}
        onAppendStepNote={(targetOrder, extractedText) => {
          const cleanText = extractedText.trim();
          if (!cleanText) return;
          if (targetOrder !== undefined) {
            const key = targetOrder.toString();
            const existing = (stepResults[key]?.note || '').trim();
            if (existing.includes(cleanText)) return;
            const nextNote = existing ? `${existing}\n${cleanText}` : cleanText;
            const nextStepResults = {
              ...stepResults,
              [key]: {
                ...stepResults[key],
                note: nextNote,
              },
            };
            setStepResults(nextStepResults);
            stepResultsRef.current = nextStepResults;
            saveCurrentResult({ stepResults: nextStepResults });
          } else {
            const existing = (notes || '').trim();
            if (existing.includes(cleanText)) return;
            const nextNote = existing ? `${existing}\n${cleanText}` : cleanText;
            setNotes(nextNote);
            saveCurrentResult({ notes: nextNote });
          }
        }}
        onSuccess={async () => {
          setMainTab('test_case');
          await props.refetchResults();
        }}
      />

      {/* View Defect Details Modal */}
      <DefectDetailModal
        open={viewingDefect !== null}
        onOpenChange={(open) => !open && setViewingDefect(null)}
        defect={viewingDefect}
      />

      {/* Keyboard Shortcut Legend Overlay */}
      {showShortcuts && <ShortcutOverlay onClose={() => setShowShortcuts(false)} />}

      {/* Evidence Preview Popup Modal */}
      <Dialog open={!!previewAttachment} onOpenChange={(open) => !open && setPreviewAttachment(null)}>
        <DialogContent hideClose className="max-w-4xl p-4 bg-popover text-popover-foreground border border-border rounded-2xl shadow-2xl">
          {previewAttachment && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 pb-2 border-b border-border/50">
                <div className="min-w-0 flex-1 pr-2">
                  <h4 className="text-sm font-semibold truncate text-foreground" title={previewAttachment.filename}>
                    {previewAttachment.filename}
                  </h4>
                  <p className="text-[11px] text-muted-foreground font-mono">Step Evidence Preview</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <a
                    href={`/api/v1/attachments/${previewAttachment.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-7 px-2.5 rounded-lg border border-border bg-muted hover:bg-muted/80 text-xs font-medium inline-flex items-center gap-1.5 text-foreground transition-colors cursor-pointer"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Open Original</span>
                  </a>
                  <button
                    type="button"
                    onClick={() => setPreviewAttachment(null)}
                    className="h-7 w-7 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors cursor-pointer"
                    title="Close preview"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-center min-h-[300px] max-h-[75vh] overflow-hidden rounded-xl bg-black/50 border border-white/10 p-2">
                {isImageAttachment(previewAttachment.filename) ? (
                  <img
                    src={`/api/v1/attachments/${previewAttachment.id}/download`}
                    alt={previewAttachment.filename}
                    className="max-h-[70vh] w-auto max-w-full object-contain rounded-lg shadow-md"
                  />
                ) : previewAttachment.filename.toLowerCase().endsWith('.pdf') ? (
                  <iframe
                    src={`/api/v1/attachments/${previewAttachment.id}/download`}
                    title={previewAttachment.filename}
                    className="w-full h-[68vh] rounded-lg border-0 bg-white"
                  />
                ) : (
                  <div className="text-center p-8 space-y-3">
                    <FileText className="h-12 w-12 text-muted-foreground mx-auto" />
                    <p className="text-xs text-muted-foreground">{previewAttachment.filename}</p>
                    <a
                      href={`/api/v1/attachments/${previewAttachment.id}/download`}
                      download={previewAttachment.filename}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium cursor-pointer"
                    >
                      Download Attachment
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmation Modal (Remove from run, etc.) */}
      {confirmConfig && (
        <ConfirmModal
          open={confirmConfig.open}
          onOpenChange={(open) => {
            if (!open) setConfirmConfig(null);
          }}
          title={confirmConfig.title}
          description={confirmConfig.description}
          confirmLabel={confirmConfig.confirmLabel}
          variant={confirmConfig.variant || 'default'}
          onConfirm={() => {
            confirmConfig.onConfirm();
            setConfirmConfig(null);
          }}
        />
      )}
    </div>
  );
}

