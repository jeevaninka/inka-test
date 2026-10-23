"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Search,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  AlertTriangle,
  Tag,
  Play,
  Layers,
  Filter,
  X,
  Loader2,
  RefreshCw,
  Inbox,
  Plus,
  Settings2,
  ListChecks,
} from 'lucide-react';
import { PostmanLogo, DatadogLogo } from '@/components/icons/IntegrationLogos';
import { toast } from 'sonner';
import { cn, formatVariableName } from '@/lib/utils';
import { createTestRunAction, validateRunPlanAction } from '@/app/actions/runs';
import { getSuiteCasesAction } from '@/app/actions/suites';
import { getProjectReleasesAction } from '@/app/actions/releases';
import { getEnvironmentsAction } from '@/app/actions/variables';
import {
  createExternalRunFromCasesAction,
  fetchPostmanCollectionRequestsAction,
  getProjectRunnerCatalogAction,
} from '@/app/actions/integrations';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { SuiteTypeBadge } from '@/components/common/SuiteTypeBadge';
import { CaseSourceIcon } from '@/components/common/CaseSourceIcon';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import {
  caseMatchesMode,
  caseMatchesSource,
  getAutomationFilterCounts,
  getAutomationSourceOptions,
  getCaseAutomationSource,
  EXTERNAL_SOURCE_LABEL,
} from '@/lib/cases/automation-source';

const DEFAULT_ENV_NAMES = ['DEV', 'STAGING', 'QA', 'UAT', 'PROD'];

function parseOverrideLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = formatVariableName(line.slice(0, idx).trim());
    if (!key) continue;
    out[key] = line.slice(idx + 1).trim();
  }
  return out;
}

export function formatTodayDdMmYyyy(): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function parseCaseDisplayId(displayId?: string | null): { prefix: string; num: number } {
  if (!displayId) return { prefix: '', num: 0 };
  const match = String(displayId).match(/^([A-Za-z]+)-?(\d+)$/);
  if (match) {
    return { prefix: match[1].toUpperCase(), num: parseInt(match[2], 10) };
  }
  return { prefix: String(displayId).toUpperCase(), num: 0 };
}

function compareCaseAsc(a: any, b: any, query?: string): number {
  const q = query ? query.toLowerCase().trim() : '';
  if (q) {
    const aId = (a.displayId || '').toLowerCase();
    const bId = (b.displayId || '').toLowerCase();
    const aExact = aId === q;
    const bExact = bId === q;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    const aStarts = aId.startsWith(q);
    const bStarts = bId.startsWith(q);
    if (aStarts && !bStarts) return -1;
    if (!aStarts && bStarts) return 1;
  }

  const pA = parseCaseDisplayId(a.displayId);
  const pB = parseCaseDisplayId(b.displayId);
  if (pA.prefix !== pB.prefix) {
    return pA.prefix.localeCompare(pB.prefix);
  }
  if (pA.num !== pB.num) {
    return pA.num - pB.num;
  }
  return (a.title || '').localeCompare(b.title || '');
}

export interface CreateRunModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  runType?: 'manual' | 'postman' | 'datadog';
  initialSuiteId?: string | null;
  initialReleaseId?: string | null;
  /** Opens the import dialog for items that are not in the repository yet. */
  onRequestImport?: (provider: 'postman' | 'datadog') => void;
}

export function CreateRunModal({
  open,
  onOpenChange,
  slug,
  runType = 'manual',
  initialSuiteId,
  initialReleaseId,
  onRequestImport,
}: CreateRunModalProps) {
  const router = useRouter();
  const { project, suites, cases: allCases, modules, members, currentUser, runs, setRuns } = useProjectData();

  const todayStr = useMemo(() => formatTodayDdMmYyyy(), []);

  const [environments, setEnvironments] = useState<any[]>([]);
  const [projectReleases, setProjectReleases] = useState<any[]>([]);

  // External (Postman/Datadog) run state
  const [externalLoading, setExternalLoading] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [externalRetryKey, setExternalRetryKey] = useState(0);
  const [postmanCollections, setPostmanCollections] = useState<any[]>([]);
  const [selectedPostmanCollectionUid, setSelectedPostmanCollectionUid] = useState<string>('');
  const [postmanCollectionRequests, setPostmanCollectionRequests] = useState<any[]>([]);
  const [selectedPostmanRequestOrders, setSelectedPostmanRequestOrders] = useState<number[]>([]);
  const [postmanRequestSearch, setPostmanRequestSearch] = useState<string>('');
  const [selectedPostmanFolder, setSelectedPostmanFolder] = useState<string>('');
  const [datadogTests, setDatadogTests] = useState<any[]>([]);
  const [selectedDatadogPublicIds, setSelectedDatadogPublicIds] = useState<string[]>([]);
  const [datadogSearch, setDatadogSearch] = useState<string>('');
  const [externalRunName, setExternalRunName] = useState<string>('');

  // Only already-imported, provider-linked repository cases are runnable here.
  const [selectedExternalCaseIds, setSelectedExternalCaseIds] = useState<Set<string>>(new Set());
  const [externalSearch, setExternalSearch] = useState('');
  const [showExternalConfig, setShowExternalConfig] = useState(false);
  const [externalOverrides, setExternalOverrides] = useState<Record<string, string>>({});
  const [extDelayMs, setExtDelayMs] = useState('0');
  const [extTimeoutMs, setExtTimeoutMs] = useState('15000');
  const [extBailOnFailure, setExtBailOnFailure] = useState(true);
  const [extPersistResponses, setExtPersistResponses] = useState(true);
  const [extKeepVariableValues, setExtKeepVariableValues] = useState(true);
  const [extStopOnFirstFailure, setExtStopOnFirstFailure] = useState(false);
  const [interCaseDelaySec, setInterCaseDelaySec] = useState(0);
  const [ddExecutionRule, setDdExecutionRule] = useState<'blocking' | 'non_blocking' | 'skipped'>('blocking');
  const [ddRetryCount, setDdRetryCount] = useState('0');
  const [ddStartUrl, setDdStartUrl] = useState('');
  // Datadog lane: several tests may run at the same time (default), or one by one.
  const [ddLaneMode, setDdLaneMode] = useState<'together' | 'sequential'>('together');
  const [ddLaneConcurrency, setDdLaneConcurrency] = useState(3);

  // Postman catalog: the project-to-Postman environment mapping plus the
  // Postman/API variables available for each environment. The top-level
  // Environment dropdown is the single source of truth and resolves through
  // this mapping; there is no separate per-run environment override.
  const [postmanCatalog, setPostmanCatalog] = useState<{
    connected: boolean;
    envMapping: Record<string, string>;
    environments: Array<{ id: string; uid: string; name: string }>;
    variablesByEnv: Record<string, Record<string, string>>;
  } | null>(null);
  const [postmanCatalogLoading, setPostmanCatalogLoading] = useState(true);
  // Live collection requests (cached by collection UID) so eligible variables
  // can be detected from the selected requests, not just the stored metadata.
  const [postmanRequestsByCollection, setPostmanRequestsByCollection] = useState<
    Record<string, any[]>
  >({});

  // Repository cases that are already linked to the selected provider, grouped by
  // collection (Postman) or Synthetic test (Datadog). This is a scoped repository
  // view — nothing is created or matched live at run time.
  const linkedExternalGroups = useMemo(() => {
    if (runType === 'manual') return [] as Array<{ key: string; label: string; cases: any[] }>;
    const groups = new Map<string, { key: string; label: string; cases: any[] }>();
    for (const c of allCases || []) {
      const cf = (c as any).customFields || (c as any).custom_fields || {};
      if (runType === 'postman') {
        if (!cf._postman?.collectionUid) continue;
        const key = cf._postman.collectionUid;
        const label = cf._postman.collectionName || 'Postman collection';
        if (!groups.has(key)) groups.set(key, { key, label, cases: [] });
        groups.get(key)!.cases.push(c);
      } else {
        if (!cf._datadog?.publicIds?.length) continue;
        const key = cf._datadog.publicIds[0];
        const label = cf._datadog.testName || c.title || 'Datadog Synthetic';
        if (!groups.has(key)) groups.set(key, { key, label, cases: [] });
        groups.get(key)!.cases.push(c);
      }
    }
    const q = externalSearch.trim().toLowerCase();
    const result = Array.from(groups.values()).map((g) => ({
      ...g,
      cases: g.cases.filter(
        (c: any) => !q || `${c.displayId || ''} ${c.title || ''}`.toLowerCase().includes(q)
      ),
    }));
    return result.filter((g) => g.cases.length > 0);
  }, [allCases, runType, externalSearch]);

  const linkedExternalCaseCount = useMemo(
    () => linkedExternalGroups.reduce((sum, g) => sum + g.cases.length, 0),
    [linkedExternalGroups]
  );

  /** Total linked cases, independent of the search filter. */
  const selectedExternalCases = useMemo(
    () => (allCases || []).filter((c: any) => selectedExternalCaseIds.has(c.id)),
    [allCases, selectedExternalCaseIds]
  );

  /** Case-level "bail" only applies to multi-request Postman journeys. */
  const hasMultiStepJourneySelected = useMemo(() => {
    if (runType !== 'postman') return false;
    return selectedExternalCases.some((c: any) => {
      const cf = c.customFields || c.custom_fields || {};
      const meta = cf._postman || {};
      const specCount = Array.isArray(meta.requestSpecs)
        ? meta.requestSpecs.filter(Boolean).length
        : 0;
      const orderCount = Array.isArray(meta.selectedRequestOrders)
        ? meta.selectedRequestOrders.length
        : 0;
      return Math.max(specCount, orderCount) > 1;
    });
  }, [runType, selectedExternalCases]);

  const [formData, setFormData] = useState({
    name: `Test Run - ${todayStr}`,
    mode: 'manual',
    releaseId: initialReleaseId || '',
    environment: 'UAT',
    environmentId: '',
  });

  const environmentKey = (formData.environment || '').trim().toUpperCase();

  /** Variables overridable for this run, from the selected requests + environment. */
  const detectedExternalVariables = useMemo(() => {
    const keys = new Set<string>();
    const add = (raw: unknown) => {
      const name = formatVariableName(typeof raw === 'string' ? raw : '');
      if (name) keys.add(name);
    };
    const scanText = (text?: string | null) => {
      if (!text) return;
      const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text))) add(match[1]);
    };

    // 1. Metadata already stored on the selected cases (present after a re-sync).
    for (const c of selectedExternalCases) {
      const cf = c.customFields || c.custom_fields || {};
      const postman = cf._postman || {};
      for (const v of postman.requiredVariables || []) add(v);
      for (const key of Object.keys(postman.customVariables || {})) add(key);
      const specs = [
        postman.requestSpec,
        ...(Array.isArray(postman.requestSpecs) ? postman.requestSpecs : []),
      ];
      for (const spec of specs) {
        for (const v of spec?.requiredVariables || []) add(v);
      }
      const datadog = cf._datadog || {};
      for (const v of datadog.requiredVariables || []) add(v);
      for (const key of Object.keys(datadog.customVariables || {})) add(key);
      scanText(c.title);
      for (const step of c.steps || []) {
        scanText(step?.step);
        scanText(step?.expected_result ?? step?.expectedResult);
        scanText(step?.data);
      }
    }

    // 2. Variables required by the selected requests in each linked collection.
    if (runType === 'postman') {
      for (const c of selectedExternalCases) {
        const cf = c.customFields || c.custom_fields || {};
        const postman = cf._postman || {};
        const items = postmanRequestsByCollection[postman.collectionUid] || [];
        if (items.length === 0) continue;
        const orders = Array.isArray(postman.selectedRequestOrders)
          ? postman.selectedRequestOrders
          : [];
        const folderFilter = String(postman.folderOrRequestFilter || '').toLowerCase();
        const selectedItems =
          orders.length > 0
            ? items.filter((it: any) => orders.includes(it.order))
            : folderFilter
            ? items.filter(
                (it: any) =>
                  String(it.folderPath || '').toLowerCase().includes(folderFilter) ||
                  String(it.name || '').toLowerCase().includes(folderFilter)
              )
            : items;
        for (const it of selectedItems) {
          for (const v of it?.requiredVariables || []) add(v);
          for (const v of it?.requestSpec?.requiredVariables || []) add(v);
        }
      }

      // 3. Postman/API variables configured for the selected environment.
      const envVars = postmanCatalog?.variablesByEnv?.[environmentKey] || {};
      for (const key of Object.keys(envVars)) add(key);
    }

    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [runType, selectedExternalCases, postmanRequestsByCollection, postmanCatalog, environmentKey]);

  const availableOverrideVariables = useMemo(
    () =>
      detectedExternalVariables.filter(
        (v) => !Object.prototype.hasOwnProperty.call(externalOverrides, v)
      ),
    [detectedExternalVariables, externalOverrides]
  );

  /** Resolve the selected environment through the project's Postman mapping. */
  const postmanEnvMappingId = postmanCatalog?.envMapping?.[environmentKey] || '';
  const postmanEnvMappingMissing =
    runType === 'postman' && Boolean(postmanCatalog) && !postmanEnvMappingId;
  const postmanEnvMappingResolved = runType === 'postman' && Boolean(postmanEnvMappingId);
  const postmanCatalogUnavailable =
    runType === 'postman' && !postmanCatalogLoading && !postmanCatalog;
  const postmanStartBlocked = runType === 'postman' && !postmanEnvMappingResolved;

  const [preflightReport, setPreflightReport] = useState<{
    valid: boolean;
    missingVariables: string[];
    missingParameters: any[];
    warnings: string[];
  } | null>(null);

  // Case selection & tab state
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());
  const [caseSearch, setCaseSearch] = useState('');
  const [expandedSuites, setExpandedSuites] = useState<Set<string>>(new Set());
  const [caseTab, setCaseTab] = useState<string>('suites');
  const [pickerMode, setPickerMode] = useState<'' | 'manual' | 'auto'>('');
  const [pickerSource, setPickerSource] = useState<string>('');

  // Consolidated Filter state
  const [filterOpen, setFilterOpen] = useState(false);
  const [repoModuleFilter, setRepoModuleFilter] = useState<string>('');
  const [repoSubmoduleFilter, setRepoSubmoduleFilter] = useState<string>('');
  const [repoPriorityFilter, setRepoPriorityFilter] = useState<string>('');
  const [repoTagFilter, setRepoTagFilter] = useState<string>('');
  const [selectedTicketKey, setSelectedTicketKey] = useState<string>('');

  const [showDraftWarningModal, setShowDraftWarningModal] = useState(false);
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [showAutomatedSettings, setShowAutomatedSettings] = useState(false);
  const [mixedOverridesText, setMixedOverridesText] = useState('');

  // Assignments (testCaseId -> userId)
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [bulkAssignee, setBulkAssignee] = useState<number>(0);
  const [starting, setStarting] = useState(false);

  // Build merged environment options so the Environment dropdown always has options and opens
  const environmentOptions = useMemo(() => {
    const list: { value: string; label: string; id?: string; name: string }[] = [];
    const seenNames = new Set<string>();

    for (const env of environments) {
      const upper = String(env.name || '').trim().toUpperCase();
      if (!upper || seenNames.has(upper)) continue;
      seenNames.add(upper);
      list.push({
        value: env.name,
        label: env.name.toUpperCase(),
        id: env.id,
        name: env.name,
      });
    }

    for (const std of DEFAULT_ENV_NAMES) {
      if (!seenNames.has(std)) {
        seenNames.add(std);
        list.push({
          value: std,
          label: std,
          name: std,
        });
      }
    }

    return list;
  }, [environments]);

  // Discover all unique ticket keys across project cases
  const uniqueTicketKeys = useMemo(() => {
    const keys = new Set<string>();
    allCases.forEach((c: any) => {
      (c.labels || []).forEach((l: string) => {
        if (l.startsWith('ticket:')) keys.add(l.replace('ticket:', ''));
        else if (/^[A-Z0-9]+-[0-9]+$/i.test(l)) keys.add(l.toUpperCase());
      });
      (c.tags || []).forEach((t: string) => {
        if (t.startsWith('ticket:')) keys.add(t.replace('ticket:', ''));
        else if (/^[A-Z0-9]+-[0-9]+$/i.test(t)) keys.add(t.toUpperCase());
      });
    });
    return Array.from(keys).sort();
  }, [allCases]);

  // Discover all unique tags across project cases
  const uniqueRepoTags = useMemo(() => {
    const tags = new Set<string>();
    allCases.forEach((c: any) => {
      (c.tags || []).forEach((t: string) => {
        if (!t.startsWith('ticket:') && !/^[A-Z0-9]+-[0-9]+$/i.test(t)) tags.add(t);
      });
    });
    return Array.from(tags).sort();
  }, [allCases]);

  // Repository-tab filters. Mode is the parent: Integration only refines
  // Automated, so a source can never conflict with Manual/All.
  const effectivePickerMode = pickerMode;
  const effectivePickerSource = pickerSource;

  const suitesWithCases = useMemo(() => {
    const mapped = suites.map((s: any) => {
      const assigneeMap: Record<string, number> = {};
      (s.suite_cases || []).forEach((sc: any) => {
        const tcId = sc.test_case_id || sc.test_case?.id;
        if (tcId && sc.assignee_id) {
          assigneeMap[tcId] = sc.assignee_id;
        }
      });

      const matchedCases = allCases.filter((c: any) => {
        if (!s.suite_cases?.some((sc: any) => sc.test_case_id === c.id || sc.test_case?.id === c.id)) {
          return false;
        }
        return true;
      });
      const suiteCases = matchedCases.sort((a: any, b: any) => compareCaseAsc(a, b));
      return { ...s, cases: suiteCases, assigneeMap };
    });

    if (initialSuiteId) {
      mapped.sort((a: any, b: any) => {
        if (a.id === initialSuiteId) return -1;
        if (b.id === initialSuiteId) return 1;
        return 0;
      });
    }

    return mapped;
  }, [suites, allCases, initialSuiteId]);

  // Mode is derived from the selection: all manual -> manual, all automated ->
  // automated, both -> mixed. There is no Mode control.
  useEffect(() => {
    if (!open || runType !== 'manual' || selectedCaseIds.size === 0) return;
    const selected = allCases.filter((c: any) => selectedCaseIds.has(c.id));
    const allManual = selected.every((c: any) => caseMatchesMode(c, 'manual'));
    const allAuto = selected.every((c: any) => caseMatchesMode(c, 'auto'));
    const derived = allManual ? 'manual' : allAuto ? 'automated' : 'mixed';
    setFormData((prev) =>
      prev.mode === derived ? prev : { ...prev, mode: derived as any }
    );
  }, [open, runType, selectedCaseIds, allCases]);

  // Suites that currently have at least 1 selected case (when in Suites tab)
  const selectedSuitesList = useMemo(() => {
    if (caseTab !== 'suites') return [];
    return suitesWithCases
      .map((s: any) => {
        const selectedCount = s.cases.filter((c: any) => selectedCaseIds.has(c.id)).length;
        return { ...s, selectedCount };
      })
      .filter((s: any) => s.selectedCount > 0);
  }, [caseTab, suitesWithCases, selectedCaseIds]);

  // Load environments and releases when modal opens
  useEffect(() => {
    if (!open || !project?.id) return;
    getEnvironmentsAction(project.id)
      .then((envs) => {
        setEnvironments(envs || []);
        if (envs && envs.length > 0) {
          // Prefer UAT as the default environment, otherwise fall back to the first available env
          const uatEnv = envs.find((e: any) => String(e.name || '').trim().toUpperCase() === 'UAT') || envs[0];
          setFormData((prev) => ({
            ...prev,
            environmentId: uatEnv.id,
            environment: uatEnv.name,
          }));
        }
      })
      .catch(() => {});

    getProjectReleasesAction(project.id)
      .then((rels) => {
        setProjectReleases(rels || []);
        if (initialReleaseId) {
          setFormData((prev) => ({ ...prev, releaseId: initialReleaseId }));
        }
      })
      .catch(() => {});
  }, [open, project?.id, initialReleaseId]);

  // Reset provider-specific selections whenever the modal opens or the run type changes
  useEffect(() => {
    if (!open) return;
    setSelectedDatadogPublicIds([]);
    setExternalRunName(
      runType === 'manual'
        ? ''
        : `${runType === 'postman' ? 'Postman' : 'Datadog'} Run - ${todayStr}`
    );
    setExternalError(null);
  }, [open, runType, todayStr]);

  // Reset external-case selection whenever the modal reopens or the provider changes.
  useEffect(() => {
    if (!open) return;
    setSelectedExternalCaseIds(new Set());
    setExternalSearch('');
    setExternalOverrides({});
    setShowExternalConfig(false);
  }, [open, runType]);

  // Load the Postman catalog so the Environment dropdown can resolve to a real
  // Postman environment and so environment-level variables are overridable.
  useEffect(() => {
    if (!open || runType !== 'postman' || !project?.id) return;
    let cancelled = false;
    setPostmanCatalogLoading(true);
    getProjectRunnerCatalogAction(project.id)
      .then((res: any) => {
        if (cancelled) return;
        setPostmanCatalog({
          connected: Boolean(res?.postman?.connected),
          envMapping: res?.postman?.envMapping || {},
          environments: res?.postman?.environments || [],
          variablesByEnv: res?.postman?.variablesByEnv || {},
        });
      })
      .catch(() => {
        if (!cancelled) setPostmanCatalog(null);
      })
      .finally(() => {
        if (!cancelled) setPostmanCatalogLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, runType, project?.id]);

  // Fetch the request lists for the collections used by the selected cases.
  // Eligible overridable variables come from these selected requests.
  useEffect(() => {
    if (!open || runType !== 'postman' || !project?.id) return;
    const uids = Array.from(
      new Set(
        selectedExternalCases
          .map(
            (c: any) =>
              (c.customFields?._postman || c.custom_fields?._postman)?.collectionUid as
                | string
                | undefined
          )
          .filter((uid): uid is string => typeof uid === 'string' && uid.length > 0)
      )
    ).filter((uid) => !(uid in postmanRequestsByCollection));
    if (uids.length === 0) return;
    let cancelled = false;
    Promise.all(
      uids.map((uid) =>
        fetchPostmanCollectionRequestsAction(project.id, uid)
          .then((items): [string, any[]] => [uid, items || []])
          .catch((): [string, any[]] => [uid, []])
      )
    ).then((pairs) => {
      if (cancelled) return;
      setPostmanRequestsByCollection((prev) => {
        const next = { ...prev };
        for (const [uid, items] of pairs) next[uid] = items;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [open, runType, project?.id, selectedExternalCases, postmanRequestsByCollection]);

  // Reset / initialize state when modal opens or initialSuiteId changes
  useEffect(() => {
    if (!open) return;

    setBulkAssignee(0);
    setCaseSearch('');
    setPickerMode('');
    setPickerSource('');
    setRepoModuleFilter('');
    setRepoSubmoduleFilter('');
    setRepoPriorityFilter('');
    setRepoTagFilter('');
    setSelectedTicketKey('');

    if (initialSuiteId && suitesWithCases.length > 0) {
      const suite = suitesWithCases.find((s) => s.id === initialSuiteId);
      if (suite) {
        setCaseTab('suites');
        setExpandedSuites(new Set([suite.id]));
        const caseIds = suite.cases.map((c: any) => c.id);
        setSelectedCaseIds(new Set(caseIds));
        setAssignments(suite.assigneeMap ? { ...suite.assigneeMap } : {});
        setFormData((prev) => ({
          ...prev,
          name: `${suite.name} - ${todayStr}`,
        }));

        getSuiteCasesAction(initialSuiteId)
          .then((freshCases) => {
            if (!freshCases || freshCases.length === 0) return;
            const freshIds = freshCases.map((fc: any) => fc.id);
            setSelectedCaseIds(new Set(freshIds));
            const freshAssignees: Record<string, number> = {};
            freshCases.forEach((fc: any) => {
              if (fc.assignee_id) freshAssignees[fc.id] = fc.assignee_id;
            });
            setAssignments(freshAssignees);
          })
          .catch(() => {});
        return;
      }
    }

    setCaseTab('suites');
    setExpandedSuites(new Set());
    setSelectedCaseIds(new Set());
    setAssignments({});
    setFormData((prev) => ({
      ...prev,
      name: `Test Run - ${todayStr}`,
    }));
  }, [open, initialSuiteId, suitesWithCases, todayStr]);

  // Silent pre-flight check (only shown if warnings exist)
  useEffect(() => {
    if (!open || !project?.id || selectedCaseIds.size === 0) {
      setPreflightReport(null);
      return;
    }
    let cancelled = false;
    validateRunPlanAction({
      projectId: project.id,
      environmentId: formData.environmentId || undefined,
      caseIds: Array.from(selectedCaseIds),
    })
      .then((report) => {
        if (!cancelled) setPreflightReport(report);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, project?.id, formData.environmentId, selectedCaseIds]);

  const automationCounts = useMemo(() => getAutomationFilterCounts(allCases || []), [allCases]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (effectivePickerMode) count++;
    if (effectivePickerSource) count++;
    if (repoModuleFilter) count++;
    if (repoPriorityFilter) count++;
    if (repoTagFilter) count++;
    if (selectedTicketKey) count++;
    return count;
  }, [effectivePickerMode, effectivePickerSource, repoModuleFilter, repoPriorityFilter, repoTagFilter, selectedTicketKey]);

  const clearAllFilters = () => {
    setPickerMode('');
    setPickerSource('');
    setRepoModuleFilter('');
    setRepoSubmoduleFilter('');
    setRepoPriorityFilter('');
    setRepoTagFilter('');
    setSelectedTicketKey('');
  };

  // Filtered cases for repository tab
  const filteredRepositoryCases = useMemo(() => {
    const filtered = allCases.filter((c: any) => {
      if (caseSearch) {
        const q = caseSearch.toLowerCase().trim();
        const matchTitle = (c.title || '').toLowerCase().includes(q);
        const matchId = (c.displayId || '').toLowerCase().includes(q);
        const matchTags = (c.tags || []).some((t: string) => t.toLowerCase().includes(q));
        if (!matchTitle && !matchId && !matchTags) return false;
      }
      if (effectivePickerMode) {
        if (!caseMatchesMode(c, effectivePickerMode)) return false;
      }
      if (effectivePickerMode === 'auto' && effectivePickerSource) {
        if (!caseMatchesSource(c, effectivePickerSource)) return false;
      }
      if (repoModuleFilter) {
        if (repoSubmoduleFilter) {
          if (c.moduleId !== repoSubmoduleFilter) return false;
        } else {
          const childIds = modules.filter((m: any) => m.parentId === repoModuleFilter).map((m: any) => m.id);
          const allowedIds = [repoModuleFilter, ...childIds];
          if (!c.moduleId || !allowedIds.includes(c.moduleId)) return false;
        }
      }
      if (repoPriorityFilter && (c.priority || '').toUpperCase() !== repoPriorityFilter.toUpperCase()) return false;
      if (repoTagFilter) {
        const target = repoTagFilter.toLowerCase();
        if (!(c.tags || []).some((t: string) => t.toLowerCase() === target)) return false;
      }
      if (selectedTicketKey) {
        const target = selectedTicketKey.toLowerCase();
        const labels: string[] = c.labels || [];
        const tags: string[] = c.tags || [];
        const match =
          labels.some((l) => l.toLowerCase() === target || l.toLowerCase() === `ticket:${target}`) ||
          tags.some((t) => t.toLowerCase() === target || t.toLowerCase() === `ticket:${target}`);
        if (!match) return false;
      }
      return true;
    });

    return filtered.sort((a: any, b: any) => compareCaseAsc(a, b, caseSearch));
  }, [
    allCases,
    caseSearch,
    effectivePickerMode,
    effectivePickerSource,
    repoModuleFilter,
    repoSubmoduleFilter,
    repoPriorityFilter,
    repoTagFilter,
    selectedTicketKey,
    modules,
  ]);

  const selectedCases = useMemo(() => {
    return allCases.filter((c: any) => selectedCaseIds.has(c.id)).sort((a: any, b: any) => compareCaseAsc(a, b));
  }, [allCases, selectedCaseIds]);

  const draftSelectedCases = useMemo(() => {
    return selectedCases.filter((c: any) => c.status === 'draft' || c.status === 'DRAFT');
  }, [selectedCases]);

  const assignedSelectedCount = useMemo(() => {
    return Array.from(selectedCaseIds).filter((id) => Boolean(assignments[id])).length;
  }, [selectedCaseIds, assignments]);

  const allFilteredRepoCasesSelected = useMemo(() => {
    if (filteredRepositoryCases.length === 0) return false;
    return filteredRepositoryCases.every((c: any) => selectedCaseIds.has(c.id));
  }, [filteredRepositoryCases, selectedCaseIds]);

  const someFilteredRepoCasesSelected = useMemo(() => {
    if (filteredRepositoryCases.length === 0) return false;
    return filteredRepositoryCases.some((c: any) => selectedCaseIds.has(c.id)) && !allFilteredRepoCasesSelected;
  }, [filteredRepositoryCases, selectedCaseIds, allFilteredRepoCasesSelected]);

  const isFilterActive = Boolean(caseSearch);

  const displayedSuites = useMemo(() => {
    if (isFilterActive) {
      return suitesWithCases.filter((s: any) => s.cases.length > 0);
    }
    return suitesWithCases;
  }, [suitesWithCases, isFilterActive]);

  const allSuitesSelected = useMemo(() => {
    if (displayedSuites.length === 0) return false;
    return displayedSuites.every((s: any) => s.cases.length > 0 && s.cases.every((c: any) => selectedCaseIds.has(c.id)));
  }, [displayedSuites, selectedCaseIds]);

  const someSuitesSelected = useMemo(() => {
    if (displayedSuites.length === 0) return false;
    const totalCases = displayedSuites.reduce((acc, s) => acc + s.cases.length, 0);
    const selectedCount = displayedSuites.reduce(
      (acc, s) => acc + s.cases.filter((c: any) => selectedCaseIds.has(c.id)).length,
      0
    );
    return selectedCount > 0 && selectedCount < totalCases;
  }, [displayedSuites, selectedCaseIds]);

  /** Run mode implied by the selection. Display only: the run mode is derived, not user-set. */
  const derivedRunMode = useMemo<'manual' | 'automated' | 'mixed' | ''>(() => {
    if (selectedCaseIds.size === 0) return '';
    const selected = allCases.filter((c: any) => selectedCaseIds.has(c.id));
    const allManual = selected.every((c: any) => caseMatchesMode(c, 'manual'));
    const allAuto = selected.every((c: any) => caseMatchesMode(c, 'auto'));
    return allManual ? 'manual' : allAuto ? 'automated' : 'mixed';
  }, [allCases, selectedCaseIds]);

  const runModeLabel =
    derivedRunMode === 'manual'
      ? 'Manual'
      : derivedRunMode === 'automated'
        ? 'Automated'
        : derivedRunMode === 'mixed'
          ? 'Manual + Automated'
          : '';

  /**
   * Selected cases visible in the current tab's list. The difference against
   * the total selection is only reported as "N of M selected" — filtering
   * never deselects anything.
   */
  const selectedInViewCount = useMemo(() => {
    if (caseTab === 'repository') {
      return filteredRepositoryCases.reduce(
        (n: number, c: any) => n + (selectedCaseIds.has(c.id) ? 1 : 0),
        0
      );
    }
    const visibleIds = new Set<string>();
    displayedSuites.forEach((s: any) => s.cases.forEach((c: any) => visibleIds.add(c.id)));
    let count = 0;
    selectedCaseIds.forEach((id) => {
      if (visibleIds.has(id)) count += 1;
    });
    return count;
  }, [caseTab, filteredRepositoryCases, displayedSuites, selectedCaseIds]);

  if (!project) return null;

  const memberOptions = [
    { value: '', label: 'Unassigned' },
    ...members.map((m: any) => ({ value: String(m.userId), label: m.user.name })),
  ];

  // Reset selected cases & assignments when switching between From Suites and From Repository
  const handleTabChange = (nextTab: string) => {
    if (nextTab === caseTab) return;
    setCaseTab(nextTab);
    setSelectedCaseIds(new Set());
    setAssignments({});
    setBulkAssignee(0);
    setExpandedSuites(new Set());
    if (nextTab === 'repository') {
      setFormData((prev) => {
        const matchesSuiteName = suitesWithCases.some(
          (s: any) => prev.name === `${s.name} - ${todayStr}`
        );
        if (matchesSuiteName) {
          return { ...prev, name: `Test Run - ${todayStr}` };
        }
        return prev;
      });
    }
  };

  const handleCaseClickWithShift = (caseId: string, shiftKey: boolean, list: any[]) => {
    setSelectedCaseIds((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastClickedId) {
        const lastIdx = list.findIndex((c) => c.id === lastClickedId);
        const currIdx = list.findIndex((c) => c.id === caseId);
        if (lastIdx !== -1 && currIdx !== -1) {
          const [start, end] = [Math.min(lastIdx, currIdx), Math.max(lastIdx, currIdx)];
          for (let i = start; i <= end; i++) {
            next.add(list[i].id);
          }
          return next;
        }
      }

      if (next.has(caseId)) next.delete(caseId);
      else next.add(caseId);
      return next;
    });
    setLastClickedId(caseId);
  };

  const handleToggleAllRepoCases = () => {
    setSelectedCaseIds((prev) => {
      const next = new Set(prev);
      if (allFilteredRepoCasesSelected) {
        filteredRepositoryCases.forEach((c: any) => next.delete(c.id));
      } else {
        filteredRepositoryCases.forEach((c: any) => next.add(c.id));
      }
      return next;
    });
  };

  const handleSelectByPriority = (priorities: string[]) => {
    setSelectedCaseIds((prev) => {
      const next = new Set(prev);
      const targetCases = filteredRepositoryCases.filter((c: any) =>
        priorities.map((p) => p.toLowerCase()).includes((c.priority || '').toLowerCase())
      );
      targetCases.forEach((c: any) => next.add(c.id));
      return next;
    });
  };

  const handleSelectAllSuites = (select: boolean) => {
    setSelectedCaseIds((prev) => {
      const next = new Set(prev);
      displayedSuites.forEach((s: any) => {
        s.cases.forEach((c: any) => {
          if (select) next.add(c.id);
          else next.delete(c.id);
        });
      });
      return next;
    });
  };

  const handleToggleExpandAllSuites = (expand: boolean) => {
    if (expand) {
      setExpandedSuites(new Set(displayedSuites.map((s) => s.id)));
    } else {
      setExpandedSuites(new Set());
    }
  };

  const handleToggleCase = (caseId: string) => {
    setSelectedCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) next.delete(caseId);
      else next.add(caseId);
      return next;
    });
  };

  const handleAssignCase = (caseId: string, val: string) => {
    setAssignments((prev) => {
      const next = { ...prev };
      if (val) next[caseId] = Number(val);
      else delete next[caseId];
      return next;
    });
  };

  const handleToggleSuite = (suiteId: string) => {
    const suite = suitesWithCases.find((s) => s.id === suiteId);
    if (!suite) return;
    const caseIds = suite.cases.map((c: any) => c.id);
    const allSelected = caseIds.length > 0 && caseIds.every((id: string) => selectedCaseIds.has(id));

    if (allSelected) {
      // Unselect this suite
      setSelectedCaseIds(new Set());
      setAssignments({});
      setFormData((prev) => ({ ...prev, name: `Test Run - ${todayStr}` }));
    } else {
      // Select ONLY this suite (a test run can only be created from 1 suite)
      setSelectedCaseIds(new Set(caseIds));
      setAssignments(suite.assigneeMap ? { ...suite.assigneeMap } : {});
      setFormData((prev) => ({ ...prev, name: `${suite.name} - ${todayStr}` }));
    }
  };

  const handleToggleExpand = (suiteId: string) => {
    setExpandedSuites((prev) => {
      const next = new Set(prev);
      if (next.has(suiteId)) next.delete(suiteId);
      else next.add(suiteId);
      return next;
    });
  };

  const handleStart = async (forceIncludeDraft = false) => {
    if (!currentUser) {
      toast.error('You must be logged in');
      return;
    }
    if (!formData.name.trim()) {
      toast.error('Please enter a run name');
      return;
    }
    if (selectedCaseIds.size === 0) {
      toast.error('Select at least one test case');
      return;
    }

    if (draftSelectedCases.length > 0 && !forceIncludeDraft) {
      setShowDraftWarningModal(true);
      return;
    }

    setStarting(true);
    try {
      let resolvedSuiteId =
        caseTab === 'suites' && selectedSuitesList.length === 1
          ? selectedSuitesList[0].id
          : undefined;

      const activeAssignments: Record<string, number> = {};
      Object.entries(assignments).forEach(([caseId, uid]) => {
        if (selectedCaseIds.has(caseId) && uid) {
          activeAssignments[caseId] = uid;
        }
      });

      const newRun = await createTestRunAction({
        projectId: project.id,
        name: formData.name.trim(),
        suiteId: resolvedSuiteId,
        releaseId: formData.releaseId || undefined,
        environment: formData.environment || 'UAT',
        environmentId: formData.environmentId || undefined,
        source: formData.mode || 'manual',
        createdBy: currentUser.id,
        testCaseIds: Array.from(selectedCaseIds),
        assignments: activeAssignments,
        config:
          formData.mode !== 'manual'
            ? {
                customVariables: parseOverrideLines(mixedOverridesText),
                stopOnFirstFailure: extStopOnFirstFailure,
                interTestDelayMs: interCaseDelaySec * 1000,
              }
            : undefined,
      });

      setRuns([
        {
          id: newRun.id,
          projectId: newRun.projectId,
          suiteId: newRun.suiteId,
          releaseId: formData.releaseId || null,
          name: newRun.name,
          environment: newRun.environment,
          buildVersion: newRun.buildVersion,
          assignedTo: newRun.assignedTo,
          status: newRun.status,
          startedAt: newRun.startedAt,
          createdBy: newRun.createdBy,
          createdAt: newRun.createdAt,
          results: Array.from(selectedCaseIds).map((tcId) => ({
            testCaseId: tcId,
            test_case_id: tcId,
            status: 'pending',
          })),
        },
        ...runs,
      ]);

      toast.success('Run started');
      onOpenChange(false);
      router.push(`/p/${slug}/runs/${newRun.id}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to start run');
    } finally {
      setStarting(false);
      setShowDraftWarningModal(false);
    }
  };

  const handleStartExternal = async () => {
    if (!currentUser) { toast.error('You must be logged in'); return; }
    const caseIds = Array.from(selectedExternalCaseIds).filter((id) =>
      (allCases || []).some((c: any) => c.id === id)
    );
    if (caseIds.length === 0) {
      toast.error('Select at least one linked test case');
      return;
    }
    if (runType === 'postman' && !postmanEnvMappingResolved) {
      toast.error(
        `No Postman environment is mapped for ${
          formData.environment || 'the selected environment'
        }. Map it in Settings → Integrations before starting the run.`
      );
      return;
    }
    setStarting(true);
    try {
      const name =
        externalRunName.trim() ||
        (runType === 'postman' ? 'Postman Run' : 'Datadog Run') + ` - ${todayStr}`;

      const customVariables: Record<string, string> = {};
      for (const [rawKey, value] of Object.entries(externalOverrides)) {
        const key = formatVariableName(rawKey);
        if (key) customVariables[key] = value;
      }

      const res = await createExternalRunFromCasesAction({
        projectId: project.id,
        name,
        source: runType as 'postman' | 'datadog',
        environmentName: formData.environment,
        caseIds,
        // The footer action is an explicit "Start Run", so create and dispatch
        // through the coordinator in one step.
        startImmediately: true,
        config: {
          customVariables,
          stopOnFirstFailure: extStopOnFirstFailure,
          // "Delay between cases" — the Postman lane only.
          interTestDelayMs: interCaseDelaySec * 1000,
          postman:
            runType === 'postman'
              ? {
                  delayMs: Number(extDelayMs) || 0,
                  timeoutMs: Number(extTimeoutMs) || 15000,
                  bailOnFailure: extBailOnFailure,
                  persistResponses: extPersistResponses,
                  keepVariableValues: extKeepVariableValues,
                }
              : undefined,
          datadog:
            runType === 'datadog'
              ? {
                  executionRule: ddExecutionRule,
                  delayMs: Number(extDelayMs) || 0,
                  retryCount: Number(ddRetryCount) || 0,
                  startUrlOverride: ddStartUrl.trim() || undefined,
                  // Datadog lane: run together (default) or one by one.
                  mode: ddLaneMode,
                  concurrency: ddLaneConcurrency,
                }
              : undefined,
        },
      });

      if (res?.createdRun) {
        setRuns([res.createdRun, ...(runs || [])]);
      }
      toast.success(res?.startError ? 'Run created (start pending)' : 'Run started');
      if (res?.startError) toast.error(res.startError);
      onOpenChange(false);
      if (res?.createdRunId) {
        router.push(`/p/${slug}/runs/${res.createdRunId}`);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to start run');
    } finally {
      setStarting(false);
    }
  };

  const togglePostmanRequest = (order: number) => {
    setSelectedPostmanRequestOrders((prev) =>
      prev.includes(order) ? prev.filter((o) => o !== order) : [...prev, order].sort((a, b) => a - b)
    );
  };

  const toggleDatadogTest = (publicId: string) => {
    setSelectedDatadogPublicIds((prev) =>
      prev.includes(publicId) ? prev.filter((p) => p !== publicId) : [...prev, publicId]
    );
  };

  const externalSelectionCount = selectedExternalCaseIds.size;

  const allSuiteCasesSelected = (suiteId: string) => {
    const suite = suitesWithCases.find((s) => s.id === suiteId);
    if (!suite || suite.cases.length === 0) return false;
    return suite.cases.every((c: any) => selectedCaseIds.has(c.id));
  };

  const someSuiteCasesSelected = (suiteId: string) => {
    const suite = suitesWithCases.find((s) => s.id === suiteId);
    if (!suite) return false;
    return suite.cases.some((c: any) => selectedCaseIds.has(c.id)) && !allSuiteCasesSelected(suiteId);
  };

  const stopOnFailureControl = (
    <label className="flex items-start gap-2 cursor-pointer select-none text-xs">
      <Checkbox
        checked={extStopOnFirstFailure}
        onCheckedChange={(v) => setExtStopOnFirstFailure(Boolean(v))}
        className="mt-0.5"
      />
      <span className="font-medium">
        Stop the run if a case fails
        <span className="block text-[10px] font-normal leading-snug text-muted-foreground">
          Cancels all cases that have not started yet.
        </span>
      </span>
    </label>
  );

  const bailOnFailureControl = hasMultiStepJourneySelected ? (
    <label className="flex items-start gap-2 cursor-pointer select-none text-xs">
      <Checkbox
        checked={extBailOnFailure}
        onCheckedChange={(v) => setExtBailOnFailure(Boolean(v))}
        className="mt-0.5"
      />
      <span className="font-medium">
        Stop remaining steps if a step in this case fails
        <span className="block text-[10px] font-normal leading-snug text-muted-foreground">
          Applies inside each multi-request journey.
        </span>
      </span>
    </label>
  ) : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          onClose={() => onOpenChange(false)}
          className="flex flex-col max-w-4xl w-[95vw] h-[85vh] max-h-[720px] min-h-[580px] p-0 gap-0 overflow-hidden border border-border/80 bg-card text-card-foreground shadow-2xl rounded-2xl"
        >
          {/* Modal Header (No suite badge in header) */}
          <DialogHeader className="px-5 py-3.5 border-b border-border/50 bg-muted/10 space-y-0.5 text-left shrink-0">
            <DialogTitle className="text-base font-bold pr-8">
              {runType === 'postman' ? 'New Postman Run' : runType === 'datadog' ? 'New Datadog Run' : 'New Test Run'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {runType === 'postman'
                ? 'Run already-imported cases linked to Postman. Nothing is created here.'
                : runType === 'datadog'
                ? 'Run already-imported cases linked to Datadog Synthetic tests. Nothing is created here.'
                : 'Configure run details, select test cases, and start execution.'}
            </DialogDescription>
          </DialogHeader>

          {/* Modal Body */}
          <div className="p-4 sm:p-5 space-y-3 min-w-0 w-full flex-1 min-h-0 overflow-y-auto">
            {/* Selection summary — appears as soon as any case is selected. The
                run mode is derived from the selection and shown read-only. */}
            {runType === 'manual' && selectedCaseIds.size > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/[0.06] px-3 py-2 min-w-0">
                <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-primary text-primary-foreground shrink-0">
                    <ListChecks className="h-3 w-3" />
                  </span>
                  <span className="text-xs font-semibold text-foreground tabular-nums">
                    {selectedInViewCount === selectedCaseIds.size
                      ? `${selectedCaseIds.size} selected`
                      : `${selectedInViewCount} of ${selectedCaseIds.size} selected`}
                  </span>
                  {runModeLabel && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="text-[11px] text-muted-foreground">Run mode</span>
                      <span className="inline-flex items-center rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-primary">
                        {runModeLabel}
                      </span>
                    </>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCaseIds(new Set())}
                  className="text-[11px] font-medium text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                >
                  Clear selection
                </button>
              </div>
            )}
            {/* Row 1: Run Name — Postman/Datadog runs put Environment beside it (75/25). */}
            <div
              className={cn(
                'min-w-0',
                runType !== 'manual' &&
                  'grid grid-cols-1 sm:grid-cols-[minmax(0,75%)_minmax(0,1fr)] gap-3 items-end'
              )}
            >
              <div className="min-w-0">
                <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Run Name</label>
                <Input
                  placeholder={
                    runType === 'manual'
                      ? `Test Run - ${todayStr}`
                      : runType === 'postman'
                      ? `Postman Run - ${todayStr}`
                      : `Datadog Run - ${todayStr}`
                  }
                  value={runType === 'manual' ? formData.name : externalRunName}
                  onChange={(e) => {
                    if (runType === 'manual') {
                      setFormData({ ...formData, name: e.target.value });
                    } else {
                      setExternalRunName(e.target.value);
                    }
                  }}
                  className="h-9 text-xs font-medium w-full"
                />
              </div>
              {runType !== 'manual' && (
                <div className="min-w-0">
                  <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Environment</label>
                  <Select
                    value={formData.environment}
                    onValueChange={(val) => {
                      const matched = environmentOptions.find((e) => e.value === val);
                      setFormData({ ...formData, environment: val, environmentId: matched?.id || '' });
                    }}
                    options={environmentOptions.map((e) => ({ value: e.value, label: e.label }))}
                    className="h-9 text-xs"
                  />
                </div>
              )}
            </div>

            {runType !== 'manual' && (
              <div className="space-y-4 min-w-0">
                {/* A. Run context — Environment is the single source of truth and lives
                    beside Run Name; this row only reports problems resolving it. */}
                {runType === 'postman' &&
                  (postmanEnvMappingMissing || postmanCatalogLoading || postmanCatalogUnavailable) && (
                    <div className="min-w-0">
                      {postmanEnvMappingMissing ? (
                        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>
                            No Postman environment is mapped for{' '}
                            <strong>{formData.environment || 'the selected environment'}</strong>. Map it in
                            Settings → Integrations before starting the run.
                          </span>
                        </p>
                      ) : postmanCatalogLoading ? (
                        <p className="text-[11px] text-muted-foreground">Resolving Postman environment…</p>
                      ) : (
                        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                          <span>
                            Could not load the Postman environment mapping. Check the project&apos;s Postman
                            integration, then reopen this dialog.
                          </span>
                        </p>
                      )}
                    </div>
                  )}

                {/* B. Request Selection */}
                <div className="space-y-2 min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Request Selection
                  </div>

                  <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden min-w-0">
                    {/* Search + Select all header */}
                    <div className="p-2.5 space-y-2 border-b border-border/40">
                      <div className="relative min-w-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder={runType === 'postman' ? 'Search linked Postman cases…' : 'Search linked Datadog cases…'}
                          value={externalSearch}
                          onChange={(e) => setExternalSearch(e.target.value)}
                          className="pl-9 h-8 text-xs w-full"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs">
                        <label className="flex items-center gap-2 cursor-pointer font-medium select-none">
                          <Checkbox
                            checked={linkedExternalCaseCount > 0 && selectedExternalCaseIds.size === linkedExternalCaseCount}
                            onCheckedChange={(checked) =>
                              setSelectedExternalCaseIds(
                                checked
                                  ? new Set(linkedExternalGroups.flatMap((g) => g.cases.map((c: any) => c.id)))
                                  : new Set()
                              )
                            }
                          />
                          <span>Select all ({linkedExternalCaseCount})</span>
                        </label>
                        <span className="text-[11px] text-muted-foreground">
                          <strong className="font-mono text-foreground">{selectedExternalCaseIds.size}</strong> of{' '}
                          {linkedExternalCaseCount} selected
                        </span>
                      </div>
                    </div>

                    {/* Flat request list — collection/test grouping labels removed */}
                    {linkedExternalCaseCount === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
                        <Inbox className="h-5 w-5" />
                        <span>
                          No linked {runType === 'postman' ? 'Postman' : 'Datadog'} cases yet. Import from the repository first.
                        </span>
                      </div>
                    ) : (
                      <div className="max-h-[280px] overflow-y-auto divide-y divide-border/30 min-w-0">
                        {linkedExternalGroups.flatMap((group) => group.cases).map((c: any) => (
                          <label
                            key={c.id}
                            className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted/40 cursor-pointer select-none min-w-0"
                          >
                            <Checkbox
                              checked={selectedExternalCaseIds.has(c.id)}
                              onCheckedChange={() => {
                                setSelectedExternalCaseIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(c.id)) next.delete(c.id);
                                  else next.add(c.id);
                                  return next;
                                });
                              }}
                            />
                            {runType === 'postman' ? (
                              <PostmanLogo className="h-3.5 w-3.5 shrink-0" />
                            ) : (
                              <DatadogLogo className="h-3.5 w-3.5 shrink-0" />
                            )}
                            <span className="text-[11px] font-mono text-muted-foreground px-1.5 py-0.5 rounded border border-border/50 shrink-0">
                              {c.displayId}
                            </span>
                            <span className="text-xs font-medium flex-1 min-w-0 truncate text-foreground" title={c.title}>
                              {c.title}
                            </span>
                            <PriorityBadge priority={c.priority} />
                          </label>
                        ))}
                      </div>
                    )}

                    {/* Import prompt moved into the table footer */}
                    <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border/40 bg-muted/20 text-[11px]">
                      <span className="text-muted-foreground">
                        Missing a {runType === 'postman' ? 'request/collection' : 'Synthetic test'}? Import it into the repository first.
                      </span>
                      <button
                        type="button"
                        onClick={() => onRequestImport?.(runType as 'postman' | 'datadog')}
                        className="inline-flex items-center gap-1 font-semibold text-primary hover:underline cursor-pointer shrink-0"
                      >
                        <Plus className="h-3 w-3" />
                        Import now
                      </button>
                    </div>
                  </div>
                </div>


                {/* C. Execution Settings */}
                <div className="space-y-2 min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Execution Settings
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 items-start min-w-0">
                    <div className="min-w-0">
                      <label className="block text-[11px] font-semibold text-foreground/80 mb-1">
                        Delay between cases (seconds)
                      </label>
                      <Input
                        type="number"
                        min={0}
                        value={interCaseDelaySec}
                        onChange={(e) => setInterCaseDelaySec(Math.max(0, Number(e.target.value) || 0))}
                        className="h-8 text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Applies to Postman cases only. Datadog tests start as soon as a slot is free.
                      </p>
                    </div>

                    <div className="min-w-0">
                      <label className="block text-[11px] font-semibold text-foreground/80 mb-1">
                        Delay between requests inside a case (ms)
                      </label>
                      <Input
                        value={extDelayMs}
                        onChange={(e) => setExtDelayMs(e.target.value)}
                        inputMode="numeric"
                        className="h-8 text-xs"
                      />
                    </div>

                    <div className="min-w-0 space-y-2 sm:pt-[22px]">
                      {stopOnFailureControl}
                      {bailOnFailureControl}
                    </div>

                    {runType === 'datadog' && (
                      <>
                        <div className="min-w-0">
                          <label className="block text-[11px] font-semibold text-foreground/80 mb-1">Execution rule</label>
                          <Select
                            value={ddExecutionRule}
                            onValueChange={(v) => setDdExecutionRule(v as 'blocking' | 'non_blocking' | 'skipped')}
                            options={[
                              { value: 'blocking', label: 'Run & Wait for Results' },
                              { value: 'non_blocking', label: 'Trigger Run in Background' },
                              { value: 'skipped', label: 'Skip Execution' },
                            ]}
                            className="h-8 text-xs"
                          />
                          <p className="text-[10px] text-muted-foreground">
                            {ddExecutionRule === 'blocking' && 'Execute the Datadog test and wait for its result before completing the run.'}
                            {ddExecutionRule === 'non_blocking' && 'Start the Datadog test and continue without waiting for its result.'}
                            {ddExecutionRule === 'skipped' && 'Create the run without triggering the Datadog test.'}
                          </p>
                        </div>

                        <div className="min-w-0">
                          <label className="block text-[11px] font-semibold text-foreground/80 mb-1">Datadog tests</label>
                          <Select
                            value={ddLaneMode}
                            onValueChange={(v) => setDdLaneMode(v as 'together' | 'sequential')}
                            options={[
                              { value: 'together', label: 'Run together (default)' },
                              { value: 'sequential', label: 'One by one' },
                            ]}
                            className="h-8 text-xs"
                          />
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {ddLaneMode === 'together'
                              ? 'Several Datadog tests may run at the same time; each result is written as it finishes.'
                              : 'Datadog tests run one after another, in list order.'}
                          </p>
                        </div>

                        {ddLaneMode === 'together' && (
                          <div className="min-w-0">
                            <label className="block text-[11px] font-semibold text-foreground/80 mb-1">
                              At most N at once
                            </label>
                            <Input
                              type="number"
                              min={1}
                              max={5}
                              value={ddLaneConcurrency}
                              onChange={(e) =>
                                setDdLaneConcurrency(Math.min(5, Math.max(1, Number(e.target.value) || 1)))
                              }
                              className="h-8 text-xs"
                            />
                            <p className="text-[10px] text-muted-foreground mt-1">
                              Default 3. Postman cases always run one at a time.
                            </p>
                          </div>
                        )}
                      </>
                    )}

                    {/* Variable overrides detected from the selected requests + environment */}
                    <div className="sm:col-span-2 rounded-xl border border-border/60 bg-muted/10 px-3 py-2.5 space-y-2 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs font-semibold text-foreground/90">Variable Overrides</label>
                        <span className="text-[10px] text-muted-foreground">
                          {detectedExternalVariables.length > 0
                            ? `${detectedExternalVariables.length} available`
                            : 'None available'}
                        </span>
                      </div>

                      {detectedExternalVariables.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">
                          {selectedExternalCases.length === 0
                            ? 'Select one or more requests to detect overridable variables.'
                            : 'No overridable variables found in selected requests.'}
                        </p>
                      ) : (
                        <>
                          {Object.keys(externalOverrides).length > 0 && (
                            <div className="space-y-1.5">
                              {Object.entries(externalOverrides).map(([key, value]) => (
                                <div key={key} className="flex items-center gap-2 min-w-0">
                                  <span
                                    className="inline-flex h-7 max-w-[180px] shrink-0 items-center truncate rounded-md border border-sky-500/30 bg-sky-500/10 px-2 font-mono text-[10.5px] font-semibold text-sky-700 dark:text-sky-300"
                                    title={key}
                                  >
                                    {formatVariableName(key)}
                                  </span>
                                  <Input
                                    value={value}
                                    onChange={(e) =>
                                      setExternalOverrides((prev) => ({ ...prev, [key]: e.target.value }))
                                    }
                                    placeholder={`Value for ${formData.environment || 'environment'}`}
                                    aria-label={`Override value for ${formatVariableName(key)}`}
                                    className="h-7 text-xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExternalOverrides((prev) => {
                                        const next = { ...prev };
                                        delete next[key];
                                        return next;
                                      })
                                    }
                                    className="h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                                    title={`Remove ${formatVariableName(key)}`}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-2">
                            <Select
                              value=""
                              onValueChange={(key) => {
                                if (!key) return;
                                const clean = formatVariableName(key);
                                if (!clean) return;
                                setExternalOverrides((prev) => ({ ...prev, [clean]: prev[clean] ?? '' }));
                              }}
                              options={[
                                {
                                  value: '',
                                  label:
                                    availableOverrideVariables.length === 0
                                      ? 'All variables overridden'
                                      : '+ Add Override',
                                },
                                ...availableOverrideVariables.map((v) => ({ value: v, label: v })),
                              ]}
                              className="h-8 text-xs w-full sm:w-[240px]"
                              disabled={availableOverrideVariables.length === 0}
                              aria-label="Add variable override"
                            />
                            {Object.keys(externalOverrides).length > 0 && (
                              <button
                                type="button"
                                onClick={() => setExternalOverrides({})}
                                className="text-[11px] font-medium text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                              >
                                Clear all
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* D. Advanced Settings */}
                <div className="rounded-xl border border-border/60 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowExternalConfig((v) => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold hover:bg-muted/30 cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Settings2 className="h-3.5 w-3.5" />
                      Advanced Settings
                    </span>
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showExternalConfig && 'rotate-180')} />
                  </button>
                  {showExternalConfig && (
                    <div className="px-3 pb-3 pt-2.5 border-t border-border/40">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 items-start min-w-0">
                        {/* Datadog polling is backend-managed; there is no
                            per-run wait-duration control. */}
                        {runType === 'postman' && (
                          <div className="min-w-0">
                            <label className="block text-[11px] font-semibold text-foreground/80 mb-1">
                              Timeout (ms)
                            </label>
                            <Input
                              value={extTimeoutMs}
                              onChange={(e) => setExtTimeoutMs(e.target.value)}
                              inputMode="numeric"
                              className="h-8 text-xs"
                            />
                          </div>
                        )}

                        {runType === 'postman' ? (
                          <label className="flex items-start gap-2 cursor-pointer select-none text-xs sm:pt-[22px]">
                            <Checkbox
                              checked={extPersistResponses}
                              onCheckedChange={(v) => setExtPersistResponses(Boolean(v))}
                              className="mt-0.5"
                            />
                            <span className="font-medium">
                              Persist responses
                              <span className="block text-[10px] font-normal leading-snug text-muted-foreground">
                                Save each response body with the run results.
                              </span>
                            </span>
                          </label>
                        ) : (
                          <div className="min-w-0">
                            <label className="block text-[11px] font-semibold text-foreground/80 mb-1">Retry count</label>
                            <Input
                              value={ddRetryCount}
                              onChange={(e) => setDdRetryCount(e.target.value)}
                              inputMode="numeric"
                              className="h-8 text-xs"
                            />
                          </div>
                        )}

                        {runType === 'postman' ? (
                          <label className="flex items-start gap-2 cursor-pointer select-none text-xs">
                            <Checkbox
                              checked={extKeepVariableValues}
                              onCheckedChange={(v) => setExtKeepVariableValues(Boolean(v))}
                              className="mt-0.5"
                            />
                            <span className="font-medium">
                              Keep variable values between requests
                              <span className="block text-[10px] font-normal leading-snug text-muted-foreground">
                                Variables set by one request stay available to the next.
                              </span>
                            </span>
                          </label>
                        ) : (
                          <div className="min-w-0">
                            <label className="block text-[11px] font-semibold text-foreground/80 mb-1">Start URL override</label>
                            <Input
                              value={ddStartUrl}
                              onChange={(e) => setDdStartUrl(e.target.value)}
                              placeholder="Optional"
                              className="h-8 text-xs"
                            />
                          </div>
                        )}

                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {runType === 'manual' && (
              <>
            {/* Row 2: Environment | Release | Assign All To */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 min-w-0">
              <div className="min-w-0">
                <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Environment</label>
                <Select
                  value={formData.environment}
                  onValueChange={(val) => {
                    const matched = environmentOptions.find((e) => e.value === val);
                    setFormData({
                      ...formData,
                      environment: val,
                      environmentId: matched?.id || '',
                    });
                  }}
                  options={environmentOptions.map((e) => ({
                    value: e.value,
                    label: e.label,
                  }))}
                  className="h-9 text-xs"
                />
              </div>

              <div className="min-w-0">
                <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Release</label>
                <Select
                  value={formData.releaseId}
                  onValueChange={(val) => setFormData({ ...formData, releaseId: val })}
                  options={[
                    { value: '', label: 'No Release' },
                    ...projectReleases.map((rel: any) => ({
                      value: rel.id,
                      label: rel.name,
                    })),
                  ]}
                  className="h-9 text-xs"
                />
              </div>

              <div className="min-w-0">
                <label className="block text-xs font-semibold text-foreground/90 mb-1.5">Assign All To</label>
                <Select
                  value={bulkAssignee ? String(bulkAssignee) : ''}
                  onValueChange={(val) => {
                    const uid = Number(val);
                    setBulkAssignee(uid);
                    const next: Record<string, number> = { ...assignments };
                    const targetIds =
                      selectedCaseIds.size > 0
                        ? Array.from(selectedCaseIds)
                        : allCases.map((c: any) => c.id);
                    targetIds.forEach((id) => {
                      if (uid) next[id] = uid;
                      else delete next[id];
                    });
                    setAssignments(next);
                  }}
                  options={[
                    { value: '', label: 'Unassigned' },
                    ...members.map((m: any) => ({ value: String(m.userId), label: m.user.name })),
                  ]}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Run-level automated settings. Collapsed by default: the run
                environment is the default for every linked case, and overrides
                are only needed for exceptional runs. */}
            {runType === 'manual' && formData.mode !== 'manual' && (
              <div className="rounded-xl border border-border/60 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAutomatedSettings((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold hover:bg-muted/30 cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2">
                    <Settings2 className="h-3.5 w-3.5" />
                    Automated runner settings
                  </span>
                  <span className="flex items-center gap-2 text-[11px] font-normal text-muted-foreground">
                    <span>Environment: {formData.environment || 'UAT'}</span>
                    <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showAutomatedSettings && 'rotate-180')} />
                  </span>
                </button>
                {showAutomatedSettings && (
                  <div className="px-3 pb-3 pt-2.5 border-t border-border/40 space-y-3">
                    <p className="text-[11px] text-muted-foreground">
                      Automated cases use this run&apos;s environment. Add overrides only when this run
                      needs different values. Use one <span className="font-mono">KEY=VALUE</span> per line.
                    </p>
                    {selectedCases.some((c: any) => getCaseAutomationSource(c) === 'external') && (
                      <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                        Some selected cases are automated elsewhere but are not linked to Postman or
                        Datadog. They stay in the run for tracking, but InkaTest cannot execute them.
                      </p>
                    )}
                    <Textarea
                      value={mixedOverridesText}
                      onChange={(e) => setMixedOverridesText(e.target.value)}
                      placeholder={'BASE_URL=https://uat.example.com\nauth_token=...'}
                      className="min-h-[88px] font-mono text-xs"
                    />
                    <label className="flex items-start gap-2 cursor-pointer select-none text-xs">
                      <Checkbox
                        checked={extStopOnFirstFailure}
                        onCheckedChange={(v) => setExtStopOnFirstFailure(Boolean(v))}
                        className="mt-0.5"
                      />
                      <span className="font-medium">
                        Stop the run if a case fails
                        <span className="block text-[10px] font-normal leading-snug text-muted-foreground">
                          Cancels automated cases that have not started yet.
                        </span>
                      </span>
                    </label>
                    <div className="space-y-1">
                      <label className="block text-[11px] font-semibold text-foreground/90">
                        Delay between cases (seconds)
                      </label>
                      <Input
                        type="number"
                        min={0}
                        value={interCaseDelaySec}
                        onChange={(e) =>
                          setInterCaseDelaySec(Math.max(0, Number(e.target.value) || 0))
                        }
                        className="h-8 w-32 text-xs"
                      />
                      <p className="text-[10px] leading-snug text-muted-foreground">
                        Waits after one case finishes before the next starts. 0 means back to
                        back. This is separate from a case&apos;s delay between its requests.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Selected Suite Section (Positioned right above the case selection tabs) */}
            {selectedSuitesList.length > 0 && (
              <div className="min-w-0">
                <label className="block text-xs font-semibold text-foreground/90 mb-1.5">
                  Selected Suite{selectedSuitesList.length > 1 ? 's' : ''}
                </label>
                <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-xl border border-border/60 bg-muted/20">
                  {selectedSuitesList.map((s: any) => (
                    <div
                      key={s.id}
                      className="inline-flex items-center gap-2 text-xs font-medium text-foreground min-w-0"
                    >
                      <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="font-semibold truncate">{s.name}</span>
                      {s.type && (
                        <>
                          <span className="text-muted-foreground/40">·</span>
                          <SuiteTypeBadge type={s.type} />
                        </>
                      )}
                      <span className="text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border/50">
                        {s.selectedCount}/{s.cases.length} cases
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleSuite(s.id)}
                        className="p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title="Unselect suite"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Only show Pre-flight Advisory when variables or parameters are actually missing */}
            {preflightReport && !preflightReport.valid && (
              <details className="group rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs">
                <summary className="flex items-center gap-1.5 px-3 py-2 font-semibold cursor-pointer select-none list-none">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span className="truncate">
                    {preflightReport.warnings[0] || 'Pre-flight check needs attention'}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] font-medium underline underline-offset-2 opacity-80 group-open:hidden">
                    Details
                  </span>
                </summary>
                <div className="px-3 pb-2 space-y-0.5">
                  {preflightReport.warnings.map((w, idx) => (
                    <p key={idx} className="pl-5 text-[11px] leading-relaxed">
                      • {w}
                    </p>
                  ))}
                </div>
              </details>
            )}

            {/* Case Selection Section (2 Tabs: From Suites | From Repository) */}
            <Tabs value={caseTab} onValueChange={handleTabChange} className="space-y-2.5 min-w-0 w-full">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <TabsList className="grid grid-cols-2 w-full sm:w-[320px] h-8">
                  <TabsTrigger value="suites" className="text-xs py-1">
                    From Suites ({displayedSuites.length})
                  </TabsTrigger>
                  <TabsTrigger value="repository" className="text-xs py-1">
                    From Repository ({filteredRepositoryCases.length})
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* TAB 1: FROM SUITES */}
              <TabsContent value="suites" className="mt-2 space-y-2 min-w-0 w-full">
                {displayedSuites.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-border/60 bg-muted/20 text-xs gap-2">
                    <span className="text-muted-foreground font-medium">Select a suite for this run</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleExpandAllSuites(expandedSuites.size < displayedSuites.length)}
                      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {expandedSuites.size < displayedSuites.length ? 'Expand all' : 'Collapse all'}
                    </Button>
                  </div>
                )}

                <div className="space-y-1.5 min-h-[200px] max-h-[260px] overflow-y-auto pr-1 min-w-0">
                  {displayedSuites.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      {isFilterActive
                        ? 'No test suites match the selected filter'
                        : 'No suites available'}
                    </p>
                  )}
                  {displayedSuites.map((suite) => {
                    const selectedInSuite = suite.cases.filter((c: any) => selectedCaseIds.has(c.id)).length;
                    const isExpanded = expandedSuites.has(suite.id);

                    return (
                      <div
                        key={suite.id}
                        className={cn(
                          'border rounded-xl overflow-hidden transition-colors min-w-0',
                          selectedInSuite > 0
                            ? 'border-primary/40 bg-primary/[0.03]'
                            : 'border-border/60 bg-card/40'
                        )}
                      >
                        <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/30 transition-colors min-w-0">
                          <button
                            type="button"
                            onClick={() => handleToggleExpand(suite.id)}
                            className="p-0.5 hover:text-foreground text-muted-foreground transition-colors cursor-pointer shrink-0"
                            title={isExpanded ? 'Hide cases' : 'Show cases & assignees'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRightIcon className="h-4 w-4" />
                            )}
                          </button>
                          <Checkbox
                            checked={allSuiteCasesSelected(suite.id)}
                            ref={(el) => {
                              if (el) {
                                const indeterminate = someSuiteCasesSelected(suite.id);
                                (el as any).indeterminate = indeterminate;
                              }
                            }}
                            onCheckedChange={() => handleToggleSuite(suite.id)}
                          />
                          <span
                            className="text-xs font-semibold flex-1 min-w-0 truncate cursor-pointer text-foreground hover:text-primary transition-colors"
                            onClick={() => handleToggleExpand(suite.id)}
                          >
                            {suite.name}
                          </span>
                          {suite.type && <SuiteTypeBadge type={suite.type} className="shrink-0" />}
                          <span className="text-[11px] font-mono text-muted-foreground bg-muted/60 px-2 py-0.5 rounded border border-border/50 shrink-0">
                            {selectedInSuite}/{suite.cases.length}
                          </span>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-border/50 divide-y divide-border/30 bg-background/50 min-w-0">
                            {suite.cases.map((c: any) => (
                              <div
                                key={c.id}
                                onClick={(e) => handleCaseClickWithShift(c.id, e.shiftKey, suite.cases)}
                                className="flex items-center gap-2.5 px-4 py-1.5 hover:bg-muted/30 cursor-pointer select-none transition-colors min-w-0"
                              >
                                <div onClick={(e) => e.stopPropagation()} className="flex items-center shrink-0">
                                  <Checkbox
                                    checked={selectedCaseIds.has(c.id)}
                                    onCheckedChange={() => handleToggleCase(c.id)}
                                  />
                                </div>
                                <span className="text-xs font-mono font-semibold text-primary w-16 shrink-0">
                                  {c.displayId}
                                </span>
                                <span className="text-xs font-medium text-foreground flex-1 min-w-0 truncate" title={c.title}>
                                  {c.title}
                                </span>
                                <CaseSourceIcon testCase={c} className="shrink-0" />
                                <PriorityBadge priority={c.priority} className="shrink-0" />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              {/* TAB 2: FROM REPOSITORY */}
              <TabsContent value="repository" className="mt-2 space-y-2 min-w-0 w-full">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search cases by title, ID, or tags..."
                      value={caseSearch}
                      onChange={(e) => setCaseSearch(e.target.value)}
                      className="pl-9 pr-7 h-8 text-xs w-full"
                    />
                    {caseSearch && (
                      <button
                        type="button"
                        onClick={() => setCaseSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Single Consolidated Filters Popover */}
                  <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          'h-8 px-3 text-xs gap-1.5 rounded-xl shrink-0 cursor-pointer',
                          activeFiltersCount > 0 && 'border-primary/50 bg-primary/10 text-primary'
                        )}
                      >
                        <Filter className="h-3.5 w-3.5" />
                        <span>Filters</span>
                        {activeFiltersCount > 0 && (
                          <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                            {activeFiltersCount}
                          </span>
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="z-[100] w-72 p-3.5 space-y-3 rounded-xl max-h-[70vh] overflow-y-auto">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-foreground">Filter Cases</span>
                        {activeFiltersCount > 0 && (
                          <button
                            type="button"
                            onClick={clearAllFilters}
                            className="text-[11px] text-primary hover:underline cursor-pointer"
                          >
                            Reset filters
                          </button>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Mode</label>
                        <Select
                          value={pickerMode}
                          onValueChange={(val) => {
                            const nextMode = val as '' | 'manual' | 'auto';
                            setPickerMode(nextMode);
                            if (nextMode !== 'auto') setPickerSource('');
                          }}
                          options={[
                            { value: '', label: `All modes (${automationCounts.all})` },
                            { value: 'manual', label: `Manual (${automationCounts.manual})` },
                            { value: 'auto', label: `Automated (${automationCounts.auto})` },
                          ]}
                          className="h-8 text-xs"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Integration</label>
                        <Select
                          value={pickerSource}
                          disabled={pickerMode !== 'auto'}
                          onValueChange={(val) => setPickerSource(val)}
                          options={[
                            { value: '', label: 'All integrations' },
                            ...getAutomationSourceOptions().map((option) => ({
                              value: option.value,
                              label: `${option.label} (${automationCounts[option.value] ?? 0})`,
                            })),
                            {
                              value: 'external',
                              label: `${EXTERNAL_SOURCE_LABEL} (${automationCounts.external ?? 0})`,
                            },
                          ]}
                          className="h-8 text-xs"
                        />
                        {pickerMode !== 'auto' && (
                          <p className="text-[10px] leading-snug text-muted-foreground">
                            Select <strong>Automated</strong> to filter by integration.
                          </p>
                        )}
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Module</label>
                        <Select
                          value={repoModuleFilter}
                          onValueChange={(val) => {
                            setRepoModuleFilter(val);
                            setRepoSubmoduleFilter('');
                          }}
                          options={[
                            { value: '', label: 'All Modules' },
                            ...modules
                              .filter((m: any) => !m.parentId)
                              .map((m: any) => ({ value: m.id, label: m.name })),
                          ]}
                          className="h-8 text-xs"
                        />
                      </div>

                      {repoModuleFilter && modules.some((m: any) => m.parentId === repoModuleFilter) && (
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-muted-foreground">Sub-module</label>
                          <Select
                            value={repoSubmoduleFilter}
                            onValueChange={setRepoSubmoduleFilter}
                            options={[
                              { value: '', label: 'All Sub-modules' },
                              ...modules
                                .filter((m: any) => m.parentId === repoModuleFilter)
                                .map((sm: any) => ({ value: sm.id, label: sm.name })),
                            ]}
                            className="h-8 text-xs"
                          />
                        </div>
                      )}

                      <div className="space-y-1">
                        <label className="text-[11px] font-medium text-muted-foreground">Priority</label>
                        <Select
                          value={repoPriorityFilter}
                          onValueChange={setRepoPriorityFilter}
                          options={[
                            { value: '', label: 'All Priorities' },
                            { value: 'P0', label: 'P0 - Critical' },
                            { value: 'P1', label: 'P1 - High' },
                            { value: 'P2', label: 'P2 - Medium' },
                            { value: 'P3', label: 'P3 - Low' },
                          ]}
                          className="h-8 text-xs"
                        />
                      </div>

                      {uniqueRepoTags.length > 0 && (
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-muted-foreground">Tag</label>
                          <Select
                            value={repoTagFilter}
                            onValueChange={setRepoTagFilter}
                            options={[
                              { value: '', label: 'All Tags' },
                              ...uniqueRepoTags.map((t) => ({ value: t, label: t })),
                            ]}
                            className="h-8 text-xs"
                          />
                        </div>
                      )}

                      {uniqueTicketKeys.length > 0 && (
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-muted-foreground">Ticket</label>
                          <Select
                            value={selectedTicketKey}
                            onValueChange={(tk) => {
                              setSelectedTicketKey(tk);
                              if (tk) {
                                setFormData((prev) => ({
                                  ...prev,
                                  name:
                                    prev.name &&
                                    prev.name !== `Test Run - ${todayStr}` &&
                                    !prev.name.startsWith('[')
                                      ? prev.name
                                      : `[${tk}] Test Run - ${todayStr}`,
                                }));
                              }
                            }}
                            options={[
                              { value: '', label: 'All Tickets' },
                              ...uniqueTicketKeys.map((tk) => ({ value: tk, label: tk })),
                            ]}
                            className="h-8 text-xs"
                          />
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>

                {filteredRepositoryCases.length > 0 && (
                  <div className="flex items-center justify-between px-3 py-1.5 rounded-lg border border-border/60 bg-muted/20 text-xs gap-2 flex-wrap min-w-0">
                    <label className="flex items-center gap-2 cursor-pointer font-medium select-none">
                      <Checkbox
                        checked={allFilteredRepoCasesSelected}
                        ref={(el) => {
                          if (el) {
                            (el as any).indeterminate = someFilteredRepoCasesSelected;
                          }
                        }}
                        onCheckedChange={handleToggleAllRepoCases}
                      />
                      <span>Select all filtered ({filteredRepositoryCases.length})</span>
                    </label>
                    <div className="flex items-center gap-1 ml-auto">
                      <span className="text-[10.5px] text-muted-foreground mr-1 hidden sm:inline">Quick select:</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSelectByPriority(['P0'])}
                        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        P0 only
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSelectByPriority(['P0', 'P1'])}
                        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        P0 &amp; P1
                      </Button>
                    </div>
                  </div>
                )}

                <div className="min-h-[200px] max-h-[260px] overflow-y-auto border border-border/60 rounded-xl divide-y divide-border/30 bg-card/40 min-w-0">
                  {filteredRepositoryCases.length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-6">No matching test cases found</p>
                  )}
                  {filteredRepositoryCases.map((c: any) => {
                    const caseTicket =
                      (c.labels || []).find((l: string) => l.startsWith('ticket:'))?.replace('ticket:', '') ||
                      (c.labels || []).find((l: string) => /^[A-Z0-9]+-[0-9]+$/i.test(l)) ||
                      (c.tags || []).find((t: string) => t.startsWith('ticket:'))?.replace('ticket:', '');
                    return (
                      <div
                        key={c.id}
                        onClick={(e) => handleCaseClickWithShift(c.id, e.shiftKey, filteredRepositoryCases)}
                        className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-muted/40 cursor-pointer select-none transition-colors min-w-0"
                      >
                        <div onClick={(e) => e.stopPropagation()} className="flex items-center shrink-0">
                          <Checkbox
                            checked={selectedCaseIds.has(c.id)}
                            onCheckedChange={() => handleToggleCase(c.id)}
                          />
                        </div>
                        <span className="text-xs font-mono font-semibold text-primary w-16 shrink-0">
                          {c.displayId}
                        </span>
                        <span className="text-xs font-medium flex-1 min-w-0 truncate text-foreground" title={c.title}>
                          {c.title}
                        </span>

                        <CaseSourceIcon testCase={c} className="shrink-0" />

                        {caseTicket && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-md bg-muted text-muted-foreground border border-border/60 font-mono text-[10px] font-semibold shrink-0">
                            <Tag className="h-2.5 w-2.5" />
                            <span>{caseTicket}</span>
                          </span>
                        )}

                        <PriorityBadge priority={c.priority} className="shrink-0" />

                      </div>
                    );
                  })}
                </div>
              </TabsContent>
            </Tabs>
              </>
            )}
          </div>

          {/* Flush Modal Footer */}
          <div className="border-t border-border/50 bg-muted/15 px-5 py-3 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="h-8 px-3.5 text-xs">
                Cancel
              </Button>
              {runType === 'manual' ? (
                assignedSelectedCount > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    <strong className="text-foreground font-mono">{assignedSelectedCount}</strong> assigned
                  </span>
                ) : null
              ) : (
                <span className="text-xs text-muted-foreground">
                  <strong className="text-foreground font-mono">{externalSelectionCount}</strong>{' '}
                  {runType === 'postman' ? 'request' : 'test'}
                  {externalSelectionCount !== 1 ? 's' : ''} selected
                </span>
              )}
            </div>

            {runType === 'manual' ? (
              <Button
                size="sm"
                onClick={() => handleStart(false)}
                disabled={starting || !formData.name.trim() || selectedCaseIds.size === 0}
                className="gradient-btn text-white h-8 px-4 text-xs font-semibold gap-1.5 shrink-0"
              >
                <Play className="h-3.5 w-3.5" />
                <span>{starting ? 'Starting...' : `Start Run (${selectedCaseIds.size})`}</span>
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={handleStartExternal}
                disabled={
                  starting ||
                  externalSelectionCount === 0 ||
                  !externalRunName.trim() ||
                  postmanStartBlocked
                }
                className="gradient-btn text-white h-8 px-4 text-xs font-semibold gap-1.5 shrink-0"
              >
                <Play className="h-3.5 w-3.5" />
                <span>
                  {starting
                    ? 'Starting...'
                    : runType === 'postman'
                    ? `Start Postman Run (${selectedExternalCaseIds.size})`
                    : `Start Datadog Run (${selectedExternalCaseIds.size})`}
                </span>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm Start Run with Draft Cases Dialog */}
      <ConfirmModal
        open={showDraftWarningModal}
        onOpenChange={setShowDraftWarningModal}
        title="Include Draft Cases in Test Run?"
        description={
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>
              You are about to start <strong className="text-foreground">&quot;{formData.name}&quot;</strong> with{' '}
              <strong className="text-foreground">{draftSelectedCases.length} draft test case(s)</strong>.
            </p>
            <p>
              Draft cases have not completed peer review yet, but they will be added to this run and can be executed immediately.
            </p>
          </div>
        }
        confirmLabel={`Include & Start Run (${selectedCaseIds.size} cases)`}
        onConfirm={() => handleStart(true)}
      />
    </>
  );
}
