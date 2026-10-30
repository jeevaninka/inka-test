"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Sparkles, CheckCircle2, Link2, Upload as UploadIcon, X, Tag, FileText, Folder, Layers, Loader2, Terminal, Copy, Plus, AlertCircle, Search, Eye, EyeOff, Image as ImageIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { generateCasesAction, acceptMultipleAiCasesAction } from '@/app/actions/ai';
import { fetchConfluencePageAction, fetchNotionPageAction } from '@/app/actions/integrations';
import { createModuleAction } from '@/app/actions/modules';
import { registerPostmanVariablesAction } from '@/app/actions/variables';
import {
  getProjectRunnerCatalogAction,
  fetchPostmanCollectionRequestsAction,
  fetchDatadogTestDefinitionsAction,
  importExternalTestCasesAction,
  syncTestCaseFromPostmanAction,
  syncTestCaseFromDatadogAction,
} from '@/app/actions/integrations';
import type { PostmanCollectionRequestItem } from '@/lib/integrations/tool-clients';
import {
  buildImportedCaseIndex,
  datadogTestLinkKey,
  postmanFolderLinkKey,
  postmanRequestLinkKey,
  type ImportedCaseRef,
} from '@/lib/integrations/link-keys';
import { buildDatadogPreConditions, buildDatadogSteps } from '@/lib/integrations/datadog-steps';
import { ModuleSelect } from '@/components/common/ModuleSelect';
import { DatadogStepsTable } from '@/components/cases/DatadogStepsTable';
import { PostmanLogo, DatadogLogo } from '@/components/icons/IntegrationLogos';
import { getReusableStepsAction } from '@/app/actions/steps';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { cn, formatVariableName } from '@/lib/utils';
import { logger } from '@/lib/logger.client';
import {
  analyzePostmanFolders,
  buildPostmanImportPlan,
  getPostmanFolderKey,
  type PostmanFolderStrategy,
  type PostmanGroupingMode,
} from '@/lib/integrations/postman-grouping';

const PRIORITY_ENUM_OPTIONS = ['P0', 'P1', 'P2', 'P3'] as const;
const SCENARIO_ENUM_OPTIONS = [
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'edge_case', label: 'Edge Case' },
  { value: 'boundary', label: 'Boundary' },
] as const;

function extractCleanEndpointPath(rawUrl?: string): string {
  if (!rawUrl || !rawUrl.trim()) return '/';
  const clean = rawUrl.trim();
  const stripped = clean
    .replace(/^\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/, '')
    .replace(/^https?:\/\/[^/]+/i, '');
  if (!stripped) return clean;
  return stripped.startsWith('/') ? stripped : `/${stripped}`;
}

function normalizeAssertionText(raw: string): string {
  return String(raw || '')
    .replace(/\bisbelow\b/gi, 'is below')
    .replace(/\bisabove\b/gi, 'is above')
    .replace(/\bisequal\b/gi, 'is equal')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPostmanAssertionsChecklist(assertions?: string[]): string {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    return '✓ Status code is 200\n✓ Valid JSON response body is returned';
  }
  return assertions.map((a) => `✓ ${normalizeAssertionText(a)}`).join('\n');
}

function formatRelativeTime(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 20) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function CacheMeta({
  updatedAt,
  now,
  onRefresh,
  disabled,
}: {
  updatedAt: number | null;
  now: number;
  onRefresh: () => void;
  disabled?: boolean;
}) {
  if (!updatedAt) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-normal text-muted-foreground">
      <span>Updated {formatRelativeTime(updatedAt, now)}</span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onRefresh}
        disabled={disabled}
        className="font-semibold text-primary hover:underline disabled:opacity-50 cursor-pointer"
      >
        Refresh
      </button>
    </span>
  );
}

function buildDatadogCasePreview(test: any): any {
  const publicId = test.public_id;
  const name = test.name || publicId;
  const testType = String(test.type || 'api').toLowerCase() === 'browser' ? 'browser' : 'api';
  const config = test.config || {};
  const steps = buildDatadogSteps(test);

  const baseTags = ['Datadog', 'API Testing'];
  return {
    _internalId: publicId,
    _source: 'datadog',
    _publicId: publicId,
    title: name,
    description: `Automated Datadog Synthetic ${testType} test imported from "${publicId}".`,
    preConditions: buildDatadogPreConditions(test, steps) || 'Datadog Synthetics integration is configured for the target environment.',
    postConditions: undefined,
    priority: 'P1',
    type: 'auto',
    status: 'active',
    scenarioType: 'positive',
    suggestedTags: baseTags,
    moduleId: null,
    customFields: {
      _datadog: {
        publicIds: [publicId],
        linkKey: `datadog:${publicId}`,
        testType,
        executionRule: 'blocking',
        delayMs: 0,
        pollingTimeoutMs: 35000,
        source: 'import',
      },
    },
    aiGenerated: false,
    steps,
  };
}

function buildJourneyCaseTitle(
  folderName: string,
  requests: PostmanCollectionRequestItem[],
  collectionName = 'API Suite'
): string {
  const prefix = (folderName || collectionName).trim();
  if (!Array.isArray(requests) || requests.length === 0) {
    return prefix;
  }
  const shortNames = requests.slice(0, 4).map((r) => {
    let n = r.name.trim();
    n = n.replace(
      new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^-–—:]*[-–—:]\\s*`, 'i'),
      ''
    );
    return n.trim() || r.name.trim();
  });
  const suffix =
    shortNames.join(' / ') + (requests.length > 4 ? ` (+${requests.length - 4} more)` : '');
  return `${prefix} — ${suffix}`;
}

function formatPostmanRequestAsStep(req: PostmanCollectionRequestItem, order: number): Array<{
  order: number;
  description: string;
  step: string;
  expectedResult: string;
  data?: string;
}> {
  const endpointPath = extractCleanEndpointPath(req.url);
  const actionText = `Execute "${req.name}" API request (${req.method} ${endpointPath})`;
  let data = req.bodyPreview && req.bodyPreview.trim() ? req.bodyPreview.trim() : undefined;
  if (data) {
    try {
      data = JSON.stringify(JSON.parse(data), null, 2);
    } catch {
      // keep raw string
    }
  }

  const steps: Array<{
    order: number;
    description: string;
    step: string;
    expectedResult: string;
    data?: string;
  }> = [
    {
      order,
      description: actionText,
      step: actionText,
      expectedResult: '',
      data,
    },
  ];

  // Add one verify step per assertion
  const assertions = req.assertions || [];
  assertions.forEach((assertion, idx) => {
    steps.push({
      order: order + idx + 1,
      description: `Verify: ${assertion}`,
      step: `Verify: ${assertion}`,
      expectedResult: `Check that ${assertion}`,
    });
  });

  return steps;
}

function inferScenarioTypeFromTitle(title: string): 'positive' | 'negative' | 'edge_case' | 'boundary' {
  const lower = String(title || '').toLowerCase();
  if (/\b(invalid|negative|error|unauthorized|forbidden|missing|expired|fail|wrong|bad)\b/.test(lower)) {
    return 'negative';
  }
  if (/\b(boundary|limit|max|min|overflow|zero)\b/.test(lower)) {
    return 'boundary';
  }
  if (/\b(edge|special|duplicate|concurrent|timeout)\b/.test(lower)) {
    return 'edge_case';
  }
  return 'positive';
}

/**
 * Destination suite for Postman/Datadog imports. Imported cases are linked to
 * the chosen suite in import order; "No suite" keeps them unlinked.
 */
function SuiteSelector({
  suites,
  value,
  onChange,
  disabled,
}: {
  suites: Array<{ id: string; name?: string }>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const options = suites.filter((suite) => suite?.id);
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
        <Layers className="h-3.5 w-3.5 text-primary" />
        <span>Suite</span>
        <span className="ml-auto text-[10px] font-normal text-muted-foreground">Optional</span>
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || options.length === 0}
        className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground disabled:opacity-60"
      >
        <option value="">
          {options.length === 0 ? 'No suites in this project' : 'No suite'}
        </option>
        {options.map((suite) => (
          <option key={suite.id} value={suite.id}>
            {suite.name || 'Untitled suite'}
          </option>
        ))}
      </select>
      <p className="text-[10.5px] text-muted-foreground">
        Imported cases are added to this suite in import order.
      </p>
    </div>
  );
}

interface GenerateTestCasesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  initialSourceMode?: 'prompt' | 'postman' | 'datadog' | 'confluence' | 'notion';
  onSuccess?: (createdCases?: any[]) => void;
}

export function GenerateTestCasesDialog({
  open,
  onOpenChange,
  projectId,
  initialSourceMode = 'prompt',
  onSuccess,
}: GenerateTestCasesDialogProps) {
  const { modules, setModules, cases: existingCases, setCases, project, suites } = useProjectData();

  /**
   * Starter prompts built from the project's own feature areas. They give a
   * blank description something concrete to click instead of an empty box.
   */
  const promptSuggestions = useMemo(() => {
    const byCount = new Map<string, number>();
    for (const c of existingCases || []) {
      const key = (c as any).moduleId;
      if (!key) continue;
      byCount.set(key, (byCount.get(key) || 0) + 1);
    }
    const named = (modules || [])
      .filter((m: any) => m?.name)
      .sort(
        (a: any, b: any) =>
          (byCount.get(b.id) || 0) - (byCount.get(a.id) || 0) ||
          String(a.name).localeCompare(String(b.name))
      )
      .slice(0, 5)
      .map((m: any) => ({
        label: m.name,
        template: `Users can complete the main ${m.name} flow end to end. Cover the happy path, validation errors, permission boundaries and empty states.`,
      }));
    if (named.length > 0) return named;
    return [
      { label: 'Authentication', template: 'Users can sign in, sign out and recover a forgotten password.' },
      { label: 'Search', template: 'Users can search, filter and clear results without losing state.' },
      { label: 'Billing', template: 'Users can change plan, apply a coupon and see the invoice update.' },
    ];
  }, [modules, existingCases]);
  const [sourceMode, setSourceMode] = useState<'prompt' | 'postman' | 'datadog' | 'confluence' | 'notion'>(initialSourceMode);
  const [description, setDescription] = useState('');
  const [countMode, setCountMode] = useState<'auto' | 'custom'>('auto');
  const [count, setCount] = useState<number>(5);
  const [moduleId, setModuleId] = useState<string>('auto');
  // Destination suite for Postman/Datadog imports (optional, single-select).
  const [suiteId, setSuiteId] = useState<string>('');
  const [creatingModule, setCreatingModule] = useState(false);
  const [promptMode, setPromptMode] = useState<'auto' | 'custom'>('auto');
  const [customPrompt, setCustomPrompt] = useState('');
  const [showAdvancedPrompt, setShowAdvancedPrompt] = useState(false);
  const [confluenceUrl, setConfluenceUrl] = useState('');
  const [notionUrl, setNotionUrl] = useState('');
  const [fetchingDoc, setFetchingDoc] = useState(false);
  const [files, setFiles] = useState<{name: string, mimeType: string, data: string}[]>([]);
  const [aiCustomTags, setAiCustomTags] = useState('');
  const [aiTicketKey, setAiTicketKey] = useState('');
  const [activeContextSource, setActiveContextSource] = useState<'none' | 'upload' | 'screenshot' | 'confluence' | 'notion'>('none');
  const [isDragging, setIsDragging] = useState(false);
  
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generationStage, setGenerationStage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [generatedCases, setGeneratedCases] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [expandedDatadogPreviews, setExpandedDatadogPreviews] = useState<Set<string>>(new Set());
  const [expandedCurlIds, setExpandedCurlIds] = useState<Set<number>>(new Set());

  const [reusableSteps, setReusableSteps] = useState<any[]>([]);

  // Postman Collection / Folder Generator State
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogUpdatedAt, setCatalogUpdatedAt] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<any>(null);
  const [selectedCollectionUid, setSelectedCollectionUid] = useState('');
  const [selectedFolder, setSelectedFolder] = useState('');
  const [collectionRequests, setCollectionRequests] = useState<PostmanCollectionRequestItem[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [requestsUpdatedAt, setRequestsUpdatedAt] = useState<number | null>(null);
  const [assertionsReady, setAssertionsReady] = useState(true);
  const [selectedRequestOrders, setSelectedRequestOrders] = useState<Set<number>>(new Set());
  const [postmanGroupingMode, setPostmanGroupingMode] = useState<PostmanGroupingMode>('smart');
  const [folderStrategies, setFolderStrategies] = useState<Record<string, PostmanFolderStrategy>>({});
  const [customFlowOrders, setCustomFlowOrders] = useState<number[][]>([]);
  const [showImportedPostman, setShowImportedPostman] = useState(false);
  const [showDetectedVariables, setShowDetectedVariables] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());

  // Datadog Synthetics import state
  const [selectedDatadogTestIds, setSelectedDatadogTestIds] = useState<Set<string>>(new Set());
  const [datadogDefinitions, setDatadogDefinitions] = useState<Map<string, any>>(new Map());
  const [datadogStepStatus, setDatadogStepStatus] = useState<
    Map<string, { state: 'loading' | 'ready' | 'error'; count: number; error?: string }>
  >(new Map());
  const [showImportedDatadog, setShowImportedDatadog] = useState(false);
  const [datadogSearch, setDatadogSearch] = useState('');
  const [datadogTypeFilter, setDatadogTypeFilter] = useState<'all' | 'browser' | 'api'>('all');
  const [resyncingImportKey, setResyncingImportKey] = useState<string | null>(null);

  // Session caches: switching collections/tests is instant; Refresh forces a reload.
  const catalogCacheRef = useRef<Map<string, { data: any; at: number }>>(new Map());
  const requestsCacheRef = useRef<
    Map<string, { items: PostmanCollectionRequestItem[]; at: number }>
  >(new Map());
  const datadogDefinitionCacheRef = useRef<Map<string, any>>(new Map());
  const catalogLoadSeq = useRef(0);
  const requestsLoadSeq = useRef(0);
  const datadogLoadSeq = useRef<Map<string, number>>(new Map());

  // Stable provider-key index of cases that already exist in the repository.
  // Declared before the preview effects so they can filter already-imported items.
  const importedCaseIndex = React.useMemo(
    () => buildImportedCaseIndex(existingCases || []),
    [existingCases]
  );

  const importedPostmanRef = React.useCallback(
    (request: PostmanCollectionRequestItem): ImportedCaseRef | null => {
      const collectionUid = selectedCollectionUid.trim();
      if (!collectionUid) return null;
      if (request.requestId) {
        const byRequest = importedCaseIndex.get(
          postmanRequestLinkKey(collectionUid, request.requestId)
        );
        if (byRequest) return byRequest;
      }
      if (request.folderId) {
        return (
          importedCaseIndex.get(
            postmanFolderLinkKey(collectionUid, request.folderId)
          ) || null
        );
      }
      return null;
    },
    [importedCaseIndex, selectedCollectionUid]
  );

  const importedDatadogRef = React.useCallback(
    (publicId: string): ImportedCaseRef | null =>
      importedCaseIndex.get(datadogTestLinkKey(publicId)) || null,
    [importedCaseIndex]
  );

  const datadogTestRows = React.useMemo(
    () =>
      (catalog?.datadog?.tests || []).map((test: any) => ({
        test,
        importedRef: importedDatadogRef(String(test.public_id || '')),
      })),
    [catalog, importedDatadogRef]
  );
  const filteredDatadogTestRows = React.useMemo(() => {
    const query = datadogSearch.trim().toLowerCase();
    return datadogTestRows.filter(({ test }: any) => {
      const type =
        String(test.type || 'api').toLowerCase() === 'browser' ? 'browser' : 'api';
      if (datadogTypeFilter !== 'all' && type !== datadogTypeFilter) return false;
      if (!query) return true;
      return `${test.name || ''} ${test.public_id || ''}`.toLowerCase().includes(query);
    });
  }, [datadogTestRows, datadogSearch, datadogTypeFilter]);
  const newDatadogTestRows = React.useMemo(
    () => filteredDatadogTestRows.filter((row: any) => !row.importedRef),
    [filteredDatadogTestRows]
  );
  const importedDatadogTestRows = React.useMemo(
    () => filteredDatadogTestRows.filter((row: any) => Boolean(row.importedRef)),
    [filteredDatadogTestRows]
  );
  const displayedDatadogTestRows = React.useMemo(
    () => (showImportedDatadog ? filteredDatadogTestRows : newDatadogTestRows),
    [showImportedDatadog, filteredDatadogTestRows, newDatadogTestRows]
  );
  const selectableDisplayedDatadogRows = React.useMemo(
    () => displayedDatadogTestRows.filter((row: any) => !row.importedRef),
    [displayedDatadogTestRows]
  );
  const allDisplayedDatadogSelected = React.useMemo(
    () =>
      selectableDisplayedDatadogRows.length > 0 &&
      selectableDisplayedDatadogRows.every((row: any) =>
        selectedDatadogTestIds.has(row.test.public_id)
      ),
    [selectableDisplayedDatadogRows, selectedDatadogTestIds]
  );
  const loadingSelectedDatadogSteps = React.useMemo(
    () =>
      Array.from(selectedDatadogTestIds).some(
        (publicId) => datadogStepStatus.get(publicId)?.state === 'loading'
      ),
    [selectedDatadogTestIds, datadogStepStatus]
  );

  useEffect(() => {
    if (open) {
      setSourceMode(initialSourceMode);
      setActiveContextSource(
        initialSourceMode === 'confluence' || initialSourceMode === 'notion' ? initialSourceMode : 'none'
      );
      setAiCustomTags(initialSourceMode === 'postman' ? 'Postman, API Testing' : '');
      loadReusableSteps();
    } else {
      resetState();
    }
  }, [open, initialSourceMode]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [open]);

  const loadCatalog = useCallback(
    async (force = false) => {
      if (!projectId) return;

      if (!force) {
        const cached = catalogCacheRef.current.get(projectId);
        if (cached) {
          setCatalog(cached.data);
          setCatalogUpdatedAt(cached.at);
          setCatalogError(null);
          setLoadingCatalog(false);
          return;
        }
      }

      const seq = ++catalogLoadSeq.current;
      setLoadingCatalog(true);
      setCatalogError(null);
      try {
        const res = await getProjectRunnerCatalogAction(projectId);
        if (catalogLoadSeq.current !== seq) return;
        catalogCacheRef.current.set(projectId, { data: res, at: Date.now() });
        setCatalog(res);
        setCatalogUpdatedAt(Date.now());
      } catch (error: any) {
        if (catalogLoadSeq.current === seq) {
          setCatalogError(error?.message || 'Could not load integrations.');
        }
      } finally {
        if (catalogLoadSeq.current === seq) setLoadingCatalog(false);
      }
    },
    [projectId]
  );

  const applyPostmanRequests = useCallback((list: PostmanCollectionRequestItem[]) => {
    setCollectionRequests(list);
    setSelectedRequestOrders(new Set(list.map((item) => item.order)));
    setFolderStrategies({});
    setCustomFlowOrders([]);
  }, []);

  const loadPostmanRequests = useCallback(
    async (force = false) => {
      const collectionUid = selectedCollectionUid.trim();
      if (!projectId || !collectionUid) return;
      const cacheKey = `${projectId}:${collectionUid}`;

      if (!force) {
        const cached = requestsCacheRef.current.get(cacheKey);
        if (cached) {
          applyPostmanRequests(cached.items);
          setRequestsUpdatedAt(cached.at);
          setRequestsError(null);
          setLoadingRequests(false);
          return;
        }
      }

      const seq = ++requestsLoadSeq.current;
      setLoadingRequests(true);
      setRequestsError(null);
      setAssertionsReady(false);
      try {
        const items = await fetchPostmanCollectionRequestsAction(projectId, collectionUid);
        if (requestsLoadSeq.current !== seq) return;
        const list = items || [];
        requestsCacheRef.current.set(cacheKey, { items: list, at: Date.now() });
        applyPostmanRequests(list);
        setRequestsUpdatedAt(Date.now());
      } catch (error: any) {
        if (requestsLoadSeq.current === seq) {
          // Keep the selected collection/folder and cached rows so Retry can
          // resume without rebuilding the form.
          setRequestsError(error?.message || 'Could not read this Postman collection.');
        }
      } finally {
        if (requestsLoadSeq.current === seq) setLoadingRequests(false);
      }
    },
    [projectId, selectedCollectionUid, applyPostmanRequests]
  );

  const loadDatadogSteps = useCallback(
    async (publicId: string, force = false) => {
      if (!projectId || !publicId) return;
      const cacheKey = `${projectId}:${publicId}`;

      if (!force) {
        const cached = datadogDefinitionCacheRef.current.get(cacheKey);
        if (cached) {
          setDatadogDefinitions((prev) => new Map(prev).set(publicId, cached));
          setDatadogStepStatus((prev) =>
            new Map(prev).set(publicId, {
              state: 'ready',
              count: buildDatadogSteps(cached).length,
            })
          );
          return;
        }
      }

      const seq = (datadogLoadSeq.current.get(publicId) || 0) + 1;
      datadogLoadSeq.current.set(publicId, seq);
      setDatadogStepStatus((prev) =>
        new Map(prev).set(publicId, { state: 'loading', count: 0 })
      );
      try {
        const definitions = await fetchDatadogTestDefinitionsAction({
          projectId,
          publicIds: [publicId],
        });
        if (datadogLoadSeq.current.get(publicId) !== seq) return;
        const definition =
          definitions.find((item) => item.public_id === publicId) || definitions[0];
        if (!definition) throw new Error('Could not read this Datadog test definition.');
        datadogDefinitionCacheRef.current.set(cacheKey, definition);
        setDatadogDefinitions((prev) => new Map(prev).set(publicId, definition));
        setDatadogStepStatus((prev) =>
          new Map(prev).set(publicId, {
            state: 'ready',
            count: buildDatadogSteps(definition).length,
          })
        );
      } catch (error: any) {
        if (datadogLoadSeq.current.get(publicId) === seq) {
          setDatadogStepStatus((prev) =>
            new Map(prev).set(publicId, {
              state: 'error',
              count: 0,
              error: error?.message || 'Could not read steps.',
            })
          );
        }
      }
    },
    [projectId]
  );

  const toggleDatadogTest = (publicId: string) => {
    if (importedDatadogRef(publicId)) return;
    const willSelect = !selectedDatadogTestIds.has(publicId);
    setSelectedDatadogTestIds((prev) => {
      const next = new Set(prev);
      if (willSelect) next.add(publicId);
      else next.delete(publicId);
      return next;
    });
    if (willSelect) void loadDatadogSteps(publicId);
  };

  const toggleAllDisplayedDatadogTests = () => {
    const rows = selectableDisplayedDatadogRows;
    if (rows.length === 0) return;
    const shouldSelect = !allDisplayedDatadogSelected;
    const ids = rows.map((row: any) => String(row.test.public_id));
    const toLoad = shouldSelect
      ? ids.filter((publicId: string) => !selectedDatadogTestIds.has(publicId))
      : [];

    setSelectedDatadogTestIds((prev) => {
      const next = new Set(prev);
      for (const publicId of ids) {
        if (shouldSelect) next.add(publicId);
        else next.delete(publicId);
      }
      return next;
    });

    for (const publicId of toLoad) void loadDatadogSteps(publicId);
  };

  useEffect(() => {
    if (!open || (sourceMode !== 'postman' && sourceMode !== 'datadog') || !projectId) return;
    void loadCatalog();
    return () => {
      catalogLoadSeq.current += 1;
    };
  }, [open, sourceMode, projectId, loadCatalog]);

  // Build the Datadog preview from whichever selected tests already have steps.
  useEffect(() => {
    if (!open || sourceMode !== 'datadog') return;
    const cases: any[] = [];
    for (const publicId of Array.from(selectedDatadogTestIds)) {
      if (importedDatadogRef(publicId)) continue;
      const definition = datadogDefinitions.get(publicId);
      if (definition) cases.push(buildDatadogCasePreview(definition));
    }
    setGeneratedCases(cases);
    setSelectedIds(new Set(cases.map((_, index) => index)));
  }, [open, sourceMode, selectedDatadogTestIds, datadogDefinitions, importedDatadogRef]);

  useEffect(() => {
    if (!open || sourceMode !== 'postman') return;
    if (!selectedCollectionUid.trim() || !projectId) {
      setCollectionRequests([]);
      setGeneratedCases([]);
      setSelectedIds(new Set());
      setLoadingRequests(false);
      setRequestsError(null);
      setRequestsUpdatedAt(null);
      setAssertionsReady(true);
      return;
    }
    void loadPostmanRequests();
    return () => {
      requestsLoadSeq.current += 1;
    };
  }, [open, sourceMode, selectedCollectionUid, projectId, loadPostmanRequests]);

  // Folder counts/rows render first, assertions fill in on the next tick.
  useEffect(() => {
    if (collectionRequests.length === 0) {
      setAssertionsReady(true);
      return;
    }
    setAssertionsReady(false);
    const timer = window.setTimeout(() => setAssertionsReady(true), 180);
    return () => window.clearTimeout(timer);
  }, [collectionRequests]);

  // Support pasting screenshots from clipboard (Cmd+V / Ctrl+V)
  useEffect(() => {
    if (!open) return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = (event) => {
              const result = event.target?.result as string;
              const base64Data = result.split(',')[1];
              const name = `screenshot-${Date.now().toString().slice(-4)}.png`;
              setFiles((prev) => [
                ...prev,
                { name, mimeType: blob.type || 'image/png', data: base64Data },
              ]);
              toast.info('Screenshot attached from clipboard');
            };
            reader.readAsDataURL(blob);
          }
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [open]);

  const loadReusableSteps = async () => {
    try {
      const steps = await getReusableStepsAction(projectId);
      setReusableSteps(steps);
    } catch (e) {
      logger.error('Failed to load reusable steps', {
        component: 'GenerateTestCasesDialog',
        action: 'loadReusableSteps',
        projectId,
        error: e,
      });
    }
  };

  const resetState = () => {
    setDescription('');
    setCountMode('auto');
    setCount(5);
    setModuleId('auto');
    setSuiteId('');
    setPromptMode('auto');
    setCustomPrompt('');
    setShowAdvancedPrompt(false);
    setFiles([]);
    setAiCustomTags('');
    setAiTicketKey('');
    setActiveContextSource('none');
    setIsDragging(false);
    setGeneratedCases([]);
    setSelectedIds(new Set());
    setExpandedIds(new Set());
    setIsGenerating(false);
    setProgress(0);
    setGenerationStage('');
    setIsSaving(false);
    setSelectedCollectionUid('');
    setSelectedFolder('');
    setCollectionRequests([]);
    setSelectedRequestOrders(new Set());
    setPostmanGroupingMode('smart');
    setFolderStrategies({});
    setCustomFlowOrders([]);
    setShowImportedPostman(false);
    setShowDetectedVariables(false);
    setLoadingRequests(false);
    setRequestsError(null);
    setRequestsUpdatedAt(null);
    setAssertionsReady(true);
    setSelectedDatadogTestIds(new Set());
    setDatadogDefinitions(new Map());
    setDatadogStepStatus(new Map());
    setShowImportedDatadog(false);
    setDatadogSearch('');
    setDatadogTypeFilter('all');
    setResyncingImportKey(null);
    setExpandedCurlIds(new Set());
    setLoadingCatalog(false);
    setCatalogError(null);
    // Ignore any in-flight loads that finish after the dialog closes.
    catalogLoadSeq.current += 1;
    requestsLoadSeq.current += 1;
    for (const [publicId, seq] of datadogLoadSeq.current) {
      datadogLoadSeq.current.set(publicId, seq + 1);
    }
  };

  const handleCreateModuleInline = async (name?: string): Promise<string | null> => {
    const rawName = (name ?? '').trim();
    if (!rawName || !projectId) return null;
    setCreatingModule(true);
    try {
      const created = await createModuleAction({
        projectId,
        name: rawName,
      });
      if (setModules) {
        setModules([...(modules || []), created]);
      }
      setModuleId(created.id);
      setGeneratedCases((prev) => prev.map((c) => ({ ...c, moduleId: created.id })));
      toast.success(`Created module "${created.name}"`);
      return created.id;
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create module');
      return null;
    } finally {
      setCreatingModule(false);
    }
  };

  const discoveredFolders = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of collectionRequests) {
      if (r.folderPath && r.folderPath.trim()) {
        set.add(r.folderPath.trim());
      }
    }
    return Array.from(set);
  }, [collectionRequests]);

  const visiblePostmanRequests = React.useMemo(() => {
    if (!selectedFolder.trim()) return collectionRequests;
    const q = selectedFolder.trim().toLowerCase();
    return collectionRequests.filter((r) => {
      const fullPath = r.folderPath ? `${r.folderPath} / ${r.name}` : r.name;
      return (
        r.folderPath.toLowerCase() === q ||
        r.folderPath.toLowerCase().includes(q) ||
        fullPath.toLowerCase().includes(q)
      );
    });
  }, [collectionRequests, selectedFolder]);

  const visiblePostmanRows = React.useMemo(
    () =>
      visiblePostmanRequests.map((request) => ({
        request,
        importedRef: importedPostmanRef(request),
      })),
    [visiblePostmanRequests, importedPostmanRef]
  );

  const visiblePostmanNew = React.useMemo(
    () => visiblePostmanRows.filter((row) => !row.importedRef),
    [visiblePostmanRows]
  );
  const visiblePostmanImported = React.useMemo(
    () => visiblePostmanRows.filter((row) => Boolean(row.importedRef)),
    [visiblePostmanRows]
  );
  const selectedPostmanNewCount = React.useMemo(
    () =>
      visiblePostmanNew.filter((row) => selectedRequestOrders.has(row.request.order))
        .length,
    [visiblePostmanNew, selectedRequestOrders]
  );

  const handleFolderSelect = (folderVal: string) => {
    setSelectedFolder(folderVal);
    setFolderStrategies({});
    setCustomFlowOrders([]);
    const matchingItems = !folderVal.trim()
      ? collectionRequests
      : collectionRequests.filter((r) => {
          const q = folderVal.trim().toLowerCase();
          const fullPath = r.folderPath ? `${r.folderPath} / ${r.name}` : r.name;
          return (
            r.folderPath.toLowerCase() === q ||
            r.folderPath.toLowerCase().includes(q) ||
            fullPath.toLowerCase().includes(q)
          );
        });
    setSelectedRequestOrders(
      new Set(matchingItems.filter((r) => !importedPostmanRef(r)).map((r) => r.order))
    );
  };

  // Already-imported requests can never be selected, even if selection state is stale.
  useEffect(() => {
    setSelectedRequestOrders((prev) => {
      const allowed = new Set(
        visiblePostmanRequests.filter((r) => !importedPostmanRef(r)).map((r) => r.order)
      );
      let changed = false;
      const next = new Set<number>();
      for (const order of prev) {
        if (allowed.has(order)) next.add(order);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visiblePostmanRequests, importedPostmanRef]);

  const detectedPostmanVariables = React.useMemo(() => {
    const vars = new Set<string>();
    const activeReqs = visiblePostmanRequests.filter(
      (r) => selectedRequestOrders.has(r.order) && !importedPostmanRef(r)
    );
    for (const req of activeReqs) {
      for (const v of req.requiredVariables || []) {
        vars.add(v);
      }
      const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
      for (const text of [req.url, req.bodyPreview]) {
        if (!text) continue;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          if (m[1] && !m[1].startsWith('$')) vars.add(m[1].trim());
        }
      }
    }
    return Array.from(vars);
  }, [visiblePostmanRequests, selectedRequestOrders, importedPostmanRef]);

  const handleTogglePostmanRequest = (order: number) => {
    setSelectedRequestOrders((prev) => {
      const next = new Set(prev);
      if (next.has(order)) next.delete(order);
      else next.add(order);
      return next;
    });
  };

  const eligibleSelectedOrders = React.useMemo(() => {
    const eligible = new Set<number>();
    for (const row of visiblePostmanRows) {
      if (!row.importedRef && selectedRequestOrders.has(row.request.order)) {
        eligible.add(row.request.order);
      }
    }
    return eligible;
  }, [visiblePostmanRows, selectedRequestOrders]);

  const postmanPlan = React.useMemo(
    () =>
      buildPostmanImportPlan({
        allRequests: visiblePostmanRequests,
        selectedOrders: eligibleSelectedOrders,
        mode: postmanGroupingMode,
        folderOverrides: folderStrategies,
        customGroups: customFlowOrders,
      }),
    [
      visiblePostmanRequests,
      eligibleSelectedOrders,
      postmanGroupingMode,
      folderStrategies,
      customFlowOrders,
    ]
  );

  const postmanFolderMeta = React.useMemo(() => {
    const map = new Map<
      string,
      {
        rows: Array<{ request: PostmanCollectionRequestItem; importedRef: ImportedCaseRef | null }>;
        importedCount: number;
        newCount: number;
        state: 'none' | 'partial' | 'all';
      }
    >();
    for (const folder of postmanPlan.folders) {
      const rows = folder.requests.map((request) => ({
        request,
        importedRef: importedPostmanRef(request),
      }));
      const importedCount = rows.filter((row) => Boolean(row.importedRef)).length;
      map.set(folder.key, {
        rows,
        importedCount,
        newCount: rows.length - importedCount,
        state:
          importedCount === 0
            ? 'none'
            : importedCount === rows.length
              ? 'all'
              : 'partial',
      });
    }
    return map;
  }, [postmanPlan.folders, importedPostmanRef]);

  const postmanGroupByOrder = React.useMemo(() => {
    const map = new Map<number, (typeof postmanPlan.groups)[number]>();
    for (const group of postmanPlan.groups) {
      for (const request of group.requests) map.set(request.order, group);
    }
    return map;
  }, [postmanPlan.groups]);

  const selectedPostmanCollectionName = React.useMemo(() => {
    const collection = catalog?.postman?.collections?.find(
      (item: any) =>
        item.uid === selectedCollectionUid || item.id === selectedCollectionUid
    );
    return collection?.name || 'Collection tree';
  }, [catalog, selectedCollectionUid]);

  const selectedNewOrderList = React.useMemo(
    () =>
      Array.from(selectedRequestOrders).filter((order) =>
        visiblePostmanRows.some(
          (row) => row.request.order === order && !row.importedRef
        )
      ),
    [selectedRequestOrders, visiblePostmanRows]
  );

  const selectedOrdersInCustomFlow = React.useMemo(
    () =>
      selectedNewOrderList.some((order) =>
        customFlowOrders.some((group) => group.includes(order))
      ),
    [selectedNewOrderList, customFlowOrders]
  );

  const handleGroupSelectedAsFlow = () => {
    const orders = [...selectedNewOrderList].sort((a, b) => a - b);
    if (orders.length < 2) {
      toast.error('Select at least two requests to group as a flow.');
      return;
    }
    setCustomFlowOrders((prev) => {
      const remaining = prev
        .map((group) => group.filter((order) => !orders.includes(order)))
        .filter((group) => group.length >= 2);
      return [...remaining, orders];
    });
  };

  const handleUngroupSelected = () => {
    const orders = new Set(selectedNewOrderList);
    setCustomFlowOrders((prev) =>
      prev
        .map((group) => group.filter((order) => !orders.has(order)))
        .filter((group) => group.length >= 2)
    );
  };

  const removeCustomFlow = (requests: PostmanCollectionRequestItem[]) => {
    const orders = new Set(requests.map((request) => request.order));
    setCustomFlowOrders((prev) =>
      prev
        .map((group) => group.filter((order) => !orders.has(order)))
        .filter((group) => group.length >= 2)
    );
  };

  const selectedPostmanGroups = React.useMemo(
    () => postmanPlan.groups.filter((_, index) => selectedIds.has(index)),
    [postmanPlan.groups, selectedIds]
  );
  const selectedPostmanSummary = React.useMemo(() => {
    const flows = selectedPostmanGroups.filter((group) => group.kind === 'flow');
    const individuals = selectedPostmanGroups.filter(
      (group) => group.kind === 'individual'
    );
    return {
      cases: selectedPostmanGroups.length,
      flows: flows.length,
      flowRequests: flows.reduce((sum, group) => sum + group.requests.length, 0),
      individuals: individuals.length,
    };
  }, [selectedPostmanGroups]);
  const postmanSummaryText =
    selectedPostmanSummary.cases === 0
      ? 'Select requests to import.'
      : `Will create ${selectedPostmanSummary.cases} case${selectedPostmanSummary.cases === 1 ? '' : 's'}: ` +
        `${selectedPostmanSummary.flows} flow${selectedPostmanSummary.flows === 1 ? '' : 's'} ` +
        `(${selectedPostmanSummary.flowRequests} request${selectedPostmanSummary.flowRequests === 1 ? '' : 's'}) ` +
        `+ ${selectedPostmanSummary.individuals} individual`;

  // Live reactive preview for Postman mode — no intermediate "Generate" button required.
  useEffect(() => {
    if (sourceMode !== 'postman') return;
    if (!selectedCollectionUid.trim()) {
      setGeneratedCases([]);
      setSelectedIds(new Set());
      return;
    }
    if (postmanPlan.groups.length === 0) {
      setGeneratedCases([]);
      setSelectedIds(new Set());
      return;
    }

    const selectedCollectionObj = catalog?.postman?.collections?.find(
      (c: any) => c.uid === selectedCollectionUid || c.id === selectedCollectionUid
    );
    const collectionName = selectedCollectionObj?.name || 'Postman Collection';

    const resolveModuleForLabel = (label: string): string | null => {
      if (moduleId !== 'auto') return moduleId || null;
      if (modules.length === 0) return null;
      const labelLower = label.toLowerCase();
      const colLower = collectionName.toLowerCase();
      const matchedMod =
        modules.find((m: any) => labelLower.includes(String(m.name || '').toLowerCase())) ||
        modules.find((m: any) => String(m.name || '').toLowerCase().includes(labelLower)) ||
        modules.find((m: any) => colLower.includes(String(m.name || '').toLowerCase()));
      return matchedMod?.id || null;
    };

    const basePostmanConfig = {
      collectionUid: selectedCollectionUid.trim(),
      collectionName,
      delayMs: catalog?.postman?.defaultDelayMs ?? 0,
      timeoutMs: catalog?.postman?.defaultTimeoutMs ?? 15000,
      bailOnFailure: Boolean(catalog?.postman?.bailOnFailure ?? true),
      persistResponses: true,
      turnOffLogs: false,
      keepVariableValues: true,
      ignoreCookies: false,
      saveCookies: true,
    };

    const collectVariables = (requests: PostmanCollectionRequestItem[]) => {
      const vars = new Set<string>();
      for (const req of requests) {
        for (const v of req.requiredVariables || []) vars.add(v);
        const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
        for (const text of [req.url, req.bodyPreview]) {
          if (!text) continue;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
            if (m[1] && !m[1].startsWith('$')) vars.add(m[1].trim());
          }
        }
      }
      return Array.from(vars);
    };

    const cases = postmanPlan.groups.map((group, groupIndex) => {
      if (group.kind === 'flow') {
        const steps = group.requests.flatMap((req, index) =>
          formatPostmanRequestAsStep(req, index + 1)
        );
        const requestIds = group.requests
          .map((request) => request.requestId)
          .filter((id): id is string => Boolean(id));
        const folderPaths = Array.from(
          new Set(group.requests.map((request) => request.folderPath).filter(Boolean))
        );
        const combinedCurls = group.requests
          .map((r, i) => (r.curlCommand ? `# Step ${i + 1}: ${r.name}\n${r.curlCommand}` : ''))
          .filter(Boolean)
          .join('\n\n');
        const flowTitle = buildJourneyCaseTitle(
          group.label,
          group.requests,
          collectionName
        );

        return {
          _internalId: groupIndex,
          title: flowTitle,
          description: `Validates the "${group.label}" API flow (${group.requests.length} step${group.requests.length === 1 ? '' : 's'}).`,
          preConditions: `Environment variables and API credentials are configured for the target environment.`,
          postConditions: undefined,
          priority: 'P1',
          type: 'auto',
          status: 'active',
          scenarioType: 'positive',
          suggestedTags: Array.from(
            new Set(['Postman', 'API Testing', ...folderPaths])
          ),
          moduleId: resolveModuleForLabel(group.label),
          customFields: {
            _postman: {
              ...basePostmanConfig,
              // Keep the exact label used for the title so re-sync reproduces it.
              folderOrRequestFilter: group.label,
              selectedRequestOrders: group.requests.map((request) => request.order),
              requestIds,
              // Only a full-folder flow may claim the folder key.
              folderId: group.folderId,
              linkKey: group.folderId
                ? postmanFolderLinkKey(selectedCollectionUid.trim(), group.folderId)
                : requestIds.length > 0
                  ? `postman:${selectedCollectionUid.trim()}:flow:${[...requestIds].sort().join(',')}`
                  : undefined,
              curlCommand: combinedCurls || undefined,
              requiredVariables: collectVariables(group.requests),
              requestSpec: group.requests[0]?.requestSpec,
              requestSpecs: group.requests
                .map((request) => request.requestSpec)
                .filter(Boolean),
            },
          },
          aiGenerated: false,
          steps,
        };
      }

      const req = group.requests[0];
      const cleanPath = extractCleanEndpointPath(req.url);
      return {
        _internalId: groupIndex,
        title: req.name,
        description:
          req.description ||
          `Validates "${req.name}" via ${req.method} ${cleanPath}.`,
        preConditions: `Environment variables and API credentials are configured for the target environment.`,
        postConditions: undefined,
        priority: 'P1',
        type: 'auto',
        status: 'active',
        scenarioType: inferScenarioTypeFromTitle(req.name),
        suggestedTags: Array.from(
          new Set([
            'Postman',
            'API Testing',
            ...(req.folderPath ? [req.folderPath] : selectedFolder ? [selectedFolder] : []),
          ])
        ),
        moduleId: resolveModuleForLabel(req.folderPath || collectionName),
        customFields: {
          _postman: {
            ...basePostmanConfig,
            folderOrRequestFilter: req.folderPath || '',
            selectedRequestOrders: [req.order],
            // Stable request link key — never the array position.
            requestId: req.requestId,
            requestIds: req.requestId ? [req.requestId] : undefined,
            folderId: req.folderId,
            linkKey: req.requestId
              ? postmanRequestLinkKey(selectedCollectionUid.trim(), req.requestId)
              : undefined,
            curlCommand: req.curlCommand || undefined,
            requiredVariables: req.requiredVariables || [],
            requestSpec: req.requestSpec,
            requestSpecs: req.requestSpec ? [req.requestSpec] : [],
          },
        },
        aiGenerated: false,
        steps: formatPostmanRequestAsStep(req, 1),
      };
    });

    setGeneratedCases(cases);
    setSelectedIds(new Set(cases.map((_, index) => index)));
    setExpandedIds(new Set(cases.length > 0 ? [0] : []));
  }, [
    sourceMode,
    selectedCollectionUid,
    selectedFolder,
    postmanPlan,
    moduleId,
    modules,
    catalog,
  ]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    const newFiles: {name: string, mimeType: string, data: string}[] = [];
    
    Array.from(selectedFiles).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        // Result is like: data:application/pdf;base64,JVBERi0xL...
        const base64Data = result.split(',')[1];
        newFiles.push({
          name: file.name,
          mimeType: file.type || 'text/plain',
          data: base64Data
        });
        
        if (newFiles.length === selectedFiles.length) {
          setFiles(prev => [...prev, ...newFiles]);
        }
      };
      reader.readAsDataURL(file);
    });
    
    // Clear input so same file can be selected again if needed
    e.target.value = '';
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleGenerate = async () => {
    if (!description.trim() && files.length === 0) {
      toast.error('Please describe the feature or attach a document.');
      return;
    }

    setIsGenerating(true);
    setProgress(8);
    setGenerationStage('Analyzing feature description & context...');

    const startTime = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed < 1800) {
        const p = Math.min(28, 8 + (elapsed / 1800) * 20);
        setProgress(p);
        setGenerationStage('Analyzing feature description & context...');
      } else if (elapsed < 4200) {
        const p = Math.min(58, 28 + ((elapsed - 1800) / 2400) * 30);
        setProgress(p);
        setGenerationStage('Synthesizing test scenarios & edge cases...');
      } else if (elapsed < 7000) {
        const p = Math.min(82, 58 + ((elapsed - 4200) / 2800) * 24);
        setProgress(p);
        setGenerationStage('Structuring step-by-step actions & results...');
      } else {
        const p = Math.min(94, 82 + ((elapsed - 7000) / 4000) * 12);
        setProgress(p);
        setGenerationStage('Matching reusable steps & modules...');
      }
    }, 100);

    try {
      const cases = await generateCasesAction({
        projectId,
        description,
        count: countMode === 'auto' ? 'auto' : count,
        moduleId: moduleId === 'auto' ? undefined : moduleId,
        customInstructions:
          promptMode === 'custom' && customPrompt.trim()
            ? customPrompt.trim()
            : undefined,
        reusableSteps: reusableSteps.map(r => ({ id: r.id, title: r.title, step: r.step, expected_result: r.expected_result })),
        projectModules: modules,
        files: files.length > 0 ? files : undefined
      });
      
      clearInterval(timer);
      setProgress(100);
      setGenerationStage('Test cases generated successfully!');

      const casesWithMeta = cases.map((c: any, i: number) => ({
        ...c,
        _internalId: i,
        moduleId: moduleId !== 'auto' ? moduleId : (c.moduleId || null)
      }));

      await new Promise((resolve) => setTimeout(resolve, 350));

      setGeneratedCases(casesWithMeta);
      setSelectedIds(new Set(casesWithMeta.map((_, i) => i)));
      toast.success(`Generated ${cases.length} test cases successfully.`);
    } catch (error: any) {
      clearInterval(timer);
      setProgress(0);
      setGenerationStage('');
      toast.error(error.message || 'Failed to generate test cases.');
    } finally {
      clearInterval(timer);
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (selectedIds.size === 0) return;
    setIsSaving(true);
    try {
      const customTagsList = aiCustomTags.split(',').map((t) => t.trim()).filter(Boolean);
      const ticketTag = aiTicketKey.trim() ? [`ticket:${aiTicketKey.trim().toUpperCase()}`, aiTicketKey.trim().toUpperCase()] : [];

      const selectedGenerated = generatedCases.filter((_c, i) => selectedIds.has(i));
      if (selectedGenerated.length === 0) {
        setIsSaving(false);
        return;
      }

      const normalizedCases = selectedGenerated.map((c) => {
        const normPrio = ['P0', 'P1', 'P2', 'P3'].includes(String(c.priority || '').toUpperCase())
          ? String(c.priority).toUpperCase()
          : 'P1';
        const normScenario = ['positive', 'negative', 'edge_case', 'boundary'].includes(
          String(c.scenarioType || '').toLowerCase()
        )
          ? String(c.scenarioType).toLowerCase()
          : 'positive';
        return {
          ...c,
          priority: normPrio,
          scenarioType: normScenario,
          moduleId:
            moduleId && moduleId !== 'auto'
              ? moduleId
              : c.moduleId && c.moduleId !== 'auto'
                ? c.moduleId
                : null,
          suggestedTags: Array.from(
            new Set([...(c.suggestedTags || []), ...customTagsList, ...ticketTag])
          ),
        };
      });

      let savedCases: any[] = [];
      let skippedCount = 0;

      if (sourceMode === 'prompt') {
        // AI generation uses the AI importer so suggestions are recorded.
        const saved = await acceptMultipleAiCasesAction({
          projectId,
          cases: normalizedCases,
        });
        savedCases = Array.isArray(saved) ? saved : [];
      } else {
        // Postman / Datadog imports are idempotent server-side: already-linked
        // provider keys are skipped and reported, never duplicated.
        const result = await importExternalTestCasesAction({
          projectId,
          cases: normalizedCases,
          suiteId: suiteId || undefined,
        });
        savedCases = result.created;
        skippedCount = result.skipped.length;
      }

      if (sourceMode === 'postman' && detectedPostmanVariables.length > 0) {
        const selectedCollectionObj = catalog?.postman?.collections?.find(
          (c: any) => c.uid === selectedCollectionUid || c.id === selectedCollectionUid
        );
        await registerPostmanVariablesAction({
          projectId,
          keys: detectedPostmanVariables,
          collectionName: selectedCollectionObj?.name,
        }).catch(() => {});
      }
      if (setCases && Array.isArray(savedCases) && savedCases.length > 0) {
        setCases([...savedCases, ...(existingCases || [])]);
      }
      if (savedCases.length === 0) {
        toast.info(`0 created, ${skippedCount} skipped (already imported).`);
        setIsSaving(false);
        return;
      }
      if (skippedCount > 0) {
        toast.info(
          `${savedCases.length} created, ${skippedCount} skipped (already imported).`
        );
      } else {
        const statusLabel = savedCases.some((c) => c.status === 'active') ? 'Active' : 'Draft';
        toast.success(`Added ${savedCases.length} test case(s) to Repository as ${statusLabel}.`);
      }
      if (onSuccess) onSuccess(savedCases);
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error.message || 'Failed to save test cases.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResyncImported = async (
    provider: 'postman' | 'datadog',
    ref: ImportedCaseRef
  ) => {
    if (!ref.caseId) return;
    const key = `${provider}:${ref.caseId}`;
    setResyncingImportKey(key);
    try {
      if (provider === 'datadog') {
        await syncTestCaseFromDatadogAction({ projectId, testCaseId: ref.caseId });
      } else {
        await syncTestCaseFromPostmanAction({ projectId, testCaseId: ref.caseId });
      }
      toast.success(`Re-synced ${ref.displayId || ref.title}.`);
    } catch (error: any) {
      toast.error(error?.message || 'Could not re-sync this test case.');
    } finally {
      setResyncingImportKey(null);
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set(generatedCases.map((_, i) => i)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const toggleSelect = (id: number, checked: boolean) => {
    const newSet = new Set(selectedIds);
    if (checked) newSet.add(id);
    else newSet.delete(id);
    setSelectedIds(newSet);
  };

  const toggleExpand = (id: number) => {
    const newSet = new Set(expandedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setExpandedIds(newSet);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[680px] max-h-[90vh] !flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border/60">
          {sourceMode === 'postman' ? (
            <>
              <DialogTitle className="flex items-center gap-2 text-base">
                <PostmanLogo className="h-4 w-4 shrink-0" />
                <span>Import from Postman Collection</span>
              </DialogTitle>
              <DialogDescription className="text-xs">
                Select a Postman Collection &amp; Folder to import active API test cases with assertions and auto-linked runner configuration.
              </DialogDescription>
            </>
          ) : sourceMode === 'datadog' ? (
            <>
              <DialogTitle className="flex items-center gap-2 text-base">
                <DatadogLogo className="h-4 w-4 shrink-0" />
                <span>Import from Datadog Synthetics</span>
              </DialogTitle>
              <DialogDescription className="text-xs">
                Select Datadog Synthetic tests to import as real InkaTest test cases with per-step assertions and auto-linked runner configuration.
              </DialogDescription>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <DialogTitle className="flex items-center gap-2 text-base">
                  Generate Test Cases
                  <span className="inline-flex items-center gap-1 text-[10px] font-normal bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400 border border-indigo-200/30 px-1.5 py-0.5 rounded-full">
                    <Sparkles className="h-2.5 w-2.5" /> AI
                  </span>
                </DialogTitle>
              </div>
              <DialogDescription className="text-xs">
                Describe a feature and AI will generate structured, step-by-step test cases.
              </DialogDescription>
            </>
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 min-h-0 custom-scrollbar">
          {/* Form Section */}
          <div className="space-y-6">
            {sourceMode === 'postman' ? (
              <div className="space-y-4 p-4 rounded-xl border border-border/70 bg-muted/15">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* Postman Collection Selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground flex items-center justify-between gap-2">
                      <span>Postman Collection *</span>
                      <span className="flex items-center gap-2">
                        {loadingCatalog && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin text-primary" />
                            Syncing...
                          </span>
                        )}
                        <CacheMeta
                          updatedAt={catalogUpdatedAt}
                          now={nowTick}
                          onRefresh={() => void loadCatalog(true)}
                          disabled={loadingCatalog}
                        />
                      </span>
                    </label>
                    {loadingCatalog && !catalog ? (
                      <div className="relative">
                        <select
                          disabled
                          className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs font-medium text-muted-foreground"
                        >
                          <option>Loading collections…</option>
                        </select>
                        <Loader2 className="absolute right-3 top-2.5 h-3.5 w-3.5 animate-spin text-primary" />
                      </div>
                    ) : catalog?.postman?.collections?.length > 0 ? (
                      <select
                        value={selectedCollectionUid}
                        onChange={(e) => {
                          setSelectedCollectionUid(e.target.value);
                          setSelectedFolder('');
                          setSelectedRequestOrders(new Set());
                          setCollectionRequests([]);
                          setRequestsUpdatedAt(null);
                          setGeneratedCases([]);
                          setSelectedIds(new Set());
                        }}
                        disabled={isSaving || loadingCatalog}
                        className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground disabled:opacity-60"
                      >
                        <option value="">Select Postman Collection...</option>
                        {catalog.postman.collections.map((c: any) => (
                          <option key={c.uid} value={c.uid}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        value={selectedCollectionUid}
                        onChange={(e) => {
                          setSelectedCollectionUid(e.target.value);
                          setSelectedFolder('');
                          setSelectedRequestOrders(new Set());
                          setCollectionRequests([]);
                          setGeneratedCases([]);
                          setSelectedIds(new Set());
                        }}
                        placeholder="Postman Collection UID (or connect Postman in Workspace Integrations)"
                        className="h-9 text-xs font-mono"
                        disabled={isSaving || loadingCatalog}
                      />
                    )}
                    {catalogError && (
                      <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                        <span className="flex-1">{catalogError}</span>
                        <button
                          type="button"
                          onClick={() => void loadCatalog(true)}
                          className="font-semibold underline cursor-pointer"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Postman Folder Selector */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1.5 gap-y-0">
                      <Folder className="h-3.5 w-3.5 text-primary" />
                      <span>Collection Folder</span>
                      <span className="ml-auto flex items-center gap-2">
                        {loadingRequests && (
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                        )}
                        <CacheMeta
                          updatedAt={requestsUpdatedAt}
                          now={nowTick}
                          onRefresh={() => void loadPostmanRequests(true)}
                          disabled={loadingRequests}
                        />
                      </span>
                    </label>
                    {discoveredFolders.length > 0 ? (
                      <select
                        value={selectedFolder}
                        onChange={(e) => handleFolderSelect(e.target.value)}
                        disabled={isSaving || loadingRequests || loadingCatalog}
                        className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground disabled:opacity-60"
                      >
                        <option value="">All Folders ({collectionRequests.length} requests)</option>
                        {discoveredFolders.map((folder) => {
                          const folderRequests = collectionRequests.filter(
                            (r) => r.folderPath === folder
                          );
                          const folderCount = folderRequests.length;
                          const importedCount = folderRequests.filter((r) =>
                            importedPostmanRef(r)
                          ).length;
                          const importLabel =
                            importedCount === 0
                              ? ''
                              : importedCount === folderCount
                                ? ' · imported'
                                : ` · ${importedCount} partially imported`;
                          return (
                            <option key={folder} value={folder}>
                              {folder} ({folderCount} request{folderCount === 1 ? '' : 's'})
                              {importLabel}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <Input
                        value={selectedFolder}
                        onChange={(e) => handleFolderSelect(e.target.value)}
                        placeholder="e.g. Policy Review (or leave blank for entire collection)"
                        className="h-9 text-xs"
                        disabled={isSaving || loadingRequests || loadingCatalog}
                      />
                    )}
                  </div>
                </div>

                {/* Default grouping */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-semibold text-foreground block">
                    Default grouping
                  </label>
                  <select
                    value={postmanGroupingMode}
                    onChange={(e) => {
                      setPostmanGroupingMode(e.target.value as PostmanGroupingMode);
                      // A new default replaces manual per-folder toggles; custom
                      // flows remain explicit and are kept.
                      setFolderStrategies({});
                    }}
                    disabled={isSaving}
                    className="w-full h-9 rounded-lg border border-input bg-background px-3 text-xs font-medium text-foreground cursor-pointer"
                  >
                    <option value="smart">Smart (recommended)</option>
                    <option value="individual">All individual</option>
                    <option value="folder">Each folder one flow</option>
                  </select>
                  <p className="text-[10.5px] text-muted-foreground">
                    {postmanGroupingMode === 'smart'
                      ? 'Folders become one flow only when a later request uses a variable set by an earlier one.'
                      : postmanGroupingMode === 'individual'
                        ? 'Every selected request becomes its own test case.'
                        : 'Every selected folder becomes one flow test case.'}
                  </p>
                </div>

                <SuiteSelector
                  suites={suites as Array<{ id: string; name?: string }>}
                  value={suiteId}
                  onChange={setSuiteId}
                  disabled={isSaving}
                />

                {/* Request tree */}
                {(selectedCollectionUid.trim() || loadingRequests || requestsError) && (
                  <div className="rounded-xl border border-border/70 bg-background overflow-hidden">
                    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b border-border/50 text-xs">
                      <span className="font-semibold text-foreground truncate">
                        {loadingRequests
                          ? 'Reading requests…'
                          : `${selectedPostmanCollectionName}${selectedFolder ? ` / ${selectedFolder}` : ''} · ${selectedPostmanNewCount} of ${visiblePostmanNew.length} selected`}
                      </span>
                      <div className="flex items-center gap-3 shrink-0">
                        {visiblePostmanImported.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setShowImportedPostman((v) => !v)}
                            className="text-[11px] text-muted-foreground hover:text-foreground font-medium cursor-pointer"
                          >
                            {visiblePostmanImported.length} already imported —{' '}
                            {showImportedPostman ? 'Hide' : 'Show'}
                          </button>
                        )}
                        {visiblePostmanNew.length > 0 && !loadingRequests && (
                          <button
                            type="button"
                            onClick={() => {
                              const allSelected = visiblePostmanNew.every((row) =>
                                selectedRequestOrders.has(row.request.order)
                              );
                              if (allSelected) {
                                setSelectedRequestOrders(new Set());
                              } else {
                                setSelectedRequestOrders(
                                  new Set(visiblePostmanNew.map((row) => row.request.order))
                                );
                              }
                            }}
                            className="text-xs text-primary hover:underline font-semibold cursor-pointer"
                          >
                            {visiblePostmanNew.every((row) =>
                              selectedRequestOrders.has(row.request.order)
                            )
                              ? 'Deselect All'
                              : 'Select All'}
                          </button>
                        )}
                      </div>
                    </div>

                    {requestsError && (
                      <div className="px-3 py-2">
                        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <div className="font-semibold">Could not read this collection</div>
                            <div className="text-[11px] opacity-90">{requestsError}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void loadPostmanRequests(true)}
                            className="font-semibold underline cursor-pointer shrink-0"
                          >
                            Retry
                          </button>
                        </div>
                      </div>
                    )}

                    {loadingRequests ? (
                      <div className="h-56 overflow-hidden text-xs">
                        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground border-b border-border/30">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                          <span>Reading requests and their tests…</span>
                        </div>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <div
                            key={index}
                            className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border/20 animate-pulse"
                          >
                            <span className="h-3.5 w-3.5 rounded border border-border/60 bg-muted" />
                            <span className="h-4 w-10 rounded bg-muted" />
                            <span className="h-3 flex-1 max-w-[38%] rounded bg-muted" />
                            <span className="h-3 w-24 rounded bg-muted/70" />
                          </div>
                        ))}
                      </div>
                    ) : collectionRequests.length > 0 || !requestsError ? (
                      <div className="h-56 overflow-y-auto text-xs">
                        {!assertionsReady && (
                          <div className="flex items-center gap-2 px-3 py-1.5 text-[10.5px] text-muted-foreground border-b border-border/30 bg-muted/10">
                            <Loader2 className="h-3 w-3 animate-spin text-primary" />
                            <span>
                              Reading {collectionRequests.length} request
                              {collectionRequests.length === 1 ? '' : 's'} and their tests…
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/30 bg-muted/10">
                          <button
                            type="button"
                            onClick={handleGroupSelectedAsFlow}
                            disabled={selectedNewOrderList.length < 2}
                            className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10.5px] font-semibold text-primary hover:bg-primary/15 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <Link2 className="h-3 w-3" />
                            Group selected as one flow
                          </button>
                          <button
                            type="button"
                            onClick={handleUngroupSelected}
                            disabled={!selectedOrdersInCustomFlow}
                            className="rounded-md border border-border/60 px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                          >
                            Ungroup
                          </button>
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {selectedNewOrderList.length} selected
                          </span>
                        </div>

                        {postmanPlan.groups.filter((group) => group.custom).length > 0 && (
                          <div className="px-3 py-1.5 border-b border-border/30 bg-primary/[0.03] space-y-1">
                            {postmanPlan.groups
                              .filter((group) => group.custom)
                              .map((group) => (
                                <div
                                  key={group.id}
                                  className="flex items-center gap-2 text-[10.5px]"
                                >
                                  <span className="font-semibold text-primary shrink-0">
                                    Custom flow · {group.requests.length} requests
                                  </span>
                                  <span className="truncate text-muted-foreground">
                                    {group.requests.map((request) => request.name).join(' → ')}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => removeCustomFlow(group.requests)}
                                    className="ml-auto shrink-0 font-semibold text-muted-foreground hover:text-foreground cursor-pointer"
                                  >
                                    Ungroup
                                  </button>
                                </div>
                              ))}
                          </div>
                        )}

                        {postmanPlan.folders.map((folder) => {
                          const meta = postmanFolderMeta.get(folder.key);
                          if (!meta) return null;
                          const strategy =
                            folderStrategies[folder.key] ||
                            (postmanGroupingMode === 'individual'
                              ? 'individual'
                              : postmanGroupingMode === 'folder'
                                ? 'flow'
                                : folder.recommended);
                          const rows = showImportedPostman
                            ? meta.rows
                            : meta.rows.filter((row) => !row.importedRef);
                          const selectedInFolder = meta.rows.filter(
                            (row) =>
                              !row.importedRef &&
                              selectedRequestOrders.has(row.request.order)
                          ).length;
                          const flowDisabled =
                            meta.state === 'all' || selectedInFolder < 2;
                          const reasonText =
                            meta.state === 'all'
                              ? `All ${meta.rows.length} request${meta.rows.length === 1 ? '' : 's'} already imported.`
                              : meta.state === 'partial'
                                ? strategy === 'flow' && selectedInFolder >= 2
                                  ? `${meta.importedCount} of ${meta.rows.length} requests already imported. ${selectedInFolder} new request${selectedInFolder === 1 ? '' : 's'} grouped as flow.`
                                  : `${meta.importedCount} of ${meta.rows.length} requests already imported. New requests stay individual.`
                                : folder.reason;

                          return (
                            <div
                              key={folder.key}
                              className="border-b border-border/30 last:border-b-0"
                            >
                              <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/25">
                                <Folder className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                                <span className="font-semibold text-[11.5px] text-foreground truncate">
                                  {folder.name}
                                </span>
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {meta.rows.length} request{meta.rows.length === 1 ? '' : 's'}
                                  {meta.state === 'partial' ? ` · ${meta.newCount} new` : ''}
                                </span>
                                {meta.state === 'all' && (
                                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                                    Imported
                                  </span>
                                )}
                                {meta.state === 'partial' && (
                                  <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-amber-700 dark:text-amber-300">
                                    Partially imported
                                  </span>
                                )}
                                <div className="ml-auto inline-flex shrink-0 overflow-hidden rounded-md border border-border/60">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setFolderStrategies((prev) => ({
                                        ...prev,
                                        [folder.key]: 'flow',
                                      }))
                                    }
                                    disabled={flowDisabled}
                                    title={
                                      meta.state === 'all'
                                        ? 'All requests in this folder are already imported.'
                                        : selectedInFolder < 2
                                          ? 'Select at least two requests in this folder to create a flow.'
                                          : 'Import selected requests in this folder as one flow case.'
                                    }
                                    className={cn(
                                      'px-2 py-0.5 text-[10px] font-semibold cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                                      strategy === 'flow'
                                        ? 'bg-primary/15 text-primary'
                                        : 'text-muted-foreground hover:text-foreground'
                                    )}
                                  >
                                    Flow
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setFolderStrategies((prev) => ({
                                        ...prev,
                                        [folder.key]: 'individual',
                                      }))
                                    }
                                    className={cn(
                                      'px-2 py-0.5 text-[10px] font-semibold border-l border-border/60 cursor-pointer',
                                      strategy === 'individual'
                                        ? 'bg-primary/15 text-primary'
                                        : 'text-muted-foreground hover:text-foreground'
                                    )}
                                  >
                                    Individual
                                  </button>
                                </div>
                              </div>

                              <div
                                className="px-3 py-1 text-[10px] text-muted-foreground leading-snug truncate"
                                title={reasonText}
                              >
                                {reasonText}
                              </div>

                              {rows.map((row) => {
                                const reqItem = row.request;
                                const importedRef = row.importedRef;
                                const checked = selectedRequestOrders.has(reqItem.order);
                                const group = postmanGroupByOrder.get(reqItem.order);

                                const rowBody = (
                                  <>
                                    {importedRef ? (
                                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                    ) : (
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => handleTogglePostmanRequest(reqItem.order)}
                                        className="rounded border-border text-primary h-3.5 w-3.5 shrink-0"
                                      />
                                    )}
                                    <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted text-foreground shrink-0">
                                      {reqItem.method}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <div className="font-medium text-foreground truncate">
                                        {reqItem.name}
                                      </div>
                                      {importedRef ? (
                                        <div className="text-[10px] text-muted-foreground truncate">
                                          Already imported
                                        </div>
                                      ) : !assertionsReady ? (
                                        <div className="text-[10px] text-muted-foreground/70 animate-pulse">
                                          Reading tests…
                                        </div>
                                      ) : reqItem.assertions && reqItem.assertions.length > 0 ? (
                                        <div className="text-[10px] text-emerald-600 dark:text-emerald-400 truncate">
                                          ✓ Assertions: {reqItem.assertions.join(' · ')}
                                        </div>
                                      ) : null}
                                    </div>
                                    {importedRef ? (
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        <a
                                          href={`/p/${project?.slug || ''}/repository/${importedRef.displayId || importedRef.caseId}`}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-[10.5px] font-mono font-semibold text-primary hover:underline"
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          Open {importedRef.displayId || 'case'}
                                        </a>
                                        <button
                                          type="button"
                                          disabled={
                                            resyncingImportKey === `postman:${importedRef.caseId}`
                                          }
                                          onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleResyncImported('postman', importedRef);
                                          }}
                                          className="text-[10.5px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
                                        >
                                          {resyncingImportKey === `postman:${importedRef.caseId}`
                                            ? 'Syncing...'
                                            : 'Re-sync'}
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {group?.kind === 'flow' && (
                                          <span className="rounded-full border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-primary">
                                            Flow
                                          </span>
                                        )}
                                        <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[180px]">
                                          {reqItem.url}
                                        </span>
                                      </div>
                                    )}
                                  </>
                                );

                                if (importedRef) {
                                  return (
                                    <div
                                      key={reqItem.order}
                                      className="flex items-center gap-2.5 pl-8 pr-3 py-1.5 bg-muted/20 select-none"
                                    >
                                      {rowBody}
                                    </div>
                                  );
                                }

                                return (
                                  <label
                                    key={reqItem.order}
                                    className="flex items-center gap-2.5 pl-8 pr-3 py-1.5 hover:bg-primary/[0.05] cursor-pointer select-none"
                                  >
                                    {rowBody}
                                  </label>
                                );
                              })}

                              {rows.length === 0 && (
                                <div className="pl-8 pr-3 py-2 text-[10.5px] text-muted-foreground">
                                  All requests in this folder are already imported.
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {postmanPlan.folders.length === 0 && (
                          <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
                            No requests found in this collection.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Detected Postman Variables (collapsed to a count) */}
                {detectedPostmanVariables.length > 0 && (
                  <div className="rounded-lg border border-border/40 bg-muted/20 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowDetectedVariables((v) => !v)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left cursor-pointer"
                    >
                      <span className="font-semibold text-foreground text-[11px]">
                        Detected Request Variables ({detectedPostmanVariables.length})
                      </span>
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span>{showDetectedVariables ? 'Hide' : 'Show'}</span>
                        {showDetectedVariables ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </span>
                    </button>
                    {showDetectedVariables && (
                      <div className="border-t border-border/40 px-3 py-2 space-y-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {detectedPostmanVariables.map((vKey) => (
                            <span
                              key={vKey}
                              className="px-1.5 py-0.5 rounded bg-background border border-border/60 font-mono text-[10px] font-semibold text-foreground"
                            >
                              {formatVariableName(vKey)}
                            </span>
                          ))}
                        </div>
                        <span className="text-[10px] text-muted-foreground block">
                          Auto-saved to Postman / API Variables
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : sourceMode === 'datadog' ? (
              <div className="space-y-4 p-4 rounded-xl border border-border/70 bg-muted/15">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Datadog Site</label>
                  <div className="flex h-9 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-xs">
                    <span className="font-mono text-muted-foreground">
                      {catalog?.datadog?.site || 'datadoghq.com'}
                    </span>
                    <span className="text-muted-foreground" aria-hidden>
                      ·
                    </span>
                    <span
                      className={cn(
                        'font-medium',
                        catalog?.datadog?.connected === true
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-muted-foreground'
                      )}
                    >
                      {catalog?.datadog?.connected === false
                        ? 'Not connected'
                        : catalog?.datadog?.connected === true
                        ? 'Connected'
                        : 'Checking…'}
                    </span>
                    <a
                      href={
                        project?.workspaceSlug
                          ? `/workspace/${project.workspaceSlug}/settings/integrations`
                          : '/workspace'
                      }
                      className="ml-auto text-[10.5px] font-medium text-primary hover:underline"
                    >
                      Change in settings
                    </a>
                  </div>
                  {catalogError && (
                    <div className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span className="flex-1">{catalogError}</span>
                      <button
                        type="button"
                        onClick={() => void loadCatalog(true)}
                        className="font-semibold underline cursor-pointer"
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
                <SuiteSelector
                  suites={suites as Array<{ id: string; name?: string }>}
                  value={suiteId}
                  onChange={setSuiteId}
                  disabled={isSaving}
                />
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground flex items-center justify-between gap-2">
                    <span>Synthetic Tests *</span>
                    <span className="flex items-center gap-2">
                      {loadingCatalog && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin text-primary" />
                          Syncing...
                        </span>
                      )}
                      <CacheMeta
                        updatedAt={catalogUpdatedAt}
                        now={nowTick}
                        onRefresh={() => void loadCatalog(true)}
                        disabled={loadingCatalog}
                      />
                      {importedDatadogTestRows.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowImportedDatadog((v) => !v)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-colors cursor-pointer',
                            showImportedDatadog
                              ? 'border-primary/30 bg-primary/10 text-primary'
                              : 'border-border/60 bg-background text-muted-foreground hover:text-foreground'
                          )}
                        >
                          {showImportedDatadog ? (
                            <EyeOff className="h-3 w-3" />
                          ) : (
                            <Eye className="h-3 w-3" />
                          )}
                          <span>Show imported ({importedDatadogTestRows.length})</span>
                        </button>
                      )}
                    </span>
                  </label>
                  {catalog && datadogTestRows.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <div className="relative min-w-[180px] flex-1">
                        <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                          value={datadogSearch}
                          onChange={(e) => setDatadogSearch(e.target.value)}
                          placeholder="Search tests or IDs…"
                          className="h-8 pl-8 text-xs bg-background"
                          aria-label="Search Datadog Synthetic tests"
                        />
                      </div>
                      <select
                        value={datadogTypeFilter}
                        onChange={(e) =>
                          setDatadogTypeFilter(e.target.value as 'all' | 'browser' | 'api')
                        }
                        className="h-8 rounded-lg border border-input bg-background px-2 text-[11px] font-medium text-foreground cursor-pointer"
                        aria-label="Filter Datadog tests by type"
                      >
                        <option value="all">All types</option>
                        <option value="browser">Browser</option>
                        <option value="api">API</option>
                      </select>
                      <button
                        type="button"
                        onClick={toggleAllDisplayedDatadogTests}
                        disabled={selectableDisplayedDatadogRows.length === 0}
                        title="Select all filtered tests"
                        className="text-[10.5px] font-semibold text-primary hover:underline disabled:opacity-40 disabled:no-underline cursor-pointer disabled:cursor-default"
                      >
                        {allDisplayedDatadogSelected ? 'Deselect all' : 'Select all'}
                      </button>
                    </div>
                  )}
                  {loadingCatalog && !catalog ? (
                    <div className="h-72 overflow-hidden rounded-lg border border-border/40 text-xs">
                      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground border-b border-border/30">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        <span>Reading Synthetic tests…</span>
                      </div>
                      {Array.from({ length: 6 }).map((_, index) => (
                        <div
                          key={index}
                          className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border/20 animate-pulse"
                        >
                          <span className="h-3.5 w-3.5 rounded border border-border/60 bg-muted" />
                          <span className="h-3 flex-1 max-w-[55%] rounded bg-muted" />
                          <span className="h-3 w-20 rounded bg-muted/70" />
                        </div>
                      ))}
                    </div>
                  ) : datadogTestRows.length > 0 ? (
                    <div className="rounded-lg border border-border/40 bg-background divide-y divide-border/30 text-xs overflow-hidden">
                      {displayedDatadogTestRows.map(({ test: t, importedRef }: any) => {
                        const checked = selectedDatadogTestIds.has(t.public_id);
                        const testType =
                          String(t.type || 'api').toLowerCase() === 'browser'
                            ? 'browser'
                            : 'api';

                        const rowBody = (
                          <>
                            {importedRef ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                            ) : (
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleDatadogTest(t.public_id)}
                                className="rounded border-border text-primary h-3.5 w-3.5 shrink-0"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className="min-w-0 max-w-full truncate font-medium text-foreground">
                                  {t.name}
                                </span>
                                <span
                                  className={cn(
                                    'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
                                    testType === 'browser'
                                      ? 'border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                                      : 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                  )}
                                >
                                  {testType === 'browser' ? 'Browser' : 'API'}
                                </span>
                                <span className="truncate font-mono text-[10px] text-muted-foreground">
                                  {t.public_id}
                                </span>
                              </div>
                              {!importedRef &&
                                checked &&
                                datadogStepStatus.get(t.public_id)?.state === 'error' && (
                                  <div className="text-[10px] text-destructive truncate">
                                    {datadogStepStatus.get(t.public_id)?.error ||
                                      'Could not read steps.'}
                                  </div>
                                )}
                            </div>
                            {importedRef ? (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <a
                                  href={`/p/${project?.slug || ''}/repository/${importedRef.displayId || importedRef.caseId}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-[10.5px] font-mono font-semibold text-primary hover:underline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  Open {importedRef.displayId || 'case'}
                                </a>
                                <button
                                  type="button"
                                  disabled={resyncingImportKey === `datadog:${importedRef.caseId}`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleResyncImported('datadog', importedRef);
                                  }}
                                  className="text-[10.5px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50 cursor-pointer"
                                >
                                  {resyncingImportKey === `datadog:${importedRef.caseId}`
                                    ? 'Syncing...'
                                    : 'Re-sync'}
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 shrink-0">
                                {checked && (() => {
                                  const status = datadogStepStatus.get(t.public_id);
                                  if (status?.state === 'loading') {
                                    return (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                        Reading steps…
                                      </span>
                                    );
                                  }
                                  if (status?.state === 'ready') {
                                    return (
                                      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                        {status.count} step{status.count === 1 ? '' : 's'}
                                      </span>
                                    );
                                  }
                                  if (status?.state === 'error') {
                                    return (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          void loadDatadogSteps(t.public_id, true);
                                        }}
                                        className="text-[10px] font-semibold text-destructive hover:underline cursor-pointer"
                                        title={status.error}
                                      >
                                        Steps failed · Retry
                                      </button>
                                    );
                                  }
                                  return null;
                                })()}
                              </div>
                            )}
                          </>
                        );

                        if (importedRef) {
                          return (
                            <div
                              key={t.public_id}
                              className="flex items-center gap-2.5 px-3 py-2 bg-muted/20 select-none"
                            >
                              {rowBody}
                            </div>
                          );
                        }

                        return (
                          <label
                            key={t.public_id}
                            className="flex items-center gap-2.5 px-3 py-2 hover:bg-primary/[0.05] cursor-pointer select-none"
                          >
                            {rowBody}
                          </label>
                        );
                      })}
                      {displayedDatadogTestRows.length === 0 && (
                        <div className="px-3 py-3 text-xs text-muted-foreground text-center">
                          {filteredDatadogTestRows.length === 0
                            ? 'No tests match your search or filter.'
                            : 'All matching Datadog Synthetic tests are already imported.'}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                      {catalog?.datadog?.connected === false ? (
                        <>
                          <div className="text-xs text-muted-foreground mb-2">Datadog not connected</div>
                          <p className="text-sm text-foreground">Connect Datadog in Workspace Settings › Integrations to import Synthetic tests.</p>
                        </>
                      ) : (
                        <div className="text-xs text-muted-foreground">No Datadog Synthetic tests found in this workspace.</div>
                      )}
                    </div>
                  )}
                </div>
                {generatedCases.length > 0 && (
                  <div className="rounded-xl border border-border/70 bg-background overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border/50 text-xs">
                      <span className="font-semibold text-foreground">
                        Import preview ({generatedCases.length} test{generatedCases.length === 1 ? '' : 's'})
                      </span>
                    </div>
                    <div className="max-h-[420px] overflow-y-auto divide-y divide-border/30 text-xs">
                      {generatedCases.map((c: any, previewIndex: number) => {
                        const previewKey = String(c._publicId || previewIndex);
                        const expanded = expandedDatadogPreviews.has(previewKey);
                        const preConditions = String(c.preConditions || '');
                        const nestedCount = Array.isArray(c.steps) ? c.steps.length : 0;
                        return (
                          <div key={previewKey} className="border-l-2 border-l-transparent hover:border-l-primary/40">
                            <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-primary/[0.05] select-none">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(previewIndex)}
                                onChange={() => {
                                  const next = new Set(selectedIds);
                                  if (next.has(previewIndex)) next.delete(previewIndex);
                                  else next.add(previewIndex);
                                  setSelectedIds(next);
                                }}
                                className="rounded border-border text-primary h-3.5 w-3.5 shrink-0"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="font-medium text-foreground truncate">{c.title}</div>
                                <div className="text-[10px] text-muted-foreground truncate">
                                  {nestedCount} step{nestedCount === 1 ? '' : 's'} · Datadog Synthetic{' '}
                                  {String(c.customFields?._datadog?.testType || '').toLowerCase() === 'browser' ? 'browser' : 'API'}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedDatadogPreviews((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(previewKey)) next.delete(previewKey);
                                    else next.add(previewKey);
                                    return next;
                                  });
                                }}
                                className="shrink-0 inline-flex items-center gap-1 text-[10.5px] font-semibold text-primary hover:underline cursor-pointer"
                              >
                                {expanded ? 'Hide steps' : 'View steps'}
                              </button>
                            </div>
                            {expanded && (
                              <div className="px-3 pb-3 space-y-2">
                                {preConditions && (
                                  <div className="rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                    {preConditions}
                                  </div>
                                )}
                                <DatadogStepsTable steps={c.steps || []} collapsedByDefault />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-foreground">Feature description</label>
                  <textarea
                    className={cn(
                      'w-full min-h-[84px] max-h-[240px] rounded-lg border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/70 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40 shadow-xs transition-colors resize-y',
                      isDragging ? 'border-dashed border-primary/60' : 'border-input'
                    )}
                    placeholder="e.g. User should be able to reset their password via email link. Include validation for expired tokens and rate limiting."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const dropped = Array.from(e.dataTransfer?.files || []);
                      if (dropped.length > 0) {
                        const newFiles: { name: string; mimeType: string; data: string }[] = [];
                        let loaded = 0;
                        dropped.forEach((f) => {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const result = event.target?.result as string;
                            const base64Data = result.split(',')[1];
                            newFiles.push({
                              name: f.name,
                              mimeType: f.type || 'text/plain',
                              data: base64Data,
                            });
                            loaded += 1;
                            if (loaded === dropped.length) {
                              setFiles((prev) => [...prev, ...newFiles]);
                            }
                          };
                          reader.readAsDataURL(f);
                        });
                      }
                    }}
                    disabled={isGenerating || isSaving}
                    rows={4}
                  />
                  {promptSuggestions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">Suggestions:</span>
                      {promptSuggestions.map((s) => (
                        <button
                          key={s.label}
                          type="button"
                          disabled={isGenerating || isSaving}
                          onClick={() =>
                            setDescription((prev) => (prev.trim() ? `${prev.trim()}\n${s.template}` : s.template))
                          }
                          className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/10 hover:text-primary cursor-pointer disabled:opacity-50"
                          title={s.template}
                        >
                          <Sparkles className="h-2.5 w-2.5" />
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-sm font-semibold text-foreground">Context</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
                          <Plus className="h-3.5 w-3.5 mr-1" /> Add context
                          <ChevronDown className="h-3.5 w-3.5 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onClick={() => { setActiveContextSource('upload'); document.getElementById('context-file-upload2')?.click(); }}>
                          <UploadIcon className="h-4 w-4 mr-2" />
                          Upload PRD or document
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setActiveContextSource('screenshot'); }}>
                          <ImageIcon className="h-4 w-4 mr-2" />
                          Attach screenshot / paste image
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setActiveContextSource('confluence'); setSourceMode('confluence'); }}>
                          <FileText className="h-4 w-4 mr-2 text-blue-500" />
                          Import from Confluence
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setActiveContextSource('notion'); setSourceMode('notion'); }}>
                          <FileText className="h-4 w-4 mr-2" />
                          Import from Notion
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className="text-[11px] text-muted-foreground">PDF, TXT, MD, CSV, PNG, JPG · or paste</p>
                  <input
                    id="context-file-upload2"
                    type="file"
                    className="hidden"
                    accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
                    multiple
                    onChange={handleFileUpload}
                    disabled={isGenerating || isSaving}
                  />
                  {files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {files.map((file, idx) => {
                        const isImage = file.mimeType.startsWith('image/');
                        return (
                          <div key={idx} className="inline-flex items-center gap-1.5 pl-1.5 pr-1.5 py-1 bg-muted/50 rounded-md text-xs border border-border/60">
                            {isImage ? (
                              <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                            )}
                            <span className="max-w-[140px] truncate">{file.name}</span>
                            <button
                              type="button"
                              onClick={() => removeFile(idx)}
                              className="p-0.5 hover:bg-destructive/10 hover:text-destructive rounded"
                              title="Remove"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {activeContextSource === 'confluence' && (
                    <div className="flex gap-2 items-center">
                      <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                      <Input
                        placeholder="Confluence Page URL or ID..."
                        value={confluenceUrl}
                        onChange={(e) => setConfluenceUrl(e.target.value)}
                        disabled={isGenerating || isSaving || fetchingDoc}
                        className="flex-1 text-xs h-8"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!confluenceUrl.trim() || fetchingDoc}
                        onClick={async () => {
                          setFetchingDoc(true);
                          try {
                            const doc = await fetchConfluencePageAction(projectId, confluenceUrl.trim());
                            const contentText = doc.markdown;
                            setDescription(prev => prev ? prev + '\n\n' + contentText : contentText);
                            toast.success('Successfully imported Confluence PRD content!');
                            setConfluenceUrl('');
                            setActiveContextSource('none');
                          } catch (err: any) {
                            toast.error(err.message || 'Failed to fetch Confluence page');
                          } finally {
                            setFetchingDoc(false);
                          }
                        }}
                        className="text-xs h-8"
                      >
                        {fetchingDoc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Import'}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => setActiveContextSource('none')}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                  {activeContextSource === 'notion' && (
                    <div className="flex gap-2 items-center">
                      <FileText className="h-4 w-4 shrink-0" />
                      <Input
                        placeholder="Notion Page URL or ID..."
                        value={notionUrl}
                        onChange={(e) => setNotionUrl(e.target.value)}
                        disabled={isGenerating || isSaving || fetchingDoc}
                        className="flex-1 text-xs h-8"
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={!notionUrl.trim() || fetchingDoc}
                        onClick={async () => {
                          setFetchingDoc(true);
                          try {
                            const doc = await fetchNotionPageAction(projectId, notionUrl.trim());
                            const contentText = doc.markdown;
                            setDescription(prev => prev ? prev + '\n\n' + contentText : contentText);
                            toast.success('Successfully imported Notion PRD content!');
                            setNotionUrl('');
                            setActiveContextSource('none');
                          } catch (err: any) {
                            toast.error(err.message || 'Failed to fetch Notion page');
                          } finally {
                            setFetchingDoc(false);
                          }
                        }}
                        className="text-xs h-8"
                      >
                        {fetchingDoc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Import'}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={() => setActiveContextSource('none')}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                

                {/* Generation settings */}
                <div className="space-y-2 pt-1">
                  <label className="text-sm font-semibold text-foreground">Generation settings</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Number of cases</label>
                      <div className="flex items-center gap-2">
                        <Select
                          value={countMode}
                          onValueChange={(val) => setCountMode(val as 'auto' | 'custom')}
                          disabled={isGenerating || isSaving}
                          options={[
                            { value: 'auto', label: 'Auto' },
                            { value: 'custom', label: 'Custom' },
                          ]}
                          className="flex-1 h-8 text-xs"
                        />
                        {countMode === 'custom' && (
                          <Input
                            type="number"
                            min={1}
                            max={20}
                            value={count}
                            onChange={(e) => setCount(parseInt(e.target.value) || 5)}
                            disabled={isGenerating || isSaving}
                            className="w-16 h-8 text-xs"
                          />
                        )}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Folder className="h-3 w-3" />
                        Module
                      </label>
                      <ModuleSelect
                        modules={modules}
                        value={moduleId}
                        allowAutoDetect
                        noneLabel="Auto"
                        disabled={isSaving}
                        onInlineCreate={handleCreateModuleInline}
                        onChange={(val) => {
                          setModuleId(val);
                          setGeneratedCases((prev) =>
                            prev.map((c) => ({
                              ...c,
                              moduleId: val === 'auto' ? c.moduleId : val || null,
                            }))
                          );
                        }}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Tag className="h-3 w-3" />
                        Tags
                      </label>
                      <Input
                        placeholder="e.g. regression, auth"
                        value={aiCustomTags}
                        onChange={(e) => setAiCustomTags(e.target.value)}
                        className="h-8 text-xs"
                        disabled={isGenerating || isSaving}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Tag className="h-3 w-3" />
                        InkaBoard/Jira ticket
                      </label>
                      <Input
                        placeholder="INK-101"
                        value={aiTicketKey}
                        onChange={(e) => setAiTicketKey(e.target.value)}
                        className="h-8 text-xs font-mono"
                        disabled={isGenerating || isSaving}
                      />
                    </div>
                  </div>
                </div>

                {/* Advanced prompt settings */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-sm font-semibold text-foreground">Advanced</label>
                    <button
                      type="button"
                      disabled={isGenerating || isSaving}
                      onClick={() => setShowAdvancedPrompt((v) => !v)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <span>Prompt mode</span>
                      <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/30 p-0.5 text-[11px]">
                        <button
                          type="button"
                          disabled={isGenerating || isSaving}
                          onClick={() => setPromptMode('auto')}
                          className={cn(
                            'px-1.5 py-0.5 rounded font-medium transition-colors cursor-pointer',
                            promptMode === 'auto'
                              ? 'bg-background text-foreground shadow-2xs'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          Auto
                        </button>
                        <button
                          type="button"
                          disabled={isGenerating || isSaving}
                          onClick={() => setPromptMode('custom')}
                          className={cn(
                            'px-1.5 py-0.5 rounded font-medium transition-colors cursor-pointer',
                            promptMode === 'custom'
                              ? 'bg-primary/15 text-primary'
                              : 'text-muted-foreground hover:text-foreground'
                          )}
                        >
                          Custom
                        </button>
                      </span>
                      {showAdvancedPrompt ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>

                  {showAdvancedPrompt && promptMode === 'custom' && (
                    <div className="space-y-1.5">
                      <Input
                        value={customPrompt}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        placeholder="Custom instructions for test case generation..."
                        className="h-8 text-xs bg-background"
                        disabled={isGenerating || isSaving}
                      />
                    </div>
                  )}
                </div>
              </>
            )}

            

            {sourceMode === 'prompt' && isGenerating && (
              <div className="relative w-full h-9 rounded-lg border border-primary/40 bg-[#121620] overflow-hidden shadow-sm flex items-center justify-between px-3 select-none animate-in fade-in-0">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/25 via-cyan-500/20 to-primary/30 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-primary to-cyan-400 transition-all duration-300 ease-out shadow-glow-sm"
                  style={{ width: `${progress}%` }}
                />
                <div className="relative z-10 flex items-center gap-2 min-w-0 flex-1 mr-2">
                  <Sparkles className="h-3.5 w-3.5 animate-spin text-cyan-400 shrink-0" />
                  <span className="text-xs font-medium text-foreground truncate">
                    {generationStage || 'Analyzing and Generating...'}
                  </span>
                </div>
                <div className="relative z-10 font-mono text-xs font-bold text-cyan-400 shrink-0">
                  {Math.round(progress)}%
                </div>
              </div>
            )}
          </div>

          {/* Results Section */}
          {generatedCases.length > 0 && sourceMode !== 'datadog' && (
            <div className="space-y-3 pt-3 border-t border-border/50">
              <div className="flex items-center justify-between px-0.5">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-sm flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                    {generatedCases.length} test case{generatedCases.length === 1 ? '' : 's'} generated
                  </h3>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === generatedCases.length}
                    onChange={(e) => toggleSelectAll(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  Select All
                </label>
              </div>

              <div className="border border-border/60 rounded-xl divide-y divide-border/50 overflow-hidden shadow-2xs">
                {generatedCases.map((tc, index) => {
                  const curlCommand = tc.customFields?._postman?.curlCommand;
                  const isCurlOpen = expandedCurlIds.has(index);

                  return (
                    <div key={index} className="bg-card">
                      <div className="flex items-start p-3.5 hover:bg-muted/30 transition-colors gap-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(index)}
                          onChange={(e) => toggleSelect(index, e.target.checked)}
                          className="mr-1.5 mt-1 rounded border-border text-primary focus:ring-primary shrink-0 cursor-pointer"
                        />
                        <button
                          type="button"
                          onClick={() => toggleExpand(index)}
                          className="mt-1 text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
                        >
                          {expandedIds.has(index) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>

                        <div
                          className="flex-1 min-w-0 flex flex-col gap-2 cursor-pointer"
                          onClick={() => toggleExpand(index)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-sm text-foreground leading-snug truncate">
                              {tc.title}
                            </span>
                            <span className="text-xs font-mono text-muted-foreground shrink-0">
                              {tc.steps?.length || 0} step{tc.steps?.length !== 1 ? 's' : ''}
                            </span>
                          </div>

                          {/* Interactive Enum Controls: Priority, Scenario, Individual Module, Postman Link & View cURL */}
                          <div
                            className="flex flex-wrap items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* Priority Enum Selector */}
                            <select
                              value={String(tc.priority || 'P1').toUpperCase()}
                              onChange={(e) => {
                                const val = e.target.value;
                                setGeneratedCases((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index ? { ...item, priority: val } : item
                                  )
                                );
                              }}
                              className="h-6 text-[11px] font-mono font-bold rounded-md px-2 border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                              title="Priority (Enum)"
                            >
                              {PRIORITY_ENUM_OPTIONS.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>

                            {/* Scenario Enum Selector */}
                            <select
                              value={
                                SCENARIO_ENUM_OPTIONS.some((o) => o.value === tc.scenarioType)
                                  ? tc.scenarioType
                                  : 'positive'
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                setGeneratedCases((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index ? { ...item, scenarioType: val } : item
                                  )
                                );
                              }}
                              className="h-6 text-[11px] font-medium rounded-md px-2 border border-border/60 bg-muted/50 text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary"
                              title="Scenario Type (Enum)"
                            >
                              {SCENARIO_ENUM_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                  {opt.label}
                                </option>
                              ))}
                            </select>

                            {/* Per-Case Individual Module Selector */}
                            <ModuleSelect
                              modules={modules}
                              value={tc.moduleId || ''}
                              allowNone
                              noneLabel="Without Module"
                              size="sm"
                              className={cn(
                                'max-w-[180px] truncate',
                                tc.moduleId
                                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                  : 'border-border/60 bg-muted/50 text-muted-foreground'
                              )}
                              onInlineCreate={async (name) => {
                                const created = await createModuleAction({ projectId, name });
                                setModules?.([...(modules || []), created]);
                                setGeneratedCases((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index ? { ...item, moduleId: created.id } : item
                                  )
                                );
                                return created.id;
                              }}
                              onChange={(val) => {
                                const newModId = val || null;
                                setGeneratedCases((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index ? { ...item, moduleId: newModId } : item
                                  )
                                );
                              }}
                            />

                            {tc.customFields?._postman?.collectionUid && (
                              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25">
                                <PostmanLogo className="h-3 w-3" />
                                <span>
                                  {tc.customFields._postman.collectionName || 'Postman'}
                                  {tc.customFields._postman.folderOrRequestFilter
                                    ? ` / ${tc.customFields._postman.folderOrRequestFilter}`
                                    : ''}
                                </span>
                              </span>
                            )}

                            {curlCommand && (
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedCurlIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(index)) next.delete(index);
                                    else next.add(index);
                                    return next;
                                  });
                                  if (!expandedIds.has(index)) {
                                    toggleExpand(index);
                                  }
                                }}
                                className={cn(
                                  'inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[11px] font-mono font-medium transition-colors cursor-pointer ml-auto',
                                  isCurlOpen
                                    ? 'bg-primary/15 text-primary border-primary/30'
                                    : 'bg-muted/40 text-muted-foreground hover:text-foreground border-border/60'
                                )}
                              >
                                <Terminal className="h-3 w-3" />
                                <span>{isCurlOpen ? 'Hide cURL' : 'View cURL'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {expandedIds.has(index) && (
                        <div className="pl-11 pr-4 pb-4 pt-3 bg-muted/10 border-t border-border/40 space-y-3">
                          {tc.description && (
                            <div className="text-xs text-muted-foreground leading-relaxed">
                              {tc.description}
                            </div>
                          )}

                          {/* Collapsible cURL Inspector (Theme-matched) */}
                          {isCurlOpen && curlCommand && (
                            <div className="rounded-lg border border-border/70 bg-muted/40 dark:bg-zinc-900/70 text-foreground p-3 space-y-1.5">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="font-mono font-semibold text-muted-foreground flex items-center gap-1.5">
                                  <Terminal className="h-3.5 w-3.5 text-orange-500" />
                                  <span>cURL Request Snippet</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(curlCommand);
                                    toast.success('cURL copied to clipboard');
                                  }}
                                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-medium cursor-pointer"
                                >
                                  <Copy className="h-3 w-3" />
                                  <span>Copy cURL</span>
                                </button>
                              </div>
                              <pre className="font-mono text-[11px] text-foreground/90 overflow-x-auto max-h-40 whitespace-pre-wrap break-all leading-relaxed">
                                {curlCommand}
                              </pre>
                            </div>
                          )}

                          {(tc.preConditions || tc.postConditions) && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                              {tc.preConditions && (
                                <div className="bg-card p-2.5 rounded-lg border border-border/50">
                                  <span className="font-semibold text-muted-foreground block mb-0.5 text-[11px]">
                                    Pre-conditions
                                  </span>
                                  <p className="whitespace-pre-line text-foreground/85 leading-relaxed">
                                    {tc.preConditions}
                                  </p>
                                </div>
                              )}
                              {tc.postConditions && (
                                <div className="bg-card p-2.5 rounded-lg border border-border/50">
                                  <span className="font-semibold text-muted-foreground block mb-0.5 text-[11px]">
                                    Post-conditions
                                  </span>
                                  <p className="whitespace-pre-line text-foreground/85 leading-relaxed">
                                    {tc.postConditions}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}

                          {tc.steps && tc.steps.length > 0 ? (
                            <div className="border border-border/60 rounded-xl overflow-hidden bg-card">
                              <table className="w-full text-xs text-left">
                                <thead className="bg-muted/50 text-muted-foreground border-b border-border/50">
                                  <tr>
                                    <th className="px-3 py-2 font-semibold w-10">#</th>
                                    <th className="px-3 py-2 font-semibold w-[46%]">Step Action &amp; Input Payload</th>
                                    <th className="px-3 py-2 font-semibold w-[54%]">Expected Result (Assertions)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border/40">
                                  {tc.steps.map((step: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-muted/10 transition-colors">
                                      <td className="px-3 py-2.5 text-muted-foreground font-mono align-top">
                                        {step.order}
                                      </td>
                                      <td className="px-3 py-2.5 text-foreground/95 font-medium leading-relaxed align-top space-y-2">
                                        <div>{step.description || step.step}</div>
                                        {step.data && (
                                          <div className="rounded-lg border border-border/60 bg-muted/30 p-2">
                                            <span className="text-[10px] font-mono uppercase font-semibold text-muted-foreground block mb-1">
                                              Request Payload / Data
                                            </span>
                                            <pre className="font-mono text-[11px] text-foreground/90 whitespace-pre-wrap break-words overflow-x-auto max-h-36">
                                              {step.data}
                                            </pre>
                                          </div>
                                        )}
                                        {step.reusableStepId && (
                                          <div className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-600 border border-blue-400/30">
                                            <Link2 className="h-3 w-3" /> Shared
                                          </div>
                                        )}
                                      </td>
                                      <td className="px-3 py-2.5 text-foreground/85 leading-relaxed align-top whitespace-pre-line">
                                        {step.expectedResult || '-'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground italic">No steps generated</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {sourceMode === 'postman' && (
          <div className="px-5 pt-1 text-[11px] font-medium text-muted-foreground">
            {postmanSummaryText}
          </div>
        )}

        <DialogFooter className="mt-0 px-5 py-3 border-t border-border/60">
          {sourceMode === 'datadog' && selectedDatadogTestIds.size === 0 && (
            <span className="sm:mr-auto text-[11px] font-medium text-muted-foreground">
              Select tests to import
            </span>
          )}
          {sourceMode === 'prompt' && generatedCases.length === 0 && !isGenerating && (
            <>
              <span className="sm:mr-auto text-[11px] text-muted-foreground">
                Cases are saved as Draft for review
              </span>
              <Button
                onClick={handleGenerate}
                disabled={isSaving || (!description.trim() && files.length === 0)}
                className="gradient-btn text-white"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                <span>Generate with AI</span>
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                Cancel
              </Button>
            </>
          )}
          {sourceMode === 'prompt' && generatedCases.length > 0 && !isGenerating && (
            <>
              <span className="sm:mr-auto text-[11px] font-medium text-muted-foreground">
                {selectedIds.size} of {generatedCases.length} selected
              </span>
              <Button
                onClick={handleSave}
                disabled={selectedIds.size === 0 || isSaving}
                className="gradient-btn text-white"
              >
                {isSaving ? 'Saving...' : `Add to Repository (${selectedIds.size})`}
              </Button>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
                Cancel
              </Button>
            </>
          )}
          {(sourceMode === 'postman' || sourceMode === 'datadog') && (
            <Button
              onClick={handleSave}
              disabled={
                selectedIds.size === 0 ||
                isGenerating ||
                isSaving ||
                (sourceMode === 'datadog' && loadingSelectedDatadogSteps)
              }
              className="gradient-btn text-white"
            >
              {isSaving ? 'Saving...' : `Add to Repository (${selectedIds.size})`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}