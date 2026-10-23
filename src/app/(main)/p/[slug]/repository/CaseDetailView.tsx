"use client";

import { useParams } from 'next/navigation';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn, formatVariableName } from '@/lib/utils';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { StatusBadge } from '@/components/common/StatusBadge';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronLeft, ChevronRight, Sparkles, MoreVertical, Plus, X, CheckCircle2, AlertCircle, Clock, UserCheck, Link as LinkIcon, ChevronDown, Eye, Send, Edit3, RotateCcw, ShieldCheck, Check, FileText, Maximize2, Upload, ExternalLink, AppWindow, PanelRight, Bug, MessageSquare, SlidersHorizontal, Paperclip, Play, Tag, Trash2, Database, Lock, Pencil, Terminal, Copy } from 'lucide-react';
import {
  TestCaseParametersSection,
  parseDatasetToBlocks,
  serializeBlocksToDataset,
  type ParamBlock,
} from '@/components/cases/TestCaseParametersSection';
import { updateTestCaseLocalDatasetAction } from '@/app/actions/datasets';
import { LinkifiedText } from '@/components/common/LinkifiedText';
import { UserAvatar } from '@/components/common/UserAvatar';
import { toast } from 'sonner';
import { apiClient } from '@/lib/apiClient';
import { logger } from '@/lib/logger.client';
import { CommentList } from '@/components/comments/CommentList';
import { AttachmentList } from '@/components/attachments/AttachmentList';
import { StepEditor, type StepEditorHandle } from '@/components/steps/StepEditor';
import { ExternalRunnerModal } from '@/components/runs/ExternalRunnerModal';
import { PostmanLogo, DatadogLogo } from '@/components/icons/IntegrationLogos';
import { syncTestCaseFromPostmanAction, syncTestCaseFromDatadogAction } from '@/app/actions/integrations';
import { LinkExternalSourceDialog } from './LinkExternalSourceDialog';
import { TagInput } from '@/components/common/TagInput';
import { Tooltip } from '@/components/ui/tooltip';
import { SplitButton } from '@/components/ui/split-button';
import { createCommentAction, deleteCommentAction, getCommentsAction, resolveCommentAction } from '@/app/actions/comments';
import { getAttachmentsAction, deleteAttachmentAction } from '@/app/actions/attachments';
import { updateTestCaseAction, archiveTestCaseAction, cloneTestCaseAction } from '@/app/actions/cases';
import { getRunResultHistoryAction } from '@/app/actions/runs';
import { getTestCaseDefectsAction, type ProjectDefectItem } from '@/app/actions/defects';
import { improveStepsAction } from '@/app/actions/ai';
import { getSuitesForCaseAction, addCaseToSuiteAction, removeCaseFromSuiteAction } from '@/app/actions/suites';
import { requestReviewAction, approveReviewAction, requestChangesOnReviewAction, adminForceApproveAction, getActiveReviewRequestAction, cancelReviewAction, getReviewHistoryAction, getReviewDiffAction, revertTestCaseVersionAction, assignReviewAction, unassignReviewAction, updateReviewSnapshotAction, discardWorkingChangesAction } from '@/app/actions/reviews';
import { ReviewDiff, type StepCommentItem } from '@/components/reviews/ReviewDiff';
import { getTestCaseStepsAction, updateTestCaseStepAction, createTestCaseStepAction, deleteTestCaseStepAction } from '@/app/actions/steps';
import { getTestCaseLocalVariablesAction, createVariableAction, updateVariableAction, deleteVariableAction, setVariableValueAction, getGlobalVariablesAction } from '@/app/actions/variables';
import { getProjectTicketsAction, type ProjectTicketOption } from '@/app/actions/integrations';
import { VariableAutocomplete } from '@/components/variables/VariableAutocomplete';
import { createModuleAction } from '@/app/actions/modules';
import { ModuleSelect } from '@/components/common/ModuleSelect';
import {
  getCustomFieldDefinitionsAction,
  createCustomFieldDefinitionAction,
} from '@/app/actions/custom-fields';
import {
  sanitizeFieldKey,
  MAX_CUSTOM_FIELDS_PER_ENTITY,
  MAX_KEY_NAME_LENGTH,
  MAX_OPTION_LENGTH,
  MAX_OPTIONS_COUNT,
  MAX_TEXT_VALUE_LENGTH,
} from '@/lib/custom-fields';
import { CustomFieldType, CustomFieldEntityType } from '@prisma/client';
import type { StepItem, Priority, CaseStatus } from '@/lib/types';

interface CaseDetailPageProps {
  slug: string;
  caseId: string;
}

function MetadataPill({ label, value, color, onClick }: { label: string; value: string; color?: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
        color
          ? `bg-${color}-100/80 text-${color}-700 border-${color}-200/50 dark:bg-${color}-900/20 dark:text-${color}-300`
          : 'bg-muted/50 text-foreground border-border/30 hover:bg-muted/80'
      )}
    >
      <span className="text-muted-foreground">{label}:</span>
      <span>{value}</span>
    </button>
  );
}

const SCENARIO_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'edge_case', label: 'Edge Case' },
  { value: 'boundary', label: 'Boundary' },
];

const projectCustomFieldsCache = new Map<string, any[]>();

export function CaseDetailView({
  onClose,
  caseId: propCaseId,
  isFullPage = false,
  viewMode = 'sheet',
  onToggleViewMode,

  initialEditMode = false,
  onEditingChange,
  onNavigatePrev,
  onNavigateNext,
  currentIndex,
  totalCount,
}: {
  onClose?: () => void;
  caseId?: string;
  isFullPage?: boolean;
  viewMode?: 'popup' | 'sheet' | 'full' | 'docked';
  onToggleViewMode?: () => void;
  onOpenEditInModal?: () => void;
  initialEditMode?: boolean;
  onEditingChange?: (editing: boolean, hasChanges: boolean) => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  currentIndex?: number;
  totalCount?: number;
}) {
  const params = useParams();
  const { slug, caseId: urlCaseId } = params as Record<string, string>;
  const router = useRouter();
  const {
    project,
    modules,
    cases: allCases,
    archivedCases,
    setArchivedCases,
    customFieldDefs: contextCustomFieldDefs,
    setCustomFieldDefs: setContextCustomFieldDefs,
    setCases,
    suites,
    members,
    currentUser,
    canEdit: contextCanEdit,
    isAdmin: contextIsAdmin,
    userRole: contextUserRole,
  } = useProjectData();
  const resolvedCaseId = propCaseId || urlCaseId;
  const testCase = allCases.find((c) => c.id === resolvedCaseId || c.displayId === resolvedCaseId);
  const caseId = testCase?.id || resolvedCaseId;

  // Normalize full-page URL to always display the human-readable key (e.g. INK-6) instead of internal UUID
  useEffect(() => {
    if (isFullPage && testCase?.displayId && urlCaseId && urlCaseId !== testCase.displayId) {
      router.replace(`/p/${slug}/repository/${testCase.displayId}`);
    }
  }, [isFullPage, testCase?.displayId, urlCaseId, slug, router]);

  const [steps, setSteps] = useState<StepItem[]>(() => {
    if (testCase?.steps && Array.isArray(testCase.steps)) {
      return testCase.steps as StepItem[];
    }
    return [];
  });

  // Modules created inline in this drawer (not yet in the provider store).
  const [extraModules, setExtraModules] = useState<any[]>([]);

  // Synchronously hydrate steps from project store if currently empty
  useEffect(() => {
    if (testCase?.steps && Array.isArray(testCase.steps) && testCase.steps.length > 0) {
      setSteps((current) => (current && current.length > 0 ? current : (testCase.steps as StepItem[])));
    }
  }, [testCase?.id]);
  const stepEditorRef = useRef<StepEditorHandle>(null);
  const [stepsDirty, setStepsDirty] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeprecateModal, setShowDeprecateModal] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [caseSuites, setCaseSuites] = useState<{ suiteId: string; suiteName: string }[]>([]);
  const [showSuiteSelector, setShowSuiteSelector] = useState(false);
  const [improvingSteps, setImprovingSteps] = useState(false);
  const [improvedSteps, setImprovedSteps] = useState<any[] | null>(null);
  const [showImproveCustomPrompt, setShowImproveCustomPrompt] = useState(false);
  const [improveCustomPrompt, setImproveCustomPrompt] = useState('');
  const [activeReviewRequest, setActiveReviewRequest] = useState<any>(null);
  const [reviewHistory, setReviewHistory] = useState<any[]>([]);
  const [reviewDiff, setReviewDiff] = useState<any>(null);
  const [reviewTarget, setReviewTarget] = useState(''); // keep for type safety but not used for pooled requests
  const [reviewComment, setReviewComment] = useState('');
  const [localVars, setLocalVars] = useState<any[]>([]);
  const [allVariables, setAllVariables] = useState<{ key: string; scope: 'GLOBAL' | 'LOCAL' }[]>([]);
  const [paramBlocks, setParamBlocks] = useState<ParamBlock[]>(() => {
    return parseDatasetToBlocks(
      testCase?.local_dataset || (testCase as any)?.localDataset,
      testCase?.dataset
    );
  });

  const [paramsDirty, setParamsDirty] = useState(false);

  const [caseParameters, setCaseParameters] = useState<string[]>(() => {
    const parsed = parseDatasetToBlocks(
      testCase?.local_dataset || (testCase as any)?.localDataset,
      testCase?.dataset
    );
    return serializeBlocksToDataset(parsed).parameters;
  });

  const enrichedCaseParameters = useMemo(() => {
    const list: Array<{ key: string; datasetName?: string; sampleValue?: string; values?: string[]; rows?: any[] }> = [];
    const dsName = testCase?.dataset?.name || 'Dataset';

    for (const b of paramBlocks) {
      if (b.type === 'single') {
        list.push({
          key: b.param,
          datasetName: dsName,
          sampleValue: b.values?.[0] || '',
          values: b.values || [],
        });
      } else if (b.type === 'group') {
        for (const p of b.params) {
          const vals = (b.rows || []).map((r) => r[p]).filter(Boolean);
          list.push({
            key: p,
            datasetName: dsName,
            sampleValue: vals[0] || '',
            values: vals,
            rows: b.rows,
          });
        }
      }
    }
    for (const p of caseParameters) {
      if (!list.some((item) => item.key.toLowerCase() === p.toLowerCase())) {
        list.push({ key: p, datasetName: dsName, values: [] });
      }
    }
    return list;
  }, [paramBlocks, caseParameters, testCase?.dataset]);

  const handleParamBlocksChange = useCallback((nextBlocks: ParamBlock[]) => {
    setParamBlocks(nextBlocks);
    const serialized = serializeBlocksToDataset(nextBlocks);
    setCaseParameters(serialized.parameters);
    setParamsDirty(true);
    setIsDirty(true);
  }, []);

  const handleCreateInlineParameter = useCallback(
    (param: string) => {
      const clean = param.toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!clean || caseParameters.includes(clean)) return;
      const newBlock: ParamBlock = {
        id: `param-${Date.now()}`,
        type: 'single',
        param: clean,
        values: [''],
      };
      handleParamBlocksChange([...paramBlocks, newBlock]);
      toast.success(`Parameter {${clean}} added to test case`);
    },
    [caseParameters, paramBlocks, handleParamBlocksChange]
  );

  const [isEditing, setIsEditing] = useState(Boolean(initialEditMode));
  useEffect(() => {
    if (initialEditMode) {
      setIsEditing(true);
    }
  }, [initialEditMode, caseId]);
  const [activeEditField, setActiveEditField] = useState<'title' | 'description' | 'preConditions' | 'postConditions' | null>(null);
  const [newLocalVarKey, setNewLocalVarKey] = useState('');
  const [newLocalVarValue, setNewLocalVarValue] = useState('');
  const [newLocalVarDefault, setNewLocalVarDefault] = useState('');
  const [activeTab, setActiveTab] = useState('steps');
  const [activityFilter, setActivityFilter] = useState<'all' | 'comments' | 'attachments' | 'history'>('all');
  const [lastRunResult, setLastRunResult] = useState<{ status: string; date?: string } | null>(null);
  const hasUserChangedTab = useRef(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [showExternalRunnerModal, setShowExternalRunnerModal] = useState(false);
  const [externalRunnerProvider, setExternalRunnerProvider] = useState<'postman' | 'datadog'>('postman');
  // Prompt shown when switching a Manual case to Automated: choose an external
  // connection (Postman / Datadog) or proceed without any connection.
  const [showExternalLinkPrompt, setShowExternalLinkPrompt] = useState(false);
  const [pendingMode, setPendingMode] = useState<'manual' | 'automated' | null>(null);
  const [syncingPostman, setSyncingPostman] = useState(false);
  const [syncingDatadog, setSyncingDatadog] = useState(false);
  const [linkDialogProvider, setLinkDialogProvider] = useState<'postman' | 'datadog' | null>(null);
  const [showCurlSnippet, setShowCurlSnippet] = useState(false);
  const [activeApiTab, setActiveApiTab] = useState('body');
  const [expandedRunHistoryId, setExpandedRunHistoryId] = useState<string | null>(null);
  const [expandedHistoryRawResponses, setExpandedHistoryRawResponses] = useState<Record<string, boolean>>({});
  const [openPill, setOpenPill] = useState<string | null>(null);
  const [reviewStatusOverride, setReviewStatusOverride] = useState<string | null>(null);
  const [showBypassMenu, setShowBypassMenu] = useState(false);
  const [showDiffDialog, setShowDiffDialog] = useState(false);
  const [historyView, setHistoryView] = useState<'changes' | 'runs'>('changes');
  const [showRequestChangesDialog, setShowRequestChangesDialog] = useState(false);
  const [requestChangesComment, setRequestChangesComment] = useState('');
  const [showSubmitReviewDialog, setShowSubmitReviewDialog] = useState(false);
  const [isEditingPending, setIsEditingPending] = useState(false);
  const [submittingReview, setSubmittingReview] = useState(false);
  const [showPreConditions, setShowPreConditions] = useState(() => Boolean(testCase?.preConditions || testCase?.pre_conditions));
  const [showPostConditions, setShowPostConditions] = useState(() => Boolean(testCase?.postConditions || testCase?.post_conditions));
  const [showDescription, setShowDescription] = useState(() => Boolean(testCase?.description));
  const [showAttachments, setShowAttachments] = useState(() => Boolean(attachments.length > 0));
  const [copiedLink, setCopiedLink] = useState(false);
  const [isTitleScrolledOut, setIsTitleScrolledOut] = useState(false);
  const heroTitleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = heroTitleRef.current;
    if (!el || typeof window === 'undefined') return;

    let scrollParent: HTMLElement | Window = window;
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent);
      if (/(auto|scroll)/.test(style.overflowY)) {
        scrollParent = parent;
        break;
      }
      parent = parent.parentElement;
    }

    const checkScroll = () => {
      if (!heroTitleRef.current) return;
      const rect = heroTitleRef.current.getBoundingClientRect();
      const headerBottom =
        scrollParent === window
          ? (isFullPage ? 56 + 48 : 48)
          : (scrollParent as HTMLElement).getBoundingClientRect().top + 48;
      setIsTitleScrolledOut(rect.bottom <= headerBottom);
    };

    checkScroll();
    scrollParent.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll, { passive: true });
    return () => {
      scrollParent.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [testCase?.id, isFullPage]);

  const handleCopyLink = () => {
    if (typeof window === 'undefined') return;
    navigator.clipboard.writeText(window.location.origin + `/p/${slug}/repository/${testCase.displayId}`);
    setCopiedLink(true);
    toast.success('Link copied to clipboard');
    setTimeout(() => setCopiedLink(false), 2000);
  };
  const [lastReadCommentTime, setLastReadCommentTime] = useState<number>(() => {
    if (typeof window !== 'undefined' && caseId) {
      const stored = localStorage.getItem(`inka_comment_read_${caseId}`);
      if (stored) return parseInt(stored, 10);
    }
    return 0;
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && caseId) {
      const stored = localStorage.getItem(`inka_comment_read_${caseId}`);
      if (stored) setLastReadCommentTime(parseInt(stored, 10));
    }
  }, [caseId]);

  // Deduplicate all active comments and nested replies
  const allUniqueComments = useMemo(() => {
    const map = new Map<string, any>();
    for (const c of comments) {
      if (c && !c.deleted_at) {
        map.set(c.id, c);
        if (Array.isArray(c.replies)) {
          for (const r of c.replies) {
            if (r && !r.deleted_at) {
              map.set(r.id, r);
            }
          }
        }
      }
    }
    return Array.from(map.values());
  }, [comments]);

  const totalCommentsCount = allUniqueComments.length;

  const unreadCommentsCount = useMemo(() => {
    if (!lastReadCommentTime) {
      return allUniqueComments.filter((c) => c.author_id !== currentUser?.id).length;
    }
    return allUniqueComments.filter((c) => {
      const isOther = c.author_id !== currentUser?.id;
      const cTime = new Date(c.created_at).getTime();
      return isOther && cTime > lastReadCommentTime;
    }).length;
  }, [allUniqueComments, lastReadCommentTime, currentUser?.id]);

  const [propertiesExpanded, setPropertiesExpanded] = useState<boolean>(isFullPage);
  const [openAddProperty, setOpenAddProperty] = useState(false);
  const [caseBugs, setCaseBugs] = useState<ProjectDefectItem[]>([]);
  const [loadingBugs, setLoadingBugs] = useState(false);
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [openTicketKeyPopover, setOpenTicketKeyPopover] = useState(false);
  const [ticketKeyInput, setTicketKeyInput] = useState('');
  const [ticketOptions, setTicketOptions] = useState<ProjectTicketOption[]>([]);
  const [isPmConnected, setIsPmConnected] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);

  useEffect(() => {
    if (openTicketKeyPopover && project?.id) {
      setLoadingTickets(true);
      getProjectTicketsAction(project.id)
        .then((res) => {
          setTicketOptions(res.tickets);
          setIsPmConnected(res.isPmConnected);
        })
        .catch(() => {})
        .finally(() => setLoadingTickets(false));
    }
  }, [openTicketKeyPopover, project?.id]);

  const filteredTicketOptions = useMemo(() => {
    const q = ticketKeyInput.trim().toLowerCase();
    if (!q) return ticketOptions;
    return ticketOptions.filter(
      (t) => t.key.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
    );
  }, [ticketOptions, ticketKeyInput]);

  const titleTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [draftState, setDraftState] = useState<any>({});
  const [title, setTitle] = useState(() => testCase?.title || '');
  const getValue = (field: string) => draftState[field] !== undefined ? draftState[field] : (testCase ? testCase[field] : undefined);

  const getLinkedTicketKey = useCallback((): string => {
    if (draftState.ticketKey !== undefined) return draftState.ticketKey;
    const labels: string[] = getValue('labels') || testCase?.labels || [];
    const ticketLabel = labels.find((l: string) => l.startsWith('ticket:'));
    if (ticketLabel) return ticketLabel.replace('ticket:', '');
    const directLabel = labels.find((l: string) => /^[A-Z0-9]+-[0-9]+$/i.test(l));
    if (directLabel) return directLabel;
    const tags: string[] = getValue('tags') || testCase?.tags || [];
    const tagTicket = tags.find((t: string) => t.startsWith('ticket:') || /^[A-Z0-9]+-[0-9]+$/i.test(t));
    if (tagTicket) return tagTicket.replace('ticket:', '');
    return '';
  }, [draftState.ticketKey, draftState.labels, draftState.tags, testCase?.labels, testCase?.tags]);

  const syncCaseToContext = useCallback((updatedObj?: any, refreshedSteps?: any[]) => {
    const nextCases = allCases.map((c: any) => {
      if (c.id === caseId) {
        return {
          ...c,
          ...(updatedObj ? {
            title: updatedObj.title !== undefined ? updatedObj.title : c.title,
            description: updatedObj.description !== undefined ? updatedObj.description : c.description,
            preConditions: updatedObj.pre_conditions !== undefined ? updatedObj.pre_conditions : (updatedObj.preConditions !== undefined ? updatedObj.preConditions : c.preConditions),
            postConditions: updatedObj.post_conditions !== undefined ? updatedObj.post_conditions : (updatedObj.postConditions !== undefined ? updatedObj.postConditions : c.postConditions),
            expectedResult: updatedObj.expected_result !== undefined ? updatedObj.expected_result : c.expectedResult,
            priority: updatedObj.priority ? updatedObj.priority.toUpperCase() : c.priority,
            type: updatedObj.type ? updatedObj.type.toLowerCase() : c.type,
            status: updatedObj.status ? updatedObj.status.toLowerCase() : c.status,
            tags: updatedObj.tags !== undefined ? updatedObj.tags : c.tags,
            labels: updatedObj.labels !== undefined ? updatedObj.labels : c.labels,
            scenarioType: updatedObj.scenario_type !== undefined ? updatedObj.scenario_type : (updatedObj.scenarioType !== undefined ? updatedObj.scenarioType : c.scenarioType),
            customFields: updatedObj.custom_fields !== undefined ? updatedObj.custom_fields : (updatedObj.customFields !== undefined ? updatedObj.customFields : c.customFields),
            custom_fields: updatedObj.custom_fields !== undefined ? updatedObj.custom_fields : (updatedObj.customFields !== undefined ? updatedObj.customFields : c.custom_fields),
            moduleId: updatedObj.module_id !== undefined ? updatedObj.module_id : (updatedObj.moduleId !== undefined ? updatedObj.moduleId : c.moduleId),
            aiGenerated: updatedObj.ai_generated !== undefined ? updatedObj.ai_generated : (updatedObj.aiGenerated !== undefined ? updatedObj.aiGenerated : c.aiGenerated),
            reviewStatus: updatedObj.review_status ? updatedObj.review_status.toLowerCase() : c.reviewStatus,
            updatedAt: updatedObj.updated_at ? new Date(updatedObj.updated_at).toISOString() : new Date().toISOString(),
            updatedBy: updatedObj.updated_by !== undefined ? updatedObj.updated_by : c.updatedBy,
          } : {}),
          ...(refreshedSteps ? { steps: refreshedSteps } : {}),
        };
      }
      return c;
    });
    setCases(nextCases);
  }, [caseId, allCases, setCases]);

  const handleDraftChange = useCallback((field: string, value: any) => {
    const immediatePropertyFields = new Set([
      'priority',
      'type',
      'moduleId',
      'scenarioType',
      'tags',
      'labels',
      'customFields',
    ]);

    if (immediatePropertyFields.has(field)) {
      syncCaseToContext({ [field]: value });
      updateTestCaseAction(caseId, { [field]: value }).catch((err: any) => {
        toast.error(err?.message || `Failed to update ${field}`);
      });
      return;
    }

    if (field === 'ticketKey') return;

    setDraftState((prev: any) => {
      const newState = { ...prev, [field]: value };
      const origVal =
        field === 'preConditions' || field === 'pre_conditions'
          ? testCase?.preConditions ?? testCase?.pre_conditions ?? ''
          : field === 'postConditions' || field === 'post_conditions'
          ? testCase?.postConditions ?? testCase?.post_conditions ?? ''
          : testCase?.[field] ?? '';

      if (String(value ?? '').trim() === String(origVal ?? '').trim()) {
        delete newState[field];
        if (field === 'preConditions' || field === 'pre_conditions') {
          delete newState.preConditions;
          delete newState.pre_conditions;
        }
        if (field === 'postConditions' || field === 'post_conditions') {
          delete newState.postConditions;
          delete newState.post_conditions;
        }
      }

      return newState;
    });
  }, [caseId, syncCaseToContext, testCase]);

  const handleUpdateTicketKey = (key: string) => {
    const cleanKey = key.trim().toUpperCase();
    const currLabels: string[] = (getValue('labels') || testCase?.labels || []).filter((l: string) => !l.startsWith('ticket:') && !/^[A-Z0-9]+-[0-9]+$/i.test(l));
    if (cleanKey) {
      currLabels.push(`ticket:${cleanKey}`);
    }
    handleDraftChange('labels', currLabels);
    toast.success(cleanKey ? `Linked ticket: ${cleanKey}` : 'Unlinked ticket');
  };

  // Custom Fields (Properties) state
  const [customFieldDefs, setCustomFieldDefs] = useState<any[]>(() => contextCustomFieldDefs || []);
  const [loadingCustomFields, setLoadingCustomFields] = useState(false);
  const [customTextInputs, setCustomTextInputs] = useState<{ [key: string]: string }>({});
  const [showQuickCreateFieldModal, setShowQuickCreateFieldModal] = useState(false);
  const [quickCreateForm, setQuickCreateForm] = useState<{
    name: string;
    type: CustomFieldType;
    options: string[];
    newOptionText: string;
  }>({
    name: '',
    type: CustomFieldType.DROPDOWN,
    options: [],
    newOptionText: '',
  });
  const [savingQuickField, setSavingQuickField] = useState(false);

  const loadCustomFieldDefs = useCallback(async (forceRefresh = false) => {
    if (!project?.id) return;
    if (!forceRefresh && Array.isArray(contextCustomFieldDefs)) {
      projectCustomFieldsCache.set(project.id, contextCustomFieldDefs);
      setCustomFieldDefs(contextCustomFieldDefs);
      return;
    }
    if (!forceRefresh && projectCustomFieldsCache.has(project.id)) {
      setCustomFieldDefs(projectCustomFieldsCache.get(project.id) || []);
      return;
    }
    try {
      setLoadingCustomFields(true);
      const defs = await getCustomFieldDefinitionsAction(project.id, CustomFieldEntityType.TEST_CASE);
      projectCustomFieldsCache.set(project.id, defs || []);
      setCustomFieldDefs(defs || []);
      setContextCustomFieldDefs?.(defs || []);
    } catch {
      // silent fallback
    } finally {
      setLoadingCustomFields(false);
    }
  }, [project?.id, contextCustomFieldDefs, setContextCustomFieldDefs]);

  useEffect(() => {
    loadCustomFieldDefs();
  }, [loadCustomFieldDefs]);

  const getCustomFieldValue = useCallback((key: string) => {
    const draftCustom = draftState.customFields || draftState.custom_fields;
    if (draftCustom && draftCustom[key] !== undefined) return draftCustom[key];
    const orig = testCase?.customFields || testCase?.custom_fields || {};
    return orig[key];
  }, [draftState.customFields, draftState.custom_fields, testCase?.customFields, testCase?.custom_fields]);

  const handleCustomFieldChange = useCallback((key: string, value: any) => {
    const orig = testCase?.customFields || testCase?.custom_fields || {};
    const current = draftState.customFields || draftState.custom_fields || { ...orig };
    const next = { ...current };

    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      delete next[key];
    } else {
      next[key] = value;
    }

    handleDraftChange('customFields', next);
  }, [draftState.customFields, draftState.custom_fields, testCase?.customFields, testCase?.custom_fields, handleDraftChange]);

  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{ open: boolean; title: string; description: React.ReactNode; confirmLabel?: string; variant?: 'default' | 'destructive'; onConfirm: () => void } | null>(null);

  const hasContentDraftChanges = useMemo(() => {
    if (!testCase) return false;
    const norm = (v: any) => String(v ?? '').trim();
    if (draftState.title !== undefined && norm(draftState.title) !== norm(testCase.title)) {
      return true;
    }
    if (draftState.description !== undefined && norm(draftState.description) !== norm(testCase.description)) {
      return true;
    }
    const origPre = testCase.preConditions ?? testCase.pre_conditions ?? '';
    const draftPre = draftState.preConditions ?? draftState.pre_conditions;
    if (draftPre !== undefined && norm(draftPre) !== norm(origPre)) {
      return true;
    }
    const origPost = testCase.postConditions ?? testCase.post_conditions ?? '';
    const draftPost = draftState.postConditions ?? draftState.post_conditions;
    if (draftPost !== undefined && norm(draftPost) !== norm(origPost)) {
      return true;
    }
    return false;
  }, [draftState, testCase]);

  const hasChanges = hasContentDraftChanges || stepsDirty || paramsDirty;

  useEffect(() => {
    setIsDirty(hasChanges);
    onEditingChange?.(isEditing, hasChanges);
    if (typeof window !== 'undefined') {
      (window as any).__caseDetailHasUnsavedChanges = hasChanges;
      (window as any).__caseDetailIsEditing = isEditing;
      (window as any).__exitCaseDetailEditMode = () => {
        setActiveEditField(null);
        setIsEditing(false);
      };
      (window as any).__requestCaseDetailClose = () => setShowUnsavedPrompt(true);
    }
    return () => {
      if (typeof window !== 'undefined') {
        (window as any).__caseDetailHasUnsavedChanges = false;
        (window as any).__caseDetailIsEditing = false;
        (window as any).__exitCaseDetailEditMode = null;
        (window as any).__requestCaseDetailClose = null;
      }
    };
  }, [hasChanges, isEditing, onEditingChange]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasChanges]);

  const handleRequestClose = useCallback(() => {
    if (hasChanges) {
      setShowUnsavedPrompt(true);
    } else {
      onClose?.();
    }
  }, [hasChanges, onClose]);

  const executeSaveDraft = async (cancelPendingReview = false) => {
    setSaving(true);
    try {
      let updatedCaseObj = null;
      const payload: any = { ...draftState };
      if (cancelPendingReview) {
        payload.cancelPendingReview = true;
      }

      const [caseUpdateRes, savedStepsRes] = await Promise.all([
        Object.keys(payload).length > 0
          ? updateTestCaseAction(caseId, payload)
          : Promise.resolve(null),
        stepsDirty && stepEditorRef.current
          ? stepEditorRef.current.saveAll()
          : Promise.resolve(null),
        paramsDirty
          ? updateTestCaseLocalDatasetAction(caseId, serializeBlocksToDataset(paramBlocks))
          : Promise.resolve(null),
      ]);

      updatedCaseObj = caseUpdateRes;
      const refreshedSteps = savedStepsRes ?? steps;
      if (savedStepsRes) {
        setSteps(refreshedSteps as any);
      }
      syncCaseToContext(updatedCaseObj, refreshedSteps as any);
      apiClient.invalidate(`/api/v1/cases/`);

      if (cancelPendingReview) {
        setReviewStatusOverride(null);
        setActiveReviewRequest(null);
        setReviewDiff(null);
        window.dispatchEvent(new CustomEvent('review-updated'));
      } else if (testCase.reviewStatus === 'pending' || testCase.reviewStatus === 'changes_requested') {
        const [diffData, req] = await Promise.all([
          getReviewDiffAction(caseId),
          getActiveReviewRequestAction(caseId),
        ]);
        setReviewDiff(diffData);
        setActiveReviewRequest(req);
      }

      toast.success(cancelPendingReview ? 'Review cancelled and draft saved' : 'Draft saved');
      setDraftState({});
      setIsDirty(false);
      setStepsDirty(false);
      setParamsDirty(false);
      setIsEditing(false);
      setIsEditingPending(false);
    } catch {
      toast.error('Failed to save draft');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!hasChanges) return;
    if (testCase.reviewStatus === 'pending') {
      setConfirmConfig({
        open: true,
        title: 'Cancel Review and Save Draft',
        description: 'Saving changes now will cancel the pending review request and return the test case to Draft. Do you want to continue?',
        confirmLabel: 'Withdraw & Save Draft',
        variant: 'destructive',
        onConfirm: () => executeSaveDraft(true),
      });
    } else {
      await executeSaveDraft(false);
    }
  };

  const executeSaveChanges = async (cancelPendingReview = false) => {
    setSaving(true);
    try {
      let updatedCaseObj = null;
      const payload: any = { ...draftState };
      if (cancelPendingReview) {
        payload.cancelPendingReview = true;
      }

      const [caseUpdateRes, savedStepsRes] = await Promise.all([
        Object.keys(payload).length > 0
          ? updateTestCaseAction(caseId, payload)
          : Promise.resolve(null),
        stepsDirty && stepEditorRef.current
          ? stepEditorRef.current.saveAll()
          : Promise.resolve(null),
        paramsDirty
          ? updateTestCaseLocalDatasetAction(caseId, serializeBlocksToDataset(paramBlocks))
          : Promise.resolve(null),
      ]);

      updatedCaseObj = caseUpdateRes;
      const refreshedSteps = savedStepsRes ?? steps;
      if (savedStepsRes) {
        setSteps(refreshedSteps as any);
      }
      syncCaseToContext(updatedCaseObj, refreshedSteps as any);
      apiClient.invalidate(`/api/v1/cases/`);

      if (cancelPendingReview) {
        setReviewStatusOverride(null);
        setActiveReviewRequest(null);
        window.dispatchEvent(new CustomEvent('review-updated'));
      } else if (testCase.reviewStatus === 'pending' || testCase.reviewStatus === 'changes_requested') {
        const req = await getActiveReviewRequestAction(caseId);
        setActiveReviewRequest(req);
      }

      toast.success(cancelPendingReview ? 'Review cancelled and changes saved' : 'Changes saved');
      setDraftState({});
      setIsDirty(false);
      setStepsDirty(false);
      setParamsDirty(false);
      setIsEditing(false);
      setIsEditingPending(false);
    } catch {
      toast.error('Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveChanges = async (publish = false) => {
    if (publish || (isEditing && status === 'draft')) {
      handleDraftChange('status', 'active');
    }
    if (testCase.reviewStatus === 'pending') {
      setConfirmConfig({
        open: true,
        title: 'Cancel Review and Save Changes',
        description: 'Saving changes now will cancel the pending review request and return the test case to Active. Do you want to continue?',
        confirmLabel: 'Withdraw & Save Changes',
        variant: 'destructive',
        onConfirm: () => executeSaveChanges(true),
      });
    } else {
      await executeSaveChanges(false);
    }
  };

  const executeCancel = async () => {
    setDraftState({});
    setIsDirty(false);
    setStepsDirty(false);
    setTitle(testCase.title);
    const origBlocks = parseDatasetToBlocks(
      testCase?.local_dataset || (testCase as any)?.localDataset,
      testCase?.dataset
    );
    setParamBlocks(origBlocks);
    setCaseParameters(serializeBlocksToDataset(origBlocks).parameters);
    await stepEditorRef.current?.discardAll();
    setActiveEditField(null);
    setIsEditing(false);
  };

  const handleCancel = async () => {
    const hasUnsavedWork = isDirty || stepsDirty || paramsDirty || Object.keys(draftState).length > 0;
    if (hasUnsavedWork) {
      setConfirmConfig({
        open: true,
        title: 'Exit Edit Mode?',
        description: 'You have unsaved changes in this session. If you exit edit mode now, all your unsaved modifications will be lost.',
        confirmLabel: 'Discard & Exit',
        variant: 'destructive',
        onConfirm: executeCancel,
      });
    } else {
      await executeCancel();
    }
  };

  const handleDiscardChanges = async () => {
    if (isDirty) {
      setConfirmConfig({
        open: true,
        title: 'Discard Changes',
        description: 'You have unsaved changes. Are you sure you want to discard them?',
        confirmLabel: 'Discard',
        variant: 'destructive',
        onConfirm: executeCancel,
      });
    } else {
      await executeCancel();
    }
  };

  const handleBack = () => {
    const doBack = () => {
      if (onClose) {
        onClose();
      } else {
        router.push(`/p/${slug}/repository`);
      }
    };
    if (hasChanges) {
      setConfirmConfig({
        open: true,
        title: 'Leave Page',
        description: 'You have unsaved changes. Are you sure you want to leave?',
        confirmLabel: 'Leave',
        variant: 'destructive',
        onConfirm: doBack,
      });
    } else {
      doBack();
    }
  };

  const overflowRef = useRef<HTMLDivElement>(null);

  // loadLocalVars is kept so other parts of the component can call it to refresh
  // local variables after a mutation (create/update/delete variable).
  const loadLocalVars = useCallback(async () => {
    try {
      const vars = await getTestCaseLocalVariablesAction(caseId);
      setLocalVars(vars);
    } catch { /* silent */ }
  }, [caseId]);

  useEffect(() => {
    if (testCase) {
      if (draftState.title === undefined) {
        setTitle(testCase.title);
      }
      if (testCase.description?.trim()) setShowDescription(true);
      if ((testCase.preConditions || testCase.pre_conditions)?.trim()) setShowPreConditions(true);
      if ((testCase.postConditions || testCase.post_conditions)?.trim()) setShowPostConditions(true);
    }
  }, [testCase?.id, testCase?.title, testCase?.description, testCase?.preConditions, testCase?.pre_conditions, testCase?.postConditions, testCase?.post_conditions, isEditing, draftState.title]);

  useEffect(() => {
    if (attachments.length > 0) {
      setShowAttachments(true);
    }
  }, [attachments.length]);

  useEffect(() => {
    if (titleTextareaRef.current) {
      titleTextareaRef.current.style.height = 'auto';
      titleTextareaRef.current.style.height = `${titleTextareaRef.current.scrollHeight}px`;
    }
  }, [title, draftState.title, isEditing]);

  const loadedBugsAndRunsForCaseRef = useRef<string | null>(null);
  const loadBugsAndRuns = useCallback(async () => {
    if (!caseId) return;
    setLoadingBugs(true);
    setLoadingRuns(true);
    try {
      const [bugsData, runsData] = await Promise.all([
        getTestCaseDefectsAction(caseId),
        getRunResultHistoryAction(caseId, ''),
      ]);
      loadedBugsAndRunsForCaseRef.current = caseId;
      setCaseBugs(bugsData || []);
      setRunHistory(runsData || []);
      if (runsData && runsData.length > 0) {
        setLastRunResult({
          status: runsData[0].status,
          date: runsData[0].executedAt,
        });
      }
    } catch (err) {
      logger.error('Failed to load bugs or run history', {
        component: 'CaseDetailView',
        action: 'loadBugsAndRuns',
        caseId,
        error: err,
      });
    } finally {
      setLoadingBugs(false);
      setLoadingRuns(false);
    }
  }, [caseId]);

  const handleScrollToStep = useCallback((stepOrder: number) => {
    setActiveTab('steps');
    hasUserChangedTab.current = true;
    setTimeout(() => {
      const el = document.getElementById(`step-row-${stepOrder}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
        setTimeout(() => {
          el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2');
        }, 2200);
      }
    }, 100);
  }, []);

  useEffect(() => {
    if ((activeTab === 'bugs' || activeTab === 'runs') && loadedBugsAndRunsForCaseRef.current !== caseId) {
      loadBugsAndRuns();
    }
  }, [activeTab, caseId, loadBugsAndRuns]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setShowOverflow(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const nonBlankSteps = useMemo(
    () =>
      steps.filter(
        (s) =>
          (s.step && s.step.trim().length > 0) ||
          (s.expected_result && s.expected_result.trim().length > 0)
      ),
    [steps]
  );
  const hasExistingSteps = nonBlankSteps.length > 0;

  const handleImproveSteps = async (customPromptOverride?: string) => {
    if (!isEditing) {
      setIsEditing(true);
    }
    const effectiveTitle = (title || getValue('title') || testCase.title || '').trim();
    const rawDesc = getValue('description') ?? testCase.description ?? '';
    const effectiveDescription = String(rawDesc).trim() || undefined;

    if (!effectiveTitle) {
      toast.error('Please enter a test case title first');
      return;
    }

    setImprovingSteps(true);
    try {
      const effectiveCustom =
        customPromptOverride !== undefined ? customPromptOverride.trim() : undefined;
      const result = await improveStepsAction({
        caseId,
        title: effectiveTitle,
        description: effectiveDescription,
        customInstructions: effectiveCustom || undefined,
        steps: nonBlankSteps.map((s, idx) => ({
          order: idx + 1,
          description: s.step || '',
          expectedResult: s.expected_result || undefined,
          data: s.data || undefined,
        })),
      });
      setImprovedSteps(result);
      setShowImproveCustomPrompt(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setImprovingSteps(false);
    }
  };

  const handleApplyImprovedSteps = async () => {
    if (!improvedSteps) return;
    if (!isEditing) setIsEditing(true);
    const wasGenerating = !hasExistingSteps;
    try {
      for (let i = 0; i < improvedSteps.length; i++) {
        const s = improvedSteps[i];
        const existing = steps[i];
        if (existing) {
          await updateTestCaseStepAction(existing.id, {
            order: i + 1,
            step: s.description,
            expectedResult: s.expectedResult,
            data: s.data,
            aiGenerated: true,
          });
        } else {
          await createTestCaseStepAction({
            testCaseId: caseId,
            order: i + 1,
            step: s.description,
            expectedResult: s.expectedResult,
            data: s.data,
            aiGenerated: true,
          });
        }
      }
      if (steps.length > improvedSteps.length) {
        for (let i = improvedSteps.length; i < steps.length; i++) {
          await deleteTestCaseStepAction(steps[i].id);
        }
      }
      const refreshed = await getTestCaseStepsAction(caseId);
      setSteps(refreshed as any);
      syncCaseToContext({ updated_at: new Date().toISOString() }, refreshed);
      toast.success(wasGenerating ? 'Steps generated' : 'Steps improved');
      setImprovedSteps(null);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Track the last case key fetched to strictly prevent duplicate fetches on re-renders
  const lastFetchedCaseKeyRef = useRef<string | null>(null);

  // Single unified case detail fetch — replaces 10 separate server action POST requests
  // with a single, fast, deduplicated GET /api/v1/cases/[caseId] call.
  useEffect(() => {
    if (!project) return;
    const keyToFetch = resolvedCaseId;
    if (!keyToFetch) return;

    let cancelled = false;

    const loadAllCaseData = async () => {
      try {
        const data = await apiClient
          .get<any>(
            `/api/v1/cases/${encodeURIComponent(keyToFetch)}`,
            undefined,
            { ttl: 3000 }
          )
          .catch((e: any) => {
            logger.warn('Failed to fetch case details via apiClient', {
              component: 'CaseDetailView',
              action: 'loadAllCaseData',
              caseKey: keyToFetch,
              reason: e?.message,
            });
            return null;
          });
        if (cancelled) return;

        if (data?.comments) setComments(data.comments);
        if (data?.attachments) setAttachments(data.attachments);
        if (data?.steps && Array.isArray(data.steps)) {
          setSteps(data.steps);
        }
        if (data?.suites) setCaseSuites(data.suites);
        if (data?.localVars) setLocalVars(data.localVars);
        if (data?.allVariables) setAllVariables(data.allVariables);
        setActiveReviewRequest(data?.activeReviewRequest || null);
        if (data?.reviewHistory) setReviewHistory(data.reviewHistory);
        setReviewDiff(data?.reviewDiff || null);
        if (data?.lastRunResult) setLastRunResult(data.lastRunResult);
      } catch (err: any) {
        logger.error('Failed to load case details', {
          component: 'CaseDetailView',
          action: 'loadAllCaseData',
          caseId: resolvedCaseId,
          error: err,
        });
      }
    };

    loadAllCaseData();

    return () => {
      cancelled = true;
    };
  }, [resolvedCaseId, project?.id]);

  // Auto-switch to Steps tab once data loads if case has steps and user hasn't manually changed tab
  useEffect(() => {
    if (hasUserChangedTab.current) return;
    if (steps.length > 0) {
      setActiveTab('steps');
    }
  }, [steps.length]);

  if (!project || !testCase) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-muted-foreground">Test case not found</p>
      </div>
    );
  }

  const handleDelete = async () => {
    const deletedCase = allCases.find((c) => c.id === caseId);
    await archiveTestCaseAction(caseId);
    setCases(allCases.filter((c) => c.id !== caseId));
    if (deletedCase) {
      setArchivedCases([
        {
          ...deletedCase,
          type: String(deletedCase.type || '').toLowerCase(),
          status: String(deletedCase.status || '').toLowerCase(),
          archivedAt: new Date().toISOString(),
        },
        ...archivedCases,
      ]);
    }
    toast.success('Test case deleted');
    router.push(`/p/${slug}/repository`);
  };

  const handleClone = async () => {
    setSaving(true);
    try {
      const cloned = await cloneTestCaseAction(caseId);
      const mappedCloned = {
        id: cloned.id,
        displayId: (cloned as any).display_id || (cloned as any).displayId || cloned.id,
        projectId: cloned.projectId,
        moduleId: cloned.moduleId,
        title: cloned.title,
        description: (cloned as any).description || '',
        preConditions: (cloned as any).pre_conditions || (cloned as any).preConditions || '',
        postConditions: (cloned as any).post_conditions || (cloned as any).postConditions || '',
        steps: cloned.steps || [],
        priority: cloned.priority,
        type: cloned.type,
        status: cloned.status,
        tags: cloned.tags || [],
        aiGenerated: cloned.aiGenerated,
        createdAt: cloned.createdAt,
      };

      setCases([...allCases, mappedCloned]);
      toast.success(`Cloned as ${mappedCloned.displayId}`);
      if (onClose) {
        onClose();
      }
      router.push(`/p/${slug}/repository/${mappedCloned.displayId}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to clone test case');
    } finally {
      setSaving(false);
    }
  };

  const handleAttachmentDelete = async (attachmentId: string) => {
    await deleteAttachmentAction(attachmentId);
    const loadedAttachments = await getAttachmentsAction(caseId, 'case');
    setAttachments(loadedAttachments.attachments || []);
  };

  const handleAttachmentUploadComplete = async () => {
    const loadedAttachments = await getAttachmentsAction(caseId, 'case');
    setAttachments(loadedAttachments.attachments || []);
  };

  const updateField = async (field: string, value: any) => {
    try {
      await updateTestCaseAction(caseId, { [field]: value });
    } catch {
      toast.error('Failed to update');
    }
  };

  const currentMember = members?.find((m: any) => m.userId === currentUser?.id);
  const currentUserRole = (currentMember?.role || contextUserRole || '').toUpperCase();
  const isAdmin =
    contextIsAdmin !== undefined
      ? contextIsAdmin
      : currentUserRole === 'ADMIN' || currentUserRole === 'OWNER';
  const isViewer = currentUserRole === 'VIEWER' || currentUserRole === 'GUEST' || contextCanEdit === false;
  const canEdit = !isViewer;

  // Review Requester resolution:
  // When an active review exists, ONLY the user who submitted this active review is the requester.
  const activeReqUserId =
    activeReviewRequest?.requestedById ??
    activeReviewRequest?.requested_by ??
    activeReviewRequest?.requester?.id;

  const isReviewRequester = Boolean(
    activeReviewRequest &&
    currentUser?.id &&
    activeReqUserId &&
    String(activeReqUserId) === String(currentUser.id)
  );

  const status = getValue('status');
  const effectiveReviewStatus = (
    reviewStatusOverride ||
    activeReviewRequest?.status ||
    testCase?.reviewStatus ||
    (testCase as any)?.review_status ||
    ''
  ).toLowerCase();
  const reviewStatus = effectiveReviewStatus;

  // When review is pending:
  // Only the user who requested the active review has author edit privileges.
  // All other users (non-requesters) are strictly locked out of editing definitions.
  const isAuthor = Boolean(
    reviewStatus === 'pending'
      ? isReviewRequester
      : (activeReviewRequest
          ? isReviewRequester
          : currentUser?.id && String(testCase?.createdBy) === String(currentUser.id))
  );

  const activeAssigneeUserId =
    activeReviewRequest?.assignedToId ??
    activeReviewRequest?.assigned_to ??
    activeReviewRequest?.assignee?.id;

  const isReviewer = Boolean(
    currentUser?.id &&
    activeAssigneeUserId &&
    String(activeAssigneeUserId) === String(currentUser.id) &&
    !isReviewRequester
  );

  // When a review is pending, all other users (non-requesters) are strictly locked out of editing
  const isLocked = Boolean(reviewStatus === 'pending' && !isAuthor);

  // Filter out empty/ghost steps when comparing local vs snapshot lengths
  const validLocalSteps = steps.filter(s => Boolean((s.step || '').trim() || (s.expected_result || (s as any).expectedResult || '').trim() || (s.data || '').trim()));
  const validSnapshotSteps = (reviewDiff?.after?.steps || []).filter((s: any) => Boolean((s.step || '').trim() || (s.expected_result || s.expectedResult || '').trim() || (s.data || '').trim()));

  const hasWorkingEdits = Boolean(
    isAuthor && reviewStatus === 'pending' && hasChanges
  );
  const hasValidSteps = validLocalSteps.length > 0;
  const reviewRequired = Boolean((project as any)?.reviewRequired);

  const handleSubmitAsActive = async () => {
    if (!hasValidSteps) {
      toast.error('Please add at least one test step before publishing as Active');
      return;
    }
    setSaving(true);
    try {
      const [updatedCaseObj, savedStepsRes] = await Promise.all([
        Object.keys(draftState).length > 0
          ? updateTestCaseAction(caseId, { ...draftState, status: 'active' })
          : updateTestCaseAction(caseId, { status: 'active' }),
        stepsDirty && stepEditorRef.current
          ? stepEditorRef.current.saveAll()
          : Promise.resolve(null),
      ]);

      if (testCase.reviewStatus === 'pending' || testCase.reviewStatus === 'changes_requested') {
        await adminForceApproveAction(caseId);
      }
      const refreshedSteps = savedStepsRes ?? steps;
      if (savedStepsRes) {
        setSteps(refreshedSteps as any);
      }
      syncCaseToContext(updatedCaseObj, refreshedSteps as any);
      apiClient.invalidate(`/api/v1/cases/`);

      toast.success('Saved and published as active');
      window.dispatchEvent(new CustomEvent('review-updated'));
      setDraftState({});
      setIsDirty(false);
      setStepsDirty(false);
      setIsEditingPending(false);
      setActiveTab('details');
      setActiveReviewRequest(null);
      setReviewDiff(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to save as active');
    } finally {
      setSaving(false);
    }
  };

  const handleAdminBypass = handleSubmitAsActive;

  const handleOpenSubmitReviewModal = () => {
    if (!hasValidSteps) {
      toast.error('Please add at least one test step before submitting for review');
      return;
    }
    if (activeReviewRequest?.assignedToId) {
      setReviewTarget(String(activeReviewRequest.assignedToId));
    } else {
      setReviewTarget('');
    }
    setReviewComment('');
    setShowSubmitReviewDialog(true);
  };

  const handleExecuteSubmitReview = async () => {
    setSubmittingReview(true);
    try {
      const [, savedStepsRes] = await Promise.all([
        Object.keys(draftState).length > 0
          ? updateTestCaseAction(caseId, draftState)
          : Promise.resolve(null),
        stepsDirty && stepEditorRef.current
          ? stepEditorRef.current.saveAll()
          : Promise.resolve(null),
      ]);
      const assignedTo = reviewTarget ? Number(reviewTarget) : undefined;
      await requestReviewAction({
        testCaseId: caseId,
        assignedTo,
        comment: reviewComment || undefined
      });

      toast.success(
        reviewStatus === 'changes_requested'
          ? 'Resubmitted for review'
          : (reviewStatus === 'pending' ? 'Review request updated' : 'Review requested')
      );
      window.dispatchEvent(new CustomEvent('review-updated'));
      setShowSubmitReviewDialog(false);
      setDraftState({});
      setIsDirty(false);
      setStepsDirty(false);
      setIsEditingPending(false);

      if (savedStepsRes) {
        setSteps(savedStepsRes as any);
      }
      apiClient.invalidate(`/api/v1/cases/`);
      const [req, diffData, history] = await Promise.all([
        getActiveReviewRequestAction(caseId),
        getReviewDiffAction(caseId),
        getReviewHistoryAction(caseId),
      ]);
      setActiveReviewRequest(req);
      setReviewDiff(diffData);
      setReviewHistory(history);
    } catch (e: any) {
      toast.error(e.message || 'Failed to submit review request');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleApproveReview = async () => {
    if (!activeReviewRequest?.id) return;
    try {
      await approveReviewAction(activeReviewRequest.id);
      toast.success('Review approved and test case published');
      window.dispatchEvent(new CustomEvent('review-updated'));
      apiClient.invalidate(`/api/v1/cases/`);
      const [req, diffData, history] = await Promise.all([
        getActiveReviewRequestAction(caseId),
        getReviewDiffAction(caseId),
        getReviewHistoryAction(caseId),
      ]);
      setActiveReviewRequest(req);
      setReviewDiff(diffData);
      setReviewHistory(history);
    } catch (e: any) {
      toast.error(e.message || 'Failed to approve review');
    }
  };

  const stepComments: StepCommentItem[] = useMemo(() => {
    return comments
      .filter((c: any) => !c.deleted_at)
      .map((c: any) => {
        const match = (c.body || '').match(/^\[Step\s+(\d+)\]\s*([\s\S]*)/i);
        if (!match) return null;
        return {
          id: c.id,
          stepOrder: parseInt(match[1], 10),
          authorId: c.author?.id ?? c.author_id,
          authorName: c.author?.name || c.author?.email || 'User',
          authorImage: c.author?.image,
          body: match[2].trim(),
          createdAt: c.created_at || c.createdAt,
          resolved: c.resolved,
        };
      })
      .filter(Boolean) as StepCommentItem[];
  }, [comments]);

  const handleAddStepComment = async (stepOrder: number, body: string) => {
    try {
      await createCommentAction({
        project_id: project?.id || '',
        entity_type: 'case',
        entity_id: caseId,
        body: `[Step ${stepOrder}] ${body}`,
      });
      toast.success(`Note added on Step ${stepOrder}`);
      const refreshed = await getCommentsAction(caseId, 'case');
      setComments(refreshed || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to add note');
    }
  };

  const handleResolveStepComment = async (commentId: string) => {
    try {
      await resolveCommentAction(commentId);
      toast.success('Note updated');
      const refreshed = await getCommentsAction(caseId, 'case');
      setComments(refreshed || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update note');
    }
  };

  const handleDeleteStepComment = async (commentId: string) => {
    try {
      await deleteCommentAction(commentId);
      toast.success('Note deleted');
      const refreshed = await getCommentsAction(caseId, 'case');
      setComments(refreshed || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete note');
    }
  };

  const handleRequestChanges = async () => {
    if (!activeReviewRequest?.id) return;
    const unresolvedStepNotes = stepComments.filter((c) => !c.resolved);
    let finalFeedback = requestChangesComment.trim();

    if (!finalFeedback && unresolvedStepNotes.length > 0) {
      const stepSummary = unresolvedStepNotes
        .map((s) => `Step ${s.stepOrder}: ${s.body}`)
        .join('; ');
      finalFeedback = `Please address feedback on ${unresolvedStepNotes.length} step(s): ${stepSummary}`;
    }

    if (!finalFeedback) {
      toast.error('Please enter feedback or leave step comments explaining the changes needed');
      return;
    }
    try {
      await requestChangesOnReviewAction(activeReviewRequest.id, finalFeedback);
      toast.success('Changes requested');
      setShowRequestChangesDialog(false);
      setRequestChangesComment('');
      window.dispatchEvent(new CustomEvent('review-updated'));
      apiClient.invalidate(`/api/v1/cases/`);
      const [req, diffData, history] = await Promise.all([
        getActiveReviewRequestAction(caseId),
        getReviewDiffAction(caseId),
        getReviewHistoryAction(caseId),
      ]);
      setActiveReviewRequest(req);
      setReviewDiff(diffData);
      setReviewHistory(history);
    } catch (e: any) {
      toast.error(e.message || 'Failed to request changes');
    }
  };

  const handleCancelReview = async () => {
    setConfirmConfig({
      open: true,
      title: 'Cancel Review Request',
      description: 'Are you sure you want to withdraw this review request? It will revert the test case to Draft.',
      confirmLabel: 'Cancel Review',
      variant: 'destructive',
      onConfirm: async () => {
        try {
          await cancelReviewAction(caseId);
          toast.success('Review request cancelled');
          window.dispatchEvent(new CustomEvent('review-updated'));
          setIsEditingPending(false);
          apiClient.invalidate(`/api/v1/cases/`);
          setActiveReviewRequest(null);
          setReviewDiff(null);
          const history = await getReviewHistoryAction(caseId);
          setReviewHistory(history);
        } catch (e: any) {
          toast.error(e.message || 'Failed to cancel review');
        }
      }
    });
  };

  const handleUpdateReviewSnapshot = async () => {
    setSaving(true);
    try {
      const [savedStepsRes] = await Promise.all([
        stepsDirty && stepEditorRef.current
          ? stepEditorRef.current.saveAll()
          : Promise.resolve(null),
        Object.keys(draftState).length > 0
          ? updateTestCaseAction(caseId, draftState)
          : Promise.resolve(null),
      ]);
      if (Object.keys(draftState).length > 0) {
        setDraftState({});
      }
      await updateReviewSnapshotAction(caseId);
      toast.success('Review request updated with latest changes');
      window.dispatchEvent(new CustomEvent('review-updated'));
      setIsEditingPending(false);
      setIsDirty(false);
      setStepsDirty(false);
      if (savedStepsRes) {
        setSteps(savedStepsRes as any);
      }
      apiClient.invalidate(`/api/v1/cases/`);
      const [freshDiff, freshReq] = await Promise.all([
        getReviewDiffAction(caseId),
        getActiveReviewRequestAction(caseId),
      ]);
      setReviewDiff(freshDiff);
      setActiveReviewRequest(freshReq);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update review');
    } finally {
      setSaving(false);
    }
  };

  const handleDiscardWorkingChanges = async () => {
    setConfirmConfig({
      open: true,
      title: 'Discard Working Edits',
      description: 'Are you sure you want to discard your local working edits? This will restore the test case steps and fields back to the submitted review snapshot.',
      confirmLabel: 'Discard & Restore Snapshot',
      variant: 'destructive',
      onConfirm: async () => {
        setSaving(true);
        try {
          await discardWorkingChangesAction(caseId);
          toast.success('Working edits discarded, restored review snapshot');
          window.dispatchEvent(new CustomEvent('review-updated'));
          setDraftState({});
          setIsDirty(false);
          setStepsDirty(false);
          setIsEditingPending(false);
          const refreshedSteps = await getTestCaseStepsAction(caseId);
          setSteps(refreshedSteps as any);
          const freshDiff = await getReviewDiffAction(caseId);
          setReviewDiff(freshDiff);
        } catch (err: any) {
          toast.error(err.message || 'Failed to discard changes');
        } finally {
          setSaving(false);
        }
      }
    });
  };

  const showLockedToast = () => {
    const authorName =
      activeReviewRequest?.requestedByName ||
      activeReviewRequest?.requester?.name ||
      activeReviewRequest?.requester?.email ||
      'Author';

    const authorFirstName = authorName.split(' ')[0] || authorName;

    const versionLabel = activeReviewRequest?.displayVersion ||
      (activeReviewRequest?.versionNumberAtRequest ? `v${activeReviewRequest.versionNumberAtRequest}` : 'In Review');

    toast.custom((t) => (
      <div className="flex items-start gap-3 w-full max-w-md p-3.5 rounded-2xl border border-blue-500/30 bg-card/95 backdrop-blur-xl shadow-2xl text-foreground animate-in fade-in-0 zoom-in-95 duration-200">
        <div className="p-2 rounded-xl bg-blue-500/15 text-blue-500 dark:text-blue-400 border border-blue-500/30 shrink-0 mt-0.5">
          <Lock className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h4 className="font-semibold text-xs text-foreground">Locked for Review</h4>
            <span className="font-mono text-[10px] font-bold px-1.5 py-0.2 rounded bg-blue-500/15 text-blue-500 dark:text-blue-400 border border-blue-500/30">
              {versionLabel}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Submitted by <span className="font-medium text-foreground">{authorFirstName}</span>. Content cannot be edited while review is pending.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 self-center">
          <button
            type="button"
            onClick={() => {
              toast.dismiss(t);
              router.push(`/p/${slug}/reviews/${testCase?.displayId || caseId}`);
            }}
            className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-colors shadow-xs cursor-pointer"
          >
            Open Review
          </button>
          <button
            type="button"
            onClick={() => toast.dismiss(t)}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
            title="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    ), { duration: 5000 });
  };

  const [savingField, setSavingField] = useState<string | null>(null);

  const isDescriptionDirty = Boolean(
    draftState.description !== undefined &&
    (draftState.description || '') !== (testCase?.description || '')
  );

  const originalPreConditions = testCase?.preConditions || (testCase as any)?.pre_conditions || '';
  const currentPreConditions = getValue('preConditions') || getValue('pre_conditions') || '';
  const isPreConditionsDirty = Boolean(
    (draftState.preConditions !== undefined || draftState.pre_conditions !== undefined) &&
    currentPreConditions !== originalPreConditions
  );

  const originalPostConditions = testCase?.postConditions || (testCase as any)?.post_conditions || '';
  const currentPostConditions = getValue('postConditions') || getValue('post_conditions') || '';
  const isPostConditionsDirty = Boolean(
    (draftState.postConditions !== undefined || draftState.post_conditions !== undefined) &&
    currentPostConditions !== originalPostConditions
  );

  const handleSaveField = async (field: 'description' | 'preConditions' | 'postConditions') => {
    if (isLocked) {
      showLockedToast();
      return;
    }

    let label = 'Description';
    let payload: any = {};
    if (field === 'description') {
      label = 'Description';
      payload = { description: draftState.description !== undefined ? draftState.description : (testCase?.description || '') };
    } else if (field === 'preConditions') {
      label = 'Pre-conditions';
      const val = getValue('preConditions') || getValue('pre_conditions') || '';
      payload = { preConditions: val, pre_conditions: val };
    } else if (field === 'postConditions') {
      label = 'Post-conditions';
      const val = getValue('postConditions') || getValue('post_conditions') || '';
      payload = { postConditions: val, post_conditions: val };
    }

    setSavingField(field);
    try {
      const updatedCaseObj = await updateTestCaseAction(caseId, payload);
      syncCaseToContext(updatedCaseObj);

      setDraftState((prev: any) => {
        const next = { ...prev };
        if (field === 'description') {
          delete next.description;
        } else if (field === 'preConditions') {
          delete next.preConditions;
          delete next.pre_conditions;
        } else if (field === 'postConditions') {
          delete next.postConditions;
          delete next.post_conditions;
        }
        if (Object.keys(next).length === 0 && !stepsDirty) {
          setIsDirty(false);
        }
        return next;
      });

      toast.success(`${label} saved`);
    } catch {
      toast.error(`Failed to save ${label.toLowerCase()}`);
    } finally {
      setSavingField(null);
    }
  };

  const handleCancelField = (field: 'description' | 'preConditions' | 'postConditions') => {
    let label = 'Description';
    setDraftState((prev: any) => {
      const next = { ...prev };
      if (field === 'description') {
        label = 'Description';
        delete next.description;
      } else if (field === 'preConditions') {
        label = 'Pre-conditions';
        delete next.preConditions;
        delete next.pre_conditions;
      } else if (field === 'postConditions') {
        label = 'Post-conditions';
        delete next.postConditions;
        delete next.post_conditions;
      }
      if (Object.keys(next).length === 0 && !stepsDirty) {
        setIsDirty(false);
      }
      return next;
    });
    toast.info(`${label} changes discarded`);
  };

  const handleClearField = (field: 'description' | 'preConditions' | 'postConditions') => {
    if (isLocked) {
      showLockedToast();
      return;
    }
    if (field === 'description') {
      handleDraftChange('description', '');
      toast.info('Description cleared (unsaved)');
    } else if (field === 'preConditions') {
      handleDraftChange('preConditions', '');
      handleDraftChange('pre_conditions', '');
      toast.info('Pre-conditions cleared (unsaved)');
    } else if (field === 'postConditions') {
      handleDraftChange('postConditions', '');
      handleDraftChange('post_conditions', '');
      toast.info('Post-conditions cleared (unsaved)');
    }
  };

  const handleOpenDiffDialog = async () => {
    try {
      const [freshDiff, req, freshComments] = await Promise.all([
        getReviewDiffAction(caseId),
        getActiveReviewRequestAction(caseId),
        getCommentsAction(caseId, 'case'),
      ]);
      if (freshDiff) setReviewDiff(freshDiff);
      if (req) setActiveReviewRequest(req);
      if (freshComments) setComments(freshComments);
      setShowDiffDialog(true);
    } catch {
      setShowDiffDialog(true);
    }
  };

  const handleSaveAndSendToReview = async () => {
    await executeSaveChanges(false);
    handleOpenSubmitReviewModal();
  };

  const handleSaveAndPushToReview = async () => {
    await executeSaveChanges(false);
    await handleUpdateReviewSnapshot();
  };

  const creatorMember = members?.find((m: any) => String(m.userId) === String(testCase.createdBy) || String(m.user?.id) === String(testCase.createdBy));
  const creatorUser = creatorMember?.user || (currentUser?.id && String(currentUser.id) === String(testCase.createdBy) ? currentUser : null);
  const isAi = Boolean(testCase?.aiGenerated || testCase?.ai_generated);
  const hasAiSteps = useMemo(
    () => steps.some((s: any) => Boolean(s.aiGenerated || s.ai_generated)),
    [steps]
  );
  const isImported = Boolean(
    (testCase?.labels || []).some((l: string) => l.toLowerCase() === 'imported' || l.toLowerCase() === 'import') ||
    (testCase?.tags || []).some((t: string) => t.toLowerCase() === 'imported' || t.toLowerCase() === 'import')
  );
  const rawFullName = creatorUser?.fullName?.trim() || (creatorUser?.name && creatorUser?.name !== creatorUser?.displayName ? creatorUser.name.trim() : '');
  const authorFullName = (
    rawFullName ||
    creatorUser?.displayName?.trim() ||
    creatorUser?.display_name?.trim() ||
    creatorUser?.name?.trim() ||
    (testCase?.createdBy ? `User #${testCase.createdBy}` : '—')
  );
  const authorFirstName = authorFullName.split(' ')[0] || authorFullName;
  const updaterMember = (testCase.updatedBy || testCase.updated_by)
    ? members?.find((m: any) => m.userId === (testCase.updatedBy || testCase.updated_by) || m.user?.id === (testCase.updatedBy || testCase.updated_by))
    : null;
  const updaterUser = updaterMember?.user;

  const handleContainerBackgroundClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isEditing || hasChanges) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const interactive = target.closest(
        'button, input, textarea, select, a, [role="button"], [role="tab"], [role="menuitem"], [role="dialog"], [data-step-order], .cursor-pointer, .cursor-text'
      );
      if (!interactive) {
        setActiveEditField(null);
        setIsEditing(false);
      }
    },
    [isEditing, hasChanges]
  );

  const customFields = (testCase?.customFields || testCase?.custom_fields) || {};
  const hasPostmanLink = Boolean(customFields._postman?.collectionUid);
  const hasDatadogLink = Boolean(customFields._datadog?.publicIds?.length);
  // A case is linked to exactly one external provider. Legacy rows may still hold
  // both markers; resolve to a single provider (Postman wins, matching the import tag)
  // so only one "Run ..." action is ever offered.
  const externalProvider: 'postman' | 'datadog' | null = hasPostmanLink
    ? 'postman'
    : hasDatadogLink
    ? 'datadog'
    : null;
  const isPostmanCase = externalProvider === 'postman';
  const isDatadogCase = externalProvider === 'datadog';

  const createdAtMs = testCase.createdAt ? new Date(testCase.createdAt).getTime() : (testCase.created_at ? new Date(testCase.created_at).getTime() : 0);
  const updatedAtMs = testCase.updatedAt ? new Date(testCase.updatedAt).getTime() : (testCase.updated_at ? new Date(testCase.updated_at).getTime() : 0);
  const showUpdatedAt = updatedAtMs > 0 && createdAtMs > 0 && updatedAtMs - createdAtMs > 1000; // >1s diff

  const displayTitle =
    draftState.title !== undefined ? draftState.title : title || testCase.title || '';

  return (
    <div className="min-h-screen scroll-smooth" onMouseDown={handleContainerBackgroundClick}>
      {/* Top Bar Header - Permanent Key + Title + Window Navigation */}
      <div
        className={cn(
          "sticky z-30 h-[56px] py-2 bg-card/95 backdrop-blur-md border-b border-border/60 flex items-center",
          isFullPage ? "top-14" : "top-0"
        )}
        style={{ willChange: 'transform' }}
      >
        <div className="w-full flex items-center justify-between px-4 md:px-6 gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {isFullPage && (
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center justify-center p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0 cursor-pointer"
                title="Back to Repository"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}

            <span className="font-mono text-xs sm:text-sm font-bold px-2.5 py-0.5 rounded-lg bg-primary/10 text-primary border border-primary/25 shrink-0 select-all">
              {testCase.displayId}
            </span>

            <div className="flex-1 min-w-0">
              {isEditing ? (
                activeEditField === 'title' ? (
                  <div className="flex items-center gap-1.5 w-full animate-in fade-in-0 duration-150">
                    <input
                      type="text"
                      value={displayTitle}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        handleDraftChange('title', e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          setActiveEditField(null);
                          toast.success('Title updated');
                        } else if (e.key === 'Escape') {
                          setTitle(testCase.title);
                          handleDraftChange('title', testCase.title);
                          setActiveEditField(null);
                        }
                      }}
                      className="flex-1 min-w-0 text-base sm:text-lg font-bold bg-muted/30 border border-primary/60 rounded-lg px-2.5 py-1 outline-none focus:border-primary text-foreground placeholder:text-muted-foreground"
                      placeholder="Test case title..."
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setActiveEditField(null);
                        toast.success('Title updated');
                      }}
                      className="h-7 px-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shrink-0 shadow-2xs"
                      title="Save title"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Save</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTitle(testCase.title);
                        handleDraftChange('title', testCase.title);
                        setActiveEditField(null);
                      }}
                      className="h-7 px-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-xs font-medium flex items-center gap-1 cursor-pointer shrink-0"
                      title="Cancel title edit"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => setActiveEditField('title')}
                    className="group cursor-pointer rounded-lg px-1.5 py-0.5 -mx-1.5 hover:bg-muted/40 transition-colors flex items-center gap-1.5 min-w-0"
                    title="Click to edit title"
                  >
                    <h1 className="text-base sm:text-lg md:text-xl font-bold text-foreground leading-snug whitespace-normal break-words select-text">
                      {displayTitle}
                    </h1>
                    <Pencil className="h-3.5 w-3.5 opacity-0 group-hover:opacity-70 transition-opacity shrink-0 text-muted-foreground" />
                  </div>
                )
              ) : (
                <h1
                  className="text-base sm:text-lg md:text-xl font-bold text-foreground leading-snug whitespace-normal break-words select-text"
                  title={displayTitle}
                >
                  {displayTitle}
                </h1>
              )}
            </div>
          </div>

          {/* Window & Navigation Controls + Primary Editorial Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {(isEditing || hasChanges) ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-semibold cursor-pointer"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  {hasChanges ? 'Discard' : 'Exit Edit'}
                </Button>

                {hasChanges && (
                  reviewStatus === 'pending' ? (
                    <Button
                      size="sm"
                      className="h-8 text-xs font-semibold shadow-xs cursor-pointer bg-primary hover:bg-primary/90 text-primary-foreground"
                      onClick={handleSaveAndPushToReview}
                      disabled={saving}
                      title="Save changes and push to review snapshot"
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />
                      {saving ? 'Pushing...' : 'Push to Review'}
                    </Button>
                  ) : reviewStatus === 'changes_requested' ? (
                    <Button
                      size="sm"
                      className="h-8 text-xs font-semibold shadow-xs cursor-pointer bg-primary hover:bg-primary/90 text-primary-foreground"
                      onClick={handleSaveAndSendToReview}
                      disabled={saving}
                      title="Save revisions and resubmit for review"
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />
                      {saving ? 'Resubmitting...' : 'Resubmit for Review'}
                    </Button>
                  ) : status === 'draft' ? (
                    <SplitButton
                      label={saving ? 'Saving...' : (isAdmin || !reviewRequired ? 'Publish Changes' : 'Submit for Review')}
                      icon={<Check className="h-3.5 w-3.5" />}
                      onClick={() => handleSaveChanges(true)}
                      disabled={saving}
                      title="Publish or submit changes"
                      items={[
                        {
                          label: 'Save as Draft',
                          icon: <FileText className="h-3.5 w-3.5" />,
                          onClick: handleSaveDraft,
                          disabled: saving,
                        },
                      ]}
                    />
                  ) : (
                    <SplitButton
                      label={saving ? 'Saving...' : 'Save Changes'}
                      icon={<Check className="h-3.5 w-3.5" />}
                      onClick={() => handleSaveChanges(true)}
                      disabled={saving}
                      title="Save changes to active test case"
                      items={[
                        {
                          label: 'Submit for Review',
                          icon: <Send className="h-3.5 w-3.5" />,
                          onClick: handleSaveAndSendToReview,
                          disabled: saving,
                        },
                      ]}
                    />
                  )
                )}
              </>
            ) : !canEdit ? (
              <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-xl bg-muted/40 border border-border/50 text-xs font-medium text-muted-foreground select-none">
                <Eye className="h-3.5 w-3.5" />
                <span>View Only</span>
              </span>
            ) : null}

            {/* Animated Copy Link Button */}
            <Tooltip content={copiedLink ? "Copied!" : "Copy link"} side="bottom">
              <button
                type="button"
                onClick={handleCopyLink}
                className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-all duration-200 cursor-pointer inline-flex items-center justify-center"
              >
                {copiedLink ? (
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400 scale-110 animate-in zoom-in-75 duration-200" />
                ) : (
                  <LinkIcon className="h-4 w-4 transition-transform hover:scale-110" />
                )}
              </button>
            </Tooltip>

            {/* Prev / Next controls for stepped master-detail browsing */}
            {(onNavigatePrev !== undefined || onNavigateNext !== undefined) && (
              <div className="flex items-center gap-1 bg-muted/50 p-0.5 rounded-lg border border-border/60 text-xs mr-1">
                <Tooltip content="Previous test case" side="bottom">
                  <button
                    type="button"
                    onClick={() => {
                      if (hasChanges) {
                        setConfirmConfig({
                          open: true,
                          title: 'Unsaved Changes',
                          description: 'You have unsaved changes. Discard them and open the previous test case?',
                          confirmLabel: 'Discard & Continue',
                          variant: 'destructive',
                          onConfirm: () => onNavigatePrev?.(),
                        });
                      } else {
                        onNavigatePrev?.();
                      }
                    }}
                    disabled={!onNavigatePrev}
                    className="p-1 rounded text-foreground/80 hover:text-foreground disabled:opacity-30 disabled:pointer-events-none hover:bg-muted transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
                {currentIndex !== undefined && totalCount !== undefined && (
                  <span className="font-mono text-[11px] text-foreground/80 px-1 select-none font-semibold">
                    {currentIndex + 1} of {totalCount}
                  </span>
                )}
                <Tooltip content="Next test case" side="bottom">
                  <button
                    type="button"
                    onClick={() => {
                      if (hasChanges) {
                        setConfirmConfig({
                          open: true,
                          title: 'Unsaved Changes',
                          description: 'You have unsaved changes. Discard them and open the next test case?',
                          confirmLabel: 'Discard & Continue',
                          variant: 'destructive',
                          onConfirm: () => onNavigateNext?.(),
                        });
                      } else {
                        onNavigateNext?.();
                      }
                    }}
                    disabled={!onNavigateNext}
                    className="p-1 rounded text-foreground/80 hover:text-foreground disabled:opacity-30 disabled:pointer-events-none hover:bg-muted transition-colors cursor-pointer"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </Tooltip>
              </div>
            )}

            {/* Case Actions Overflow Menu (Clone, Delete) */}
            {canEdit && (
              <div
                className="relative"
                ref={overflowRef}
                onMouseEnter={() => setShowOverflow(true)}
                onMouseLeave={() => setShowOverflow(false)}
              >
                <button
                  onClick={() => setShowOverflow(!showOverflow)}
                  className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                  title="More actions"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
                {showOverflow && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowOverflow(false)} />
                    <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-xl shadow-xl py-1 min-w-[180px] overflow-hidden text-xs">
                      {isPostmanCase && (
                        <button
                          onClick={() => {
                            setExternalRunnerProvider('postman');
                            setShowExternalRunnerModal(true);
                            setShowOverflow(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-muted text-foreground font-medium transition-colors cursor-pointer flex items-center gap-2"
                        >
                          <Play className="h-3.5 w-3.5 text-primary" />
                          <span>Run Postman</span>
                        </button>
                      )}
                      {isDatadogCase && (
                        <button
                          onClick={() => {
                            setExternalRunnerProvider('datadog');
                            setShowExternalRunnerModal(true);
                            setShowOverflow(false);
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-muted text-foreground font-medium transition-colors cursor-pointer flex items-center gap-2"
                        >
                          <Play className="h-3.5 w-3.5 text-primary" />
                          <span>Run Datadog</span>
                        </button>
                      )}
                      {Boolean(
                        customFields._postman?.collectionUid
                      ) && (
                        <button
                          disabled={syncingPostman}
                          onClick={async () => {
                            setShowOverflow(false);
                            if (!project?.id) return;
                            const confirmed = window.confirm(
                              'Syncing will overwrite this case’s current steps with the latest Postman request. Continue?'
                            );
                            if (!confirmed) return;
                            setSyncingPostman(true);
                            try {
                              const res = await syncTestCaseFromPostmanAction({
                                projectId: project.id,
                                testCaseId: caseId,
                              });
                              toast.success(
                                `Synced ${res.stepsCount} step(s) & assertions from Postman ("${res.title}")`
                              );
                              window.location.reload();
                            } catch (err: any) {
                              toast.error(err?.message || 'Failed to sync from Postman');
                            } finally {
                              setSyncingPostman(false);
                            }
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-muted text-foreground font-medium transition-colors cursor-pointer flex items-center gap-2"
                        >
                          <RotateCcw className="h-3.5 w-3.5 text-orange-500" />
                          <span>{syncingPostman ? 'Syncing...' : 'Sync from Postman'}</span>
                        </button>
                      )}
                      {isDatadogCase && (
                        <button
                          disabled={syncingDatadog}
                          onClick={async () => {
                            setShowOverflow(false);
                            if (!project?.id) return;
                            const confirmed = window.confirm(
                              'Re-syncing will overwrite this case’s current steps with the latest Datadog definition. Continue?'
                            );
                            if (!confirmed) return;
                            setSyncingDatadog(true);
                            try {
                              const res = await syncTestCaseFromDatadogAction({
                                projectId: project.id,
                                testCaseId: caseId,
                              });
                              toast.success(`Re-synced ${res.stepsCount} step(s) from Datadog ("${res.name}")`);
                              window.location.reload();
                            } catch (err: any) {
                              toast.error(err?.message || 'Failed to re-sync from Datadog');
                            } finally {
                              setSyncingDatadog(false);
                            }
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-muted text-foreground font-medium transition-colors cursor-pointer flex items-center gap-2"
                        >
                          <RotateCcw className="h-3.5 w-3.5 text-orange-500" />
                          <span>{syncingDatadog ? 'Syncing...' : 'Re-sync from Datadog'}</span>
                        </button>
                      )}
                      {!externalProvider && (
                        <>
                          <button
                            onClick={() => {
                              setLinkDialogProvider('postman');
                              setShowOverflow(false);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-muted text-foreground font-medium transition-colors cursor-pointer flex items-center gap-2"
                          >
                            <LinkIcon className="h-3.5 w-3.5 text-primary" />
                            <span>Link to Postman</span>
                          </button>
                          <button
                            onClick={() => {
                              setLinkDialogProvider('datadog');
                              setShowOverflow(false);
                            }}
                            className="w-full text-left px-3 py-2 hover:bg-muted text-foreground font-medium transition-colors cursor-pointer flex items-center gap-2"
                          >
                            <LinkIcon className="h-3.5 w-3.5 text-primary" />
                            <span>Link to Datadog</span>
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => { handleClone(); setShowOverflow(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-muted text-foreground font-medium transition-colors cursor-pointer"
                      >
                        Clone Case
                      </button>
                      {canEdit && status === 'active' && (
                        <button
                          onClick={() => { setShowDeprecateModal(true); setShowOverflow(false); }}
                          className="w-full text-left px-3 py-2 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 font-medium transition-colors cursor-pointer"
                        >
                          Deprecate Case
                        </button>
                      )}
                      <button
                        onClick={() => { setShowDeleteModal(true); setShowOverflow(false); }}
                        className="w-full text-left px-3 py-2 text-destructive hover:bg-destructive/10 font-medium transition-colors cursor-pointer"
                      >
                        Delete Case
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Drawer & Pop-up Modal View Mode Controls */}
            {isFullPage ? (
              <>
                <Tooltip content="Open in side drawer" side="bottom">
                  <button
                    type="button"
                    onClick={() => router.push(`/p/${slug}/repository?case=${testCase?.displayId || caseId}&view=sheet`)}
                    className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center cursor-pointer"
                  >
                    <PanelRight className="h-4 w-4" />
                  </button>
                </Tooltip>
                <Tooltip content="Open in centered pop-up modal" side="bottom">
                  <button
                    type="button"
                    onClick={() => router.push(`/p/${slug}/repository?case=${testCase?.displayId || caseId}&view=popup`)}
                    className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center cursor-pointer"
                  >
                    <AppWindow className="h-4 w-4" />
                  </button>
                </Tooltip>
              </>
            ) : (
              <>
                {onToggleViewMode && viewMode !== 'docked' && (
                  <Tooltip content={viewMode === 'popup' ? "Switch to side drawer view" : "Switch to centered pop-up modal view"} side="bottom">
                    <button
                      type="button"
                      onClick={onToggleViewMode}
                      className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center cursor-pointer"
                    >
                      {viewMode === 'popup' ? (
                        <PanelRight className="h-4 w-4" />
                      ) : (
                        <AppWindow className="h-4 w-4" />
                      )}
                    </button>
                  </Tooltip>
                )}
                <Tooltip content="Open in full page view" side="bottom">
                  <button
                    type="button"
                    onClick={() => router.push(`/p/${slug}/repository/${testCase?.displayId || testCase?.display_id || testCase?.id || resolvedCaseId}`)}
                    className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors inline-flex items-center justify-center cursor-pointer"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                </Tooltip>
              </>
            )}

            {onClose && (
              <button
                onClick={handleRequestClose}
                className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title={isFullPage ? "Back to Repository" : "Close"}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="w-full px-4 sm:px-6 md:px-8 py-4">

        {/* Author metadata line + Consolidated Review Gate */}
        <div className="flex items-center justify-between gap-3 mb-4 font-sans flex-wrap">
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span className="text-muted-foreground">
              {isImported ? 'Imported by' : 'Created by'}
            </span>
            <div className="inline-flex items-center gap-1.5 font-medium text-foreground/90">
              <UserAvatar
                userId={testCase.createdBy}
                name={authorFullName}
                imageUrl={creatorUser?.image || creatorUser?.avatarUrl || (creatorUser as any)?.avatar_url}
                size="sm"
                className="h-5 w-5 text-[9px] shrink-0"
              />
              <span>{authorFirstName}</span>
            </div>
            {(isAi || (isImported && hasAiSteps)) && (
              <>
                {!isImported && <span className="text-muted-foreground">using</span>}
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-violet-500/15 text-violet-600 dark:text-violet-400 border border-violet-500/25">
                  <Sparkles className="h-2.5 w-2.5" />
                  <span>AI</span>
                </span>
              </>
            )}
            <span className="text-muted-foreground/40">•</span>
            <span className="font-mono text-[11px]">
              {testCase.createdAt || testCase.created_at
                ? format(new Date(testCase.createdAt || testCase.created_at), 'MMM d, yyyy · h:mm a')
                : 'Initial'}
            </span>
            {showUpdatedAt && (
              <>
                <span className="text-muted-foreground/40">•</span>
                <span className="font-mono text-[11px]">
                  Updated {format(new Date(testCase.updatedAt || testCase.updated_at), 'MMM d, yyyy · h:mm a')}
                </span>
              </>
            )}
          </div>

          {/* Review Action Buttons (Status & Review redirect live in Lifecycle chip below) */}
          <div className="flex items-center gap-2 flex-wrap">
            {reviewStatus === 'pending' ? (
              !isEditing && isAuthor && hasWorkingEdits ? (
                <Button
                  size="sm"
                  className="h-8 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl shadow-xs cursor-pointer flex items-center gap-1.5 px-3.5"
                  onClick={handleUpdateReviewSnapshot}
                  disabled={saving}
                  title="Push unsubmitted working edits to the active review snapshot"
                >
                  <Send className="h-3.5 w-3.5 mr-1" />
                  <span>Push to Review</span>
                </Button>
              ) : null
            ) : reviewStatus === 'changes_requested' ? (
              !isEditing ? (
                <Button
                  size="sm"
                  className="h-8 text-xs bg-primary text-primary-foreground font-semibold cursor-pointer shadow-xs"
                  onClick={handleOpenSubmitReviewModal}
                >
                  <Send className="h-3 w-3 mr-1" /> Resubmit for Review
                </Button>
              ) : null
            ) : status === 'draft' && !reviewStatus ? (
              <>
                {canEdit && !isEditing && hasValidSteps && (
                  <>
                    <Button
                      size="sm"
                      className="h-7 text-xs bg-primary text-primary-foreground font-medium shadow-xs cursor-pointer"
                      onClick={handleOpenSubmitReviewModal}
                    >
                      <Send className="h-3 w-3 mr-1" /> Submit for Review
                    </Button>
                    {(isAdmin || !reviewRequired) && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 font-medium cursor-pointer"
                        onClick={handleSubmitAsActive}
                      >
                        <Check className="h-3 w-3 mr-1" /> Publish Directly
                      </Button>
                    )}
                  </>
                )}
              </>
            ) : null}
          </div>
        </div>

        {/* Unified Fields Bar (All View Modes: Drawer, Pop-up, and Full Page) */}
        <div className="flex flex-wrap items-center gap-2 mb-4 pb-3 border-b border-border/30">
          {/* Priority */}
          <div className="relative">
            <button
              type="button"
              onClick={() => canEdit && setOpenPill(openPill === 'priority' ? null : 'priority')}
              className={cn(
                "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-medium border border-border/50 bg-muted/40 transition-colors",
                canEdit ? "hover:bg-muted/70 cursor-pointer" : "cursor-default"
              )}
            >
              <span className="text-muted-foreground">Priority:</span>
              <PriorityBadge priority={getValue('priority')} className="text-[10px] px-1.5 py-0.2" />
            </button>
            {canEdit && openPill === 'priority' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenPill(null)} />
                <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg p-2 min-w-[120px]">
                  {['P0', 'P1', 'P2', 'P3'].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { handleDraftChange('priority', p); setOpenPill(null); }}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-muted transition-colors flex items-center gap-2 cursor-pointer',
                        getValue('priority') === p && 'bg-primary/10 text-primary font-semibold'
                      )}
                    >
                      <PriorityBadge priority={p as Priority} className="text-[10px] px-1.5 py-0.5" />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Mode (Execution: Manual / Automated) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => canEdit && setOpenPill(openPill === 'type' ? null : 'type')}
              className={cn(
                "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-medium border border-border/50 bg-muted/40 transition-colors",
                canEdit ? "hover:bg-muted/70 cursor-pointer" : "cursor-default"
              )}
            >
              <span className="text-muted-foreground">Mode:</span>
              <span className="capitalize">{getValue('type')}</span>
            </button>
            {canEdit && openPill === 'type' && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpenPill(null)} />
                <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg p-2 min-w-[120px]">
                  {['manual', 'automated'].map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        const currentType = getValue('type');
                        // Switching Manual -> Automated asks how the case should be linked externally.
                        if (t === 'automated' && currentType !== 'automated') {
                          setPendingMode('automated');
                          setShowExternalLinkPrompt(true);
                          setOpenPill(null);
                          return;
                        }
                        handleDraftChange('type', t);
                        setOpenPill(null);
                      }}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-muted transition-colors capitalize cursor-pointer',
                        getValue('type') === t && 'bg-primary/10 text-primary font-semibold'
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Lifecycle Status (Redirects to Review Workspace when In Review / Changes Requested) */}
          {reviewStatus === 'pending' || reviewStatus === 'changes_requested' ? (
            <button
              type="button"
              onClick={() => router.push(`/p/${slug}/reviews/${testCase?.displayId || caseId}`)}
              title="Open Review Workspace"
              className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-medium border border-border/50 bg-muted/40 hover:bg-muted/70 transition-colors cursor-pointer group select-none"
            >
              <span className="text-muted-foreground">Lifecycle:</span>
              <StatusBadge status={getValue('status')} reviewStatus={reviewStatus} className="text-[10px] px-1.5 py-0.2" />
              <ExternalLink className="h-3 w-3 text-muted-foreground opacity-70 group-hover:opacity-100 group-hover:text-foreground transition-opacity" />
            </button>
          ) : (
            <div className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-medium border border-border/50 bg-muted/40 select-none cursor-default">
              <span className="text-muted-foreground">Lifecycle:</span>
              <StatusBadge status={getValue('status')} reviewStatus={reviewStatus} className="text-[10px] px-1.5 py-0.2" />
            </div>
          )}

          {/* Module */}
          <ModuleSelect
            modules={[...(modules || []), ...extraModules]}
            value={getValue('moduleId') || testCase.moduleId || ''}
            allowNone
            noneLabel="None"
            size="sm"
            className="h-6 px-2.5 text-xs font-medium border border-border/50 bg-muted/40 shadow-none hover:bg-muted/70 hover:text-foreground hover:border-border"
            onInlineCreate={async (name) => {
              const created = await createModuleAction({ projectId: project.id, name });
              setExtraModules((prev) => [...prev, created]);
              return created.id;
            }}
            onChange={(val) => handleDraftChange('moduleId', val || null)}
          />

          {/* Scenario (Only if set) */}
          {getValue('scenarioType') && (
            <div className="relative">
              <div className="inline-flex items-center gap-1 h-6 pl-2.5 pr-1 rounded-md text-xs font-medium border border-border/50 bg-muted/40">
                <button
                  type="button"
                  onClick={() => setOpenPill(openPill === 'scenario' ? null : 'scenario')}
                  className="inline-flex items-center gap-1.5 hover:text-foreground text-left cursor-pointer"
                >
                  <span className="text-muted-foreground">Scenario:</span>
                  <span className="capitalize">{getValue('scenarioType').replace('_', ' ')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDraftChange('scenarioType', null)}
                  className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive cursor-pointer"
                  title="Remove scenario"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {openPill === 'scenario' && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenPill(null)} />
                  <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg p-2 min-w-[140px]">
                    {SCENARIO_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { handleDraftChange('scenarioType', opt.value || null); setOpenPill(null); }}
                        className={cn(
                          'w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-muted transition-colors capitalize cursor-pointer',
                          (getValue('scenarioType') || '') === opt.value && 'bg-primary/10 text-primary font-semibold'
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Tags (Only if set) */}
          {(getValue('tags') || []).length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenPill(openPill === 'tags' ? null : 'tags')}
                className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-medium border border-border/50 bg-muted/40 hover:bg-muted/70 transition-colors cursor-pointer"
              >
                <span className="text-muted-foreground">Tags:</span>
                <span>
                  {(getValue('tags') || []).length === 1
                    ? (getValue('tags') || [])[0]
                    : `${(getValue('tags') || [])[0]} +${(getValue('tags') || []).length - 1}`}
                </span>
              </button>
              {openPill === 'tags' && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenPill(null)} />
                  <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg p-3 min-w-[220px]">
                    <div className="flex flex-wrap gap-1 mb-2">
                      {(getValue('tags') || []).map((t: string) => (
                        <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground flex items-center gap-1">
                          {t}
                          <button
                            type="button"
                            onClick={() => {
                              const next = (getValue('tags') || []).filter((x: string) => x !== t);
                              handleDraftChange('tags', next);
                            }}
                            className="hover:text-red-500 cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <TagInput
                      onAdd={async (tag) => {
                        const curr = getValue('tags') || [];
                        if (curr.includes(tag)) return;
                        await handleDraftChange('tags', [...curr, tag]);
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Suites (Compact single chip with +n & multi-select popover) */}
          {caseSuites.length > 0 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => canEdit && setOpenPill(openPill === 'suite' ? null : 'suite')}
                className={cn(
                  "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-md text-xs font-medium border border-border/50 bg-muted/40 transition-colors",
                  canEdit ? "hover:bg-muted/70 cursor-pointer" : "cursor-default"
                )}
              >
                <span className="text-muted-foreground">Suite:</span>
                <span className="truncate max-w-[180px]" title={caseSuites.map((cs) => cs.suiteName).join(', ')}>
                  {caseSuites.length === 1
                    ? caseSuites[0].suiteName
                    : `${caseSuites[0].suiteName} +${caseSuites.length - 1}`}
                </span>
              </button>

              {canEdit && openPill === 'suite' && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenPill(null)} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-popover border border-border rounded-xl shadow-xl py-1.5 text-xs animate-in fade-in-0 duration-100">
                    <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/40 mb-1 flex items-center justify-between">
                      <span>Test Suites</span>
                      <span className="font-mono text-[9px] text-muted-foreground">
                        {caseSuites.length} selected
                      </span>
                    </div>
                    <div className="max-h-56 overflow-y-auto space-y-0.5 px-1">
                      {suites.map((s: any) => {
                        const isLinked = caseSuites.some((cs) => cs.suiteId === s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={async () => {
                              try {
                                if (isLinked) {
                                  await removeCaseFromSuiteAction(s.id, caseId);
                                  setCaseSuites((prev) => prev.filter((cs) => cs.suiteId !== s.id));
                                } else {
                                  await addCaseToSuiteAction(s.id, caseId);
                                  setCaseSuites((prev) => [...prev, { suiteId: s.id, suiteName: s.name }]);
                                }
                              } catch (e: any) {
                                toast.error(e.message || 'Failed to update suite');
                              }
                            }}
                            className="w-full px-2.5 py-1.5 text-left text-xs rounded-lg hover:bg-muted/60 flex items-center justify-between cursor-pointer transition-colors"
                          >
                            <span className="truncate max-w-[190px] font-medium text-foreground" title={s.name}>
                              {s.name}
                            </span>
                            {isLinked && <Check className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Linked Ticket Key (Only if set) */}
          {getLinkedTicketKey() && (
            <div className="relative">
              <div className="inline-flex items-center gap-1.5 h-6 pl-2.5 pr-1 rounded-md text-xs font-medium border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <Tag className="h-3 w-3" />
                <span className="text-muted-foreground">Ticket:</span>
                <span className="font-mono font-bold">{getLinkedTicketKey()}</span>
                <button
                  type="button"
                  onClick={() => handleUpdateTicketKey('')}
                  className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive cursor-pointer"
                  title="Unlink ticket"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* Project Custom Fields (Shown on all test cases automatically) */}
          {customFieldDefs.map((def) => {
            const val = getCustomFieldValue(def.key);
            const isSet = !(val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0));
            const isSeverity = def.key.toLowerCase().includes('severity');
            const strVal = isSet
              ? def.type === CustomFieldType.BOOLEAN
                ? val
                  ? 'Yes'
                  : 'No'
                : Array.isArray(val)
                ? val.join(', ')
                : String(val)
              : '—';

            return (
              <div key={def.id} className="relative">
                <div
                  className={cn(
                    "inline-flex items-center gap-1 h-6 px-2.5 rounded-md text-xs font-medium border transition-colors max-w-[240px]",
                    isSet && isSeverity && strVal.toLowerCase() === 'critical'
                      ? "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400 font-semibold"
                      : isSet && isSeverity && strVal.toLowerCase() === 'high'
                      ? "bg-orange-500/10 border-orange-500/30 text-orange-600 dark:text-orange-400 font-semibold"
                      : isSet && isSeverity && strVal.toLowerCase() === 'medium'
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400 font-semibold"
                      : isSet && isSeverity && strVal.toLowerCase() === 'low'
                      ? "bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400"
                      : "border-border/50 bg-muted/40 hover:bg-muted/70"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!canEdit) return;
                      if (def.type === CustomFieldType.BOOLEAN) {
                        handleCustomFieldChange(def.key, !val);
                      } else {
                        setOpenPill(openPill === `cf_${def.key}` ? null : `cf_${def.key}`);
                        if (
                          def.type === CustomFieldType.TEXT ||
                          def.type === CustomFieldType.URL ||
                          def.type === CustomFieldType.NUMBER
                        ) {
                          setCustomTextInputs((prev) => ({ ...prev, [def.key]: String(val ?? '') }));
                        }
                      }
                    }}
                    className="inline-flex items-center gap-1.5 hover:text-foreground text-left cursor-pointer min-w-0"
                  >
                    <span className="text-muted-foreground truncate max-w-[90px]" title={def.name}>
                      {def.name}:
                    </span>
                    <span
                      className={cn(
                        "truncate max-w-[110px]",
                        !isSet && "text-muted-foreground font-normal"
                      )}
                      title={strVal}
                    >
                      {strVal}
                    </span>
                  </button>
                  {canEdit && isSet && (
                    <button
                      type="button"
                      onClick={() => handleCustomFieldChange(def.key, undefined)}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive cursor-pointer shrink-0 ml-0.5"
                      title={`Clear ${def.name}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>

                {/* Popover Editor */}
                {openPill === `cf_${def.key}` && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setOpenPill(null)} />
                    <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-xl p-2.5 min-w-[170px] max-w-[280px]">
                      {/* DROPDOWN Options */}
                      {def.type === CustomFieldType.DROPDOWN && (
                        <div className="space-y-1">
                          <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            Select {def.name}
                          </div>
                          {(def.options || []).map((opt: string) => {
                            const optLower = opt.toLowerCase();
                            const isCrit = isSeverity && optLower === 'critical';
                            const isHigh = isSeverity && optLower === 'high';
                            const isMed = isSeverity && optLower === 'medium';
                            const isLow = isSeverity && optLower === 'low';
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => {
                                  handleCustomFieldChange(def.key, opt);
                                  setOpenPill(null);
                                }}
                                className={cn(
                                  "w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-muted transition-colors flex items-center justify-between cursor-pointer",
                                  val === opt && "bg-primary/10 text-primary font-semibold"
                                )}
                              >
                                <span
                                  className={cn(
                                    isCrit && "text-red-500 font-bold",
                                    isHigh && "text-orange-500 font-bold",
                                    isMed && "text-amber-600 font-bold",
                                    isLow && "text-blue-500 font-medium"
                                  )}
                                >
                                  {opt}
                                </span>
                                {val === opt && <Check className="h-3.5 w-3.5 text-primary" />}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* MULTI_SELECT Options */}
                      {def.type === CustomFieldType.MULTI_SELECT && (
                        <div className="space-y-1">
                          <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {def.name}
                          </div>
                          {(def.options || []).map((opt: string) => {
                            const arr = Array.isArray(val) ? val : [];
                            const isSelected = arr.includes(opt);
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => {
                                  const next = isSelected
                                    ? arr.filter((x: string) => x !== opt)
                                    : [...arr, opt];
                                  handleCustomFieldChange(def.key, next);
                                }}
                                className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg hover:bg-muted transition-colors flex items-center justify-between cursor-pointer"
                              >
                                <span className="truncate">{opt}</span>
                                {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* TEXT Editor */}
                      {def.type === CustomFieldType.TEXT && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                            <span className="font-bold uppercase">{def.name}</span>
                            <span className="font-mono">
                              {(customTextInputs[def.key] ?? String(val || '')).length} / {MAX_TEXT_VALUE_LENGTH}
                            </span>
                          </div>
                          <input
                            type="text"
                            autoFocus
                            maxLength={MAX_TEXT_VALUE_LENGTH}
                            value={customTextInputs[def.key] ?? String(val || '')}
                            onChange={(e) =>
                              setCustomTextInputs((prev) => ({ ...prev, [def.key]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleCustomFieldChange(def.key, (customTextInputs[def.key] ?? '').trim());
                                setOpenPill(null);
                              }
                            }}
                            className="w-full h-8 px-2.5 rounded-lg border border-border bg-background text-xs"
                            placeholder={`Enter ${def.name}...`}
                          />
                          <div className="flex justify-end gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => setOpenPill(null)}
                              className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleCustomFieldChange(def.key, (customTextInputs[def.key] ?? '').trim());
                                setOpenPill(null);
                              }}
                              className="px-2.5 py-1 text-[11px] bg-primary text-primary-foreground rounded-md font-semibold cursor-pointer"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      )}

                      {/* NUMBER Editor */}
                      {def.type === CustomFieldType.NUMBER && (
                        <div className="space-y-2">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase">{def.name}</div>
                          <input
                            type="number"
                            autoFocus
                            value={customTextInputs[def.key] ?? String(val ?? '')}
                            onChange={(e) =>
                              setCustomTextInputs((prev) => ({ ...prev, [def.key]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const num = parseFloat(customTextInputs[def.key] ?? '');
                                handleCustomFieldChange(def.key, isNaN(num) ? undefined : num);
                                setOpenPill(null);
                              }
                            }}
                            className="w-full h-8 px-2.5 rounded-lg border border-border bg-background text-xs"
                            placeholder="0"
                          />
                          <div className="flex justify-end gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => setOpenPill(null)}
                              className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const num = parseFloat(customTextInputs[def.key] ?? '');
                                handleCustomFieldChange(def.key, isNaN(num) ? undefined : num);
                                setOpenPill(null);
                              }}
                              className="px-2.5 py-1 text-[11px] bg-primary text-primary-foreground rounded-md font-semibold cursor-pointer"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      )}

                      {/* URL Editor */}
                      {def.type === CustomFieldType.URL && (
                        <div className="space-y-2">
                          <div className="text-[10px] font-bold text-muted-foreground uppercase">{def.name} URL</div>
                          <input
                            type="url"
                            autoFocus
                            maxLength={255}
                            value={customTextInputs[def.key] ?? String(val || '')}
                            onChange={(e) =>
                              setCustomTextInputs((prev) => ({ ...prev, [def.key]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleCustomFieldChange(def.key, (customTextInputs[def.key] ?? '').trim());
                                setOpenPill(null);
                              }
                            }}
                            className="w-full h-8 px-2.5 rounded-lg border border-border bg-background text-xs"
                            placeholder="https://..."
                          />
                          <div className="flex justify-end gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => setOpenPill(null)}
                              className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleCustomFieldChange(def.key, (customTextInputs[def.key] ?? '').trim());
                                setOpenPill(null);
                              }}
                              className="px-2.5 py-1 text-[11px] bg-primary text-primary-foreground rounded-md font-semibold cursor-pointer"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {/* + Add Field dropdown */}
          {canEdit && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenAddProperty(!openAddProperty)}
                className="inline-flex items-center gap-1 h-6 px-2.5 rounded-md text-xs border border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                <span>Add Field</span>
              </button>

              {openAddProperty && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenAddProperty(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-popover border border-border rounded-xl shadow-xl py-1 text-xs">
                    {!getLinkedTicketKey() && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenAddProperty(false);
                          setOpenTicketKeyPopover(true);
                          setTicketKeyInput('');
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-muted transition-colors flex items-center justify-between cursor-pointer"
                      >
                        <span>Ticket Key (InkaBoard/Jira)</span>
                        <Plus className="h-3 w-3 text-muted-foreground" />
                      </button>
                    )}
                    {!getValue('scenarioType') && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenAddProperty(false);
                          setOpenPill('scenario');
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-muted transition-colors flex items-center justify-between cursor-pointer"
                      >
                        <span>Scenario Type</span>
                        <Plus className="h-3 w-3 text-muted-foreground" />
                      </button>
                    )}
                    {!(getValue('tags') && getValue('tags').length > 0) && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenAddProperty(false);
                          setOpenPill('tags');
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-muted transition-colors flex items-center justify-between cursor-pointer"
                      >
                        <span>Tags</span>
                        <Plus className="h-3 w-3 text-muted-foreground" />
                      </button>
                    )}
                    {caseSuites.length === 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setOpenAddProperty(false);
                          setShowSuiteSelector(true);
                        }}
                        className="w-full text-left px-3 py-1.5 hover:bg-muted transition-colors flex items-center justify-between cursor-pointer"
                      >
                        <span>Test Suite</span>
                        <Plus className="h-3 w-3 text-muted-foreground" />
                      </button>
                    )}

                    {/* Create New Custom Field action for Admins */}
                    {isAdmin && (
                      <>
                        <div className="border-t border-border/40 my-1" />
                        <button
                          type="button"
                          onClick={() => {
                            setOpenAddProperty(false);
                            setQuickCreateForm({
                              name: '',
                              type: CustomFieldType.DROPDOWN,
                              options: [],
                              newOptionText: '',
                            });
                            setShowQuickCreateFieldModal(true);
                          }}
                          className="w-full text-left px-3 py-1.5 text-primary hover:bg-primary/10 transition-colors flex items-center justify-between cursor-pointer font-semibold"
                        >
                          <span>+ Create Custom Field...</span>
                          <Sparkles className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Suite Selector Popover - Anchored directly to + Add Field */}
              {showSuiteSelector && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowSuiteSelector(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 w-64 bg-popover border border-border rounded-xl shadow-xl py-1.5 text-xs animate-in fade-in-0 duration-100">
                    <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/40 mb-1 flex items-center justify-between">
                      <span>Add to Test Suite</span>
                      <span className="font-mono text-[9px] text-muted-foreground">{suites.length} suites</span>
                    </div>
                    {suites.length === 0 ? (
                      <div className="p-3 text-center space-y-1.5">
                        <p className="text-xs text-muted-foreground">No test suites created yet.</p>
                        <Link
                          href={`/p/${slug}/suites`}
                          className="text-xs font-semibold text-primary hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          <span>Go to Suites</span>
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    ) : (
                      <div className="max-h-56 overflow-y-auto">
                        {suites
                          .filter((s: any) => !caseSuites.find((cs) => cs.suiteId === s.id))
                          .map((s: any) => (
                            <button
                              key={s.id}
                              type="button"
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/60 flex items-center justify-between cursor-pointer transition-colors group"
                              onClick={async () => {
                                try {
                                  await addCaseToSuiteAction(s.id, caseId);
                                  setCaseSuites([...caseSuites, { suiteId: s.id, suiteName: s.name }]);
                                  setShowSuiteSelector(false);
                                  toast.success(`Added to ${s.name}`);
                                } catch (e: any) {
                                  toast.error(e.message || 'Failed to add to suite');
                                }
                              }}
                            >
                              <span className="truncate max-w-[190px] font-medium text-foreground" title={s.name}>
                                {s.name}
                              </span>
                              <Plus className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground shrink-0 ml-2" />
                            </button>
                          ))}
                        {suites.filter((s: any) => !caseSuites.find((cs) => cs.suiteId === s.id)).length === 0 && (
                          <p className="px-3 py-2 text-xs text-muted-foreground text-center">
                            All suites include this case
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Ticket Key Input Popover */}
              {openTicketKeyPopover && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenTicketKeyPopover(false)} />
                  <div className="absolute top-full left-0 mt-1 z-[80] bg-popover border border-border/80 rounded-xl shadow-2xl p-2.5 min-w-[280px] max-w-[340px] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase">Link Ticket Key</span>
                      {isPmConnected && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          InkaBoard
                        </span>
                      )}
                    </div>

                    <div className="relative">
                      <input
                        type="text"
                        value={ticketKeyInput}
                        onChange={(e) => setTicketKeyInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const val = ticketKeyInput.trim().toUpperCase();
                            if (val) {
                              handleUpdateTicketKey(val);
                              setOpenTicketKeyPopover(false);
                            }
                          }
                        }}
                        placeholder={isPmConnected ? "Search InkaBoard or type key..." : "e.g. TECH-22, JIRA-42"}
                        className="w-full h-8 px-2.5 pr-7 text-xs rounded-lg border border-border/60 bg-background font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                        autoFocus
                      />
                      {loadingTickets && (
                        <div className="absolute right-2 top-2">
                          <div className="h-3.5 w-3.5 animate-spin rounded-full border border-primary border-t-transparent" />
                        </div>
                      )}
                    </div>

                    <div className="max-h-48 overflow-y-auto space-y-1 pt-0.5">
                      {ticketKeyInput.trim() && (
                        <button
                          type="button"
                          onClick={() => {
                            const val = ticketKeyInput.trim().toUpperCase();
                            handleUpdateTicketKey(val);
                            setOpenTicketKeyPopover(false);
                          }}
                          className="w-full text-left p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 flex items-center justify-between text-xs cursor-pointer"
                        >
                          <span className="font-medium text-[11px]">
                            Use manual key <span className="font-mono font-bold uppercase">{ticketKeyInput.trim().toUpperCase()}</span>
                          </span>
                          <span className="text-[9px] text-muted-foreground">Press Enter</span>
                        </button>
                      )}

                      {filteredTicketOptions.length > 0 ? (
                        <div className="space-y-0.5">
                          <div className="px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                            <span>{isPmConnected ? 'InkaBoard & Project Tickets' : 'Project Tickets'}</span>
                            <span>{filteredTicketOptions.length}</span>
                          </div>
                          {filteredTicketOptions.map((t) => (
                            <button
                              key={t.key}
                              type="button"
                              onClick={() => {
                                handleUpdateTicketKey(t.key);
                                setOpenTicketKeyPopover(false);
                              }}
                              className="w-full text-left p-1.5 rounded-md hover:bg-muted/70 transition-colors flex items-center justify-between gap-1.5 text-xs cursor-pointer group"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono font-bold text-foreground text-[11px] px-1 py-0.2 rounded bg-muted shrink-0">
                                    {t.key}
                                  </span>
                                  <span className="truncate text-foreground/90 font-medium text-[11px]">
                                    {t.title}
                                  </span>
                                </div>
                              </div>
                              <span className="shrink-0 text-[9px] px-1.5 py-0.2 rounded-full bg-muted font-medium text-muted-foreground">
                                {t.status}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : !ticketKeyInput.trim() ? (
                        <div className="p-2 text-xs text-center text-muted-foreground font-mono">
                          {isPmConnected ? 'No tickets found on InkaBoard. Type ticket key manually.' : 'Type ticket key manually (e.g. TECH-22).'}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/40">
                      <button
                        type="button"
                        onClick={() => setOpenTicketKeyPopover(false)}
                        className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const val = ticketKeyInput.trim().toUpperCase();
                          if (val) {
                            handleUpdateTicketKey(val);
                            setOpenTicketKeyPopover(false);
                          }
                        }}
                        disabled={!ticketKeyInput.trim()}
                        className="px-2.5 py-1 text-[11px] bg-primary text-primary-foreground rounded-md font-semibold disabled:opacity-50 cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Scenario Picker when opened from + Add Field */}
              {openPill === 'scenario' && !getValue('scenarioType') && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenPill(null)} />
                  <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg p-2 min-w-[140px]">
                    <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase">Choose Scenario</div>
                    {SCENARIO_OPTIONS.filter((o) => o.value).map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => { handleDraftChange('scenarioType', opt.value); setOpenPill(null); }}
                        className="w-full text-left px-3 py-1.5 text-sm rounded-lg hover:bg-muted transition-colors capitalize cursor-pointer"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Tags Input when opened from + Add Field */}
              {openPill === 'tags' && !(getValue('tags') && getValue('tags').length > 0) && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setOpenPill(null)} />
                  <div className="absolute top-full left-0 mt-1 z-50 bg-popover border border-border rounded-xl shadow-lg p-3 min-w-[220px]">
                    <div className="text-[10px] font-bold text-muted-foreground uppercase mb-1.5">Add Tags</div>
                    <TagInput
                      onAdd={async (tag) => {
                        await handleDraftChange('tags', [tag]);
                        setOpenPill(null);
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab === 'runs_bugs' ? 'runs' : activeTab}
          onValueChange={(tab) => {
            setActiveTab(tab);
            hasUserChangedTab.current = true;
            if (tab === 'comments' && caseId) {
              const now = Date.now();
              setLastReadCommentTime(now);
              if (typeof window !== 'undefined') {
                localStorage.setItem(`inka_comment_read_${caseId}`, String(now));
              }
              getCommentsAction(caseId, 'case')
                .then((refreshed) => setComments(refreshed || []))
                .catch(() => {});
            }
          }}
          className="w-full"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
            <TabsList className="bg-muted/50 p-1 rounded-xl">
              <TabsTrigger value="steps" className="rounded-lg px-3 py-1.5 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:shadow-xs cursor-pointer">
                Steps
                {steps.length > 0 && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                    {steps.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="runs" className="rounded-lg px-3 py-1.5 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:shadow-xs cursor-pointer">
                <Play className="h-3.5 w-3.5 mr-1 text-primary/80" />
                <span>Runs</span>
                {runHistory.length > 0 && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-mono font-bold">
                    {runHistory.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="bugs" className="rounded-lg px-3 py-1.5 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:shadow-xs cursor-pointer">
                <Bug className="h-3.5 w-3.5 mr-1 text-red-500/80" />
                <span>Bugs</span>
                {caseBugs.length > 0 && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-500 font-mono font-bold">
                    {caseBugs.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="activity" className="rounded-lg px-3 py-1.5 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:shadow-xs cursor-pointer">
                <Clock className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                <span>Activity</span>
                {reviewHistory.length > 0 && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                    {reviewHistory.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="comments" className="rounded-lg px-3 py-1.5 text-xs font-semibold data-[state=active]:bg-background data-[state=active]:shadow-xs cursor-pointer">
                <MessageSquare className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
                <span>Comments</span>
                {(reviewStatus === 'changes_requested' || stepComments.some((c) => !c.resolved)) && (
                  <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" title="Unresolved review feedback" />
                )}
                {totalCommentsCount > 0 && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                    {totalCommentsCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

              {/* Edit / Exit Edit (body-level action, replaces the old header button) */}
              {canEdit && (isEditing || hasChanges) ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-semibold border-border hover:bg-muted cursor-pointer flex items-center gap-1.5"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  <RotateCcw className="h-3.5 w-3.5 text-primary" />
                  <span>{hasChanges ? 'Discard' : 'Exit Edit'}</span>
                </Button>
              ) : canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs font-semibold border-border hover:bg-muted cursor-pointer flex items-center gap-1.5"
                  onClick={() => {
                    if (isLocked) {
                      showLockedToast();
                      return;
                    }
                    // Stay in the current presentation (drawer stays a drawer).
                    setIsEditing(true);
                  }}
                >
                  <Edit3 className="h-3.5 w-3.5 text-primary" />
                  <span>Edit Test Case</span>
                </Button>
              ) : null}
            </div>

          <TabsContent value="steps" className="space-y-4 mt-4">
            {/* Collapsible Description in Steps view (+ Separate View cURL Button for API / Postman Cases) */}
            {(() => {
              const rawDescText = String(getValue('description') || '');
              const savedCurl = (testCase?.customFields || testCase?.custom_fields)?._postman?.curlCommand;
              const inlineCurlMatch = rawDescText.match(/(?:Generated from cURL:\s*)?(curl\s+[\s\S]+)$/i);
              const effectiveCurl = savedCurl || (inlineCurlMatch ? inlineCurlMatch[1].trim() : '');
              const cleanedDescText = inlineCurlMatch
                ? rawDescText.slice(0, inlineCurlMatch.index).trim() ||
                  `Validates "${displayTitle}" API endpoint.`
                : rawDescText;

              return (
                <div className="border border-border/40 rounded-xl overflow-hidden bg-card/50 shadow-xs">
                  <div
                    onClick={() => setShowDescription(!showDescription)}
                    className="flex items-center justify-between px-3.5 py-2 bg-muted/20 border-b border-border/20 cursor-pointer hover:bg-muted/30 transition-colors select-none"
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
                      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform text-muted-foreground", !showDescription && "-rotate-90")} />
                      <span>Description</span>
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      {cleanedDescText && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block" />
                      )}
                    </div>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {effectiveCurl && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowCurlSnippet((prev) => !prev);
                            if (!showDescription) setShowDescription(true);
                          }}
                          className={cn(
                            "inline-flex items-center gap-1 h-6 px-2 rounded-md border text-[11px] font-mono font-medium transition-colors cursor-pointer",
                            showCurlSnippet
                              ? "bg-primary/15 text-primary border-primary/30"
                              : "bg-background/80 text-muted-foreground hover:text-foreground border-border/60"
                          )}
                        >
                          <Terminal className="h-3 w-3" />
                          <span>{showCurlSnippet ? 'Hide cURL' : 'View cURL'}</span>
                        </button>
                      )}
                      <span className="text-[11px] font-normal text-muted-foreground hidden sm:inline-block">Summary & context</span>
                    </div>
                  </div>
                  {showDescription && (
                    <div className="p-3 space-y-2.5">
                      {isEditing ? (
                        activeEditField === 'description' ? (
                          <div className="space-y-2 animate-in fade-in-0 duration-150">
                            <Textarea
                              value={cleanedDescText}
                              onChange={(e) => handleDraftChange('description', e.target.value)}
                              placeholder="Provide background information, acceptance criteria, or context for this test case..."
                              rows={3}
                              className="resize-none text-xs border-primary/50 focus:border-primary"
                              autoFocus
                            />
                            <div className="flex items-center gap-1.5 justify-end">
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveEditField(null);
                                  toast.success('Description saved');
                                }}
                                className="h-6 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shadow-2xs"
                                title="Save description"
                              >
                                <Check className="h-3 w-3" />
                                <span>Save</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  handleDraftChange('description', testCase.description || '');
                                  setActiveEditField(null);
                                }}
                                className="h-6 px-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs font-medium flex items-center gap-1 cursor-pointer"
                                title="Cancel"
                              >
                                <X className="h-3 w-3" />
                                <span>Cancel</span>
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            onClick={() => setActiveEditField('description')}
                            className="group cursor-pointer rounded-xl p-2 -m-1 hover:bg-muted/30 transition-colors flex items-start justify-between"
                            title="Click to edit description"
                          >
                            <div className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap flex-1 select-text">
                              {cleanedDescText ? (
                                <LinkifiedText
                                  text={cleanedDescText}
                                  variables={allVariables}
                                  parameters={enrichedCaseParameters}
                                />
                              ) : (
                                <span className="text-muted-foreground/60 italic font-normal">Click to add description...</span>
                              )}
                            </div>
                            <Pencil className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60 transition-opacity ml-2 shrink-0 text-muted-foreground mt-0.5" />
                          </div>
                        )
                      ) : (
                        <div className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap select-text">
                          {cleanedDescText ? (
                            <LinkifiedText
                              text={cleanedDescText}
                              variables={allVariables}
                              parameters={enrichedCaseParameters}
                            />
                          ) : (
                            <span className="text-muted-foreground/50 italic font-normal">No description provided</span>
                          )}
                        </div>
                      )}

                      {showCurlSnippet && effectiveCurl && (
                        <div className="rounded-lg border border-border/70 bg-muted/40 dark:bg-zinc-900/70 text-foreground p-3 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="font-mono font-semibold text-muted-foreground flex items-center gap-1.5">
                              <Terminal className="h-3.5 w-3.5 text-orange-500" />
                              <span>cURL Request Snippet</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(effectiveCurl);
                                toast.success('cURL copied to clipboard');
                              }}
                              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <Copy className="h-3 w-3" />
                              <span>Copy cURL</span>
                            </button>
                          </div>
                          <pre className="font-mono text-[11px] text-foreground/90 overflow-x-auto max-h-48 whitespace-pre-wrap break-all leading-relaxed">
                            {effectiveCurl}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* API Request Inspector for Postman-linked test cases */}
            {(() => {
              const postmanMeta = (testCase?.customFields || testCase?.custom_fields)?._postman;
              if (!postmanMeta?.requestSpec) return null;

              const requestSpec = postmanMeta.requestSpec;

              return (
                <div className="border border-border/40 rounded-xl overflow-hidden bg-card/50 shadow-xs">
                  <div className="px-3.5 py-2 bg-muted/20 border-b border-border/20">
                    <div className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
                      <PostmanLogo className="h-3.5 w-3.5 text-orange-500" />
                      <span>API Request Inspector</span>
                    </div>
                  </div>
                  <Tabs value={activeApiTab} onValueChange={setActiveApiTab} className="mt-0">
                    <div className="flex border-b border-border/40 bg-muted/10 px-3">
                      <TabsList className="h-8 bg-transparent border-0 gap-1 p-0">
                        <TabsTrigger
                          value="body"
                          className="h-7 px-2.5 rounded-md text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm border-0"
                        >
                          Request Body
                        </TabsTrigger>
                        <TabsTrigger
                          value="headers"
                          className="h-7 px-2.5 rounded-md text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm border-0"
                        >
                          Headers & Auth
                        </TabsTrigger>
                        <TabsTrigger
                          value="scripts"
                          className="h-7 px-2.5 rounded-md text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm border-0"
                        >
                          Scripts & Assertions
                        </TabsTrigger>
                        <TabsTrigger
                          value="variables"
                          className="h-7 px-2.5 rounded-md text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm border-0"
                        >
                          Variables
                        </TabsTrigger>
                        <TabsTrigger
                          value="response"
                          className="h-7 px-2.5 rounded-md text-[11px] font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm border-0"
                        >
                          Latest Response
                        </TabsTrigger>
                      </TabsList>
                    </div>

                    <TabsContent value="body" className="p-3 space-y-2">
                      <div className="text-[11px] font-semibold text-muted-foreground mb-2">
                        {requestSpec.method} {requestSpec.url}
                      </div>
                      {requestSpec.bodyRaw ? (
                        <pre className="font-mono text-[11px] text-foreground/90 bg-muted/30 rounded-lg p-3 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
                          {requestSpec.bodyRaw}
                        </pre>
                      ) : requestSpec.formDataFields && requestSpec.formDataFields.length > 0 ? (
                        <div className="space-y-1">
                          {requestSpec.formDataFields.map((field: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 text-xs font-mono bg-muted/30 rounded p-2">
                              <span className="text-foreground/70">{field.key}:</span>
                              <span className="text-foreground/90">{field.value}</span>
                              {field.type && <span className="text-muted-foreground text-[10px]">({field.type})</span>}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No request body</p>
                      )}
                    </TabsContent>

                    <TabsContent value="headers" className="p-3 space-y-3">
                      {requestSpec.headers && requestSpec.headers.length > 0 ? (
                        <div className="space-y-1">
                          {requestSpec.headers.map((header: any, idx: number) => (
                            <div key={idx} className="flex items-center gap-2 text-xs font-mono bg-muted/30 rounded p-2">
                              <span className="text-foreground/70">{header.key}:</span>
                              <span className="text-foreground/90 truncate">{header.value}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No headers</p>
                      )}
                      {requestSpec.auth && (
                        <div className="border-t border-border/40 pt-3">
                          <div className="text-[11px] font-semibold text-muted-foreground mb-2">Authentication</div>
                          <div className="text-xs font-mono bg-muted/30 rounded p-2">
                            <span className="text-foreground/70">Type:</span>
                            <span className="text-foreground/90 ml-2">{requestSpec.auth.type}</span>
                          </div>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="scripts" className="p-3 space-y-3">
                      {requestSpec.assertions && requestSpec.assertions.length > 0 ? (
                        <div>
                          <div className="text-[11px] font-semibold text-muted-foreground mb-2">Assertions Checklist</div>
                          <div className="space-y-1">
                            {requestSpec.assertions.map((assertion: string, idx: number) => (
                              <div key={idx} className="flex items-center gap-2 text-xs">
                                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                                <span className="text-foreground/90">{assertion}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No assertions</p>
                      )}
                      {requestSpec.testScript && (
                        <div className="border-t border-border/40 pt-3">
                          <div className="text-[11px] font-semibold text-muted-foreground mb-2">Test Script</div>
                          <pre className="font-mono text-[11px] text-foreground/90 bg-muted/30 rounded-lg p-3 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
                            {requestSpec.testScript}
                          </pre>
                        </div>
                      )}
                      {requestSpec.preRequestScript && (
                        <div className="border-t border-border/40 pt-3">
                          <div className="text-[11px] font-semibold text-muted-foreground mb-2">Pre-request Script</div>
                          <pre className="font-mono text-[11px] text-foreground/90 bg-muted/30 rounded-lg p-3 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
                            {requestSpec.preRequestScript}
                          </pre>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="variables" className="p-3 space-y-2">
                      {requestSpec.requiredVariables && requestSpec.requiredVariables.length > 0 ? (
                        <div className="space-y-1">
                          {requestSpec.requiredVariables.map((variable: string, idx: number) => (
                            <div key={idx} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-background border border-border/60 font-mono text-[11px]">
                              {formatVariableName(variable)}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No variables detected</p>
                      )}
                    </TabsContent>

                    <TabsContent value="response" className="p-3 space-y-2">
                      {runHistory && runHistory.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-xs">
                            <span className={`px-2 py-0.5 rounded font-semibold ${
                              runHistory[0].status === 'PASS' ? 'bg-emerald-500/10 text-emerald-600' :
                              runHistory[0].status === 'FAIL' ? 'bg-red-500/10 text-red-600' :
                              'bg-muted text-muted-foreground'
                            }`}>
                              {runHistory[0].status}
                            </span>
                            <span className="text-muted-foreground">{runHistory[0].duration_ms}ms</span>
                          </div>
                          {runHistory[0].response_body && (
                            <pre className="font-mono text-[11px] text-foreground/90 bg-muted/30 rounded-lg p-3 overflow-x-auto max-h-64 whitespace-pre-wrap break-all">
                              {typeof runHistory[0].response_body === 'string' 
                                ? runHistory[0].response_body 
                                : JSON.stringify(runHistory[0].response_body, null, 2)}
                            </pre>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No test runs yet</p>
                      )}
                    </TabsContent>
                  </Tabs>
                </div>
              );
            })()}

            {/* Collapsible Pre-conditions in Steps view */}
            <div className="border border-border/40 rounded-xl overflow-hidden bg-card/50 shadow-xs">
              <div
                onClick={() => setShowPreConditions(!showPreConditions)}
                className="flex items-center justify-between px-3.5 py-2 bg-muted/20 border-b border-border/20 cursor-pointer hover:bg-muted/30 transition-colors select-none"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform text-muted-foreground", !showPreConditions && "-rotate-90")} />
                  <span>Pre-conditions</span>
                  {(getValue('preConditions') || getValue('pre_conditions')) && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block" />
                  )}
                </div>
                <span className="text-[11px] font-normal text-muted-foreground hidden sm:inline-block">Requirements setup</span>
              </div>
              {showPreConditions && (
                <div className="p-3">
                  {isEditing ? (
                    activeEditField === 'preConditions' ? (
                      <div className="space-y-2 animate-in fade-in-0 duration-150">
                        <VariableAutocomplete
                          value={getValue('preConditions') || getValue('pre_conditions') || ''}
                          onChange={(value) => {
                            handleDraftChange('preConditions', value);
                            handleDraftChange('pre_conditions', value);
                          }}
                          placeholder="e.g. User account is verified; Device is on Wi-Fi; Test data is seeded..."
                          className="text-xs border-primary/50 focus:border-primary"
                          variables={allVariables}
                          parameters={enrichedCaseParameters}
                          onCreateParameter={handleCreateInlineParameter}
                          multiline
                          autoFocus
                        />
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveEditField(null);
                              toast.success('Pre-conditions saved');
                            }}
                            className="h-6 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shadow-2xs"
                            title="Save pre-conditions"
                          >
                            <Check className="h-3 w-3" />
                            <span>Save</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const orig = testCase.preConditions || testCase.pre_conditions || '';
                              handleDraftChange('preConditions', orig);
                              handleDraftChange('pre_conditions', orig);
                              setActiveEditField(null);
                            }}
                            className="h-6 px-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs font-medium flex items-center gap-1 cursor-pointer"
                            title="Cancel"
                          >
                            <X className="h-3 w-3" />
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => setActiveEditField('preConditions')}
                        className="group cursor-pointer rounded-xl p-2 -m-1 hover:bg-muted/30 transition-colors flex items-start justify-between"
                        title="Click to edit pre-conditions"
                      >
                        <div className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap flex-1 select-text">
                          {getValue('preConditions') || getValue('pre_conditions') ? (
                            <LinkifiedText
                              text={getValue('preConditions') || getValue('pre_conditions')}
                              variables={allVariables}
                              parameters={enrichedCaseParameters}
                            />
                          ) : (
                            <span className="text-muted-foreground/60 italic font-normal">Click to add pre-conditions...</span>
                          )}
                        </div>
                        <Pencil className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60 transition-opacity ml-2 shrink-0 text-muted-foreground mt-0.5" />
                      </div>
                    )
                  ) : (
                    <div className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap select-text">
                      {getValue('preConditions') || getValue('pre_conditions') ? (
                        <LinkifiedText
                          text={getValue('preConditions') || getValue('pre_conditions')}
                          variables={allVariables}
                          parameters={enrichedCaseParameters}
                        />
                      ) : (
                        <span className="text-muted-foreground/50 italic font-normal">No pre-conditions specified</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Inline Collapsible Parameters (Approach A - Test Data) */}
            <TestCaseParametersSection
              blocks={paramBlocks}
              onChange={handleParamBlocksChange}
              isEditing={isEditing && canEdit}
              disabled={!canEdit || isLocked}
              onRequestEdit={
                canEdit
                  ? () => {
                      if (isLocked) {
                        showLockedToast();
                        return;
                      }
                      setIsEditing(true);
                    }
                  : undefined
              }
              projectSlug={slug}
              projectId={project?.id}
              caseContext={{
                title: testCase?.title,
                description: testCase?.description || undefined,
                preConditions: testCase?.preConditions || testCase?.pre_conditions || undefined,
                steps: steps.map((s) => `${s.order}. ${s.step || (s as any).description || ''}`),
              }}
            />

            <div className="mt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                  <span>Test Steps</span>
                  <span className="text-xs font-normal text-muted-foreground">({nonBlankSteps.length})</span>
                </h3>
                {!isLocked && canEdit && (
                  <div className="relative">
                    <div className="inline-flex items-center rounded-lg border border-violet-500/30 bg-background overflow-hidden shadow-2xs">
                      <button
                        type="button"
                        onClick={() => {
                          if (!isEditing) setIsEditing(true);
                          handleImproveSteps('');
                        }}
                        disabled={improvingSteps}
                        className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-2 text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors cursor-pointer disabled:opacity-50"
                        title={
                          hasExistingSteps
                            ? 'Run AI Step Improvement (Auto)'
                            : 'Generate steps from Title & Description with AI'
                        }
                      >
                        <Sparkles className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {improvingSteps
                            ? hasExistingSteps
                              ? 'Improving...'
                              : 'Generating...'
                            : hasExistingSteps
                            ? 'Improve with AI'
                            : 'Generate with AI'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!isEditing) setIsEditing(true);
                          setShowImproveCustomPrompt((prev) => !prev);
                        }}
                        disabled={improvingSteps}
                        className={cn(
                          'inline-flex items-center gap-1 h-7 px-2 border-l border-violet-500/25 text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 transition-colors cursor-pointer disabled:opacity-50',
                          showImproveCustomPrompt && 'bg-violet-500/15'
                        )}
                        title="Customize AI prompt instructions"
                      >
                        <span>Custom</span>
                        <ChevronDown
                          className={cn(
                            'h-3 w-3 transition-transform duration-150',
                            showImproveCustomPrompt && 'rotate-180'
                          )}
                        />
                      </button>
                    </div>

                    {showImproveCustomPrompt && (
                      <>
                        <div
                          className="fixed inset-0 z-40"
                          onClick={() => setShowImproveCustomPrompt(false)}
                        />
                        <div className="absolute right-0 top-full mt-1.5 z-50 w-96 max-w-[90vw] p-3.5 rounded-xl border border-border bg-popover shadow-2xl space-y-3 animate-in fade-in-0 zoom-in-95 duration-150">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                              <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                              <span>
                                {hasExistingSteps ? 'Custom AI Step Improvement' : 'Custom AI Step Generation'}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowImproveCustomPrompt(false)}
                              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="flex flex-wrap gap-1.5">
                            {(hasExistingSteps
                              ? [
                                  'Keep step count unchanged, only refine expected results',
                                  'Merge granular clicks into goal-oriented steps',
                                  'Replace hardcoded values with {parameters}',
                                ]
                              : [
                                  'Include negative validation steps',
                                  'Use {parameters} for input data',
                                  'Keep to 3 concise steps',
                                ]
                            ).map((preset) => (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setImproveCustomPrompt(preset)}
                                className={cn(
                                  "text-[11px] px-2.5 py-1 rounded-lg border text-left transition-colors cursor-pointer",
                                  improveCustomPrompt === preset
                                    ? "border-violet-500/50 bg-violet-500/15 text-foreground font-medium"
                                    : "border-border/60 bg-muted/30 hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                                )}
                              >
                                {preset}
                              </button>
                            ))}
                          </div>

                          <div className="flex items-center gap-2 pt-0.5">
                            <input
                              type="text"
                              value={improveCustomPrompt}
                              onChange={(e) => setImproveCustomPrompt(e.target.value)}
                              placeholder={
                                hasExistingSteps
                                  ? 'Tell AI how to improve these steps...'
                                  : 'Tell AI how to generate steps...'
                              }
                              disabled={improvingSteps}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleImproveSteps(improveCustomPrompt);
                                }
                              }}
                              className="flex-1 h-8 rounded-lg border border-border/80 bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-violet-500/60"
                              autoFocus
                            />
                            <Button
                              type="button"
                              size="sm"
                              disabled={improvingSteps}
                              onClick={() => handleImproveSteps(improveCustomPrompt)}
                              className="h-8 px-3 text-xs bg-violet-600 hover:bg-violet-700 text-white font-semibold cursor-pointer gap-1 shrink-0"
                            >
                              <Sparkles className="h-3 w-3" />
                              <span>{improvingSteps ? 'Running...' : 'Run'}</span>
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              <StepEditor
                ref={stepEditorRef}
                testCaseId={caseId}
                projectId={project?.id || ''}
                initialSteps={steps}
                initialVariables={allVariables}
                parameters={enrichedCaseParameters}
                disabled={!isEditing || isLocked || !canEdit}
                isFullPage={isFullPage}
                onCreateParameter={handleCreateInlineParameter}
                onRequestEdit={
                  canEdit && !isLocked
                    ? () => {
                        setIsEditing(true);
                      }
                    : undefined
                }
                onStepChange={async () => {
                  const refreshed = await getTestCaseStepsAction(caseId);
                  setSteps(refreshed as any);
                  if (reviewStatus === 'pending' || reviewStatus === 'changes_requested') {
                    const freshDiff = await getReviewDiffAction(caseId).catch(() => null);
                    if (freshDiff) setReviewDiff(freshDiff);
                  }
                }}
                onDirtyChange={(d) => {
                  setStepsDirty(d);
                }}
              />
            </div>

            {/* Collapsible Post-conditions in Steps view */}
            <div className="border border-border/40 rounded-xl overflow-hidden bg-card/50 shadow-xs mt-3">
              <div
                onClick={() => setShowPostConditions(!showPostConditions)}
                className="flex items-center justify-between px-3.5 py-2 bg-muted/20 border-b border-border/20 cursor-pointer hover:bg-muted/30 transition-colors select-none"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform text-muted-foreground", !showPostConditions && "-rotate-90")} />
                  <span>Post-conditions</span>
                  {(getValue('postConditions') || getValue('post_conditions')) && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary inline-block" />
                  )}
                </div>
                <span className="text-[11px] font-normal text-muted-foreground hidden sm:inline-block">Teardown / Cleanup</span>
              </div>
              {showPostConditions && (
                <div className="p-3">
                  {isEditing ? (
                    activeEditField === 'postConditions' ? (
                      <div className="space-y-2 animate-in fade-in-0 duration-150">
                        <VariableAutocomplete
                          placeholder="e.g. User account is logged out; Test session is closed; Seeded database records are deleted..."
                          value={getValue('postConditions') || getValue('post_conditions') || ''}
                          onChange={(value) => {
                            handleDraftChange('postConditions', value);
                            handleDraftChange('post_conditions', value);
                          }}
                          className="text-xs border-primary/50 focus:border-primary"
                          variables={allVariables}
                          parameters={enrichedCaseParameters}
                          onCreateParameter={handleCreateInlineParameter}
                          multiline
                          autoFocus
                        />
                        <div className="flex items-center gap-1.5 justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveEditField(null);
                              toast.success('Post-conditions saved');
                            }}
                            className="h-6 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer shadow-2xs"
                            title="Save post-conditions"
                          >
                            <Check className="h-3 w-3" />
                            <span>Save</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const orig = testCase.postConditions || testCase.post_conditions || '';
                              handleDraftChange('postConditions', orig);
                              handleDraftChange('post_conditions', orig);
                              setActiveEditField(null);
                            }}
                            className="h-6 px-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground text-xs font-medium flex items-center gap-1 cursor-pointer"
                            title="Cancel"
                          >
                            <X className="h-3 w-3" />
                            <span>Cancel</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => setActiveEditField('postConditions')}
                        className="group cursor-pointer rounded-xl p-2 -m-1 hover:bg-muted/30 transition-colors flex items-start justify-between"
                        title="Click to edit post-conditions"
                      >
                        <div className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap flex-1 select-text">
                          {getValue('postConditions') || getValue('post_conditions') ? (
                            <LinkifiedText
                              text={getValue('postConditions') || getValue('post_conditions')}
                              variables={allVariables}
                              parameters={enrichedCaseParameters}
                            />
                          ) : (
                            <span className="text-muted-foreground/60 italic font-normal">Click to add post-conditions...</span>
                          )}
                        </div>
                        <Pencil className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60 transition-opacity ml-2 shrink-0 text-muted-foreground mt-0.5" />
                      </div>
                    )
                  ) : (
                    <div className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap select-text">
                      {getValue('postConditions') || getValue('post_conditions') ? (
                        <LinkifiedText
                          text={getValue('postConditions') || getValue('post_conditions')}
                          variables={allVariables}
                          parameters={enrichedCaseParameters}
                        />
                      ) : (
                        <span className="text-muted-foreground/50 italic font-normal">No post-conditions specified</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Test Case Level Attachments Section (inside Steps tab) */}
            <div className="border border-border/40 rounded-xl bg-card/50 shadow-xs overflow-hidden mt-3">
              <div
                onClick={() => setShowAttachments(!showAttachments)}
                className="flex items-center justify-between px-3.5 py-2.5 bg-muted/20 border-b border-border/20 cursor-pointer hover:bg-muted/30 transition-colors select-none"
              >
                <div className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform text-muted-foreground", !showAttachments && "-rotate-90")} />
                  <span>Attachments</span>
                  <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                  {attachments.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-mono">
                      {attachments.length}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground hidden sm:inline-block">
                  Datasets, specs, and mock files
                </div>
              </div>
              {showAttachments && (
                <div className="p-4">
                  <AttachmentList
                    entityId={caseId}
                    entityType="case"
                    projectId={project.id}
                    attachments={attachments}
                    onUploadComplete={handleAttachmentUploadComplete}
                    onDelete={handleAttachmentDelete}
                  />
                </div>
              )}
            </div>

            {/* AI improved steps preview */}
            {improvedSteps && (
              <div className="mt-6 space-y-3 border border-violet-200/30 rounded-xl p-4 bg-violet-500/5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-violet-500" />
                    {hasExistingSteps ? 'Improved Steps' : 'Generated Steps'}
                  </span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setImprovedSteps(null)}>
                      Discard
                    </Button>
                    <Button size="sm" onClick={handleApplyImprovedSteps}>
                      Apply Changes
                    </Button>
                  </div>
                </div>
                {improvedSteps.map((step: any) => (
                  <div key={step.order} className="p-3 rounded-lg border border-border/50 bg-card">
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-muted-foreground font-mono mt-0.5">{step.order}.</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm">{step.description || step.step}</p>
                        {(step.expectedResult || step.expected_result) && (
                          <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                            Expected: {step.expectedResult || step.expected_result}
                          </p>
                        )}
                        {step.changeSummary && step.changeSummary !== 'No changes' && (
                          <p className="text-xs text-violet-500 mt-1 italic">{step.changeSummary}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Runs Tab: Execution Run History Table */}
          <TabsContent value="runs" className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span>Execution Run History</span>
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-mono font-medium">
                      {runHistory.length}
                    </span>
                  </div>
                </div>

                {loadingRuns ? (
                  <div className="p-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <span className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span>Loading run history...</span>
                  </div>
                ) : runHistory.length === 0 ? (
                  <div className="border border-dashed border-border/40 rounded-xl p-8 text-center text-xs text-muted-foreground">
                    No test runs have recorded results for this test case yet.
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/40 bg-card overflow-hidden shadow-xs divide-y divide-border/20 text-xs">
                    <div className="grid grid-cols-[minmax(160px,1.6fr)_105px_95px_75px_175px_95px_80px] items-center px-4 py-2 bg-muted/20 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      <div>Test Run</div>
                      <div>Environment</div>
                      <div>Status</div>
                      <div>Attempt</div>
                      <div>Executed At</div>
                      <div>Bugs</div>
                      <div className="text-right">Duration</div>
                    </div>
                    {runHistory.map((r) => {
                      const isRunExpanded = expandedRunHistoryId === r.id;
                      const rawStepResults: Record<string, any> =
                        r.stepResults && typeof r.stepResults === 'object' ? r.stepResults : {};
                      const stepEntries = Object.entries(rawStepResults).sort(
                        ([a], [b]) => Number(a) - Number(b)
                      );

                      return (
                        <div key={r.id} className="divide-y divide-border/20">
                          <div
                            onClick={() =>
                              setExpandedRunHistoryId((prev) => (prev === r.id ? null : r.id))
                            }
                            className="grid grid-cols-[minmax(160px,1.6fr)_105px_95px_75px_175px_95px_80px] items-center px-4 py-2.5 hover:bg-muted/15 transition-colors cursor-pointer select-none"
                          >
                            <div className="min-w-0 pr-3 flex items-start gap-2">
                              {isRunExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                              )}
                              <div className="min-w-0">
                                <Link
                                  href={`/p/${slug}/runs/${r.runId}?caseId=${testCase.displayId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="font-semibold text-foreground hover:text-primary transition-colors truncate block text-xs hover:underline"
                                  title={r.runName || 'Test Run'}
                                >
                                  {r.runName || 'Test Run'}
                                </Link>
                                <div className="flex items-center gap-1 mt-0.5 font-mono text-[10px] text-muted-foreground">
                                  <span>ID:</span>
                                  <Link
                                    href={`/p/${slug}/runs/${r.runId}?caseId=${testCase.displayId}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-primary/80 hover:text-primary hover:underline transition-colors font-semibold"
                                  >
                                    #{r.runId.slice(0, 8)}
                                  </Link>
                                  {stepEntries.length > 0 && (
                                    <span className="ml-1 text-[10px] text-muted-foreground/80">
                                      · {stepEntries.length} step{stepEntries.length === 1 ? '' : 's'}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div>
                              <span className="inline-block px-2 py-0.5 rounded font-mono text-[10px] bg-muted/70 border border-border/50 text-foreground/80 uppercase font-semibold">
                                {r.runEnvironment || 'Default'}
                              </span>
                            </div>
                            <div>
                              <span
                                className={cn(
                                  "px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono tracking-wider shrink-0",
                                  r.status === 'pass' && "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
                                  r.status === 'fail' && "bg-red-500/15 text-red-400 border border-red-500/30",
                                  r.status === 'blocked' && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                                  r.status === 'skip' && "bg-zinc-500/15 text-zinc-300 border border-zinc-500/30",
                                  r.status === 'invalid' && "bg-violet-500/15 text-violet-400 border border-violet-500/30",
                                  (!r.status || r.status === 'pending') && "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                                )}
                              >
                                {r.status === 'pass' ? 'Pass' : r.status === 'fail' ? 'Fail' : (r.status || 'Not Run')}
                              </span>
                            </div>
                            <div className="font-mono text-muted-foreground text-[11px]">
                              #{r.attemptNumber || 1}
                            </div>
                            <div className="font-mono text-muted-foreground text-[11px] whitespace-nowrap">
                              {r.executedAt ? format(new Date(r.executedAt), 'MMM d, yyyy · h:mm a') : '—'}
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                              {r.defectCount > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('bugs')}
                                  className="inline-flex items-center gap-1 text-[11px] text-red-500 hover:text-red-400 font-semibold hover:underline cursor-pointer"
                                  title="View bugs for this test case"
                                >
                                  <Bug className="h-3 w-3" />
                                  <span>{r.defectCount} bug{r.defectCount !== 1 ? 's' : ''}</span>
                                </button>
                              ) : (
                                <span className="text-muted-foreground/60 text-[11px] font-mono">0</span>
                              )}
                            </div>
                            <div className="text-right font-mono text-muted-foreground text-[11px]">
                              {r.timeSpentSeconds > 0
                                ? `${Math.floor(r.timeSpentSeconds / 60)}m ${r.timeSpentSeconds % 60}s`
                                : '—'}
                            </div>
                          </div>

                          {isRunExpanded && (
                            <div className="px-5 py-3 bg-muted/10 space-y-2.5">
                              {r.notes && (
                                <div className="text-xs font-medium text-foreground/90 flex items-center justify-between">
                                  <span>{r.notes}</span>
                                  <Link
                                    href={`/p/${slug}/runs/${r.runId}?caseId=${testCase.displayId}`}
                                    className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 font-semibold"
                                  >
                                    <span>Open in Execution Console</span>
                                    <ExternalLink className="h-3 w-3" />
                                  </Link>
                                </div>
                              )}

                              {stepEntries.length > 0 ? (
                                <div className="space-y-2">
                                  {stepEntries.map(([stepOrder, srVal]) => {
                                    const stepObj =
                                      typeof srVal === 'object' && srVal !== null
                                        ? srVal
                                        : { status: String(srVal) };
                                    const apiExec = stepObj.apiExecution || null;
                                    const rawRespKey = `${r.id}_${stepOrder}`;
                                    const isRawOpen = Boolean(expandedHistoryRawResponses[rawRespKey]);

                                    let fallbackUrl = '';
                                    let fallbackStatus = '';
                                    let fallbackBody = '';
                                    if (!apiExec && typeof stepObj.note === 'string') {
                                      const m = stepObj.note.match(
                                        /^\[(GET|POST|PUT|PATCH|DELETE)\s+([^\]]+)\]\s*(HTTP\s+\d+\s*[^(]*\(\d+ms\))(?:.*?\bBody:\s*([\s\S]+))?$/i
                                      );
                                      if (m) {
                                        fallbackUrl = `${m[1]} ${m[2]}`;
                                        fallbackStatus = m[3].trim();
                                        fallbackBody = (m[4] || '').trim();
                                      }
                                    }

                                    const responseToShow = apiExec?.responseBody || fallbackBody;

                                    return (
                                      <div
                                        key={stepOrder}
                                        className="rounded-lg border border-border/60 bg-card p-2.5 space-y-2"
                                      >
                                        <div className="flex items-center justify-between gap-2 flex-wrap">
                                          <div className="flex items-center gap-2 min-w-0">
                                            <span
                                              className={cn(
                                                'px-1.5 py-0.5 rounded font-mono text-[10px] font-bold uppercase',
                                                stepObj.status === 'pass'
                                                  ? 'bg-emerald-500/15 text-emerald-400'
                                                  : 'bg-red-500/15 text-red-400'
                                              )}
                                            >
                                              Step #{stepOrder} · {stepObj.status || 'pending'}
                                            </span>
                                            {apiExec ? (
                                              <span className="font-mono text-[11px] text-foreground/85 truncate">
                                                <strong>{apiExec.method}</strong> {apiExec.url} · HTTP{' '}
                                                {apiExec.statusCode || 'ERR'} ({apiExec.durationMs}ms)
                                              </span>
                                            ) : fallbackUrl ? (
                                              <span className="font-mono text-[11px] text-foreground/85 truncate">
                                                {fallbackUrl} · {fallbackStatus}
                                              </span>
                                            ) : stepObj.note ? (
                                              <span className="text-[11px] text-muted-foreground truncate">
                                                {stepObj.note}
                                              </span>
                                            ) : null}
                                          </div>

                                          {responseToShow && (
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setExpandedHistoryRawResponses((prev) => ({
                                                  ...prev,
                                                  [rawRespKey]: !prev[rawRespKey],
                                                }))
                                              }
                                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                                            >
                                              <span>
                                                {isRawOpen ? 'Hide raw response' : 'View raw response'}
                                              </span>
                                              {isRawOpen ? (
                                                <ChevronDown className="h-3 w-3" />
                                              ) : (
                                                <ChevronRight className="h-3 w-3" />
                                              )}
                                            </button>
                                          )}
                                        </div>

                                        {apiExec?.assertions && apiExec.assertions.length > 0 && (
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                            {apiExec.assertions.map((a: any, aIdx: number) => (
                                              <div
                                                key={aIdx}
                                                className="flex items-start gap-1.5 text-[11px] px-2 py-1 rounded bg-muted/30"
                                              >
                                                {a.passed ? (
                                                  <Check className="h-3 w-3 text-emerald-400 shrink-0 mt-0.5" />
                                                ) : (
                                                  <X className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
                                                )}
                                                <span
                                                  className={
                                                    a.passed ? 'text-foreground/90' : 'text-red-400'
                                                  }
                                                >
                                                  {a.name}
                                                  {a.error ? ` — ${a.error}` : ''}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        )}

                                        {isRawOpen && responseToShow && (
                                          <pre className="p-2.5 rounded-lg border border-border/60 bg-background font-mono text-[11px] text-foreground/90 overflow-x-auto max-h-56 whitespace-pre-wrap break-words">
                                            {responseToShow}
                                          </pre>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="text-[11px] text-muted-foreground italic">
                                  No step-level response details recorded for this run.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </TabsContent>

              {/* Bugs Tab: Linked Bugs Table */}
              <TabsContent value="bugs" className="mt-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
                      <Bug className="h-4 w-4 text-red-500" />
                      <span>Linked Bugs</span>
                    </h3>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-500 font-mono font-medium">
                      {caseBugs.length}
                    </span>
                  </div>
                </div>

                {loadingBugs ? (
                  <div className="p-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                    <span className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                    <span>Loading bugs...</span>
                  </div>
                ) : caseBugs.length === 0 ? (
                  <div className="border border-dashed border-border/40 rounded-xl p-8 text-center space-y-1.5 bg-muted/[0.02]">
                    <Bug className="h-5 w-5 text-muted-foreground/50 mx-auto" />
                    <h4 className="text-xs font-semibold text-foreground">No bugs linked to this test case</h4>
                    <p className="text-[11px] text-muted-foreground">
                      Bugs raised during test execution for this case will appear here.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border/40 bg-card overflow-hidden shadow-xs divide-y divide-border/20 text-xs">
                    <div className="grid grid-cols-[105px_minmax(220px,2fr)_105px_115px_130px_90px] items-center px-4 py-2 bg-muted/20 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                      <div>ID</div>
                      <div>Bug Title</div>
                      <div>Severity</div>
                      <div>Status</div>
                      <div>Reported By</div>
                      <div className="text-right">Ticket</div>
                    </div>
                    {caseBugs.map((b) => (
                      <div key={b.id} className="grid grid-cols-[105px_minmax(220px,2fr)_105px_115px_130px_90px] items-center px-4 py-2.5 hover:bg-muted/10 transition-colors">
                        <div className="font-mono text-[11px] text-foreground font-semibold">
                          {b.ticketUrl ? (
                            <a
                              href={b.ticketUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary hover:underline inline-flex items-center gap-1"
                            >
                              <span>{b.externalTicketId || `#DEF-${b.id.slice(0, 6)}`}</span>
                              <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          ) : (
                            <Link
                              href={`/p/${slug}/defects?search=${b.externalTicketId || b.id}`}
                              className="text-primary hover:underline"
                            >
                              {b.externalTicketId || `#DEF-${b.id.slice(0, 6)}`}
                            </Link>
                          )}
                        </div>
                        <div className="min-w-0 pr-3">
                          {b.ticketUrl ? (
                            <a
                              href={b.ticketUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-foreground hover:text-primary transition-colors truncate block text-xs hover:underline"
                            >
                              {b.title}
                            </a>
                          ) : (
                            <Link
                              href={`/p/${slug}/defects?search=${b.externalTicketId || b.id}`}
                              className="font-medium text-foreground hover:text-primary transition-colors truncate block text-xs hover:underline"
                            >
                              {b.title}
                            </Link>
                          )}
                          {b.runName && (
                            <Link
                              href={`/p/${slug}/runs/${b.runId}?caseId=${testCase.displayId}`}
                              className="text-[11px] text-muted-foreground hover:text-primary transition-colors truncate block mt-0.5 hover:underline"
                            >
                              Run: {b.runName} {b.environment ? `(${b.environment})` : ''}
                            </Link>
                          )}
                        </div>
                        <div>
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                              b.severity === 'critical' && "bg-red-500/15 text-red-400 border border-red-500/30",
                              b.severity === 'high' && "bg-orange-500/15 text-orange-400 border border-orange-500/30",
                              b.severity === 'medium' && "bg-amber-500/15 text-amber-400 border border-amber-500/30",
                              b.severity === 'low' && "bg-blue-500/15 text-blue-400 border border-blue-500/30",
                              !['critical', 'high', 'medium', 'low'].includes(b.severity) && "bg-muted text-muted-foreground"
                            )}
                          >
                            {b.severity}
                          </span>
                        </div>
                        <div>
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider",
                              b.localStatus === 'OPEN' && "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
                              b.localStatus === 'IN_PROGRESS' && "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20",
                              b.localStatus === 'RESOLVED' && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
                              !['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(b.localStatus) && "bg-muted text-muted-foreground border border-border/30"
                            )}
                          >
                            {b.localStatus.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <UserAvatar name={b.raisedByName || 'User'} size="sm" className="h-5 w-5 text-[9px] shrink-0" />
                          <span className="truncate text-foreground/90 font-medium text-xs">{b.raisedByName || 'User'}</span>
                        </div>
                        <div className="text-right">
                          {b.ticketUrl ? (
                            <a
                              href={b.ticketUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                            >
                              <span>View</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground/50 font-mono">—</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

          {/* Activity Tab: Audit Trail & Review Version History */}
          <TabsContent value="activity" className="mt-4 space-y-4 max-w-4xl">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Audit & Review History
              </h4>
            </div>

            {/* AI Update Activity Entry (when steps were improved/updated using AI) */}
            {hasAiSteps &&
              (testCase.updatedAt || testCase.updated_at) &&
              new Date(testCase.updatedAt || testCase.updated_at).getTime() -
                new Date(testCase.createdAt || testCase.created_at || 0).getTime() >
                5000 && (
                <div className="p-3.5 rounded-xl border border-border/40 bg-card shadow-2xs space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <UserAvatar
                        userId={testCase.updatedBy || testCase.updated_by || testCase.createdBy}
                        name={updaterUser?.name || creatorUser?.name || authorFullName}
                        imageUrl={updaterUser?.avatarUrl || updaterUser?.image || creatorUser?.avatarUrl || creatorUser?.image}
                        size="sm"
                        className="h-5 w-5 text-[10px]"
                      />
                      <span className="font-semibold text-xs text-foreground">
                        {updaterUser?.name ? updaterUser.name.trim() : authorFullName}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        updated test case <strong className="text-foreground font-mono">{testCase.displayId}</strong> using AI
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 text-violet-400 border border-violet-500/30">
                      <Sparkles className="h-3 w-3" />
                      <span>AI Improved</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1.5 border-t border-border/20 font-mono">
                    <span>
                      {format(new Date(testCase.updatedAt || testCase.updated_at), 'MMMM d, yyyy · h:mm a')}
                    </span>
                    <span className="text-[10px] font-sans">AI Step Update</span>
                  </div>
                </div>
              )}

            {/* Origin & Creation Provenance Card */}
            <div className="p-3.5 rounded-xl border border-border/40 bg-card shadow-2xs space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <UserAvatar
                    userId={testCase.createdBy}
                    name={creatorUser?.name || `User #${testCase.createdBy}`}
                    imageUrl={creatorUser?.avatarUrl || creatorUser?.image}
                    size="sm"
                    className="h-5 w-5 text-[10px]"
                  />
                  <span className="font-semibold text-xs text-foreground">
                    {creatorUser?.name ? creatorUser.name.trim() : `User #${testCase.createdBy}`}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {isImported ? 'imported test case ' : 'created test case '}
                    <strong className="text-foreground font-mono">{testCase.displayId}</strong>
                    {!isImported && isAi ? ' using AI' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  {isImported && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/15 text-blue-400 border border-blue-500/30">
                      <Upload className="h-3 w-3" />
                      <span>Imported from File</span>
                    </span>
                  )}
                  {isImported && (isAi || hasAiSteps) && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-500/15 text-violet-400 border border-violet-500/30">
                      <Sparkles className="h-3 w-3" />
                      <span>AI</span>
                    </span>
                  )}
                  {!isImported && !isAi && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground border border-border/40">
                      Manual Creation
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1.5 border-t border-border/20 font-mono">
                <span>
                  {testCase.createdAt || testCase.created_at
                    ? format(new Date(testCase.createdAt || testCase.created_at), 'MMMM d, yyyy · h:mm a')
                    : 'Initial Creation'}
                </span>
                <span className="text-[10px] font-sans">Initial Version v1</span>
              </div>
            </div>

            {reviewHistory.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-28 border border-dashed border-border/40 rounded-xl p-4 text-center">
                <Clock className="h-4 w-4 text-muted-foreground mb-1 opacity-50" />
                <p className="text-xs font-medium text-muted-foreground">No review versions submitted yet</p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5">Submit this test case for review to start tracking formal approval snapshots.</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {reviewHistory.map((req: any) => (
                  <div key={req.id} className="p-3.5 rounded-xl border border-border/40 bg-card shadow-2xs space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-xs text-foreground">{req.requestedByName}</span>
                        <span className="text-xs text-muted-foreground">&rarr;</span>
                        <span className="text-xs text-muted-foreground font-medium">{req.assignedToName || 'Project Pool'}</span>
                      </div>
                      <span className={cn(
                        'text-[10px] px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wider',
                        req.status === 'approved' && 'bg-green-500/15 text-green-700 dark:text-green-400',
                        req.status === 'changes_requested' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                        req.status === 'cancelled' && 'bg-muted text-muted-foreground',
                        req.status === 'pending' && 'bg-blue-500/15 text-blue-700 dark:text-blue-400'
                      )}>
                        {req.status.replace('_', ' ')}
                      </span>
                    </div>
                    {req.comment && (
                      <p className="text-xs text-foreground/85 bg-muted/30 p-2 rounded-lg border border-border/30">
                        {req.comment}
                      </p>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/20">
                      <span suppressHydrationWarning>Submitted: {new Date(req.createdAt).toLocaleString()}</span>
                      {req.resolvedAt && <span suppressHydrationWarning>Resolved: {new Date(req.resolvedAt).toLocaleString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="comments" className="mt-4 space-y-4 max-w-4xl">
            {/* Highlighted Review Feedback Section */}
            {stepComments.filter((c) => !c.resolved).length > 0 && (
              <div className="p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/[0.05] dark:bg-amber-950/20 shadow-xs space-y-2.5 ring-1 ring-amber-500/20">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                    </span>
                    <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                      Review Feedback ({stepComments.filter((c) => !c.resolved).length} open)
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => router.push(`/p/${slug}/reviews/${testCase?.displayId || caseId}`)}
                    className="h-6 px-1.5 text-[11px] text-primary hover:bg-primary/10 cursor-pointer flex items-center gap-1"
                  >
                    <span>Review Page</span>
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>

                {activeReviewRequest?.comment && (
                  <p className="text-xs text-foreground/90 leading-relaxed font-sans bg-background/80 p-2 rounded-lg border border-amber-500/20">
                    <span className="font-semibold text-muted-foreground block text-[10px] uppercase font-mono">Reviewer Note:</span>
                    {activeReviewRequest.comment}
                  </p>
                )}

                <div className="space-y-1.5">
                  {stepComments.filter((c) => !c.resolved).map((s) => (
                    <div
                      key={s.id}
                      className="p-2 rounded-lg bg-card border border-amber-500/30 text-xs flex items-center justify-between gap-2 shadow-2xs"
                    >
                      <div className="min-w-0">
                        <span className="font-mono font-bold text-primary mr-1">Step {s.stepOrder}:</span>
                        <span className="text-foreground/90 font-medium">{s.body}</span>
                        <span className="text-[10px] text-muted-foreground font-mono ml-1.5">({s.authorName})</span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          await handleResolveStepComment(s.id);
                        }}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-500 hover:bg-amber-500/25 border border-amber-500/30 transition-colors cursor-pointer shrink-0"
                      >
                        Resolve
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <CommentList
              entityId={caseId}
              entityType="case"
              projectId={project.id}
              comments={comments}
              onCommentAdded={async () => {
                const loadedComments = await getCommentsAction(caseId, 'case');
                setComments(loadedComments);
              }}
              members={members}
              currentUserId={currentUser?.id}
              onStepClick={handleScrollToStep}
              projectSlug={slug}
              caseDisplayId={testCase?.displayId || testCase?.display_id || caseId}
            />
          </TabsContent>

        </Tabs>
      </div>

      
      

      <ConfirmModal
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        title="Delete Test Case"
        description="Are you sure you want to delete this test case? It will be removed from your repository. Its execution history is preserved."
        confirmLabel="Delete Case"
        requireTypedConfirmation="DELETE"
        onConfirm={handleDelete}
        variant="destructive"
      />

      <ConfirmModal
        open={showDeprecateModal}
        onOpenChange={setShowDeprecateModal}
        title="Deprecate Test Case"
        description="Are you sure you want to mark this test case as Deprecated? Deprecated test cases are retired and will be excluded from new test runs."
        confirmLabel="Deprecate Case"
        variant="destructive"
        onConfirm={async () => {
          try {
            await updateTestCaseAction(caseId, { status: 'DEPRECATED' });
            syncCaseToContext({ status: 'DEPRECATED' });
            setShowDeprecateModal(false);
            toast.success('Test case marked as Deprecated');
          } catch (e: any) {
            toast.error(e.message || 'Failed to deprecate test case');
          }
        }}
      />

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

      <Dialog open={showDiffDialog} onOpenChange={setShowDiffDialog}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Test Case Changes: {testCase.displayId}</DialogTitle>
            <DialogDescription>
              {reviewDiff?.baselineVersion
                ? `Comparing Baseline Version ${reviewDiff.baselineVersion} (Left) to Working Copy (Right)`
                : 'Comparing against baseline version'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {reviewDiff ? (
              <ReviewDiff
                before={reviewDiff.before}
                after={reviewDiff.after}
                baselineLabel={`Version ${reviewDiff.baselineVersion || 1} (Approved)`}
                revisionLabel="Working Copy"
                defaultCollapsed={false}
                defaultViewMode="split"
                stepComments={stepComments}
                onAddStepComment={handleAddStepComment}
                onResolveStepComment={handleResolveStepComment}
                onDeleteStepComment={handleDeleteStepComment}
                currentUserId={currentUser?.id}
              />
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No changes found.</p>
            )}
          </div>
          <DialogFooter className="flex items-center justify-between gap-2 border-t border-border/40 pt-3">
            <div>
              {reviewStatus === 'pending' && isAuthor && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-500/30 hover:bg-red-500/10 text-xs h-8 font-medium cursor-pointer"
                  onClick={() => {
                    setShowDiffDialog(false);
                    handleCancelReview();
                  }}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Withdraw Review
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {reviewStatus === 'pending' && isAuthor && hasWorkingEdits && (
                <Button
                  size="sm"
                  className="h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-semibold shadow-xs cursor-pointer"
                  onClick={async () => {
                    await handleUpdateReviewSnapshot();
                    setShowDiffDialog(false);
                  }}
                  disabled={saving}
                >
                  <Send className="h-3.5 w-3.5 mr-1" /> Push to Review
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setShowDiffDialog(false)}>Close</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSubmitReviewDialog} onOpenChange={setShowSubmitReviewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reviewStatus === 'changes_requested'
                ? 'Resubmit for Review'
                : (reviewStatus === 'pending' ? 'Update Review Request' : 'Submit for Review')}
            </DialogTitle>
            <DialogDescription>
              {reviewStatus === 'changes_requested'
                ? 'Address feedback and send revisions back to the reviewer.'
                : 'Send this test case to a team member or project pool for review.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Simple & clean Review Changes preview */}
            <div className="p-3 rounded-xl border border-border/50 bg-muted/20 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <Eye className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground truncate">Inspect Changes</p>
                  <p className="text-[11px] text-muted-foreground truncate">Preview diff against baseline before sending</p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs font-semibold shrink-0 cursor-pointer"
                onClick={handleOpenDiffDialog}
              >
                View Diff
              </Button>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Assign Reviewer
              </label>
              <select
                value={reviewTarget}
                onChange={(e) => setReviewTarget(e.target.value)}
                className="w-full h-9 rounded-lg border border-border/60 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Project Pool (Any Member)</option>
                {members.filter((m: any) => m.userId !== currentUser?.id).map((m: any) => (
                  <option key={m.userId} value={String(m.userId)}>
                    {m.user?.name || m.user?.email || `User #${m.userId}`}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Note for Reviewer (Optional)
              </label>
              <Textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder={
                  reviewStatus === 'changes_requested'
                    ? 'Summarize the changes made in response to feedback...'
                    : 'What should the reviewer focus on?'
                }
                rows={3}
                className="resize-none text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowSubmitReviewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleExecuteSubmitReview} disabled={submittingReview}>
              {submittingReview ? 'Submitting...' : (reviewStatus === 'changes_requested' ? 'Resubmit' : 'Send Request')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRequestChangesDialog} onOpenChange={setShowRequestChangesDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>
              Provide specific feedback explaining what needs to be improved or corrected.
            </DialogDescription>
          </DialogHeader>

          {stepComments.filter((c) => !c.resolved).length > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/10 text-xs space-y-1 my-2">
              <div className="font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                <span>
                  {stepComments.filter((c) => !c.resolved).length} step-specific note(s) attached
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                The author will see your notes pinned directly to each step. You can add an optional overall summary note below.
              </p>
            </div>
          )}

          <div className="py-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
              Overall Summary Feedback {stepComments.filter((c) => !c.resolved).length === 0 && <span className="text-red-500">*</span>}
            </label>
            <Textarea
              value={requestChangesComment}
              onChange={(e) => setRequestChangesComment(e.target.value)}
              placeholder={
                stepComments.filter((c) => !c.resolved).length > 0
                  ? "Optional summary note (or leave blank to send your step notes)..."
                  : "e.g. Please add expected results for steps 2 and 3, and verify boundary conditions."
              }
              rows={3}
              className="resize-none text-sm"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setShowRequestChangesDialog(false); setRequestChangesComment(''); }}>
              Cancel
            </Button>
            <Button
              variant="default"
              className="bg-amber-600 hover:bg-amber-700 text-white"
              onClick={handleRequestChanges}
              disabled={!requestChangesComment.trim() && stepComments.filter((c) => !c.resolved).length === 0}
            >
              Submit Feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Confirmation Modal */}
      <Dialog open={showUnsavedPrompt} onOpenChange={setShowUnsavedPrompt}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-5 w-5" />
              Unsaved Changes
            </DialogTitle>
            <DialogDescription>
              You have unsaved changes on this test case. If you close now, your uncommitted changes will be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowUnsavedPrompt(false)}>
              Keep Editing
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                await handleDiscardChanges();
                setShowUnsavedPrompt(false);
                onClose?.();
              }}
            >
              Discard & Close
            </Button>
            <Button
              size="sm"
              className="bg-primary text-primary-foreground"
              onClick={async () => {
                if (status === 'active' && reviewRequired && !isAdmin) {
                  setShowUnsavedPrompt(false);
                  handleOpenSubmitReviewModal();
                } else {
                  await handleSubmitAsActive();
                  setShowUnsavedPrompt(false);
                  onClose?.();
                }
              }}
            >
              Save & Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick Create Custom Property Dialog (Admins Only) */}
      <Dialog open={showQuickCreateFieldModal} onOpenChange={setShowQuickCreateFieldModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>Create Custom Field</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Define a new custom field for test cases in this project (Max {MAX_CUSTOM_FIELDS_PER_ENTITY} fields).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {/* Field Name */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="font-semibold text-foreground">Field Name</label>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {quickCreateForm.name.length} / {MAX_KEY_NAME_LENGTH}
                </span>
              </div>
              <input
                type="text"
                placeholder="e.g. Severity, Test Type, Component"
                maxLength={MAX_KEY_NAME_LENGTH}
                value={quickCreateForm.name}
                onChange={(e) => {
                  const val = e.target.value.slice(0, MAX_KEY_NAME_LENGTH);
                  const lower = val.toLowerCase().trim();
                  setQuickCreateForm((prev) => {
                    let nextOptions = prev.options;
                    if (prev.options.length === 0) {
                      if (lower.includes('severity')) {
                        nextOptions = ['Critical', 'High', 'Medium', 'Low'];
                      } else if (lower.includes('type')) {
                        nextOptions = ['Functional', 'Regression', 'Smoke', 'Integration', 'Security', 'Performance', 'Acceptance'];
                      }
                    }
                    return {
                      ...prev,
                      name: val,
                      options: nextOptions,
                    };
                  });
                }}
                className={cn(
                  "w-full h-8 px-2.5 rounded-lg border border-border bg-background text-xs",
                  quickCreateForm.name.trim() &&
                    customFieldDefs.some(
                      (d) =>
                        d.key === sanitizeFieldKey(quickCreateForm.name) ||
                        d.name.toLowerCase() === quickCreateForm.name.trim().toLowerCase()
                    ) &&
                    "border-red-500 focus:ring-red-500"
                )}
              />
              {quickCreateForm.name.trim() &&
                customFieldDefs.some(
                  (d) =>
                    d.key === sanitizeFieldKey(quickCreateForm.name) ||
                    d.name.toLowerCase() === quickCreateForm.name.trim().toLowerCase()
                ) && (
                  <p className="text-[11px] text-red-400 flex items-center gap-1 font-medium pt-0.5">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    <span>
                      A custom property with key &quot;{sanitizeFieldKey(quickCreateForm.name)}&quot; already exists in this project.
                    </span>
                  </p>
                )}
            </div>

            {/* Field Type */}
            <div className="space-y-1.5">
              <label className="font-semibold text-foreground">Field Type</label>
              <select
                value={quickCreateForm.type}
                onChange={(e) =>
                  setQuickCreateForm((prev) => ({
                    ...prev,
                    type: e.target.value as CustomFieldType,
                  }))
                }
                className="w-full h-8 rounded-md border border-border/60 bg-background px-2 text-xs cursor-pointer"
              >
                <option value={CustomFieldType.DROPDOWN}>Dropdown (Single Select)</option>
                <option value={CustomFieldType.MULTI_SELECT}>Multi-Select (Multiple Choice)</option>
                <option value={CustomFieldType.TEXT}>Text Field (Max 100 chars)</option>
                <option value={CustomFieldType.BOOLEAN}>Boolean (Yes / No Toggle)</option>
                <option value={CustomFieldType.NUMBER}>Numeric Field</option>
                <option value={CustomFieldType.URL}>URL / External Link</option>
              </select>
            </div>

            {/* Options Builder for Dropdown and Multi-Select */}
            {(quickCreateForm.type === CustomFieldType.DROPDOWN ||
              quickCreateForm.type === CustomFieldType.MULTI_SELECT) && (
              <div className="space-y-2 p-3 rounded-xl border border-border/50 bg-muted/20">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Options List</span>
                  <div className="flex items-center gap-2">
                    {quickCreateForm.options.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setQuickCreateForm((prev) => ({ ...prev, options: [] }))}
                        className="text-[10px] text-muted-foreground hover:text-destructive cursor-pointer underline"
                      >
                        Clear all
                      </button>
                    )}
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {quickCreateForm.options.length} / {MAX_OPTIONS_COUNT} options
                    </span>
                  </div>
                </div>

                {/* Preset suggestions */}
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  <span className="text-[10px] text-muted-foreground font-medium">Presets:</span>
                  <button
                    type="button"
                    onClick={() =>
                      setQuickCreateForm((prev) => ({
                        ...prev,
                        options: ['Functional', 'Regression', 'Smoke', 'Integration', 'Security', 'Performance', 'Acceptance'],
                      }))
                    }
                    className="px-2 py-0.5 rounded-md bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-[10px] font-semibold cursor-pointer transition-colors"
                  >
                    + Testing Type
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setQuickCreateForm((prev) => ({
                        ...prev,
                        options: ['Critical', 'High', 'Medium', 'Low'],
                      }))
                    }
                    className="px-2 py-0.5 rounded-md bg-muted hover:bg-muted/80 text-foreground border border-border/40 text-[10px] font-semibold cursor-pointer transition-colors"
                  >
                    + Severity
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setQuickCreateForm((prev) => ({
                        ...prev,
                        options: ['P0', 'P1', 'P2', 'P3'],
                      }))
                    }
                    className="px-2 py-0.5 rounded-md bg-muted hover:bg-muted/80 text-foreground border border-border/40 text-[10px] font-semibold cursor-pointer transition-colors"
                  >
                    + Priority
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Type an option and press Enter..."
                    value={quickCreateForm.newOptionText}
                    maxLength={MAX_OPTION_LENGTH}
                    onChange={(e) =>
                      setQuickCreateForm((prev) => ({ ...prev, newOptionText: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const opt = quickCreateForm.newOptionText.trim();
                        if (!opt) return;
                        if (quickCreateForm.options.map((o) => o.toLowerCase()).includes(opt.toLowerCase())) {
                          toast.error('Option already exists');
                          return;
                        }
                        if (quickCreateForm.options.length >= MAX_OPTIONS_COUNT) return;
                        setQuickCreateForm((prev) => ({
                          ...prev,
                          options: [...prev.options, opt],
                          newOptionText: '',
                        }));
                      }
                    }}
                    className="h-7 px-2 text-xs flex-1 rounded-md border border-border bg-background"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const opt = quickCreateForm.newOptionText.trim();
                      if (!opt) return;
                      if (quickCreateForm.options.map((o) => o.toLowerCase()).includes(opt.toLowerCase())) {
                        toast.error('Option already exists');
                        return;
                      }
                      if (quickCreateForm.options.length >= MAX_OPTIONS_COUNT) return;
                      setQuickCreateForm((prev) => ({
                        ...prev,
                        options: [...prev.options, opt],
                        newOptionText: '',
                      }));
                    }}
                    disabled={!quickCreateForm.newOptionText.trim()}
                    className="h-7 px-2.5 rounded-md bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold disabled:opacity-50 cursor-pointer"
                  >
                    Add
                  </button>
                </div>

                {quickCreateForm.options.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/80 py-1">
                    No options yet. Type custom options above or click a preset.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 pt-1 max-h-28 overflow-y-auto">
                    {quickCreateForm.options.map((opt, i) => (
                      <span
                        key={opt}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-foreground border border-border/40 text-[11px]"
                      >
                        <span className="truncate max-w-[120px]">{opt}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setQuickCreateForm((prev) => ({
                              ...prev,
                              options: prev.options.filter((_, idx) => idx !== i),
                            }))
                          }
                          className="hover:text-red-400 cursor-pointer p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowQuickCreateFieldModal(false)}
              className="text-xs h-8 cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                savingQuickField ||
                !quickCreateForm.name.trim() ||
                customFieldDefs.some(
                  (d) =>
                    d.key === sanitizeFieldKey(quickCreateForm.name) ||
                    d.name.toLowerCase() === quickCreateForm.name.trim().toLowerCase()
                )
              }
              onClick={async () => {
                if (!project?.id) return;
                const trimmedName = quickCreateForm.name.trim();
                if (!trimmedName) {
                  toast.error('Property name is required');
                  return;
                }
                if (
                  (quickCreateForm.type === CustomFieldType.DROPDOWN ||
                    quickCreateForm.type === CustomFieldType.MULTI_SELECT) &&
                  quickCreateForm.options.length === 0
                ) {
                  toast.error('Please add at least one option or select a preset');
                  return;
                }
                setSavingQuickField(true);
                try {
                  const created = await createCustomFieldDefinitionAction({
                    projectId: project.id,
                    entityType: CustomFieldEntityType.TEST_CASE,
                    name: trimmedName,
                    type: quickCreateForm.type,
                    options: quickCreateForm.options,
                  });
                  await loadCustomFieldDefs(true);
                  setShowQuickCreateFieldModal(false);
                  toast.success(`Property "${created.name}" created`);

                  // Automatically open picker or set initial value on current test case
                  if (created.type === CustomFieldType.BOOLEAN) {
                    handleCustomFieldChange(created.key, true);
                  } else {
                    setOpenPill(`cf_${created.key}`);
                  }
                } catch (e: any) {
                  toast.error(e.message || 'Failed to create property');
                } finally {
                  setSavingQuickField(false);
                }
              }}
              className="text-xs h-8 gradient-btn text-white cursor-pointer"
            >
              {savingQuickField ? 'Creating...' : 'Create & Apply'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {project?.id && (
        <ExternalRunnerModal
          open={showExternalRunnerModal}
          onOpenChange={setShowExternalRunnerModal}
          projectId={project.id}
          testCaseId={caseId}
          testCaseDisplayId={testCase.displayId}
          testCaseTitle={displayTitle}
          initialCustomFields={testCase.customFields || testCase.custom_fields || {}}
          lockedProvider={externalRunnerProvider}
        />
      )}

      {project?.id && linkDialogProvider && (
        <LinkExternalSourceDialog
          open={Boolean(linkDialogProvider)}
          onOpenChange={(next) => {
            if (!next) setLinkDialogProvider(null);
          }}
          projectId={project.id}
          testCaseId={caseId}
          provider={linkDialogProvider}
          onLinked={() => window.location.reload()}
        />
      )}

      {/* Prompt: link an Automated case to an external source (Postman / Datadog / none) */}
      <Dialog open={showExternalLinkPrompt} onOpenChange={setShowExternalLinkPrompt} className="z-[120]">
        <DialogContent onClose={() => { setShowExternalLinkPrompt(false); setPendingMode(null); }} className="z-[120]">
          <DialogHeader>
            <DialogTitle>Link Automated case to an external source?</DialogTitle>
            <DialogDescription>
              Choose how this test case should run after switching to Automated. You can also proceed without any
              external connection and add steps manually.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 p-4">
            <button
              type="button"
              onClick={() => {
                if (pendingMode) handleDraftChange('type', pendingMode);
                const orig = testCase?.customFields || testCase?.custom_fields || {};
                const next = { ...orig };
                delete next._datadog;
                next._postman = { pendingLink: true, source: 'postman' };
                handleDraftChange('customFields', next);
                toast.success('Mode set to Automated — use the ⋯ menu → Link to Postman to finish setup.');
                setShowExternalLinkPrompt(false);
                setPendingMode(null);
              }}
              className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors cursor-pointer flex items-center gap-2"
            >
              <Play className="h-3.5 w-3.5 text-orange-500 shrink-0" />
              <div>
                <span className="font-medium text-foreground">Connect to Postman</span>
                <span className="text-[10px] text-muted-foreground">Collection / Request / Folder</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                if (pendingMode) handleDraftChange('type', pendingMode);
                const orig = testCase?.customFields || testCase?.custom_fields || {};
                const next = { ...orig };
                delete next._postman;
                next._datadog = { pendingLink: true, source: 'datadog' };
                handleDraftChange('customFields', next);
                toast.success('Mode set to Automated — use the ⋯ menu → Link to Datadog to finish setup.');
                setShowExternalLinkPrompt(false);
                setPendingMode(null);
              }}
              className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors cursor-pointer flex items-center gap-2"
            >
              <span className="h-3.5 w-3.5 shrink-0 rounded bg-violet-100 text-violet-700 flex items-center justify-center text-[10px] font-bold">DD</span>
              <div>
                <span className="font-medium text-foreground">Connect to Datadog</span>
                <span className="text-[10px] text-muted-foreground">Synthetic test</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => {
                if (pendingMode) handleDraftChange('type', pendingMode);
                toast.success('Mode set to Automated (no external connection).');
                setShowExternalLinkPrompt(false);
                setPendingMode(null);
              }}
              className="w-full text-left px-3 py-2 rounded-lg border border-border hover:bg-muted transition-colors cursor-pointer flex items-center gap-2"
            >
              <span className="h-3.5 w-3.5 shrink-0 rounded border border-border flex items-center justify-center text-[10px]">—</span>
              <div>
                <span className="font-medium text-foreground">No external connection</span>
                <span className="text-[10px] text-muted-foreground">Add steps manually</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => { setShowExternalLinkPrompt(false); setPendingMode(null); }}
              className="w-full text-left px-3 py-2 rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
