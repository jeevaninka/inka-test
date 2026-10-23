'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PostmanLogo, DatadogLogo } from '@/components/icons/IntegrationLogos';
import {
  getProjectRunnerCatalogAction,
  fetchPostmanCollectionRequestsAction,
  fetchDatadogTestVariablesAction,
  executeTestCaseExternalRunnerAction,
} from '@/app/actions/integrations';
import type {
  ExternalTestExecutionResult,
  PostmanCollectionRequestItem,
} from '@/lib/integrations/tool-clients';
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  SkipForward,
  SlidersHorizontal,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Copy,
  Plus,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { savePostmanEnvironmentVariablesAction } from '@/app/actions/variables';
import { toast } from 'sonner';
import { cn, formatVariableName } from '@/lib/utils';

interface ExternalRunnerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  testCaseId: string;
  testCaseDisplayId?: string;
  testCaseTitle?: string;
  runResultId?: string;
  defaultEnvironment?: string;
  datasetParams?: Record<string, string>;
  resolvedVariables?: Record<string, string>;
  initialCustomFields?: Record<string, any>;
  /** Pin the runner to a single provider (used when launched from a case's Run action). */
  lockedProvider?: 'postman' | 'datadog';
  onExecutionComplete?: (result: ExternalTestExecutionResult) => void;
}

export function ExternalRunnerModal({
  open,
  onOpenChange,
  projectId,
  testCaseId,
  testCaseDisplayId,
  testCaseTitle,
  runResultId,
  defaultEnvironment,
  datasetParams = {},
  resolvedVariables = {},
  initialCustomFields = {},
  lockedProvider,
  onExecutionComplete,
}: ExternalRunnerModalProps) {
  const savedPostman = initialCustomFields?._postman || {};
  const savedDatadog = initialCustomFields?._datadog || {};
  // A run opened from a case is scoped to that case's linked item. The
  // collection/folder picker belongs to the collection-level runner, not here.
  const hasLinkedPostman = Boolean(savedPostman.collectionUid);
  const hasLinkedDatadog = Boolean(savedDatadog.publicIds?.length);

  // The provider this case is pinned to on open. Used for defaults that must not
  // change when the user toggles the provider inside the modal.
  const initialProvider = lockedProvider || (savedDatadog?.publicIds?.length ? 'datadog' : 'postman');
  const [provider, setProvider] = useState<'postman' | 'datadog'>(initialProvider);

  useEffect(() => {
    if (lockedProvider) {
      setProvider(lockedProvider);
      setResult(null);
    }
  }, [lockedProvider]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [catalog, setCatalog] = useState<any>(null);

  // Shared parametrization state
  // New runs default to UAT. A saved per-case environment wins; the project's
  // default environment is only used for Postman runs without a saved value.
  const [environmentName, setEnvironmentName] = useState(
    defaultEnvironment ||
      savedPostman.defaultEnvironment ||
      savedDatadog.defaultEnvironment ||
      'UAT'
  );
  const [saveLinkToCase, setSaveLinkToCase] = useState(true);
  // Every ad-hoc execution is tracked: there is no opt-out path.
  const recordInTestRuns = !runResultId;
  const [customVarsText, setCustomVarsText] = useState(() => {
    if (savedPostman.customVariables && typeof savedPostman.customVariables === 'object') {
      return Object.entries(savedPostman.customVariables)
        .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
        .map(([k, v]) => `${k} = ${v}`)
        .join('; ');
    }
    return '';
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [expandedStepOrders, setExpandedStepOrders] = useState<Set<number>>(new Set());
  const [missingVarInputs, setMissingVarInputs] = useState<Record<string, string>>({});
  const [showMissingVars, setShowMissingVars] = useState(false);
  const [saveVarsToEnv, setSaveVarsToEnv] = useState(true);
  const [savingEnvVars, setSavingEnvVars] = useState(false);

  // Postman-specific state
  const [collectionUid, setCollectionUid] = useState<string>(savedPostman.collectionUid || '');
  const [folderFilter, setFolderFilter] = useState<string>(savedPostman.folderOrRequestFilter || '');
  const [collectionRequests, setCollectionRequests] = useState<PostmanCollectionRequestItem[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [selectedRequestOrders, setSelectedRequestOrders] = useState<Set<number>>(
    () => new Set(Array.isArray(savedPostman.selectedRequestOrders) ? savedPostman.selectedRequestOrders : [])
  );

  const discoveredFolders = React.useMemo(() => {
    const set = new Set<string>();
    for (const r of collectionRequests) {
      if (r.folderPath && r.folderPath.trim()) {
        set.add(r.folderPath.trim());
      }
    }
    return Array.from(set);
  }, [collectionRequests]);

  const visibleRequests = React.useMemo(() => {
    // Linked cases use full-collection order indices; a folder/name filter
    // would make those indices point at the wrong requests.
    if (hasLinkedPostman || !folderFilter.trim()) return collectionRequests;
    const q = folderFilter.trim().toLowerCase();
    return collectionRequests.filter((r) => {
      const fullPath = r.folderPath ? `${r.folderPath} / ${r.name}` : r.name;
      return (
        r.folderPath.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        fullPath.toLowerCase().includes(q)
      );
    });
  }, [collectionRequests, folderFilter, hasLinkedPostman]);

  const linkedPostmanSpecs = React.useMemo(() => {
    const savedSpecs = Array.isArray(savedPostman.requestSpecs) ? savedPostman.requestSpecs : [];
    if (savedSpecs.length > 0) return savedSpecs;
    const selected = collectionRequests.filter((r) => selectedRequestOrders.has(r.order));
    if (selected.length > 0) return selected;
    return savedPostman.requestSpec ? [savedPostman.requestSpec] : [];
  }, [savedPostman.requestSpecs, savedPostman.requestSpec, collectionRequests, selectedRequestOrders]);

  const linkedDatadogLabels = React.useMemo(() => {
    const ids: string[] = Array.isArray(savedDatadog.publicIds) ? savedDatadog.publicIds : [];
    return ids.map((id) => {
      const catalogTest = catalog?.datadog?.tests?.find((t: any) => t.public_id === id);
      return { id, name: catalogTest?.name || id, type: catalogTest?.type || savedDatadog.testType };
    });
  }, [savedDatadog.publicIds, savedDatadog.testType, catalog]);

  // Iteration & SLA state
  const [iterationDataMode, setIterationDataMode] = useState<'none' | 'dataset'>('none');
  const [iterations, setIterations] = useState<number>(1);
  const [maxLatencyMs, setMaxLatencyMs] = useState<string>(
    savedPostman.maxLatencyMs ? String(savedPostman.maxLatencyMs) : ''
  );

  // Native Postman Runner Settings Checkboxes
  const [persistResponses, setPersistResponses] = useState<boolean>(
    savedPostman.persistResponses !== false
  );
  const [turnOffLogs, setTurnOffLogs] = useState<boolean>(Boolean(savedPostman.turnOffLogs));
  const [bailOnFailure, setBailOnFailure] = useState<boolean>(
    savedPostman.bailOnFailure !== undefined ? Boolean(savedPostman.bailOnFailure) : true
  );
  const [keepVariableValues, setKeepVariableValues] = useState<boolean>(
    savedPostman.keepVariableValues !== false
  );
  const [ignoreCookies, setIgnoreCookies] = useState<boolean>(Boolean(savedPostman.ignoreCookies));
  const [saveCookies, setSaveCookies] = useState<boolean>(savedPostman.saveCookies !== false);
  const [enableDelay, setEnableDelay] = useState<boolean>(Number(savedPostman.delayMs ?? 0) > 0);
  const [delayMs, setDelayMs] = useState<number>(savedPostman.delayMs ?? 0);
  const [timeoutMs, setTimeoutMs] = useState<number>(savedPostman.timeoutMs ?? 15000);

  // Datadog-specific state
  const [datadogPublicIdsText, setDatadogPublicIdsText] = useState<string>(
    Array.isArray(savedDatadog.publicIds) ? savedDatadog.publicIds.join(', ') : ''
  );
  const [startUrlOverride, setStartUrlOverride] = useState<string>('');
  const [executionRule, setExecutionRule] = useState<'blocking' | 'non_blocking' | 'skipped'>(
    savedDatadog.executionRule || 'blocking'
  );
  const [ddDelayMs, setDdDelayMs] = useState<number>(savedDatadog.delayMs ?? 0);
  const [retryCount, setRetryCount] = useState<number>(savedDatadog.retryCount ?? 0);

  // Datadog variable overrides (dropdown-based). Overrides are passed to the CI
  // trigger as `variables`, which replaces `{{ NAME }}` for that execution only —
  // the Datadog test definition is never modified.
  const [ddOverrides, setDdOverrides] = useState<Array<{ name: string; value: string }>>(() => {
    const saved = savedDatadog.customVariables;
    if (saved && typeof saved === 'object') {
      return Object.entries(saved)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([name, value]) => ({ name, value: String(value) }));
    }
    return [];
  });
  const [ddVarPick, setDdVarPick] = useState('');
  const [ddNewValue, setDdNewValue] = useState('');
  const [ddAvailableVars, setDdAvailableVars] = useState<
    Array<{ name: string; example?: string; source: string }>
  >([]);
  const [ddVarsSupported, setDdVarsSupported] = useState(true);
  const [ddVarsReason, setDdVarsReason] = useState<string | undefined>(undefined);
  const [loadingDdVars, setLoadingDdVars] = useState(false);

  // Execution state
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ExternalTestExecutionResult | null>(null);

  useEffect(() => {
    if (!open || !projectId) return;
    setLoadingCatalog(true);
    getProjectRunnerCatalogAction(projectId)
      .then((res) => {
        setCatalog(res);
        // Datadog runs always default to UAT; never silently adopt the project
        // default environment for a synthetic execution.
        if (
          !defaultEnvironment &&
          initialProvider !== 'datadog' &&
          !savedDatadog.defaultEnvironment &&
          res.environments?.length > 0
        ) {
          const def = res.environments.find((e: any) => e.isDefault) || res.environments[0];
          if (def?.name) setEnvironmentName(def.name);
        }
        if (!savedPostman.collectionUid && res.postman?.collections?.length > 0) {
          setCollectionUid((prev) => prev || res.postman.collections[0].uid);
        }
        if (res.postman && savedPostman.delayMs === undefined) {
          const d = res.postman.defaultDelayMs ?? 0;
          setDelayMs(d);
          setEnableDelay(d > 0);
          setTimeoutMs(res.postman.defaultTimeoutMs ?? 15000);
          setBailOnFailure(Boolean(res.postman.bailOnFailure));
        }
        if (res.datadog && !savedDatadog.executionRule) {
          setExecutionRule(res.datadog.defaultExecutionRule || 'blocking');
        }
        if (!lockedProvider && !res.postman?.connected && res.datadog?.connected) {
          setProvider('datadog');
        }
      })
      .catch(() => {})
      .finally(() => setLoadingCatalog(false));
  }, [open, projectId, defaultEnvironment, initialProvider, savedPostman.collectionUid, savedPostman.delayMs, savedDatadog.defaultEnvironment, savedDatadog.executionRule, lockedProvider]);

  // Load the variables that Datadog will accept as per-execution overrides.
  useEffect(() => {
    if (!open || provider !== 'datadog' || !projectId) return;
    const publicIds = datadogPublicIdsText
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (publicIds.length === 0) {
      setDdAvailableVars([]);
      setDdVarsSupported(true);
      setDdVarsReason(undefined);
      return;
    }
    let cancelled = false;
    setLoadingDdVars(true);
    fetchDatadogTestVariablesAction({ projectId, publicIds })
      .then((res) => {
        if (cancelled) return;
        setDdAvailableVars(res.variables || []);
        setDdVarsSupported(res.supported !== false);
        setDdVarsReason(res.reason);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setDdAvailableVars([]);
        setDdVarsSupported(false);
        setDdVarsReason(err?.message || 'Could not load overridable variables from Datadog.');
      })
      .finally(() => {
        if (!cancelled) setLoadingDdVars(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, provider, projectId, datadogPublicIdsText]);

  // Load requests in the selected Postman collection so user can select which requests to run
  useEffect(() => {
    if (!open || provider !== 'postman' || !collectionUid.trim() || !projectId) {
      setCollectionRequests([]);
      return;
    }
    let cancelled = false;
    setLoadingRequests(true);
    fetchPostmanCollectionRequestsAction(projectId, collectionUid.trim())
      .then((items) => {
        if (cancelled) return;
        setCollectionRequests(items || []);
        if (items && items.length > 0) {
          setSelectedRequestOrders((prev) => {
            if (prev.size > 0) return prev;
            if (!hasLinkedPostman) return new Set(items.map((it) => it.order));

            // Linked case: never fall back to "select all" (that would run
            // sibling requests from the same folder). Resolve only the linked item.
            const linkedOrders = new Set<number>();
            const savedSpecs = Array.isArray(savedPostman.requestSpecs)
              ? savedPostman.requestSpecs
              : savedPostman.requestSpec
              ? [savedPostman.requestSpec]
              : [];
            for (const spec of savedSpecs) {
              if (typeof spec?.order === 'number') linkedOrders.add(spec.order);
            }
            if (savedPostman.requestId) {
              items
                .filter((it) => it.requestId && it.requestId === savedPostman.requestId)
                .forEach((it) => linkedOrders.add(it.order));
            }
            if (linkedOrders.size === 0 && savedPostman.folderId) {
              items
                .filter((it) => it.folderId && it.folderId === savedPostman.folderId)
                .forEach((it) => linkedOrders.add(it.order));
            }
            if (linkedOrders.size === 0) {
              for (const spec of savedSpecs) {
                const match = items.find(
                  (it) => it.url === spec?.url && it.method === spec?.method
                );
                if (match) linkedOrders.add(match.order);
              }
            }
            return linkedOrders;
          });
        }
      })
      .catch(() => {
        if (!cancelled) setCollectionRequests([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRequests(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, provider, collectionUid, projectId, hasLinkedPostman, savedPostman.requestId, savedPostman.folderId]);

  const parseCustomVariables = (): Record<string, string> => {
    const out: Record<string, string> = { ...resolvedVariables };
    if (customVarsText.trim()) {
      const lines = customVarsText.split(/\r?\n|;/);
      for (const line of lines) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          const k = line.slice(0, idx).trim();
          const v = line.slice(idx + 1).trim();
          if (k) out[k] = v;
        }
      }
    }
    for (const [k, v] of Object.entries(missingVarInputs)) {
      if (v && v.trim()) {
        out[k] = v.trim();
      }
    }
    return out;
  };

  const requiredRequestVars = React.useMemo(() => {
    const keys = new Set<string>();
    const activeReqs = visibleRequests.filter((r) => selectedRequestOrders.has(r.order));
    for (const req of activeReqs) {
      for (const rv of req.requiredVariables || []) {
        if (rv && !rv.startsWith('$')) keys.add(rv);
      }
      const re = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
      for (const str of [req.url, req.bodyPreview]) {
        if (!str) continue;
        let m: RegExpExecArray | null;
        while ((m = re.exec(str)) !== null) {
          if (m[1] && !m[1].startsWith('$')) keys.add(m[1].trim());
        }
      }
    }
    if (keys.size === 0 && Array.isArray(savedPostman.requiredVariables)) {
      for (const rv of savedPostman.requiredVariables) {
        if (rv && !String(rv).startsWith('$')) keys.add(String(rv));
      }
    }
    return Array.from(keys);
  }, [visibleRequests, selectedRequestOrders, savedPostman.requiredVariables]);

  const envScopedVarsMap = React.useMemo(() => {
    const envKey = (environmentName || 'UAT').trim().toUpperCase();
    const fromCatalog = catalog?.postman?.variablesByEnv?.[envKey] || {};
    const manualOverrides: Record<string, string> = { ...resolvedVariables };
    if (customVarsText.trim()) {
      for (const line of customVarsText.split(/\r?\n|;/)) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          const k = line.slice(0, idx).trim();
          const v = line.slice(idx + 1).trim();
          if (k && v) manualOverrides[k] = v;
        }
      }
    }
    return { ...fromCatalog, ...manualOverrides };
  }, [catalog, environmentName, resolvedVariables, customVarsText]);

  const { missingEnvVars, resolvedRequestVars } = React.useMemo(() => {
    const missing: string[] = [];
    const resolved: Array<{ key: string; value: string }> = [];
    const lowerLookup = new Map<string, string>();
    for (const [k, v] of Object.entries(envScopedVarsMap)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        lowerLookup.set(k.toLowerCase(), String(v));
      }
    }

    for (const reqKey of requiredRequestVars) {
      const val = envScopedVarsMap[reqKey] ?? lowerLookup.get(reqKey.toLowerCase());
      if (val && String(val).trim() !== '') {
        resolved.push({ key: reqKey, value: String(val) });
      } else {
        missing.push(reqKey);
      }
    }
    return { missingEnvVars: missing, resolvedRequestVars: resolved };
  }, [requiredRequestVars, envScopedVarsMap]);

  const shouldShowMissingVarsAlert = React.useMemo(() => {
    if (provider !== 'postman' || missingEnvVars.length === 0) return false;
    if (catalog?.postman?.alertOnMissingEnvVars === false) return false;
    if (typeof window !== 'undefined' && projectId) {
      try {
        const raw = localStorage.getItem(`inkatest_project_config_${projectId}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.alertOnMissingEnvVars === false) return false;
        }
      } catch {
        // ignore
      }
    }
    return true;
  }, [provider, missingEnvVars.length, catalog?.postman?.alertOnMissingEnvVars, projectId]);

  const handleSaveMissingVarsToEnv = async () => {
    const nonEmpty: Record<string, string> = {};
    for (const k of missingEnvVars) {
      const v = (missingVarInputs[k] || '').trim();
      if (v) nonEmpty[k] = v;
    }
    if (Object.keys(nonEmpty).length === 0) {
      toast.error(`Enter value(s) for ${environmentName} first.`);
      return;
    }
    setSavingEnvVars(true);
    try {
      await savePostmanEnvironmentVariablesAction({
        projectId,
        environmentName,
        values: nonEmpty,
      });
      setCatalog((prev: any) => {
        if (!prev?.postman) return prev;
        const envKey = environmentName.toUpperCase();
        const prevByEnv = prev.postman.variablesByEnv || {};
        return {
          ...prev,
          postman: {
            ...prev.postman,
            variablesByEnv: {
              ...prevByEnv,
              [envKey]: {
                ...(prevByEnv[envKey] || {}),
                ...nonEmpty,
              },
            },
          },
        };
      });
      toast.success(`Saved ${Object.keys(nonEmpty).length} variable(s) to ${environmentName} Postman Variables`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save environment variables');
    } finally {
      setSavingEnvVars(false);
    }
  };

  const handleToggleRequest = (order: number) => {
    setSelectedRequestOrders((prev) => {
      const next = new Set(prev);
      if (next.has(order)) next.delete(order);
      else next.add(order);
      return next;
    });
  };

  const handleExecute = async () => {
    if (provider === 'postman' && hasLinkedPostman && selectedRequestOrders.size === 0) {
      toast.error('Linked request could not be resolved. Re-sync from Postman in the case menu.');
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      // If user filled in missing environment variable inputs and checked "Save to Env", persist them first
      if (provider === 'postman' && saveVarsToEnv) {
        const nonEmptyMissing: Record<string, string> = {};
        for (const [k, v] of Object.entries(missingVarInputs)) {
          if (v && v.trim()) nonEmptyMissing[k] = v.trim();
        }
        if (Object.keys(nonEmptyMissing).length > 0) {
          await savePostmanEnvironmentVariablesAction({
            projectId,
            environmentName,
            values: nonEmptyMissing,
          }).catch(() => {});
          setCatalog((prev: any) => {
            if (!prev?.postman) return prev;
            const envKey = environmentName.toUpperCase();
            const prevByEnv = prev.postman.variablesByEnv || {};
            return {
              ...prev,
              postman: {
                ...prev.postman,
                variablesByEnv: {
                  ...prevByEnv,
                  [envKey]: {
                    ...(prevByEnv[envKey] || {}),
                    ...nonEmptyMissing,
                  },
                },
              },
            };
          });
        }
      }

      const publicIds = datadogPublicIdsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const parsedSla = maxLatencyMs.trim() ? parseInt(maxLatencyMs.trim(), 10) : undefined;

      // Datadog overrides are applied to this execution only (CI trigger
      // `variables`), never written back to the Datadog test definition.
      const ddOverrideMap: Record<string, string> = {};
      for (const o of ddOverrides) {
        if (o.name && String(o.value).trim() !== '') {
          ddOverrideMap[o.name] = String(o.value);
        }
      }

      const execRes = await executeTestCaseExternalRunnerAction({
        projectId,
        testCaseId,
        runResultId,
        recordInTestRuns: !runResultId,
        provider,
        environmentName,
        datasetParams,
        customVariables: provider === 'datadog' ? ddOverrideMap : parseCustomVariables(),
        saveLinkToCase,
        postman:
          provider === 'postman'
            ? {
                collectionUid: collectionUid.trim(),
                // Orders are full-collection indices. Applying a folder/name filter
                // first would shift them and run unrelated sibling requests.
                folderOrRequestFilter: hasLinkedPostman
                  ? undefined
                  : folderFilter.trim() || undefined,
                selectedRequestOrders:
                  hasLinkedPostman || (collectionRequests.length > 0 && selectedRequestOrders.size > 0)
                    ? Array.from(selectedRequestOrders)
                    : undefined,
                iterationDataMode,
                iterations,
                delayMs: enableDelay ? delayMs : 0,
                timeoutMs,
                maxLatencyMs: parsedSla && !isNaN(parsedSla) ? parsedSla : undefined,
                bailOnFailure,
                persistResponses,
                turnOffLogs,
                keepVariableValues,
                ignoreCookies,
                saveCookies,
              }
            : undefined,
        datadog:
          provider === 'datadog'
            ? {
                publicIds,
                startUrlOverride: startUrlOverride.trim() || undefined,
                executionRule,
                delayMs: ddDelayMs,
                retryCount,
              }
            : undefined,
      });

      setResult(execRes);
      setExpandedStepOrders(new Set((execRes.steps || []).map((s) => s.order)));
      if (execRes.overallStatus === 'PENDING') {
        toast.info(execRes.summary || 'Run started — awaiting Datadog results.');
      } else if (execRes.overallStatus === 'PASS') {
        toast.success(execRes.summary);
      } else if (execRes.overallStatus === 'SKIP') {
        toast.info(execRes.summary);
      } else {
        toast.error(execRes.summary);
      }
      onExecutionComplete?.(execRes);
    } catch (err: any) {
      toast.error(err?.message || 'Execution failed');
    } finally {
      setRunning(false);
    }
  };

  const envOptions: Array<{ name: string; baseUrl?: string }> =
    catalog?.environments?.length > 0
      ? [
          ...catalog.environments,
          ...['DEV', 'STAGING', 'UAT', 'PROD']
            .filter(
              (std) =>
                !catalog.environments.some(
                  (e: any) => String(e.name).toUpperCase() === std
                )
            )
            .map((name) => ({ name })),
        ]
      : [{ name: 'DEV' }, { name: 'STAGING' }, { name: 'UAT' }, { name: 'PROD' }];

  const activeDatasetKeys = Object.keys(datasetParams);

  const addDdOverride = () => {
    const name = ddVarPick.trim();
    const value = ddNewValue.trim();
    if (!name || !value) return;
    setDdOverrides((prev) => [...prev.filter((o) => o.name !== name), { name, value }]);
    setDdVarPick('');
    setDdNewValue('');
  };
  const updateDdOverride = (idx: number, value: string) => {
    setDdOverrides((prev) => prev.map((o, i) => (i === idx ? { ...o, value } : o)));
  };
  const removeDdOverride = (name: string) => {
    setDdOverrides((prev) => prev.filter((o) => o.name !== name));
  };
  const ddVarPickPlaceholder = ddVarPick
    ? ddAvailableVars.find((v) => v.name === ddVarPick)?.example || 'Override value'
    : 'Override value';
  const executionRuleSubtext =
    executionRule === 'blocking'
      ? 'Wait for the Datadog result before the case can pass or fail.'
      : executionRule === 'non_blocking'
        ? 'Trigger the test, but do not let its result block this run.'
        : 'Do not trigger the test; record it as skipped.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onClose={() => onOpenChange(false)}
        className="max-w-2xl w-[95vw] p-0 gap-0 overflow-hidden bg-card text-card-foreground border border-border rounded-2xl shadow-2xl max-h-[88vh] flex flex-col"
      >
        <DialogHeader className="px-5 py-3.5 border-b border-border/60 bg-muted/20 space-y-1 text-left shrink-0">
          <div className="flex items-center justify-between pr-8 gap-2">
            <DialogTitle className="text-base font-bold text-foreground flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              <span>Run Automated API / Synthetic Test</span>
              {testCaseDisplayId && (
                <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/25">
                  {testCaseDisplayId}
                </span>
              )}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground truncate">
            {testCaseTitle || 'Execute linked Postman collection or Datadog Synthetic test with live environment variables & dataset parameters.'}
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 flex-1 overflow-y-auto space-y-4 text-xs">
          {/* Provider Switcher (hidden when a provider is pinned by the caller) */}
          {!lockedProvider && (
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                setProvider('postman');
                setResult(null);
              }}
              className={cn(
                'flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer',
                provider === 'postman'
                  ? 'border-primary bg-primary/[0.08] text-foreground shadow-2xs'
                  : 'border-border/70 bg-background/60 hover:bg-muted/50 text-muted-foreground'
              )}
            >
              <PostmanLogo className="h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-xs text-foreground">Postman Runner</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {catalog?.postman?.connected ? 'Connected · Functional & Latency Runner' : 'Configure in Workspace Integrations'}
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setProvider('datadog');
                setResult(null);
              }}
              className={cn(
                'flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition-all cursor-pointer',
                provider === 'datadog'
                  ? 'border-primary bg-primary/[0.08] text-foreground shadow-2xs'
                  : 'border-border/70 bg-background/60 hover:bg-muted/50 text-muted-foreground'
              )}
            >
              <DatadogLogo className="h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-xs text-foreground">Datadog Synthetics</div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {catalog?.datadog?.connected
                    ? `Connected (${catalog.datadog.site})`
                    : 'Configure in Workspace Integrations'}
                </div>
              </div>
            </button>
          </div>
          )}

          {/* Environment & Parameterization Strip (Postman, or when dataset
              parameters are active for the selected case). */}
          {(provider === 'postman' || activeDatasetKeys.length > 0) && (
          <div className="p-3 rounded-xl border border-border/70 bg-muted/25 space-y-2.5">
            {/* Postman parametrization. Datadog uses its own compact
                Environment & Test / Variable Overrides sections below. */}
            {provider === 'postman' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-foreground block">
                    Target Environment
                  </label>
                  <select
                    value={environmentName}
                    onChange={(e) => setEnvironmentName(e.target.value)}
                    className="w-full h-8 rounded-lg border border-input bg-background px-2.5 text-xs font-semibold text-foreground"
                  >
                    {envOptions.map((env) => (
                      <option key={env.name} value={env.name}>
                        {env.name} {env.baseUrl ? `(${env.baseUrl})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-foreground block">
                    Variable Overrides (Optional, KEY=VALUE)
                  </label>
                  <Input
                    value={customVarsText}
                    onChange={(e) => setCustomVarsText(e.target.value)}
                    placeholder="e.g. BASE_URL=https://uat.app.io; AUTH_TOKEN=xyz"
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {activeDatasetKeys.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border/40 text-[11px]">
                <span className="text-muted-foreground font-medium">Active Dataset Params:</span>
                {activeDatasetKeys.map((k) => (
                  <span
                    key={k}
                    className="px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/25 font-mono text-[10px] font-semibold"
                  >
                    &#123;{k}&#125; = {String(datasetParams[k])}
                  </span>
                ))}
              </div>
            )}

            {/* Resolved Environment Variables Summary */}
            {provider === 'postman' && resolvedRequestVars.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1.5 border-t border-border/40 text-[11px]">
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>{environmentName} Variables:</span>
                </span>
                {resolvedRequestVars.map((rv) => (
                  <span
                    key={rv.key}
                    className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 font-mono text-[10px] truncate max-w-[260px]"
                    title={`${formatVariableName(rv.key)} = ${rv.value}`}
                  >
                    {formatVariableName(rv.key)} = {rv.value}
                  </span>
                ))}
              </div>
            )}

            {/* Missing Environment Variables: collapsed by default. Saved values
                are resolved above, so this only appears for genuinely missing ones. */}
            {shouldShowMissingVarsAlert && (
              <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs min-w-0">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <span className="text-foreground truncate">
                      <strong>{missingEnvVars.length}</strong> variable{missingEnvVars.length === 1 ? '' : 's'} need
                      {missingEnvVars.length === 1 ? 's' : ''} values for <strong>{environmentName}</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowMissingVars((v) => !v)}
                    className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline cursor-pointer shrink-0"
                  >
                    {showMissingVars ? 'Hide' : 'Fill in'}
                  </button>
                </div>

                {showMissingVars && (
                  <div className="mt-2 pt-2 border-t border-amber-500/20 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {missingEnvVars.map((varKey) => (
                        <div key={varKey} className="flex items-center gap-1.5 min-w-0">
                          <span
                            className="font-mono text-[10.5px] font-semibold px-1.5 py-1 rounded bg-background/80 border border-amber-500/25 text-amber-700 dark:text-amber-300 shrink-0 max-w-[140px] truncate"
                            title={formatVariableName(varKey)}
                          >
                            {formatVariableName(varKey)}
                          </span>
                          <Input
                            value={missingVarInputs[varKey] || ''}
                            onChange={(e) =>
                              setMissingVarInputs((prev) => ({
                                ...prev,
                                [varKey]: e.target.value,
                              }))
                            }
                            placeholder="Value"
                            className="h-7 text-xs font-mono bg-background flex-1 min-w-0"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={saveVarsToEnv}
                          onChange={(e) => setSaveVarsToEnv(e.target.checked)}
                          className="rounded border-border text-primary h-3.5 w-3.5"
                        />
                        <span>
                          Save entered value(s) to <strong>{environmentName}</strong> in Postman / API Variables on run
                        </span>
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={savingEnvVars}
                        onClick={handleSaveMissingVarsToEnv}
                        className="h-7 px-2.5 text-[11px] font-semibold border-amber-500/40 hover:bg-amber-500/20 shrink-0 cursor-pointer"
                      >
                        {savingEnvVars ? 'Saving...' : `Save to ${environmentName}`}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          )}

          {/* Provider-Specific Configuration */}
          {provider === 'postman' ? (
            <div className="space-y-3.5">
              {hasLinkedPostman && (
                <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10.5px] uppercase font-semibold text-muted-foreground">
                      Linked to this case
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">
                      {savedPostman.collectionName || 'Postman collection'}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {linkedPostmanSpecs.length > 0 ? (
                      linkedPostmanSpecs.map((spec: any, idx: number) => (
                        <div key={`${spec?.requestId || spec?.order || idx}`} className="flex items-center gap-2 text-xs font-mono min-w-0">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-background border border-border/50 shrink-0">
                            {spec?.method || 'REQ'}
                          </span>
                          <span className="truncate text-foreground/90" title={spec?.name || spec?.url}>
                            {spec?.name || spec?.url || 'Linked request'}
                          </span>
                          <span className="truncate text-muted-foreground/70 ml-auto max-w-[45%]" title={spec?.url}>
                            {spec?.url || ''}
                          </span>
                        </div>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">Linked request details unavailable.</span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground/70">
                    This run executes only the request(s) linked to this case. Use &quot;Sync from Postman&quot; in the case menu to pick up source changes.
                  </p>
                </div>
              )}

              {!hasLinkedPostman && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  No Postman request is linked to this case. Link one from the case menu before running.
                </div>
              )}

              {/* Collapsible Advanced Runner Options */}
              <div className="rounded-xl border border-border/70 bg-muted/15 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((prev) => !prev)}
                  className="w-full px-3 py-2 flex items-center justify-between text-xs font-semibold text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-1.5">
                    {showAdvanced ? (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span>Advanced Runner Settings (Iterations, SLA &amp; Cookies)</span>
                  </span>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {iterations} iter{maxLatencyMs ? ` · SLA ${maxLatencyMs}ms` : ''}
                  </span>
                </button>

                {showAdvanced && (
                  <div className="p-3 border-t border-border/60 space-y-3">
                    {/* Iteration Data, Iterations & Max Latency SLA */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-foreground block">
                          Iteration Data
                        </label>
                        <select
                          value={iterationDataMode}
                          onChange={(e) => setIterationDataMode(e.target.value as 'none' | 'dataset')}
                          className="w-full h-8 rounded-lg border border-input bg-background px-2 text-xs font-medium text-foreground"
                        >
                          <option value="none">None (Single / Current Row)</option>
                          <option value="dataset">Test Case Dataset Rows</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-foreground block">
                          Iterations
                        </label>
                        <Input
                          type="number"
                          min={1}
                          max={20}
                          value={iterations}
                          onChange={(e) => setIterations(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                          className="h-8 text-xs font-mono"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-foreground block">
                          Max Latency SLA (Optional, ms)
                        </label>
                        <Input
                          type="number"
                          min={50}
                          placeholder="e.g. 1500 (Fail if slower)"
                          value={maxLatencyMs}
                          onChange={(e) => setMaxLatencyMs(e.target.value)}
                          className="h-8 text-xs font-mono"
                        />
                      </div>
                    </div>

                    {/* Native Postman Settings Checkboxes */}
                    <div className="space-y-2 pt-2 border-t border-border/50">
                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={persistResponses}
                          onChange={(e) => setPersistResponses(e.target.checked)}
                          className="rounded border-border text-primary h-3.5 w-3.5"
                        />
                        <span className="text-foreground font-medium">Persist responses for a session</span>
                      </label>

                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={turnOffLogs}
                          onChange={(e) => setTurnOffLogs(e.target.checked)}
                          className="rounded border-border text-primary h-3.5 w-3.5"
                        />
                        <span className="text-foreground font-medium">Turn off logs during run</span>
                      </label>

                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={bailOnFailure}
                          onChange={(e) => setBailOnFailure(e.target.checked)}
                          className="rounded border-border text-primary h-3.5 w-3.5"
                        />
                        <span className="text-foreground font-medium">Stop run if an error occurs</span>
                      </label>

                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={keepVariableValues}
                          onChange={(e) => setKeepVariableValues(e.target.checked)}
                          className="rounded border-border text-primary h-3.5 w-3.5"
                        />
                        <span className="text-foreground font-medium">Keep variable values</span>
                      </label>

                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={ignoreCookies}
                          onChange={(e) => setIgnoreCookies(e.target.checked)}
                          className="rounded border-border text-primary h-3.5 w-3.5"
                        />
                        <span className="text-foreground font-medium">Run collection without using stored cookies</span>
                      </label>

                      <label className="flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={saveCookies}
                          onChange={(e) => setSaveCookies(e.target.checked)}
                          className="rounded border-border text-primary h-3.5 w-3.5"
                        />
                        <span className="text-foreground font-medium">Save cookies after collection run</span>
                      </label>

                      <div className="flex items-center gap-2.5 flex-wrap pt-0.5">
                        <label className="flex items-center gap-2.5 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={enableDelay}
                            onChange={(e) => {
                              setEnableDelay(e.target.checked);
                              if (e.target.checked && delayMs === 0) setDelayMs(250);
                            }}
                            className="rounded border-border text-primary h-3.5 w-3.5"
                          />
                          <span className="text-foreground font-medium">Add a delay of</span>
                        </label>
                        <div className="relative flex items-center w-24">
                          <input
                            type="number"
                            min={0}
                            max={10000}
                            step={50}
                            disabled={!enableDelay}
                            value={enableDelay ? delayMs : 0}
                            onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))}
                            className="w-full h-7 rounded-lg border border-input bg-background pl-2.5 pr-7 text-xs font-mono text-foreground disabled:opacity-50"
                          />
                          <span className="absolute right-2 text-[10px] font-mono text-muted-foreground pointer-events-none">
                            ms
                          </span>
                        </div>
                        <span className="text-foreground font-medium">between requests</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* 1. Environment & Test (two columns) */}
              <div className="rounded-xl border border-border/70 bg-muted/20 p-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-foreground block">
                      Target Environment
                    </label>
                    <select
                      value={environmentName}
                      onChange={(e) => setEnvironmentName(e.target.value)}
                      className="h-8 w-full sm:max-w-[200px] rounded-lg border border-input bg-background px-2.5 text-xs font-semibold text-foreground"
                    >
                      {envOptions.map((env) => (
                        <option key={env.name} value={env.name}>
                          {env.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground/70">
                      Resolves the Datadog start URL and run variables.
                    </p>
                  </div>

                  <div className="space-y-1 min-w-0">
                    <label className="text-[11px] font-semibold text-foreground block">
                      {hasLinkedDatadog
                        ? 'Linked Datadog test'
                        : 'Datadog Synthetic Test Public ID(s) *'}
                    </label>
                    {hasLinkedDatadog ? (
                      <div className="rounded-lg border border-border/60 bg-background px-2.5 py-1.5 space-y-0.5">
                        {linkedDatadogLabels.map((t) => (
                          <div key={t.id} className="flex items-center gap-2 text-xs min-w-0">
                            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/25 shrink-0">
                              {t.type || 'test'}
                            </span>
                            <span className="truncate text-foreground/90" title={t.name}>
                              {t.name}
                            </span>
                            <span
                              className="font-mono text-[10px] text-muted-foreground truncate ml-auto max-w-[45%]"
                              title={t.id}
                            >
                              {t.id}
                            </span>
                          </div>
                        ))}
                        <p className="text-[10px] text-muted-foreground/70 pt-0.5">
                          This run executes only the test(s) linked to this case.
                        </p>
                      </div>
                    ) : catalog?.datadog?.tests?.length > 0 ? (
                      <select
                        value={datadogPublicIdsText}
                        onChange={(e) => setDatadogPublicIdsText(e.target.value)}
                        className="w-full h-8 rounded-lg border border-input bg-background px-2.5 text-xs font-medium text-foreground"
                      >
                        <option value="">Select a Datadog Synthetic Test...</option>
                        {catalog.datadog.tests.map((t: any) => (
                          <option key={t.public_id} value={t.public_id}>
                            [{String(t.type || 'test').toUpperCase()}] {t.name} ({t.public_id})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        value={datadogPublicIdsText}
                        onChange={(e) => setDatadogPublicIdsText(e.target.value)}
                        placeholder="e.g. abc-def-ghi, jkl-mno-pqr"
                        className="h-8 text-xs font-mono"
                      />
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground block">
                    Start URL Override (Optional)
                  </label>
                  <Input
                    value={startUrlOverride}
                    onChange={(e) => setStartUrlOverride(e.target.value)}
                    placeholder="Defaults to the selected environment's Datadog start URL"
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              {/* 2. Variable overrides (full width) */}
              <div className="rounded-xl border border-border/70 bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] font-semibold text-foreground">
                    Variable Overrides (Optional)
                  </label>
                  <span className="text-[10px] text-muted-foreground/70">
                    Applied to this execution only
                  </span>
                </div>

                {!ddVarsSupported ? (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      {ddVarsReason ||
                        'Variable overrides are unavailable for this Datadog test.'}
                    </span>
                  </p>
                ) : loadingDdVars ? (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Loading overridable variables…</span>
                  </p>
                ) : ddAvailableVars.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    No overridable variables found in the selected test(s). Datadog only
                    accepts overrides for variables referenced by the test.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <select
                        value={ddVarPick}
                        onChange={(e) => setDdVarPick(e.target.value)}
                        className="h-8 flex-1 min-w-0 rounded-lg border border-input bg-background px-2 text-xs font-mono text-foreground"
                      >
                        <option value="">Select a variable…</option>
                        {ddAvailableVars
                          .filter((v) => !ddOverrides.some((o) => o.name === v.name))
                          .map((v) => (
                            <option key={v.name} value={v.name}>
                              {formatVariableName(v.name)}
                              {v.source === 'global' ? ' (global)' : ''}
                            </option>
                          ))}
                      </select>
                      <Input
                        value={ddVarPick ? ddNewValue : ''}
                        onChange={(e) => setDdNewValue(e.target.value)}
                        placeholder={ddVarPickPlaceholder}
                        disabled={!ddVarPick}
                        className="h-8 flex-1 min-w-0 text-xs font-mono"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={addDdOverride}
                        disabled={!ddVarPick || !ddNewValue.trim()}
                        className="h-8 shrink-0 gap-1 cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add Variable</span>
                      </Button>
                    </div>

                    {ddOverrides.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        {ddOverrides.map((o, idx) => (
                          <div key={o.name} className="flex items-center gap-2">
                            <span
                              className="font-mono text-[10.5px] font-semibold px-1.5 py-1 rounded bg-background/80 border border-border/60 text-foreground shrink-0 max-w-[200px] truncate"
                              title={o.name}
                            >
                              {formatVariableName(o.name)}
                            </span>
                            <Input
                              value={o.value}
                              onChange={(e) => updateDdOverride(idx, e.target.value)}
                              className="h-7 flex-1 min-w-0 text-xs font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => removeDdOverride(o.name)}
                              className="text-muted-foreground hover:text-red-500 shrink-0 cursor-pointer"
                              title="Remove override"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 3. Execution settings (2x2) */}
              <div className="rounded-xl border border-border/70 bg-muted/20 p-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground block">
                      Execution Rule
                    </label>
                    <select
                      value={executionRule}
                      onChange={(e) => setExecutionRule(e.target.value as any)}
                      className="w-full h-8 rounded-lg border border-input bg-background px-2 text-xs font-medium text-foreground"
                    >
                      <option value="blocking">Run &amp; Wait for Results</option>
                      <option value="non_blocking">Trigger Run in Background</option>
                      <option value="skipped">Skip Execution</option>
                    </select>
                    <p className="text-[10px] text-muted-foreground/70">{executionRuleSubtext}</p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground block">
                      Initial Delay
                    </label>
                    <select
                      value={String(ddDelayMs)}
                      onChange={(e) => setDdDelayMs(Number(e.target.value))}
                      className="w-full h-8 rounded-lg border border-input bg-background px-2 text-xs font-mono text-foreground"
                    >
                      <option value="0">0 ms</option>
                      <option value="500">500 ms</option>
                      <option value="1000">1,000 ms</option>
                      <option value="3000">3,000 ms</option>
                    </select>
                    <p className="text-[10px] text-muted-foreground/70">
                      Time before the test is triggered.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground block">
                      Retry Count
                    </label>
                    <select
                      value={String(retryCount)}
                      onChange={(e) => setRetryCount(Number(e.target.value))}
                      className="w-full h-8 rounded-lg border border-input bg-background px-2 text-xs font-mono text-foreground"
                    >
                      <option value="0">0 retries</option>
                      <option value="1">1 retry</option>
                      <option value="2">2 retries</option>
                      <option value="3">3 retries</option>
                    </select>
                    <p className="text-[10px] text-muted-foreground/70">
                      Datadog re-runs the test up to this many times on failure.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground block">
                      Configuration
                    </label>
                    <label className="flex items-center gap-2 h-8 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={saveLinkToCase}
                        onChange={(e) => setSaveLinkToCase(e.target.checked)}
                        className="rounded border-border text-primary h-3.5 w-3.5"
                      />
                      <span className="text-xs text-foreground font-medium">
                        Save configuration on this test case
                      </span>
                    </label>
                    <p className="text-[10px] text-muted-foreground/70">
                      Stores environment, overrides, rule, delay and retries on the case.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Persistence Options (Datadog renders this inside Execution Settings) */}
          {provider === 'postman' && (
            <div className="flex flex-wrap items-center gap-4 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={saveLinkToCase}
                  onChange={(e) => setSaveLinkToCase(e.target.checked)}
                  className="rounded border-border text-primary h-3.5 w-3.5"
                />
                <span>Save configuration on this test case</span>
              </label>
            </div>
          )}

          {/* Live Execution Results Preview */}
          {result && (
            <div className="rounded-xl border border-border/80 bg-muted/20 overflow-hidden space-y-2.5 p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  {result.overallStatus === 'PASS' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : result.overallStatus === 'SKIP' ? (
                    <SkipForward className="h-4 w-4 text-zinc-500 shrink-0" />
                  ) : result.overallStatus === 'PENDING' ? (
                    <Loader2 className="h-4 w-4 text-blue-500 animate-spin shrink-0" />
                  ) : result.overallStatus === 'UNAVAILABLE' ? (
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
                  )}
                  <span className="font-bold text-xs text-foreground">{result.summary}</span>
                </div>

                <div className="flex items-center gap-3">
                  {result.createdRunId && (
                    <a
                      href={(() => {
                        const slugMatch =
                          typeof window !== 'undefined'
                            ? window.location.pathname.match(/^\/p\/([^/]+)/)
                            : null;
                        return slugMatch
                          ? `/p/${slugMatch[1]}/runs/${result.createdRunId}`
                          : `/runs/${result.createdRunId}`;
                      })()}
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-semibold"
                    >
                      <span>Open Test Run ({result.createdRunId})</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {result.externalUrl && (
                    <a
                      href={result.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-medium"
                    >
                      <span>Open in Datadog</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              {result.overallStatus === 'PENDING' && (
                <p className="text-[11px] text-muted-foreground">
                  The Datadog run was started. Results are retrieved in the background — you can
                  close this dialog and follow the run; it updates automatically.
                </p>
              )}

              <div className="max-h-72 overflow-y-auto divide-y divide-border/50 border border-border/60 rounded-lg bg-card">
                {result.steps.map((st) => {
                  const isExpanded = expandedStepOrders.has(st.order);
                  const assertions = st.assertions || [];
                  const passedAssertionsCount = assertions.filter((a) => a.passed).length;

                  return (
                    <div key={st.order} className="text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedStepOrders((prev) => {
                            const next = new Set(prev);
                            if (next.has(st.order)) next.delete(st.order);
                            else next.add(st.order);
                            return next;
                          });
                        }}
                        className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-muted/30 transition-colors cursor-pointer"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                          <span
                            className={cn(
                              'px-1.5 py-0.5 rounded font-mono text-[10px] font-bold uppercase shrink-0',
                              st.status === 'pass'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                                : st.status === 'skip'
                                ? 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400'
                                : 'bg-red-500/15 text-red-700 dark:text-red-400'
                            )}
                          >
                            {st.status}
                          </span>
                          {st.method && (
                            <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted text-foreground shrink-0">
                              {st.method}
                            </span>
                          )}
                          <span className="font-semibold text-foreground truncate">{st.name}</span>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {st.statusCode ? (
                            <span
                              className={cn(
                                'font-mono text-[10px] px-1.5 py-0.5 rounded font-semibold',
                                st.statusCode >= 200 && st.statusCode < 300
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
                              )}
                            >
                              HTTP {st.statusCode}
                            </span>
                          ) : null}

                          {assertions.length > 0 && (
                            <span
                              className={cn(
                                'font-mono text-[10px] px-1.5 py-0.5 rounded font-semibold border',
                                passedAssertionsCount === assertions.length
                                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                                  : 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25'
                              )}
                            >
                              Tests: {passedAssertionsCount}/{assertions.length}
                            </span>
                          )}

                          <span className="font-mono text-[10px] text-muted-foreground">
                            {st.durationMs}ms
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1.5 bg-muted/10 border-t border-border/40 space-y-2.5">
                          {st.url && (
                            <div className="font-mono text-[11px] text-muted-foreground break-all">
                              <span className="font-semibold text-foreground">{st.method || 'REQ'}</span>{' '}
                              {st.url}
                            </div>
                          )}

                          {/* 1. Postman Test Script Assertions (pm.test) */}
                          {assertions.length > 0 ? (
                            <div className="space-y-1">
                              <div className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                                <span>
                                  Test Script Results ({passedAssertionsCount} of {assertions.length} passed)
                                </span>
                              </div>
                              <div className="rounded-lg border border-border/60 bg-background divide-y divide-border/40">
                                {assertions.map((a, idx) => (
                                  <div
                                    key={idx}
                                    className="px-2.5 py-1.5 flex items-start gap-2 text-[11px]"
                                  >
                                    {a.passed ? (
                                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                                    ) : (
                                      <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0 mt-0.5" />
                                    )}
                                    <div className="min-w-0 flex-1">
                                      <div
                                        className={cn(
                                          'font-medium',
                                          a.passed
                                            ? 'text-foreground'
                                            : 'text-red-600 dark:text-red-400 font-semibold'
                                        )}
                                      >
                                        {a.name}
                                      </div>
                                      {a.error && (
                                        <div className="font-mono text-[10px] text-red-500 mt-0.5 break-all">
                                          {a.error}
                                        </div>
                                      )}
                                    </div>
                                    <span
                                      className={cn(
                                        'font-mono text-[9px] font-bold uppercase px-1.5 py-0.2 rounded shrink-0',
                                        a.passed
                                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                          : 'bg-red-500/10 text-red-600 dark:text-red-400'
                                      )}
                                    >
                                      {a.passed ? 'PASS' : 'FAIL'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : !st.statusCode ? (
                            <div className="font-mono text-[11px] text-red-500 break-all">
                              {st.detail}
                            </div>
                          ) : null}

                          {/* 2. Full Formatted JSON Response Body */}
                          {st.responseBody && (
                            <div className="space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold text-foreground">
                                  Response Body {st.statusCode ? `(HTTP ${st.statusCode})` : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(st.responseBody || '');
                                    toast.success('Response JSON copied to clipboard');
                                  }}
                                  className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground cursor-pointer"
                                >
                                  <Copy className="h-3 w-3" />
                                  <span>Copy JSON</span>
                                </button>
                              </div>
                              <pre className="p-2.5 rounded-lg border border-border/60 bg-background font-mono text-[11px] text-foreground overflow-x-auto max-h-48 whitespace-pre-wrap break-words leading-relaxed">
                                {st.responseBody}
                              </pre>
                            </div>
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

        <DialogFooter className="px-5 py-3 border-t border-border/60 bg-muted/15 flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            size="sm"
            onClick={handleExecute}
            disabled={
              running ||
              loadingCatalog ||
              (provider === 'postman'
                ? !collectionUid.trim() ||
                  ((collectionRequests.length > 0 || hasLinkedPostman) && selectedRequestOrders.size === 0)
                : !datadogPublicIdsText.trim())
            }
            className="gap-1.5 cursor-pointer"
          >
            {running ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Running...</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                <span>Start Run</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
