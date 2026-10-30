"use client";

import { useParams, useSearchParams, useRouter } from 'next/navigation';
import React, { useState, useMemo, useEffect, useCallback, Fragment, useRef } from 'react';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronRight, ChevronLeft, ChevronDown, ChevronUp, ChevronsUpDown, Folder, FolderOpen, Plus, Search, PanelLeft, PanelLeftClose, PanelLeftOpen, Sparkles, Edit2, Trash2, Maximize2, AppWindow, PanelRight, ArrowDownToLine, ArrowUpFromLine, SlidersHorizontal, Calendar, X, RotateCcw, Tag, Layers, MoreHorizontal, CornerDownRight, GripVertical, Check, FileText, User, Cpu, ArrowUpDown, Copy, Loader2 as LoaderIcon, Lock, Unlock, Play, ListChecks } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { TagsManagerModal } from '@/components/cases/TagsManagerModal';
import { BulkAddTagsModal } from '@/components/cases/BulkAddTagsModal';
import { BulkAddToSuiteModal } from '@/components/cases/BulkAddToSuiteModal';
import { DataTable } from '@/components/common/DataTable';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { StatusBadge } from '@/components/common/StatusBadge';
import { AiBadge } from '@/components/common/AiBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { AiButton } from '@/components/common/AiButton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { getTestCaseStepsAction } from '@/app/actions/steps';
import type { Module } from '@/lib/types';
import { createTestCaseAction, archiveTestCaseAction, bulkArchiveTestCasesAction, restoreTestCaseAction, getArchivedTestCasesAction, findDuplicateTestCasesAction, type DuplicateCaseGroup } from '@/app/actions/cases';
import { bulkAdminForceApproveAction, bulkRequestReviewAction } from '@/app/actions/reviews';
import { generateCasesAction, acceptAiCaseAction } from '@/app/actions/ai';
import { createModuleAction, updateModuleAction, deleteModuleAction, reorderModulesAction, bulkMoveCasesAction } from '@/app/actions/modules';
import { addCaseToSuiteAction } from '@/app/actions/suites';
import { getProjectTicketsAction, type ProjectTicketOption } from '@/app/actions/integrations';
import { PostmanLogo, DatadogLogo } from '@/components/icons/IntegrationLogos';
import { CaseSourceIcon } from '@/components/common/CaseSourceIcon';
import { AutomationFilter } from '@/components/common/AutomationFilter';
import { caseMatchesMode, caseMatchesSource, getCaseAutomationSource, getAutomationFilterCounts } from '@/lib/cases/automation-source';
import { getCustomFieldDefinitionsAction } from '@/app/actions/custom-fields';
import { CustomFieldEntityType, CustomFieldType } from '@prisma/client';
import { SplitButton } from '@/components/ui/split-button';
import { useMobileSidebar } from '@/components/providers/MobileSidebarProvider';
import { logger } from '@/lib/logger.client';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

const CaseDetailView = dynamic(() => import('./CaseDetailView').then((mod) => mod.CaseDetailView), {
  loading: () => (
    <div className="flex items-center justify-center h-64 p-8">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  ),
  ssr: false,
});

const ImportTestCasesDialog = dynamic(() => import('@/components/cases/ImportTestCasesDialog').then((mod) => mod.ImportTestCasesDialog), {
  ssr: false,
});

const GenerateTestCasesDialog = dynamic(() => import('@/components/cases/GenerateTestCasesDialog').then((mod) => mod.GenerateTestCasesDialog), {
  ssr: false,
});

import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Tooltip } from '@/components/ui/tooltip';
import { buildModuleCaseCounts } from '@/lib/repository/module-counts';

export function RepositoryClient({
  initialCases,
  initialArchivedCases,
  initialModules,
  initialCustomFieldDefs,
}: {
  initialCases?: any[];
  initialArchivedCases?: any[];
  initialModules?: any[];
  initialCustomFieldDefs?: any[];
}) {
  const params = useParams();
  const { slug, caseId } = params as Record<string, string>;
  const searchParams = useSearchParams();
  const caseFromQuery = searchParams.get('case');
  const viewFromQuery = searchParams.get('view');
  const moduleFromQuery = searchParams.get('module');
  const router = useRouter();

  const {
    project,
    modules: contextModules,
    cases: contextCases,
    archivedCases: contextArchivedCases,
    setArchivedCases,
    customFieldDefs: contextCustomFieldDefs,
    setCases,
    setModules,
    suites,
    currentUser,
    members,
    canEdit = true,
    isAdmin: contextIsAdmin,
  } = useProjectData();
  
  const allCases = initialCases || contextCases;
  const archivedCases = initialArchivedCases || contextArchivedCases;
  const modules = initialModules || contextModules;
  const customFieldDefs = initialCustomFieldDefs || contextCustomFieldDefs;
  const { setOpen: setMobileOpen } = useMobileSidebar();
  // Mobile module drawer (the tree is a sidebar at ≥768px).
  const [modulesSheetOpen, setModulesSheetOpen] = useState(false);

  const currentMember = members?.find((m: any) => m.userId === currentUser?.id);
  const currentUserRole = (currentMember?.role || '').toUpperCase();
  const isAdmin =
    contextIsAdmin !== undefined
      ? contextIsAdmin
      : currentUserRole === 'ADMIN' || currentUserRole === 'OWNER';

  const [selectedModule, setSelectedModule] = useState<string | null>(
    moduleFromQuery === 'no-module' || moduleFromQuery === 'none' ? 'no-module' : moduleFromQuery || null
  );
  const [selectedSubmodule, setSelectedSubmodule] = useState<string | null>(null);

  useEffect(() => {
    // Picking a module closes the mobile drawer so the case list is visible.
    setModulesSheetOpen(false);
  }, [selectedModule, selectedSubmodule]);

  // Sync selected module with external selection / URL query
  useEffect(() => {
    const handleSelect = (e: any) => {
      const modId = e.detail?.moduleId;
      setSelectedModule(modId === 'no-module' || modId === 'none' ? 'no-module' : modId ?? null);
      setSelectedSubmodule(null);
    };
    window.addEventListener('inka-select-module', handleSelect);
    return () => window.removeEventListener('inka-select-module', handleSelect);
  }, []);

  useEffect(() => {
    if (moduleFromQuery !== null && moduleFromQuery !== undefined) {
      setSelectedModule(moduleFromQuery === 'no-module' || moduleFromQuery === 'none' ? 'no-module' : moduleFromQuery);
    }
  }, [moduleFromQuery]);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [priorityFilters, setPriorityFilters] = useState<string[]>([]);
  const [statusFilters, setStatusFilters] = useState<string[]>([]);
  const [authorFilters, setAuthorFilters] = useState<string[]>([]);
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [isFilterLocked, setIsFilterLocked] = useState<boolean>(false);
  const [reviewStatusFilter, setReviewStatusFilter] = useState<string>('');
  const [scenarioFilter, setScenarioFilter] = useState<string>('');
  const [ticketKeyFilter, setTicketKeyFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [customFieldFilters, setCustomFieldFilters] = useState<{ [key: string]: string }>({});
  const [visibleFilterKeys, setVisibleFilterKeys] = useState<string[]>([]);

  const availableExtraFilters = useMemo(() => {
    const list: { key: string; label: string; def?: any }[] = [];
    if (!visibleFilterKeys.includes('review_status')) {
      list.push({ key: 'review_status', label: 'Review Status' });
    }
    if (!visibleFilterKeys.includes('scenario')) {
      list.push({ key: 'scenario', label: 'Scenario Type' });
    }
    (customFieldDefs || []).forEach((def: any) => {
      if (!visibleFilterKeys.includes(def.key)) {
        list.push({ key: def.key, label: def.name, def });
      }
    });
    return list;
  }, [visibleFilterKeys, customFieldDefs]);

  useEffect(() => {
    const keys: string[] = [];
    if (reviewStatusFilter) keys.push('review_status');
    if (scenarioFilter) keys.push('scenario');
    Object.keys(customFieldFilters).forEach((k) => {
      if (customFieldFilters[k]) keys.push(k);
    });
    if (keys.length > 0) {
      setVisibleFilterKeys((prev) => Array.from(new Set([...prev, ...keys])));
    }
  }, [reviewStatusFilter, scenarioFilter, customFieldFilters]);

  const ALL_PRIORITIES = useMemo(() => ['P0', 'P1', 'P2', 'P3'], []);
  const togglePriorityFilter = (p: string) => {
    if (!p) { setPriorityFilters([]); return; }
    setPriorityFilters((prev) => {
      const next = prev.includes(p) ? prev.filter((i) => i !== p) : [...prev, p];
      if (ALL_PRIORITIES.every((opt) => next.includes(opt))) return [];
      return next;
    });
  };

  const ALL_STATUSES = useMemo(() => ['active', 'draft', 'deprecated', 'archived'], []);
  const toggleStatusFilter = (s: string) => {
    if (!s) { setStatusFilters([]); return; }
    if (s === 'archived') fetchArchivedCases();
    setStatusFilters((prev) => {
      const next = prev.includes(s) ? prev.filter((i) => i !== s) : [...prev, s];
      if (ALL_STATUSES.every((opt) => next.includes(opt))) return [];
      return next;
    });
  };

  const toggleAuthorFilter = (a: string) => {
    if (!a) { setAuthorFilters([]); return; }
    const allAuthorIds = (members || []).map((m: any) => String(m.userId)).filter(Boolean);
    setAuthorFilters((prev) => {
      const next = prev.includes(a) ? prev.filter((i) => i !== a) : [...prev, a];
      if (allAuthorIds.length > 0 && allAuthorIds.every((opt) => next.includes(opt))) return [];
      return next;
    });
  };

  const toggleTagFilter = (t: string) => {
    if (!t) { setTagFilters([]); return; }
    setTagFilters((prev) => {
      const next = prev.includes(t) ? prev.filter((i) => i !== t) : [...prev, t];
      if (allUniqueTags.length > 0 && allUniqueTags.every((opt) => next.includes(opt))) return [];
      return next;
    });
  };
  const [createdFrom, setCreatedFrom] = useState<string>('');
  const [createdTo, setCreatedTo] = useState<string>('');
  const [updatedFrom, setUpdatedFrom] = useState<string>('');
  const [updatedTo, setUpdatedTo] = useState<string>('');
  const [createdPreset, setCreatedPreset] = useState<string>('');
  const [updatedPreset, setUpdatedPreset] = useState<string>('');
  const [dateFilterField, setDateFilterField] = useState<'updated' | 'created'>('updated');
  const [isAllCasesDragOver, setIsAllCasesDragOver] = useState(false);
  const [isNoModuleDragOver, setIsNoModuleDragOver] = useState(false);

  // A8 — filters persist per user and project until Reset (or a different
  // user signs in, which resolves to a different storage key).
  const filterStorageKey =
    project?.id && currentUser?.id
      ? `inka:repo-filters:${project.id}:${currentUser.id}`
      : null;
  const [filtersReady, setFiltersReady] = useState(false);

  useEffect(() => {
    if (!filterStorageKey) {
      setFiltersReady(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(filterStorageKey);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && typeof saved === 'object') {
        if (Array.isArray(saved.priority)) setPriorityFilters(saved.priority);
        if (Array.isArray(saved.status)) setStatusFilters(saved.status);
        if (Array.isArray(saved.author)) setAuthorFilters(saved.author);
        if (Array.isArray(saved.tag)) setTagFilters(saved.tag);
        if (Array.isArray(saved.visibleKeys)) setVisibleFilterKeys(saved.visibleKeys);
        if (typeof saved.type === 'string') setTypeFilter(saved.type);
        if (typeof saved.reviewStatus === 'string') setReviewStatusFilter(saved.reviewStatus);
        if (typeof saved.scenario === 'string') setScenarioFilter(saved.scenario);
        if (typeof saved.ticket === 'string') setTicketKeyFilter(saved.ticket);
        if (typeof saved.source === 'string') setSourceFilter(saved.source);
        if (typeof saved.createdFrom === 'string') setCreatedFrom(saved.createdFrom);
        if (typeof saved.createdTo === 'string') setCreatedTo(saved.createdTo);
        if (typeof saved.createdPreset === 'string') setCreatedPreset(saved.createdPreset);
        if (typeof saved.updatedFrom === 'string') setUpdatedFrom(saved.updatedFrom);
        if (typeof saved.updatedTo === 'string') setUpdatedTo(saved.updatedTo);
        if (typeof saved.updatedPreset === 'string') setUpdatedPreset(saved.updatedPreset);
        if (saved.dateField === 'created' || saved.dateField === 'updated') setDateFilterField(saved.dateField);
        if (saved.customFields && typeof saved.customFields === 'object') setCustomFieldFilters(saved.customFields);
        if (typeof saved.locked === 'boolean') setIsFilterLocked(saved.locked);
      }
    } catch {
      /* corrupt payload: start from defaults */
    }
    setFiltersReady(true);
  }, [filterStorageKey]);

  useEffect(() => {
    if (!filterStorageKey || !filtersReady) return;
    try {
      window.localStorage.setItem(
        filterStorageKey,
        JSON.stringify({
          priority: priorityFilters,
          status: statusFilters,
          author: authorFilters,
          tag: tagFilters,
          visibleKeys: visibleFilterKeys,
          type: typeFilter,
          reviewStatus: reviewStatusFilter,
          scenario: scenarioFilter,
          ticket: ticketKeyFilter,
          source: sourceFilter,
          createdFrom,
          createdTo,
          createdPreset,
          updatedFrom,
          updatedTo,
          updatedPreset,
          dateField: dateFilterField,
          customFields: customFieldFilters,
          locked: isFilterLocked,
        })
      );
    } catch {
      /* storage may be unavailable (private mode) */
    }
  }, [
    filterStorageKey,
    filtersReady,
    priorityFilters,
    statusFilters,
    authorFilters,
    tagFilters,
    visibleFilterKeys,
    typeFilter,
    reviewStatusFilter,
    scenarioFilter,
    ticketKeyFilter,
    sourceFilter,
    createdFrom,
    createdTo,
    createdPreset,
    updatedFrom,
    updatedTo,
    updatedPreset,
    dateFilterField,
    customFieldFilters,
    isFilterLocked,
  ]);
  const noModuleCasesCount = useMemo(() => allCases.filter((c: any) => !c.moduleId).length, [allCases]);
  // Parent badges roll up their descendants so collapsing a branch never hides
  // work. Sub-modules read the same map, so every level shows its subtree total.
  const moduleCaseCounts = useMemo(
    () => buildModuleCaseCounts(modules as any[], allCases as any[]),
    [modules, allCases]
  );
  const moduleTotalCount = useCallback(
    (moduleId: string) => moduleCaseCounts.get(moduleId)?.total ?? 0,
    [moduleCaseCounts]
  );
  const [showFilterPopover, setShowFilterPopover] = useState(false);
  const [showTagsModal, setShowTagsModal] = useState(false);
  const [showBulkAddTagsModal, setShowBulkAddTagsModal] = useState(false);
  const [showBulkAddToSuiteModal, setShowBulkAddToSuiteModal] = useState(false);
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [showDataMenu, setShowDataMenu] = useState(false);

  const allUniqueTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCases) {
      if (Array.isArray(c.tags)) {
        for (const t of c.tags) {
          const clean = String(t).trim().toLowerCase();
          if (clean) set.add(clean);
        }
      }
    }
    return Array.from(set).sort();
  }, [allCases]);

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

  const automationCounts = useMemo(() => getAutomationFilterCounts(allCases), [allCases]);

  /**
   * Resolve the cases that belong to the currently selected module, including
   * every descendant module. Used by the bulk bar so "Select all" matches the
   * count the tree already shows for that module.
   */
  const selectedModuleCaseIds = useMemo(() => {
    if (!selectedModule) return [] as string[];
    if (selectedModule === 'no-module') {
      return allCases.filter((c: any) => !c.moduleId).map((c: any) => c.id);
    }
    const childIds = new Set<string>([selectedModule]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of modules as any[]) {
        const parent = m.parentId || m.parent_id || null;
        if (parent && childIds.has(parent) && !childIds.has(m.id)) {
          childIds.add(m.id);
          grew = true;
        }
      }
    }
    return allCases
      .filter((c: any) => c.moduleId && childIds.has(c.moduleId))
      .map((c: any) => c.id);
  }, [selectedModule, allCases, modules]);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    count += priorityFilters.length;
    count += statusFilters.length;
    count += authorFilters.length;
    count += tagFilters.length;
    if (typeFilter || sourceFilter) count++;
    if (reviewStatusFilter) count++;
    if (scenarioFilter) count++;
    if (ticketKeyFilter) count++;
    if (createdFrom || createdTo || createdPreset) count++;
    if (updatedFrom || updatedTo || updatedPreset) count++;
    count += Object.values(customFieldFilters).filter(Boolean).length;
    return count;
  }, [priorityFilters, statusFilters, authorFilters, tagFilters, typeFilter, reviewStatusFilter, scenarioFilter, ticketKeyFilter, sourceFilter, createdFrom, createdTo, createdPreset, updatedFrom, updatedTo, updatedPreset, customFieldFilters]);

  const clearAllFilters = () => {
    if (filterStorageKey) {
      try {
        window.localStorage.removeItem(filterStorageKey);
      } catch {}
    }
    setPriorityFilters([]);
    setStatusFilters([]);
    setAuthorFilters([]);
    setTagFilters([]);
    setTypeFilter('');
    setReviewStatusFilter('');
    setScenarioFilter('');
    setTicketKeyFilter('');
    setSourceFilter('');
    setCreatedFrom('');
    setCreatedTo('');
    setCreatedPreset('');
    setUpdatedFrom('');
    setUpdatedTo('');
    setUpdatedPreset('');
    setCustomFieldFilters({});
  };

  const handleApplyCreatedPreset = (preset: string) => {
    setCreatedPreset(preset);
    const now = new Date();
    const toStr = now.toISOString().split('T')[0];
    if (preset === 'today') {
      setCreatedFrom(toStr);
      setCreatedTo(toStr);
    } else if (preset === '7d') {
      const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setCreatedFrom(past.toISOString().split('T')[0]);
      setCreatedTo(toStr);
    } else if (preset === '30d') {
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setCreatedFrom(past.toISOString().split('T')[0]);
      setCreatedTo(toStr);
    } else if (preset === 'all') {
      setCreatedFrom('');
      setCreatedTo('');
      setCreatedPreset('');
    }
  };

  const handleApplyUpdatedPreset = (preset: string) => {
    setUpdatedPreset(preset);
    const now = new Date();
    const toStr = now.toISOString().split('T')[0];
    if (preset === 'today') {
      setUpdatedFrom(toStr);
      setUpdatedTo(toStr);
    } else if (preset === '7d') {
      const past = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setUpdatedFrom(past.toISOString().split('T')[0]);
      setUpdatedTo(toStr);
    } else if (preset === '30d') {
      const past = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      setUpdatedFrom(past.toISOString().split('T')[0]);
      setUpdatedTo(toStr);
    } else if (preset === 'all') {
      setUpdatedFrom('');
      setUpdatedTo('');
      setUpdatedPreset('');
    }
  };
  const [showNewCaseModal, setShowNewCaseModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateSourceMode, setGenerateSourceMode] = useState<'prompt' | 'postman' | 'datadog'>('prompt');
  const [showCreateModuleModal, setShowCreateModuleModal] = useState(false);
  const [moduleForm, setModuleForm] = useState('');
  const [moduleParentId, setModuleParentId] = useState<string | null>(null);
  const [quickCreateModuleId, setQuickCreateModuleId] = useState<string | null>(null);
  const [quickCaseTitle, setQuickCaseTitle] = useState('');
  const [isSubmittingQuick, setIsSubmittingQuick] = useState(false);
  const [showNewCaseDropdown, setShowNewCaseDropdown] = useState(false);
  const newCaseDropdownRef = useRef<HTMLDivElement>(null);
  const newCaseHoverCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openNewCaseDropdown = () => {
    if (newCaseHoverCloseRef.current) clearTimeout(newCaseHoverCloseRef.current);
    newCaseHoverCloseRef.current = null;
    setShowNewCaseDropdown(true);
  };

  const scheduleCloseNewCaseDropdown = () => {
    if (newCaseHoverCloseRef.current) clearTimeout(newCaseHoverCloseRef.current);
    newCaseHoverCloseRef.current = setTimeout(() => {
      setShowNewCaseDropdown(false);
      newCaseHoverCloseRef.current = null;
    }, 180);
  };

  useEffect(() => {
    return () => {
      if (newCaseHoverCloseRef.current) clearTimeout(newCaseHoverCloseRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showNewCaseDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (newCaseDropdownRef.current && !newCaseDropdownRef.current.contains(e.target as Node)) {
        setShowNewCaseDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNewCaseDropdown]);
  const [newCaseForm, setNewCaseForm] = useState({
    title: '',
    moduleId: '',
    submoduleId: '',
    suiteId: '',
    priority: 'P2',
    description: '',
    tags: [] as string[],
    ticketKey: '',
  });
  const [tagInputText, setTagInputText] = useState('');
  const [isTagInputFocused, setIsTagInputFocused] = useState(false);

  const modalTagSuggestions = useMemo(() => {
    const query = tagInputText.trim().toLowerCase();
    return allUniqueTags
      .filter((t) => !newCaseForm.tags.includes(t))
      .filter((t) => (!query ? true : t.includes(query)))
      .slice(0, 20);
  }, [allUniqueTags, newCaseForm.tags, tagInputText]);

  // Project & InkaBoard tickets state for New Case Modal
  const [ticketOptions, setTicketOptions] = useState<ProjectTicketOption[]>([]);
  const [isPmConnected, setIsPmConnected] = useState(false);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [isTicketInputFocused, setIsTicketInputFocused] = useState(false);
  const [ticketSearchQuery, setTicketSearchQuery] = useState('');

  // Live debounced ticket search for InkaBoard / Project tickets
  useEffect(() => {
    if (!showNewCaseModal || !project?.id) return;
    setLoadingTickets(true);
    const timer = setTimeout(() => {
      getProjectTicketsAction(project.id, ticketSearchQuery)
        .then((res) => {
          setTicketOptions(res.tickets);
          setIsPmConnected(res.isPmConnected);
        })
        .catch(() => {})
        .finally(() => setLoadingTickets(false));
    }, 250);

    return () => clearTimeout(timer);
  }, [showNewCaseModal, project?.id, ticketSearchQuery]);

  const filteredTicketOptions = useMemo(() => {
    const q = ticketSearchQuery.trim().toLowerCase();
    if (!q) return ticketOptions;
    return ticketOptions.filter(
      (t) => t.key.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
    );
  }, [ticketOptions, ticketSearchQuery]);
  const [modulesCollapsed, setModulesCollapsed] = useState(false);
  // The module tree is useful navigation, but below lg it leaves too little
  // room for the case table. Start it collapsed there; the toggle stays available.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setModulesCollapsed(true);
    }
  }, []);
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());
  const [moveTargetModule, setMoveTargetModule] = useState('');
  const [activeDrawerCaseId, setActiveDrawerCaseId] = useState<string | null>(caseId || caseFromQuery || null);
  const [detailViewType, setDetailViewType] = useState<'popup' | 'sheet'>('sheet');
  const [openCaseInEditMode, setOpenCaseInEditMode] = useState(false);
  const [dragOverModuleGroupId, setDragOverModuleGroupId] = useState<string | null>(null);
  const lastActiveCaseIdRef = useRef<string | null>(activeDrawerCaseId);
  if (activeDrawerCaseId) {
    lastActiveCaseIdRef.current = activeDrawerCaseId;
  }
  const persistentDrawerCaseId = activeDrawerCaseId || lastActiveCaseIdRef.current;

  useEffect(() => {
    if (caseFromQuery && caseFromQuery !== activeDrawerCaseId) {
      setActiveDrawerCaseId(caseFromQuery);
    }
    if (viewFromQuery === 'popup' || viewFromQuery === 'sheet') {
      setDetailViewType(viewFromQuery);
    }
  }, [caseFromQuery, viewFromQuery]);

  const toggleDetailViewType = () => {
    setDetailViewType((prev) => (prev === 'popup' ? 'sheet' : 'popup'));
  };
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{ open: boolean; title: string; description: React.ReactNode; onConfirm: () => void; variant?: 'default' | 'destructive'; requireTypedConfirmation?: string } | null>(null);
  const [showBulkReviewModal, setShowBulkReviewModal] = useState(false);
  const [bulkReviewTarget, setBulkReviewTarget] = useState('');
  const [bulkReviewComment, setBulkReviewComment] = useState('');
  const [submittingBulkReview, setSubmittingBulkReview] = useState(false);
  const [collapsedModuleIds, setCollapsedModuleIds] = useState<Set<string>>(() => new Set());
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateCaseGroup[]>([]);
  const [loadingDuplicates, setLoadingDuplicates] = useState(false);
  const [archivingDuplicates, setArchivingDuplicates] = useState(false);

  useEffect(() => {
    setCollapsedModuleIds((prev) => {
      if (!prev.has('no-module') && (!selectedModule || !prev.has(selectedModule))) {
        return prev;
      }
      const next = new Set(prev);
      next.delete('no-module');
      if (selectedModule) next.delete(selectedModule);
      return next;
    });
  }, [selectedModule]);

  const handleHeaderSort = (colId: string) => {
    if (sortColumn === colId) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(colId);
      setSortDirection('asc');
    }
  };

  const toggleModuleCollapse = (id: string) => {
    setCollapsedModuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenCase = (displayId: string, editMode = false) => {
    setOpenCaseInEditMode(editMode);
    setActiveDrawerCaseId(displayId);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('case', displayId);
      window.history.pushState(null, '', url.toString());
    }
  };

  const handleCloseCaseDrawer = (force = false) => {
    if (!force && typeof window !== 'undefined') {
      if ((window as any).__caseDetailHasUnsavedChanges) {
        if (typeof (window as any).__requestCaseDetailClose === 'function') {
          (window as any).__requestCaseDetailClose();
          return;
        }
      }
      if ((window as any).__caseDetailIsEditing && typeof (window as any).__exitCaseDetailEditMode === 'function') {
        (window as any).__exitCaseDetailEditMode();
        setOpenCaseInEditMode(false);
        return;
      }
    }
    setOpenCaseInEditMode(false);
    setActiveDrawerCaseId(null);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('case');
      window.history.pushState(null, '', url.toString());
    }
  };

  const handleBulkSubmitReview = async () => {
    if (selectedCaseIds.size === 0) return;
    setSubmittingBulkReview(true);
    try {
      const caseIdsArray = Array.from(selectedCaseIds);
      const assignedTo = bulkReviewTarget ? Number(bulkReviewTarget) : undefined;
      await bulkRequestReviewAction({
        testCaseIds: caseIdsArray,
        assignedTo,
        comment: bulkReviewComment || undefined,
      });

      setCases(allCases.map(c => selectedCaseIds.has(c.id) ? { ...c, reviewStatus: 'pending' } : c));
      toast.success(`Submitted ${selectedCaseIds.size} test cases for review`);
      setShowBulkReviewModal(false);
      setSelectedCaseIds(new Set());
      setBulkReviewTarget('');
      setBulkReviewComment('');
    } catch (e: any) {
      toast.error(e.message || 'Failed to submit cases for review');
    } finally {
      setSubmittingBulkReview(false);
    }
  };

  useEffect(() => {
    if (!newCaseForm.title) return;
    if (newCaseForm.moduleId) return; // user already picked one

    const timer = setTimeout(() => {
      const titleLower = newCaseForm.title.toLowerCase();
      let match = modules.find((m: any) => titleLower.includes(m.name.toLowerCase()));
      if (!match) {
        match = modules.find((m: any) => {
          const words = m.name.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
          return words.some((w: string) => titleLower.includes(w));
        });
      }
      if (match && !newCaseForm.moduleId) {
        setNewCaseForm((prev) => ({ ...prev, moduleId: match.id }));
        toast.success('Module auto-assigned based on title');
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [newCaseForm.title, modules, newCaseForm.moduleId]);

  const handleBulkMove = async () => {
    if (selectedCaseIds.size === 0) { toast.error('Select cases to move'); return; }
    try {
      await bulkMoveCasesAction([...selectedCaseIds], moveTargetModule || null);
      toast.success(`Moved ${selectedCaseIds.size} cases`);
      setSelectedCaseIds(new Set());
      setMoveTargetModule('');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRowDragStart = (e: React.DragEvent, row: any) => {
    const ids = selectedCaseIds.has(row.id) ? Array.from(selectedCaseIds) : [row.id];
    e.dataTransfer.setData('application/json', JSON.stringify({ caseIds: ids, sourceCaseId: row.id }));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleMoveCasesToModule = async (caseIds: string[], targetModuleId: string | null) => {
    if (!caseIds || caseIds.length === 0) return;
    const targetName = targetModuleId
      ? modules.find((m: any) => m.id === targetModuleId)?.name || 'Module'
      : 'Without Module';

    const prevCases = [...allCases];
    setCases(allCases.map((c: any) => caseIds.includes(c.id) ? { ...c, moduleId: targetModuleId } : c));
    setSelectedCaseIds(new Set());

    try {
      await bulkMoveCasesAction(caseIds, targetModuleId);
      toast.success(`Moved ${caseIds.length} case${caseIds.length !== 1 ? 's' : ''} to ${targetName}`);
    } catch (err: any) {
      setCases(prevCases);
      toast.error(err.message || 'Failed to move cases');
    }
  };

  const handleRowDrop = (e: React.DragEvent, targetRow: any) => {
    setDragOverModuleGroupId(null);
    try {
      const raw = e.dataTransfer.getData('application/json');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const caseIds: string[] = Array.isArray(parsed?.caseIds) ? parsed.caseIds : [];
      if (caseIds.length === 0 || caseIds.includes(targetRow.id)) return;

      const targetModuleId = targetRow.moduleId || null;
      const draggedCases = allCases.filter((c: any) => caseIds.includes(c.id));
      if (draggedCases.length === 0) return;

      const movingAcrossModule = draggedCases.some(
        (c: any) => (c.moduleId || null) !== targetModuleId
      );

      // Reorder in local cases list so dropped items sit immediately before targetRow
      const remaining = allCases.filter((c: any) => !caseIds.includes(c.id));
      const targetIdx = remaining.findIndex((c: any) => c.id === targetRow.id);
      const movedItems = draggedCases.map((c: any) => ({
        ...c,
        moduleId: targetModuleId,
      }));

      if (targetIdx !== -1) {
        remaining.splice(targetIdx, 0, ...movedItems);
      } else {
        remaining.push(...movedItems);
      }

      if (sortColumn) setSortColumn(null);
      setCases(remaining);

      if (movingAcrossModule) {
        setSelectedCaseIds(new Set());
        const targetName = targetModuleId
          ? modules.find((m: any) => m.id === targetModuleId)?.name || 'Module'
          : 'Without Module';
        bulkMoveCasesAction(caseIds, targetModuleId)
          .then(() => {
            toast.success(`Moved ${caseIds.length} case${caseIds.length !== 1 ? 's' : ''} to ${targetName}`);
          })
          .catch((err: any) => {
            toast.error(err.message || 'Failed to move cases');
          });
      }
    } catch {
      // ignore malformed drag payload
    }
  };

  const toArchivedCase = (testCase: any) => ({
    ...testCase,
    type: String(testCase.type || '').toLowerCase(),
    status: String(testCase.status || '').toLowerCase(),
    archivedAt: new Date().toISOString(),
  });

  const openDuplicateFinder = async () => {
    setShowDuplicates(true);
    setLoadingDuplicates(true);
    try {
      const groups = await findDuplicateTestCasesAction(project.id);
      setDuplicateGroups(groups);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to scan for duplicates');
    } finally {
      setLoadingDuplicates(false);
    }
  };

  const archiveDuplicateCases = async (group: DuplicateCaseGroup) => {
    // Keep the newest case; the older ones are the leftovers from the
    // duplicate-on-every-run behaviour.
    const sorted = [...group.cases].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
    const toArchive = sorted.slice(1).map((c) => c.id);
    if (toArchive.length === 0) return;
    setArchivingDuplicates(true);
    try {
      const archived = allCases.filter((c) => toArchive.includes(c.id));
      await bulkArchiveTestCasesAction(toArchive);
      setCases(allCases.filter((c) => !toArchive.includes(c.id)));
      setArchivedCases([...archived.map(toArchivedCase), ...archivedCases]);
      setDuplicateGroups((prev) => prev.filter((g) => g.key !== group.key));
      toast.success(
        `Archived ${toArchive.length} duplicate${toArchive.length === 1 ? '' : 's'}`
      );
    } catch (e: any) {
      toast.error(e?.message || 'Failed to archive duplicates');
    } finally {
      setArchivingDuplicates(false);
    }
  };

  const handleBulkArchive = async () => {
    if (selectedCaseIds.size === 0) { toast.error('Select cases to delete'); return; }
    setConfirmConfig({
      open: true,
      title: 'Delete Test Cases',
      description: `Are you sure you want to delete ${selectedCaseIds.size} test case${selectedCaseIds.size === 1 ? '' : 's'}? They will be removed from your repository. Their execution history is preserved.`,
      variant: 'destructive',
      requireTypedConfirmation: 'DELETE',
      onConfirm: async () => {
        try {
          const deletedCases = allCases.filter((c) => selectedCaseIds.has(c.id));
          await bulkArchiveTestCasesAction(Array.from(selectedCaseIds));
          setCases(allCases.filter((c) => !selectedCaseIds.has(c.id)));
          setArchivedCases([...deletedCases.map(toArchivedCase), ...archivedCases]);
          toast.success(`Deleted ${selectedCaseIds.size} case${selectedCaseIds.size === 1 ? '' : 's'}`);
          setSelectedCaseIds(new Set());
        } catch (e: any) {
          toast.error(e.message || 'Failed to delete cases');
        }
      }
    });
  };

  const handleBulkMarkActive = () => {
    if (selectedCaseIds.size === 0) return;
    setConfirmConfig({
      open: true,
      title: 'Mark Active',
      description: `Are you sure you want to approve and mark ${selectedCaseIds.size} test cases as Active?`,
      variant: 'default',
      onConfirm: async () => {
        try {
          await bulkAdminForceApproveAction(Array.from(selectedCaseIds));
          setCases(allCases.map(c => selectedCaseIds.has(c.id) ? { ...c, status: 'active', reviewStatus: 'APPROVED' } : c));
          toast.success(`Marked ${selectedCaseIds.size} cases as Active`);
          setSelectedCaseIds(new Set());
        } catch (e: any) {
          toast.error(e.message || 'Failed to mark active');
        }
      }
    });
  };

  const handleArchiveCase = async (caseId: string) => {
    setConfirmConfig({
      open: true,
      title: 'Delete Test Case',
      description: 'Are you sure you want to delete this test case? It will be removed from your repository. Its execution history is preserved.',
      variant: 'destructive',
      requireTypedConfirmation: 'DELETE',
      onConfirm: async () => {
        try {
          const deletedCase = allCases.find((c) => c.id === caseId);
          await archiveTestCaseAction(caseId);
          setCases(allCases.filter((c) => c.id !== caseId));
          if (deletedCase) setArchivedCases([toArchivedCase(deletedCase), ...archivedCases]);
          toast.success('Test case deleted');
        } catch (e: any) {
          toast.error(e.message || 'Failed to delete');
        }
      }
    });
  };

  const handleRestoreCase = async (caseId: string) => {
    try {
      const restoredCase = archivedCases.find((c) => c.id === caseId);
      await restoreTestCaseAction(caseId);
      setArchivedCases(archivedCases.filter((c) => c.id !== caseId));
      if (restoredCase && !allCases.some((c) => c.id === caseId)) {
        const activeCase = { ...restoredCase };
        delete activeCase.archivedAt;
        setCases([activeCase, ...allCases]);
      }
      toast.success('Test case restored');
    } catch (e: any) {
      toast.error(e.message || 'Failed to restore');
    }
  };

  const handleBulkRestoreCases = async () => {
    if (selectedCaseIds.size === 0) return;
    const ids = Array.from(selectedCaseIds);
    try {
      await Promise.all(ids.map((id) => restoreTestCaseAction(id)));
      const restored = archivedCases
        .filter((c) => selectedCaseIds.has(c.id))
        .map((c) => {
          const active = { ...c };
          delete active.archivedAt;
          delete (active as any).updatedAt;
          return active;
        });
      setArchivedCases(archivedCases.filter((c) => !selectedCaseIds.has(c.id)));
      const existing = new Set(allCases.map((c) => c.id));
      setCases([...restored.filter((c) => !existing.has(c.id)), ...allCases]);
      setSelectedCaseIds(new Set());
      toast.success(`Restored ${ids.length} case${ids.length === 1 ? '' : 's'}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to restore cases');
    }
  };

  const fetchArchivedCases = async () => {
    if (!project) return;
    setLoadingArchived(true);
    try {
      const cases = await getArchivedTestCasesAction(project.id);
      setArchivedCases(cases);
    } catch (e: any) {
      toast.error('Failed to load archived cases');
    }
    setLoadingArchived(false);
  };

  const rootModules = useMemo(() => {
    const seen = new Set<string>();
    return modules
      .filter((m: any) => !m.parentId)
      .filter((m: any) => {
        const key = m.name?.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  }, [modules]);

  const getChildModules = useCallback((parentId: string) => {
    const seen = new Set<string>();
    return modules
      .filter((m: any) => m.parentId === parentId)
      .filter((m: any) => {
        const key = m.name?.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
  }, [modules]);

  const moduleTreeOptions = useMemo(() => {
    const options: { value: string; label: string }[] = [
      { value: '', label: 'No module (Root)' },
    ];

    rootModules.forEach((rm: any) => {
      options.push({ value: rm.id, label: `📁 ${rm.name}` });
      const children = modules.filter((m: any) => m.parentId === rm.id);
      children.forEach((cm: any) => {
        options.push({ value: cm.id, label: `    ↳ 📁 ${cm.name}` });
      });
    });

    return options;
  }, [rootModules, modules]);

  const filteredCases = useMemo(() => {
    let filtered = allCases;

    if (selectedModule) {
      if (selectedModule === 'no-module' || selectedModule === 'none') {
        filtered = filtered.filter((c: any) => !c.moduleId);
      } else if (selectedSubmodule) {
        filtered = filtered.filter((c: any) => c.moduleId === selectedSubmodule);
      } else {
        const getDescendantIds = (parentId: string): string[] => {
          const directKids = modules.filter((m: any) => m.parentId === parentId);
          return [parentId, ...directKids.flatMap((k: any) => getDescendantIds(k.id))];
        };
        const targetIds = getDescendantIds(selectedModule);
        filtered = filtered.filter((c: any) => c.moduleId && targetIds.includes(c.moduleId));
      }
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        (c.displayId || '').toLowerCase().includes(q)
      );
    }

    if (priorityFilters.length > 0) {
      filtered = filtered.filter((c) => priorityFilters.includes(c.priority));
    }

    if (statusFilters.length > 0) {
      filtered = filtered.filter((c) => statusFilters.includes(c.status?.toLowerCase()));
    }

    if (typeFilter) {
      filtered = filtered.filter((c) => caseMatchesMode(c, typeFilter));
    }

    if (reviewStatusFilter) {
      if (reviewStatusFilter === 'unreviewed' || reviewStatusFilter === 'draft') {
        filtered = filtered.filter((c) => !c.reviewStatus);
      } else {
        filtered = filtered.filter((c) => (c.reviewStatus || '').toLowerCase() === reviewStatusFilter.toLowerCase());
      }
    }

    if (scenarioFilter) {
      filtered = filtered.filter((c) => (c.scenarioType || '').toLowerCase() === scenarioFilter.toLowerCase());
    }

    if (authorFilters.length > 0) {
      filtered = filtered.filter((c) => authorFilters.includes(String(c.createdBy || '')));
    }

    if (ticketKeyFilter) {
      const target = ticketKeyFilter.toLowerCase().trim();
      filtered = filtered.filter((c: any) => {
        const labels: string[] = c.labels || [];
        const tags: string[] = c.tags || [];
        const hasTicketLabel = labels.some((l: string) => l.toLowerCase() === target || l.toLowerCase() === `ticket:${target}`);
        const hasTicketTag = tags.some((t: string) => t.toLowerCase() === target || t.toLowerCase() === `ticket:${target}`);
        return hasTicketLabel || hasTicketTag;
      });
    }

    if (tagFilters.length > 0) {
      filtered = filtered.filter((c: any) => {
        const tags: string[] = (c.tags || []).map((t: string) => t.toLowerCase().trim());
        return tagFilters.some((tf) => tags.includes(tf.toLowerCase().trim()));
      });
    }

    if (sourceFilter) {
      filtered = filtered.filter((c: any) => caseMatchesSource(c, sourceFilter));
    }

    if (createdFrom) {
      const fromTime = new Date(`${createdFrom}T00:00:00`).getTime();
      filtered = filtered.filter((c) => {
        const d = new Date(c.createdAt || (c as any).created_at).getTime();
        return !isNaN(d) && d >= fromTime;
      });
    }

    if (createdTo) {
      const toTime = new Date(`${createdTo}T23:59:59.999`).getTime();
      filtered = filtered.filter((c) => {
        const d = new Date(c.createdAt || (c as any).created_at).getTime();
        return !isNaN(d) && d <= toTime;
      });
    }

    if (updatedFrom) {
      const fromTime = new Date(`${updatedFrom}T00:00:00`).getTime();
      filtered = filtered.filter((c) => {
        const d = new Date(c.updatedAt || (c as any).updated_at).getTime();
        return !isNaN(d) && d >= fromTime;
      });
    }

    if (updatedTo) {
      const toTime = new Date(`${updatedTo}T23:59:59.999`).getTime();
      filtered = filtered.filter((c) => {
        const d = new Date(c.updatedAt || (c as any).updated_at).getTime();
        return !isNaN(d) && d <= toTime;
      });
    }

    // Custom property filters
    for (const [key, filterVal] of Object.entries(customFieldFilters)) {
      if (filterVal) {
        filtered = filtered.filter((c: any) => {
          const val = c.customFields?.[key] ?? c.custom_fields?.[key];
          if (val === undefined || val === null) return false;
          if (Array.isArray(val)) {
            return val.map((x: any) => String(x).toLowerCase()).includes(filterVal.toLowerCase());
          }
          if (typeof val === 'boolean') {
            return String(val) === filterVal;
          }
          return String(val).toLowerCase() === filterVal.toLowerCase();
        });
      }
    }

    if (sortColumn) {
      filtered = [...filtered].sort((a: any, b: any) => {
        let aVal = '';
        let bVal = '';
        if (sortColumn === 'displayId') {
          const aNum = parseInt(String(a.displayId || '').replace(/\D+/g, ''), 10);
          const bNum = parseInt(String(b.displayId || '').replace(/\D+/g, ''), 10);
          if (!isNaN(aNum) && !isNaN(bNum) && aNum !== bNum) {
            return sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
          }
          aVal = String(a.displayId || '');
          bVal = String(b.displayId || '');
        } else if (sortColumn === 'title') {
          aVal = String(a.title || '').toLowerCase();
          bVal = String(b.title || '').toLowerCase();
        } else if (sortColumn === 'priority') {
          aVal = String(a.priority || '');
          bVal = String(b.priority || '');
        } else if (sortColumn === 'type') {
          aVal = String(a.type || '').toLowerCase();
          bVal = String(b.type || '').toLowerCase();
        }
        if (aVal === bVal) return 0;
        const cmp = aVal < bVal ? -1 : 1;
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }

    return filtered;
  }, [allCases, selectedModule, selectedSubmodule, searchQuery, priorityFilters, statusFilters, typeFilter, reviewStatusFilter, scenarioFilter, authorFilters, tagFilters, ticketKeyFilter, sourceFilter, createdFrom, createdTo, updatedFrom, updatedTo, customFieldFilters, sortColumn, sortDirection]);

  const currentCasesList = useMemo(() => {
    return statusFilters.includes('archived') ? archivedCases : filteredCases;
  }, [statusFilters, archivedCases, filteredCases]);

  const currentCaseIndex = useMemo(() => {
    if (!activeDrawerCaseId) return -1;
    return currentCasesList.findIndex(
      (c: any) => c.id === activeDrawerCaseId || c.displayId === activeDrawerCaseId || c.display_id === activeDrawerCaseId
    );
  }, [activeDrawerCaseId, currentCasesList]);

  const handleNavigatePrev = currentCaseIndex > 0 ? () => {
    const prevCase = currentCasesList[currentCaseIndex - 1];
    if (prevCase) {
      handleOpenCase(prevCase.displayId || prevCase.display_id || prevCase.id);
    }
  } : undefined;

  const handleNavigateNext = currentCaseIndex >= 0 && currentCaseIndex < currentCasesList.length - 1 ? () => {
    const nextCase = currentCasesList[currentCaseIndex + 1];
    if (nextCase) {
      handleOpenCase(nextCase.displayId || nextCase.display_id || nextCase.id);
    }
  } : undefined;

  const handleExport = async () => {
    const itemsToExport = selectedCaseIds.size > 0 
      ? allCases.filter(c => selectedCaseIds.has(c.id))
      : (statusFilters.includes('archived') ? archivedCases : filteredCases);
    
    if (itemsToExport.length === 0) {
      toast.error("No cases selected or available to export");
      return;
    }

    toast.info("Preparing export data...");

    const exportData = await Promise.all(itemsToExport.map(async (c: any) => {
      const moduleName = modules.find((m: any) => m.id === c.moduleId)?.name || '';
      
      let parsedSteps: any[] = [];
      if (Array.isArray(c.steps) && c.steps.length > 0) {
        parsedSteps = c.steps;
      } else if (typeof c.steps === 'string' && c.steps.trim() !== '') {
        try { parsedSteps = JSON.parse(c.steps); } catch { parsedSteps = []; }
      }

      if (parsedSteps.length === 0) {
        try {
          const loadedSteps = await getTestCaseStepsAction(c.id);
          if (Array.isArray(loadedSteps) && loadedSteps.length > 0) {
            parsedSteps = loadedSteps;
          }
        } catch { /* silent */ }
      }

      const stepsText = parsedSteps.map((s: any, idx: number) => {
        let text = `${idx + 1}. ${s.step || s.description || s.action || ''}`;
        const exp = s.expected_result || s.expectedResult;
        if (exp) text += `\n   Expected: ${exp}`;
        if (s.data) text += `\n   Data: ${s.data}`;
        return text;
      }).join('\n\n');

      const createdByName = members?.find((m: any) => m.userId === c.createdBy)?.user?.name || c.createdBy || '-';
      const updatedByName = members?.find((m: any) => m.userId === c.updatedBy)?.user?.name || c.updatedBy || '-';

      const safeCell = (val?: string | null): string => {
        if (!val) return '';
        const str = String(val);
        if (/^[=+\-@\t\r]/.test(str) && isNaN(Number(str))) {
          return `'${str}`;
        }
        return str;
      };

      return {
        'ID': c.displayId || c.id,
        'Title': safeCell(c.title),
        'Description': safeCell(c.description),
        'Module': moduleName,
        'Priority': c.priority || '',
        'Type': c.type || '',
        'Scenario Type': safeCell(c.scenarioType),
        'Status': c.status || '',
        'Review Status': c.reviewStatus || '',
        'Pre-Conditions': safeCell(c.preConditions),
        'Post-Conditions': safeCell(c.postConditions),
        'Expected Result': safeCell(c.expectedResult),
        'Tags': (c.tags || []).join(', '),
        'Labels': (c.labels || []).join(', '),
        'Steps': safeCell(stepsText),
        'Created By': createdByName,
        'Created Date': c.createdAt ? new Date(c.createdAt).toLocaleString() : '',
        'Updated By': updatedByName,
        'Updated Date': c.updatedAt ? new Date(c.updatedAt).toLocaleString() : '',
      };
    }));

    const XLSX = await import('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Test Cases");

    const max_widths = Object.keys(exportData[0] || {}).map(key => ({
      wch: Math.max(key.length, 12)
    }));
    worksheet['!cols'] = max_widths;

    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `Test_Cases_${project?.key || 'Export'}_${dateStr}.xlsx`);
    toast.success(`Exported ${itemsToExport.length} test cases to Excel`);
  };

  const casesByModule = useMemo(() => {
    if (statusFilters.length > 0) return null;

    // Counts follow the current filters, and roll up descendants so a parent
    // badge matches the sum of the rows visible beneath it.
    const filteredDirectCount = (moduleId: string) =>
      filteredCases.filter((c: any) => c.moduleId === moduleId).length;
    const filteredSubtreeCount = (moduleId: string): number => {
      const children = modules.filter((m: any) => m.parentId === moduleId);
      return (
        filteredDirectCount(moduleId) +
        children.reduce((sum: number, child: any) => sum + filteredSubtreeCount(child.id), 0)
      );
    };


    if (selectedModule !== null) {
      if (selectedModule === 'no-module' || selectedModule === 'none') {
        const noModCases = filteredCases.filter((c: any) => !c.moduleId);
        return [{
          id: null,
          name: 'Without Module',
          directCases: noModCases,
          submodules: [],
          totalCasesCount: noModCases.length,
        }];
      }
      // If a parent module with submodules is selected, show parent and its submodules!
      const parentMod = modules.find((m: any) => m.id === selectedModule);
      if (parentMod) {
        const submodules = modules
          .filter((m: any) => m.parentId === parentMod.id)
          .map((sm: any) => ({
            id: sm.id,
            name: sm.name,
            parentId: parentMod.id,
            cases: filteredCases.filter((c: any) => c.moduleId === sm.id),
            totalCasesCount: filteredSubtreeCount(sm.id),
          }));

        if (submodules.length > 0 && selectedSubmodule === null) {
          const directCases = filteredCases.filter((c: any) => c.moduleId === parentMod.id);
          return [{
            id: parentMod.id,
            name: parentMod.name,
            directCases,
            submodules,
            totalCasesCount: filteredSubtreeCount(parentMod.id),
          }];
        }
      }
      return null;
    }

    // All Cases view: group by root modules and their child submodules
    const groups: any[] = [];
    rootModules.forEach((rootMod: any) => {
      const directCases = filteredCases.filter((c: any) => c.moduleId === rootMod.id);
      const submodules = modules
        .filter((m: any) => m.parentId === rootMod.id)
        .map((sm: any) => ({
          id: sm.id,
          name: sm.name,
          parentId: rootMod.id,
          cases: filteredCases.filter((c: any) => c.moduleId === sm.id),
          totalCasesCount: filteredSubtreeCount(sm.id),
        }));
      const totalCasesCount = filteredSubtreeCount(rootMod.id);

      if (totalCasesCount > 0 || submodules.length > 0) {
        groups.push({
          id: rootMod.id,
          name: rootMod.name,
          directCases,
          submodules,
          totalCasesCount,
        });
      }
    });

    const noModCases = filteredCases.filter((c: any) => !c.moduleId);
    if (noModCases.length > 0) {
      groups.unshift({
        id: null,
        name: 'Without Module',
        directCases: noModCases,
        submodules: [],
        totalCasesCount: noModCases.length,
      });
    }

    return groups;
  }, [statusFilters, selectedModule, selectedSubmodule, filteredCases, modules, rootModules]);

  const areAllCollapsed = Boolean(
    casesByModule &&
    casesByModule.length > 0 &&
    casesByModule.every((g) => collapsedModuleIds.has(g.id || 'no-module'))
  );

  const toggleAllModulesCollapse = () => {
    if (!casesByModule) return;
    if (areAllCollapsed) {
      setCollapsedModuleIds(new Set());
    } else {
      setCollapsedModuleIds(new Set(casesByModule.map((g) => g.id || 'no-module')));
    }
  };

  const handleCreateCaseFromModal = async () => {
    if (!newCaseForm.title.trim()) {
      toast.error('Title is required');
      return;
    }
    try {
      const cleanTags = newCaseForm.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
      const labels = newCaseForm.ticketKey.trim()
        ? [`ticket:${newCaseForm.ticketKey.trim().toUpperCase()}`, newCaseForm.ticketKey.trim().toUpperCase()]
        : [];

      const savedCase = await createTestCaseAction({
        projectId: project?.id || '',
        moduleId: newCaseForm.submoduleId || newCaseForm.moduleId || selectedSubmodule || selectedModule || null,
        title: newCaseForm.title.trim(),
        description: newCaseForm.description.trim() || undefined,
        steps: [],
        priority: newCaseForm.priority,
        type: 'manual',
        status: 'draft',
        tags: cleanTags,
        labels,
      });

      if (newCaseForm.suiteId) {
        try {
          await addCaseToSuiteAction(newCaseForm.suiteId, savedCase.id);
        } catch (suiteErr) {
          logger.error('Failed to link test case to suite', {
            component: 'RepositoryPage',
            action: 'addCaseToSuite',
            suiteId: newCaseForm.suiteId,
            caseId: savedCase.id,
            error: suiteErr,
          });
        }
      }

      const mappedCase = {
        id: savedCase.id,
        displayId: savedCase.display_id,
        projectId: savedCase.project_id,
        moduleId: savedCase.module_id,
        title: savedCase.title,
        description: savedCase.description,
        steps: savedCase.steps,
        priority: savedCase.priority,
        type: savedCase.type.toLowerCase(),
        status: savedCase.status.toLowerCase(),
        tags: savedCase.tags,
        labels: savedCase.labels,
        customFields: savedCase.custom_fields || {},
        custom_fields: savedCase.custom_fields || {},
        aiGenerated: savedCase.ai_generated,
        createdAt: savedCase.created_at.toISOString(),
      };
      setCases([...allCases, mappedCase]);
      setShowNewCaseModal(false);
      setNewCaseForm({ title: '', moduleId: '', submoduleId: '', suiteId: '', priority: 'P2', description: '', tags: [], ticketKey: '' });
      setTagInputText('');
      setIsTagInputFocused(false);
      setTicketSearchQuery('');
      setIsTicketInputFocused(false);
      toast.success('Test case created');
      setDetailViewType('sheet');
      handleOpenCase(savedCase.display_id, true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create test case');
    }
  };

  const handleQuickCreateCase = async (targetModuleId: string | null) => {
    if (!quickCaseTitle.trim()) return;
    setIsSubmittingQuick(true);
    try {
      const savedCase = await createTestCaseAction({
        projectId: project?.id || '',
        moduleId: targetModuleId || null,
        title: quickCaseTitle.trim(),
        steps: [],
        priority: 'P2',
        type: 'manual',
        status: 'draft',
        tags: [],
      });

      const mappedCase = {
        id: savedCase.id,
        displayId: savedCase.display_id,
        projectId: savedCase.project_id,
        moduleId: savedCase.module_id,
        title: savedCase.title,
        steps: savedCase.steps,
        priority: savedCase.priority,
        type: savedCase.type.toLowerCase(),
        status: savedCase.status.toLowerCase(),
        tags: savedCase.tags,
        customFields: (savedCase as any).custom_fields || {},
        custom_fields: (savedCase as any).custom_fields || {},
        aiGenerated: savedCase.ai_generated,
        createdAt: savedCase.created_at.toISOString(),
      };

      setCases([...allCases, mappedCase]);
      toast.success(`Created test case ${savedCase.display_id}`);
      setQuickCaseTitle('');
      setQuickCreateModuleId(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create test case');
    } finally {
      setIsSubmittingQuick(false);
    }
  };

  const handleCreateModule = async () => {
    const trimmed = moduleForm.trim();
    if (!trimmed) return;

    // Check for duplicate among siblings
    const isDuplicate = modules.some((m: any) =>
      (m.parentId || null) === (moduleParentId || null) &&
      m.name?.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) {
      toast.error(moduleParentId ? `Sub-module "${trimmed}" already exists in this module` : `Module "${trimmed}" already exists`);
      return;
    }

    try {
      const created = await createModuleAction({
        projectId: project?.id || '',
        name: trimmed,
        parentId: moduleParentId || null,
      });
      setModules([...modules, {
        id: created.id,
        projectId: created.projectId,
        name: created.name,
        parentId: created.parentId,
        orderIndex: created.orderIndex,
      }]);
      toast.success(moduleParentId ? 'Sub-module created' : 'Module created');
      setShowCreateModuleModal(false);
      setModuleForm('');
      setModuleParentId(null);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRenameModule = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const target = modules.find((m: any) => m.id === id);
    if (!target) return;
    if (target.name?.trim().toLowerCase() === trimmed.toLowerCase()) return;

    // Check for duplicate among siblings
    const isDuplicate = modules.some((m: any) =>
      m.id !== id &&
      (m.parentId || null) === (target.parentId || null) &&
      m.name?.trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (isDuplicate) {
      toast.error(target.parentId ? `Sub-module "${trimmed}" already exists in this module` : `Module "${trimmed}" already exists`);
      return;
    }

    try {
      const updated = await updateModuleAction(id, { name: trimmed });
      setModules(modules.map((m: any) => m.id === id ? { ...m, name: updated.name } : m));
      toast.success('Module renamed');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteModule = (id: string) => {
    const targetModule = modules.find((m: any) => m.id === id);
    const isSubmodule = !!targetModule?.parentId;
    const parentModule = isSubmodule
      ? modules.find((m: any) => m.id === targetModule?.parentId)
      : null;
    const childModules = modules.filter((m: any) => m.parentId === id);
    const caseCount = allCases.filter((c: any) => c.moduleId === id).length;
    const destination = isSubmodule && parentModule
      ? `"${parentModule.name}"`
      : 'No Module';

    const effects: string[] = [];
    if (childModules.length > 0) {
      effects.push(
        `${childModules.length} sub-module${childModules.length === 1 ? '' : 's'} will become top-level module${childModules.length === 1 ? '' : 's'}`
      );
    }
    if (caseCount > 0) {
      effects.push(
        `${caseCount} test case${caseCount === 1 ? '' : 's'} will be moved to ${destination}`
      );
    }

    setConfirmConfig({
      open: true,
      title: isSubmodule ? 'Delete Sub-module' : 'Delete Module',
      description: `Are you sure you want to delete ${
        isSubmodule ? 'sub-module' : 'module'
      } "${targetModule?.name || 'this module'}"?${
        effects.length ? ` ${effects.join(' · ')}.` : ''
      } Test cases are never deleted. This action cannot be undone.`,
      variant: 'destructive',
      requireTypedConfirmation: 'DELETE',
      onConfirm: async () => {
        try {
          const result = await deleteModuleAction(id);
          const fallbackId = result?.fallbackModuleId ?? null;

          setModules(
            modules
              .filter((m: any) => m.id !== id)
              .map((m: any) => (m.parentId === id ? { ...m, parentId: null } : m))
          );
          setCases(
            allCases.map((c: any) =>
              c.moduleId === id ? { ...c, moduleId: fallbackId } : c
            )
          );
          if (selectedModule === id) setSelectedModule(fallbackId);

          const moved = result?.movedCases ?? 0;
          const promoted = result?.promotedSubmodules ?? 0;
          toast.success(
            `Module deleted${
              moved > 0
                ? ` · ${moved} case${moved === 1 ? '' : 's'} moved to ${destination}`
                : ''
            }${promoted > 0 ? ` · ${promoted} sub-module${promoted === 1 ? '' : 's'} promoted` : ''}`
          );
        } catch (err: any) {
          toast.error(err.message);
        }
      }
    });
  };

  const handleReorderModule = async (id: string, dir: -1 | 1) => {
    const targetMod = modules.find((m: any) => m.id === id);
    if (!targetMod) return;

    // Find siblings sharing the same parent (either root or same submodule parent)
    const siblings = modules
      .filter((m: any) => (m.parentId || null) === (targetMod.parentId || null))
      .sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

    const idx = siblings.findIndex((m: any) => m.id === id);
    if (idx === -1) return;
    if ((dir === -1 && idx === 0) || (dir === 1 && idx === siblings.length - 1)) return;

    const newOrder = [...siblings];
    const target = idx + dir;
    [newOrder[idx], newOrder[target]] = [newOrder[target], newOrder[idx]];

    try {
      await reorderModulesAction(newOrder.map((m: any) => m.id));
      const reorderedIds = newOrder.map((m: any) => m.id);
      setModules(modules.map((m: any) => {
        const newIdx = reorderedIds.indexOf(m.id);
        return newIdx !== -1 ? { ...m, orderIndex: newIdx } : m;
      }));
      toast.success('Module reordered');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDragReorderModule = async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const draggedMod = modules.find((m: any) => m.id === draggedId);
    const targetMod = modules.find((m: any) => m.id === targetId);
    if (!draggedMod || !targetMod) return;

    // Only reorder among true siblings sharing same parent
    if ((draggedMod.parentId || null) !== (targetMod.parentId || null)) return;

    const siblings = modules
      .filter((m: any) => (m.parentId || null) === (draggedMod.parentId || null))
      .sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

    const fromIdx = siblings.findIndex((m: any) => m.id === draggedId);
    const toIdx = siblings.findIndex((m: any) => m.id === targetId);
    if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return;

    const newOrder = [...siblings];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);

    try {
      await reorderModulesAction(newOrder.map((m: any) => m.id));
      const reorderedIds = newOrder.map((m: any) => m.id);
      setModules(modules.map((m: any) => {
        const newIdx = reorderedIds.indexOf(m.id);
        return newIdx !== -1 ? { ...m, orderIndex: newIdx } : m;
      }));
      toast.success('Module reordered');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCreateCaseDirectly = async () => {
    try {
      const savedCase = await createTestCaseAction({
        projectId: project?.id || '',
        moduleId: selectedModule || null,
        title: 'New Test Case Draft',
        steps: [],
        priority: 'P2',
        type: 'manual',
        status: 'draft',
        tags: [],
      });
      const mappedCase = {
        id: savedCase.id,
        displayId: savedCase.display_id,
        projectId: savedCase.project_id,
        moduleId: savedCase.module_id,
        title: savedCase.title,
        steps: savedCase.steps,
        priority: savedCase.priority,
        type: savedCase.type.toLowerCase(),
        status: savedCase.status.toLowerCase(),
        tags: savedCase.tags,
        customFields: savedCase.custom_fields || {},
        custom_fields: savedCase.custom_fields || {},
        aiGenerated: savedCase.ai_generated,
        createdAt: savedCase.created_at.toISOString(),
      };
      setCases([...allCases, mappedCase]);
      toast.success('Test Case Draft created successfully');
      setDetailViewType('sheet');
      handleOpenCase(savedCase.display_id, true);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create test case');
    }
  };

  const columns = useMemo(() => [
    {
      id: 'displayId',
      header: 'ID',
      className: 'w-[88px] pl-1 pr-2 shrink-0 max-sm:sticky max-sm:left-[46px] max-sm:z-[1] max-sm:bg-card',
      accessor: (row: any) => (
        <a
          href={`/p/${slug}/repository/${row.displayId}`}
          onClick={(e) => {
            if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
              e.preventDefault();
              e.stopPropagation();
              handleOpenCase(row.displayId);
            }
          }}
          className="text-xs text-foreground/75 dark:text-muted-foreground font-mono whitespace-nowrap group-hover:text-primary transition-colors cursor-pointer font-medium"
        >
          {row.displayId}
        </a>
      ),
      sortable: true,
      sortValue: (row: any) => row.displayId || '',
    },
    {
      id: 'title',
      header: 'Title',
      className: 'w-full min-w-[160px] sm:min-w-[280px] pl-2 pr-4',
      sortValue: (row: any) => (row.title || '').toLowerCase(),
      accessor: (row: any) => {
        const normStatus = (row.status || '').toLowerCase();
        const normReview = (row.reviewStatus || '').toLowerCase();
        const isDraft = normStatus === 'draft';
        const isDeprecated = normStatus === 'deprecated';
        const isInReview = normReview === 'pending';
        const isChangesReq = normReview === 'changes_requested';

        return (
          <div className="flex items-center gap-2 min-w-0 max-w-full">
            <a
              href={`/p/${slug}/repository/${row.displayId}`}
              onClick={(e) => {
                if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
                  e.preventDefault();
                  e.stopPropagation();
                  handleOpenCase(row.displayId);
                }
              }}
              title={row.title}
              className={cn(
                "font-medium text-left group-hover:text-primary transition-colors cursor-pointer truncate text-foreground/95",
                isDeprecated && "line-through text-muted-foreground/60"
              )}
            >
              {row.title}
            </a>

            {/* Sparkles icon right beside the title */}
            {row.aiGenerated && (
              <span title="Generated with AI" className="text-violet-600 dark:text-violet-400/90 hover:text-violet-500 transition-colors shrink-0 inline-flex items-center">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
            )}

            {/* Inline exception badges: only shown when not default Active */}
            {isInReview && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/25 shrink-0">
                <span className="h-1 w-1 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                In Review
              </span>
            )}
            {isChangesReq && (
              <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.2 rounded bg-amber-500/12 text-amber-700 dark:text-amber-400 border border-amber-500/30 shrink-0">
                Changes Req.
              </span>
            )}
            {isDraft && !isInReview && !isChangesReq && (
              <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.2 rounded bg-muted/70 text-foreground/75 dark:text-muted-foreground border border-border/60 shrink-0">
                Draft
              </span>
            )}
            {isDeprecated && (
              <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.2 rounded bg-zinc-500/12 text-zinc-600 dark:text-zinc-400 border border-zinc-500/25 shrink-0">
                Deprecated
              </span>
            )}
          </div>
        );
      },
      sortable: true,
    },
    {
      id: 'priority',
      header: 'Priority',
      className: 'max-[768px]:hidden w-[104px] shrink-0 text-center',
      accessor: (row: any) => (
        <div className="flex items-center justify-center">
          <PriorityBadge priority={row.priority} />
        </div>
      ),
      sortable: true,
      sortValue: (row: any) => row.priority || '',
    },
    {
      id: 'type',
      header: 'Mode',
      className: 'max-[1199px]:hidden w-[116px] shrink-0 text-center',
      accessor: (row: any) => {
        const isAuto = (row.type || '').toLowerCase() === 'automated' || (row.type || '').toLowerCase() === 'auto';
        const source = getCaseAutomationSource(row);
        const sourceLabel =
          source === 'postman'
            ? 'Automated · Postman'
            : source === 'datadog'
            ? 'Automated · Datadog'
            : source === 'external'
            ? 'Automated · External (not integrated)'
            : 'Manual';
        const label = isAuto ? 'Automated' : 'Manual';
        return (
          <div className="inline-flex items-center justify-center gap-1.5 text-xs text-foreground/80 dark:text-muted-foreground font-medium">
            {/* On < xl (when label is hidden), show icon with portal Tooltip */}
            <span className="xl:hidden">
              <Tooltip content={sourceLabel} side="top">
                <span className="p-1 rounded-md hover:bg-muted/60 transition-colors inline-flex items-center justify-center cursor-pointer">
                  {isAuto ? (
                    <CaseSourceIcon testCase={row} />
                  ) : (
                    <User className="h-3.5 w-3.5 text-foreground/65 dark:text-muted-foreground/80 shrink-0" />
                  )}
                </span>
              </Tooltip>
            </span>

            {/* On >= xl (when label is visible), show icon + label */}
            <span className="hidden xl:inline-flex items-center gap-1.5" title={sourceLabel}>
              {isAuto ? (
                <CaseSourceIcon testCase={row} />
              ) : (
                <User className="h-3.5 w-3.5 text-foreground/65 dark:text-muted-foreground/80 shrink-0" />
              )}
              <span className="capitalize">{label}</span>
            </span>
          </div>
        );
      },
      sortable: true,
      sortValue: (row: any) => (row.type || '').toLowerCase(),
    },
  ], [slug, allCases, archivedCases]);

  const archivedColumns = useMemo(() => [
    {
      id: 'displayId',
      header: 'ID',
      className: 'w-[88px] shrink-0',
      accessor: (row: any) => (
        <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">{row.displayId}</span>
      ),
      sortable: true,
    },
    {
      id: 'title',
      header: 'Title',
      className: 'w-full xl:w-[70%] min-w-[340px]',
      accessor: (row: any) => (
        <div className="flex items-center gap-2 min-w-0 max-w-full">
          <span className="font-medium truncate text-foreground/90" title={row.title}>{row.title}</span>
          {row.aiGenerated && (
            <span title="Generated with AI" className="text-violet-400/90 shrink-0 inline-flex items-center">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
      ),
      sortable: true,
    },
    {
      id: 'priority',
      header: 'Priority',
      className: 'max-[768px]:hidden w-16 xl:w-[15%] shrink-0 text-center',
      accessor: (row: any) => (
        <div className="flex items-center justify-center">
          <PriorityBadge priority={row.priority} />
        </div>
      ),
      sortable: true,
      sortValue: (row: any) => row.priority || '',
    },
    {
      id: 'archivedAt',
      header: 'Archived',
      className: 'w-32 xl:w-[15%] shrink-0 text-center',
      accessor: (row: any) => {
        const stamp = row.archivedAt || row.updatedAt;
        const byName =
          row.archivedByName ||
          (row.archivedBy
            ? members?.find(
                (m: any) => String(m.userId) === String(row.archivedBy) || String(m.user?.id) === String(row.archivedBy)
              )?.user?.name
            : null);
        return (
          <span className="inline-flex flex-col items-center leading-tight">
            <span className="text-xs text-muted-foreground">
              {stamp ? new Date(stamp).toLocaleDateString() : '-'}
            </span>
            {byName && <span className="text-[10px] text-muted-foreground/70">{byName}</span>}
          </span>
        );
      },
      sortable: true,
    },
    {
      id: 'actions',
      header: '',
      className: 'w-[90px] shrink-0 text-right',
      accessor: (row: any) => (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs font-medium gap-1.5 border-border/60 hover:bg-muted cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            handleRestoreCase(row.id);
          }}
        >
          <RotateCcw className="h-3 w-3" />
          <span>Restore</span>
        </Button>
      ),
    },
  ], [archivedCases, members]);


  const filterPanelHeader = (
    <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/40">
      <h4 className="font-semibold text-foreground text-xs">Filter Test Cases</h4>
      <div className="flex items-center gap-1.5">
        {/* Reset Button */}
        <button
          type="button"
          onClick={clearAllFilters}
          title="Reset all filters"
          className="h-6.5 px-2 rounded-md border border-border/60 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex items-center gap-1 cursor-pointer"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset</span>
        </button>

        {/* Lock Button */}
        <button
          type="button"
          onClick={() => setIsFilterLocked(!isFilterLocked)}
          title={isFilterLocked ? "Unlock filters" : "Lock filters"}
          className={cn(
            "h-6.5 px-2 rounded-md border transition-all cursor-pointer flex items-center gap-1 text-[11px] font-medium",
            isFilterLocked
              ? "bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400 font-semibold"
              : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50"
          )}
        >
          {isFilterLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
          <span>{isFilterLocked ? "Locked" : "Lock"}</span>
        </button>

        {/* Close Button */}
        <button
          type="button"
          onClick={() => setShowFilterPopover(false)}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer ml-0.5"
          aria-label="Close filters"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  const filterPanelBody = (
    <div className="px-3.5 py-3 grid grid-cols-[96px_1fr] items-center gap-y-3">
      {/* Priority */}
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Priority</label>
      <div className="flex items-center gap-1 flex-wrap">
        <button
          type="button"
          onClick={() => setPriorityFilters([])}
          className={cn(
            "h-6 px-2 rounded-md text-[10.5px] font-medium transition-colors cursor-pointer border",
            priorityFilters.length === 0
              ? "bg-primary/15 border-primary/50 text-primary font-semibold"
              : "bg-background border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40"
          )}
        >
          All
        </button>
        {['P0', 'P1', 'P2', 'P3'].map((p) => {
          const active = priorityFilters.includes(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => togglePriorityFilter(p)}
              className={cn(
                "h-6 px-2 rounded-md text-[10.5px] font-medium transition-colors cursor-pointer border",
                active
                  ? "bg-primary/15 border-primary/50 text-primary font-semibold"
                  : "bg-background border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
            >
              {p}
            </button>
          );
        })}
      </div>

      {/* Mode */}
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Mode</label>
      <AutomationFilter
        mode={typeFilter}
        source={sourceFilter}
        counts={automationCounts}
        onChange={({ mode, source }) => { setTypeFilter(mode); setSourceFilter(source); }}
        hideAllChip
      />

      {/* Author */}
      {members && members.length > 0 && (
        <>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Author</label>
          <div className="relative w-full">
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  toggleAuthorFilter(e.target.value);
                  e.target.value = "";
                }
              }}
              className="h-8 w-full appearance-none rounded-lg border border-border/60 bg-background pl-2.5 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value="">+ Add author...</option>
              {members.map((m: any) => (
                <option key={m.userId} value={String(m.userId)}>
                  {m.user?.name || m.user?.email || `User #${m.userId}`}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </div>
        </>
      )}

      {/* Tags */}
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tags</label>
      <div className="relative w-full">
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) {
              toggleTagFilter(e.target.value);
              e.target.value = "";
            }
          }}
          className="h-8 w-full appearance-none rounded-lg border border-border/60 bg-background pl-2.5 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
        >
          <option value="">+ Add tag ({allUniqueTags.length})...</option>
          {allUniqueTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </div>

      {/* Ticket */}
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ticket</label>
      <Input placeholder="e.g. PROJ-123" value={ticketKeyFilter} onChange={(e) => setTicketKeyFilter(e.target.value)} className="h-8 text-xs" />

      {/* Date */}
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground self-start pt-2">Date</label>
      <div className="flex flex-col gap-2">
        <div className="flex items-center rounded-md border border-border/60 overflow-hidden w-fit">
          <button type="button" onClick={() => setDateFilterField('updated')} className={cn("px-2.5 py-0.5 text-[10px] font-medium transition-colors cursor-pointer", dateFilterField === 'updated' ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-muted/40")}>Updated</button>
          <button type="button" onClick={() => setDateFilterField('created')} className={cn("px-2.5 py-0.5 text-[10px] font-medium transition-colors cursor-pointer border-l border-border/60", dateFilterField === 'created' ? "bg-primary/15 text-primary font-semibold" : "text-muted-foreground hover:bg-muted/40")}>Created</button>
        </div>
        <div className="relative w-full">
          <select value={dateFilterField === 'updated' ? updatedPreset : createdPreset} onChange={(e) => { if (dateFilterField === 'updated') handleApplyUpdatedPreset(e.target.value); else handleApplyCreatedPreset(e.target.value); }} className="h-8 w-full appearance-none rounded-lg border border-border/60 bg-background pl-2.5 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer">
            <option value="all">Any</option>
            <option value="today">Today</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
            <option value="custom">Custom</option>
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </div>
        {(dateFilterField === 'updated' ? updatedPreset : createdPreset) === 'custom' && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">From</label>
              <input type="date" value={dateFilterField === 'updated' ? updatedFrom : createdFrom} onChange={(e) => { if (dateFilterField === 'updated') { setUpdatedFrom(e.target.value); setUpdatedPreset('custom'); } else { setCreatedFrom(e.target.value); setCreatedPreset('custom'); } }} className="h-8 px-2 text-xs rounded-lg border border-border/60 bg-background focus:outline-none focus:ring-1 focus:ring-primary w-full" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">To</label>
              <input type="date" value={dateFilterField === 'updated' ? updatedTo : createdTo} onChange={(e) => { if (dateFilterField === 'updated') { setUpdatedTo(e.target.value); setUpdatedPreset('custom'); } else { setCreatedTo(e.target.value); setCreatedPreset('custom'); } }} className="h-8 px-2 text-xs rounded-lg border border-border/60 bg-background focus:outline-none focus:ring-1 focus:ring-primary w-full" />
            </div>
          </div>
        )}
      </div>

      {/* Dynamically Added Filters */}
      {visibleFilterKeys.map((key) => {
        if (key === 'review_status') {
          return (
            <Fragment key={key}>
              <div className="flex items-center justify-between gap-1 pr-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate" title="Review">Review</label>
                <button
                  type="button"
                  onClick={() => {
                    setVisibleFilterKeys((prev) => prev.filter((k) => k !== key));
                    setReviewStatusFilter('');
                  }}
                  className="text-muted-foreground hover:text-destructive cursor-pointer p-0.5"
                  title="Remove filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="relative w-full">
                <select
                  value={reviewStatusFilter}
                  onChange={(e) => setReviewStatusFilter(e.target.value)}
                  className="h-8 w-full appearance-none rounded-lg border border-border/60 bg-background pl-2.5 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="">Any</option>
                  <option value="approved">Approved</option>
                  <option value="pending">In Review</option>
                  <option value="changes_requested">Changes Requested</option>
                  <option value="unreviewed">Draft / Unreviewed</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </div>
            </Fragment>
          );
        }

        if (key === 'scenario') {
          return (
            <Fragment key={key}>
              <div className="flex items-center justify-between gap-1 pr-1">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate" title="Scenario">Scenario</label>
                <button
                  type="button"
                  onClick={() => {
                    setVisibleFilterKeys((prev) => prev.filter((k) => k !== key));
                    setScenarioFilter('');
                  }}
                  className="text-muted-foreground hover:text-destructive cursor-pointer p-0.5"
                  title="Remove filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="relative w-full">
                <select
                  value={scenarioFilter}
                  onChange={(e) => setScenarioFilter(e.target.value)}
                  className="h-8 w-full appearance-none rounded-lg border border-border/60 bg-background pl-2.5 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="">Any</option>
                  <option value="positive">Positive</option>
                  <option value="negative">Negative</option>
                  <option value="edge_case">Edge Case</option>
                  <option value="destructive">Destructive</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </div>
            </Fragment>
          );
        }

        const def = (customFieldDefs || []).find((d: any) => d.key === key);
        if (!def) return null;

        const hasOptions = Array.isArray(def.options) && def.options.length > 0;

        return (
          <Fragment key={key}>
            <div className="flex items-center justify-between gap-1 pr-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate" title={def.name}>
                {def.name}
              </label>
              <button
                type="button"
                onClick={() => {
                  setVisibleFilterKeys((prev) => prev.filter((k) => k !== key));
                  setCustomFieldFilters((prev) => {
                    const next = { ...prev };
                    delete next[key];
                    return next;
                  });
                }}
                className="text-muted-foreground hover:text-destructive cursor-pointer p-0.5"
                title="Remove filter"
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {hasOptions ? (
              <div className="relative w-full">
                <select
                  value={customFieldFilters[def.key] || ''}
                  onChange={(e) =>
                    setCustomFieldFilters((prev) => ({ ...prev, [def.key]: e.target.value }))
                  }
                  className="h-8 w-full appearance-none rounded-lg border border-border/60 bg-background pl-2.5 pr-8 text-xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="">Any</option>
                  {def.options.map((opt: string) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none h-3.5 w-3.5 text-muted-foreground shrink-0" />
              </div>
            ) : (
              <Input
                placeholder={`Filter by ${def.name}`}
                value={customFieldFilters[def.key] || ''}
                onChange={(e) =>
                  setCustomFieldFilters((prev) => ({ ...prev, [def.key]: e.target.value }))
                }
                className="h-8 text-xs"
              />
            )}
          </Fragment>
        );
      })}

      {/* Add Filter Action */}
      {availableExtraFilters.length > 0 && (
        <div className="col-span-2 pt-1 border-t border-border/40 flex items-center justify-between">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] font-medium text-primary hover:text-primary hover:bg-primary/10 cursor-pointer gap-1 px-2"
              >
                <Plus className="h-3 w-3" />
                <span>Add Filter</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48 z-[100] max-h-56 overflow-y-auto">
              {availableExtraFilters.map((filter) => (
                <DropdownMenuItem
                  key={filter.key}
                  onSelect={() => setVisibleFilterKeys((prev) => [...prev, filter.key])}
                  className="text-xs cursor-pointer flex items-center justify-between"
                >
                  <span className="truncate">{filter.label}</span>
                  <Plus className="h-3 w-3 opacity-50 shrink-0 ml-1" />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );

  const filterPanelFooter = (
    <div className="px-4 py-3 border-t border-border/40 flex items-center justify-between">
      <span className="text-[11px] text-muted-foreground">Showing {filteredCases.length} matching cases</span>
      <div className="flex items-center gap-2">
        {activeFiltersCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={clearAllFilters}
          >
            Clear all
          </Button>
        )}
        <Button
          size="sm"
          className="h-8 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs cursor-pointer"
          onClick={() => setShowFilterPopover(false)}
        >
          Done
        </Button>
      </div>
    </div>
  );


  const moduleTreeBody = (
    <div className="p-2 pb-24">
              <button
                onClick={() => setSelectedModule(null)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (!isAllCasesDragOver) setIsAllCasesDragOver(true);
                }}
                onDragLeave={() => setIsAllCasesDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsAllCasesDragOver(false);
                  try {
                    const raw = e.dataTransfer.getData('application/json');
                    if (raw) {
                      const parsed = JSON.parse(raw);
                      if (parsed?.caseIds) {
                        handleMoveCasesToModule(parsed.caseIds, null);
                      }
                    }
                  } catch {}
                }}
                className={cn(
                  "w-full text-left px-3 py-2 rounded-xl text-sm flex items-center justify-between transition-colors cursor-pointer mb-2",
                  isAllCasesDragOver && "ring-2 ring-inset ring-primary bg-primary/15 text-primary",
                  !isAllCasesDragOver && selectedModule === null
                    ? "bg-primary/10 text-primary font-semibold border-l-2 border-primary shadow-2xs"
                    : !isAllCasesDragOver && "hover:bg-muted text-foreground/80"
                )}
              >
                <span className="text-left font-medium">All Cases</span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground font-semibold">
                  {allCases.length}
                </span>
              </button>

              <div className="h-px bg-border/40 mx-1 mb-1.5" />

              {/* Without Module (Aligned with ModuleItem rows inside the module list) */}
              {noModuleCasesCount > 0 && (
                <div
                  onClick={() => { setSelectedModule('no-module'); setSelectedSubmodule(null); }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (!isNoModuleDragOver) setIsNoModuleDragOver(true);
                  }}
                  onDragLeave={() => setIsNoModuleDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsNoModuleDragOver(false);
                    try {
                      const raw = e.dataTransfer.getData('application/json');
                      if (raw) {
                        const parsed = JSON.parse(raw);
                        if (parsed?.caseIds) {
                          handleMoveCasesToModule(parsed.caseIds, null);
                        }
                      }
                    } catch {}
                  }}
                  className={cn(
                    "group flex items-center h-8 min-h-[32px] max-h-[32px] px-2 rounded-xl cursor-pointer text-xs transition-colors relative overflow-hidden",
                    isNoModuleDragOver && "ring-1 ring-inset ring-primary bg-primary/10 text-primary",
                    !isNoModuleDragOver && selectedModule === 'no-module'
                      ? "bg-primary/10 text-primary font-semibold border-l-2 border-primary shadow-2xs"
                      : !isNoModuleDragOver && "hover:bg-primary/[0.09] dark:hover:bg-white/[0.07] text-foreground/85 hover:text-foreground"
                  )}
                >
                  {canEdit && <span className="w-3.5 h-3.5 shrink-0" />}
                  <span className="w-4 h-4 shrink-0" />
                  <div className="flex-1 flex items-center gap-1.5 text-left min-w-0 pr-2">
                    <Folder className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
                    <TruncatedText text="Without Module" className="font-medium text-xs text-foreground/90 flex-1 min-w-0" />
                    <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-muted/60 text-muted-foreground font-medium shrink-0 ml-auto">
                      {noModuleCasesCount}
                    </span>
                  </div>
                </div>
              )}

              {(() => {
                return rootModules.map((module: any, i: number) => (
                  <ModuleItem
                    key={module.id}
                    module={module}
                    childModules={getChildModules(module.id)}
                    allModules={modules}
                    selectedModule={selectedModule}
                    onSelect={(id) => { setSelectedModule(id); setSelectedSubmodule(null); }}
                    getCaseCount={moduleTotalCount}
                    onRename={handleRenameModule}
                    onDelete={handleDeleteModule}
                    onReorder={handleReorderModule}
                    onDragReorder={handleDragReorderModule}
                    onAddSubmodule={(parentId) => {
                      setModuleParentId(parentId);
                      setShowCreateModuleModal(true);
                    }}
                    onMoveCases={handleMoveCasesToModule}
                    index={i}
                    total={rootModules.length}
                    readOnly={!canEdit}
                  />
                ));
              })()}
    </div>
  );
  return (
    <div className="flex">
      {/* Module Tree - Desktop */}
      <aside className={cn(
        "module-sidebar-scroll sticky top-14 self-start shrink-0 border-r bg-surface h-[calc(100vh-56px)] overflow-y-auto overflow-x-hidden hidden md:block transition-all duration-300 z-20",
        modulesCollapsed ? "w-[56px]" : "w-56 xl:w-60"
      )}>
        <div className={cn(
          "border-b flex items-center h-14",
          modulesCollapsed ? "justify-center px-2" : "justify-between px-3"
        )}>
          {modulesCollapsed ? (
            <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">MODULES</span>
          ) : (
            <h3 className="font-medium text-sm">Modules</h3>
          )}
          {!modulesCollapsed && (
            <div className="flex items-center gap-1.5 ml-auto">
              {canEdit && (
                <button
                  onClick={() => setShowCreateModuleModal(true)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mr-1 cursor-pointer"
                  title="Create Module"
                >
                  <Plus className="h-3.5 w-3.5" /> Module
                </button>
              )}
              <button
                onClick={() => setModulesCollapsed(!modulesCollapsed)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-teal-500 hover:bg-[#E6F3F0] transition-colors cursor-pointer"
                aria-label={modulesCollapsed ? "Expand Modules" : "Collapse Modules"}
                title={modulesCollapsed ? "Expand Modules" : "Collapse Modules"}
              >
                {modulesCollapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.5} /> : <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.5} />}
              </button>
            </div>
          )}
        </div>
        {modulesCollapsed && (
          <div className="flex justify-center mt-3 mb-1">
            <button
              onClick={() => setModulesCollapsed(false)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-teal-500 hover:bg-[#E6F3F0] transition-colors cursor-pointer"
              aria-label="Expand Modules"
              title="Expand Modules"
            >
              <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.5} />
            </button>
          </div>
        )}

        {!modulesCollapsed && moduleTreeBody}
        {modulesCollapsed && (
          <div className="p-1 space-y-1 flex flex-col items-center pt-2 min-h-full">
            <Tooltip content={`All Cases (${allCases.length})`} side="right" delay={0}>
              <button
                onClick={() => setSelectedModule(null)}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 h-12 w-10 shrink-0 rounded-xl transition-colors cursor-pointer group",
                  selectedModule === null ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="text-[9px] font-semibold truncate leading-none text-center uppercase tracking-tighter">ALL</span>
                
              </button>
            </Tooltip>
            <div className="w-5 h-px bg-border/40 mx-0.5 my-0.5" />
            {noModuleCasesCount > 0 && (
              <Tooltip content={`Without Module (${noModuleCasesCount})`} side="right" delay={0}>
                <button
                  onClick={() => { setSelectedModule('no-module'); setSelectedSubmodule(null); }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 h-12 w-10 shrink-0 rounded-xl transition-colors cursor-pointer group relative",
                    selectedModule === 'no-module' ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Folder className="h-4 w-4 shrink-0" />
                  <span className="text-[9px] font-semibold truncate leading-none text-center uppercase tracking-tighter">No Mod</span>
                  {selectedModule === 'no-module' && (
                    <span className="absolute top-0 right-0 w-1 h-4 rounded-r bg-primary" />
                  )}
                </button>
              </Tooltip>
            )}
            {rootModules.map((m: any) => {
              const isSelected = selectedModule === m.id;
              const totalCount = moduleTotalCount(m.id);
              return (
                <Tooltip key={m.id} content={`${m.name} (${totalCount})`} side="right" delay={0}>
                  <button
                    onClick={() => setSelectedModule(m.id)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-1 h-12 w-10 shrink-0 rounded-xl transition-colors cursor-pointer group relative",
                      isSelected ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Folder className="h-4 w-4 shrink-0" />
                    <span className="text-[9px] font-semibold truncate leading-none text-center uppercase tracking-tighter">{m.name.slice(0,4).toUpperCase()}</span>
                    
                  </button>
                </Tooltip>
              );
            })}
          </div>
        )}
      </aside>

      {/* Case List */}
      <main className="min-w-0 flex-1 p-4 md:p-6 max-w-[1536px]">
        {/* Status tabs */}
        <div className="flex items-center gap-1 mb-4 border-b border-border/50 overflow-x-auto scrollbar-none">
          {[
            { value: '', label: 'All', count: allCases.length },
            { value: 'active', label: 'Active', count: allCases.filter((c) => c.status === 'active').length },
            { value: 'draft', label: 'Draft', count: allCases.filter((c) => c.status === 'draft').length },
            { value: 'deprecated', label: 'Deprecated', count: allCases.filter((c) => c.status === 'deprecated').length, hideIfZero: true },
            { value: 'archived', label: 'Archived', count: archivedCases.length, hideIfZero: true },
          ]
            .filter((tab) => !tab.hideIfZero || tab.count > 0 || statusFilters.includes(tab.value))
            .map((tab) => {
              const active = tab.value === '' ? statusFilters.length === 0 : statusFilters.includes(tab.value);
              return (
                <button
                  key={tab.value}
                  onClick={() => {
                    setSelectedCaseIds(new Set());
                    if (tab.value === '') {
                      setStatusFilters([]);
                    } else {
                      if (tab.value === 'archived') fetchArchivedCases();
                      setStatusFilters([tab.value]);
                    }
                  }}
                  className={cn(
                    'px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 shrink-0',
                    active
                      ? 'border-primary text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className={cn(
                      "text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium",
                      active
                        ? "bg-primary/15 text-primary font-bold"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
        </div>

        {/* Toolbar: Search, Filters, View Controls, and CTAs */}
        <div className="mb-3 flex items-center justify-between gap-2.5 flex-wrap">
          {/* Left: Mobile Toggle, Search & Dedicated Filters Button */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Button
              variant="outline"
              size="icon"
              className="md:hidden shrink-0 h-9 w-9 p-0"
              onClick={() => setMobileOpen(true)}
              title="Open Navigation & Modules"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="md:hidden shrink-0 h-9 w-9 p-0"
              onClick={() => setModulesSheetOpen(true)}
              title="Browse modules"
              aria-label="Browse modules"
            >
              <Folder className="h-4 w-4" />
            </Button>

            <div className="relative flex-1 min-w-[140px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search cases..."
                className="pl-9 h-9 text-xs"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Dedicated Filters Button with Popover */}
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilterPopover(!showFilterPopover)}
                aria-label={activeFiltersCount > 0 ? `Filters · ${activeFiltersCount}` : 'Filters'}
                title="Filters"
                className={cn(
                  "h-9 px-2.5 min-[1200px]:px-3 text-xs font-medium border-border/60 transition-colors cursor-pointer flex items-center gap-1.5",
                  activeFiltersCount > 0 ? "border-primary/50 bg-primary/10 text-primary" : "hover:bg-muted"
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span className="hidden min-[1200px]:inline">Filters</span>
                {isFilterLocked && (
                  <Lock className="h-3 w-3 -ml-0.5 text-amber-500" aria-label="Filters locked" />
                )}
                {activeFiltersCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full bg-primary text-primary-foreground font-mono font-bold text-[10px]">
                    {activeFiltersCount}
                  </span>
                )}
              </Button>

              {/* Filter Popover Dropdown */}
              {showFilterPopover && (
                <>
                  {/* Desktop/tablet popover anchored under the Filters button (>= 480px) */}
                  <div className="hidden min-[480px]:flex flex-col absolute left-0 top-full mt-2 z-50 w-[460px] max-w-[calc(100vw-32px)] bg-popover/95 backdrop-blur-xl border border-border/80 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150 max-h-[calc(100vh-140px)]">
                    {filterPanelHeader}
                    <div className="flex-1 overflow-y-auto">{filterPanelBody}</div>
                    {filterPanelFooter}
                  </div>

                  {/* Mobile bottom sheet (< 480px) */}
                  <div className="hidden max-[479px]:fixed max-[479px]:inset-0 z-40" onClick={() => setShowFilterPopover(false)} />
                  <div className="hidden max-[479px]:fixed max-[479px]:inset-x-0 max-[479px]:bottom-0 z-50 max-[479px]:bg-popover max-[479px]:border-t max-[479px]:border-border/80 max-[479px]:rounded-t-2xl max-[479px]:shadow-2xl flex flex-col max-h-[calc(100vh-140px)]">
                    {filterPanelHeader}
                    <div className="flex-1 overflow-y-auto">{filterPanelBody}</div>
                    {filterPanelFooter}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Right: Unified View Controls + Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Hierarchy Expand/Collapse All Modules Icon Button */}
            {casesByModule && casesByModule.length > 0 && (
              <Tooltip content={areAllCollapsed ? "Expand all modules" : "Collapse all modules"} side="bottom">
                <button
                  type="button"
                  onClick={toggleAllModulesCollapse}
                  className={cn(
                    "h-9 w-9 rounded-xl border border-border/60 flex items-center justify-center transition-all cursor-pointer text-muted-foreground hover:text-foreground hover:bg-muted/50 shrink-0",
                    areAllCollapsed && "bg-primary/10 text-primary border-primary/30"
                  )}
                  aria-label={areAllCollapsed ? "Expand all modules" : "Collapse all modules"}
                >
                  <ChevronsUpDown className="h-4 w-4" />
                </button>
              </Tooltip>
            )}

            <Tooltip content="Export Test Cases to Excel (.xlsx)" side="bottom">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                className="h-9 w-9 p-0 text-muted-foreground hover:text-foreground cursor-pointer shrink-0 rounded-xl border-border/60"
                aria-label="Export Cases"
              >
                <ArrowUpFromLine className="h-4 w-4" />
              </Button>
            </Tooltip>

            {project.aiEnabled && canEdit && (
              <AiButton
                onClick={() => {
                  setGenerateSourceMode('prompt');
                  setShowGenerateModal(true);
                }}
                size="sm"
                aria-label="Generate test cases with AI"
                title="Generate with AI"
                className="h-9 text-xs font-semibold px-3 min-[1200px]:px-3.5 shadow-xs cursor-pointer rounded-xl"
              >
                <span className="hidden min-[1200px]:inline">Generate with AI</span>
              </AiButton>
            )}



            {/* New Case with Seamless Dropdown */}
            {canEdit && (
            <div
              className="relative inline-flex items-center z-30"
              ref={newCaseDropdownRef}
              onMouseEnter={() => {
                if (newCaseHoverCloseRef.current) {
                  clearTimeout(newCaseHoverCloseRef.current);
                  newCaseHoverCloseRef.current = null;
                }
              }}
              onMouseLeave={scheduleCloseNewCaseDropdown}
            >
              <div className="inline-flex items-center overflow-hidden gradient-btn text-white h-9 rounded-xl shadow-lg shadow-black/15 dark:shadow-black/50 hover:shadow-black/25 dark:hover:shadow-black/60 transition-all duration-150">
                {/* Main Action: New Case */}
                <button
                  type="button"
                  onClick={() => {
                    setNewCaseForm({
                      title: '',
                      moduleId: '',
                      submoduleId: '',
                      suiteId: '',
                      priority: 'P2',
                      description: '',
                      tags: [],
                      ticketKey: '',
                    });
                    setTagInputText('');
                    setTicketSearchQuery('');
                    setShowNewCaseModal(true);
                  }}
                  className="inline-flex items-center pl-3.5 pr-1.5 h-full text-xs font-semibold text-white hover:bg-black/10 transition-colors cursor-pointer select-none"
                >
                  <Plus className="h-4 w-4 mr-1.5" />
                  <span>New Case</span>
                </button>

                {/* Dropdown Chevron Trigger — Seamless, no divider */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowNewCaseDropdown((prev) => !prev);
                  }}
                  onMouseEnter={openNewCaseDropdown}
                  className="inline-flex items-center justify-center pl-1 pr-2.5 h-full text-white hover:bg-black/10 transition-colors cursor-pointer"
                  title="More options"
                >
                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", showNewCaseDropdown && "rotate-180")} />
                </button>
              </div>

              {/* Standalone Dialed-In Floating Dropdown Panel */}
              {showNewCaseDropdown && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-full right-0 min-w-[205px] mt-[6px] z-50 bg-popover/95 dark:bg-[#0a1217]/95 backdrop-blur-xl border border-teal-700/20 dark:border-teal-400/25 rounded-xl shadow-xl shadow-black/15 dark:shadow-black/50 p-1 flex flex-col gap-0.5 animate-in fade-in-0 zoom-in-95 duration-100"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewCaseDropdown(false);
                      setShowImportModal(true);
                    }}
                    className="w-full inline-flex items-center justify-start px-2.5 py-2 rounded-lg font-medium text-xs text-foreground hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer select-none whitespace-nowrap group"
                  >
                    <ArrowDownToLine className="w-3.5 h-3.5 mr-2 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                    <span>Import Cases (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewCaseDropdown(false);
                      setGenerateSourceMode('postman');
                      setShowGenerateModal(true);
                    }}
                    className="w-full inline-flex items-center justify-start px-2.5 py-2 rounded-lg font-medium text-xs text-foreground hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer select-none whitespace-nowrap group"
                  >
                    <PostmanLogo className="w-3.5 h-3.5 mr-2 shrink-0" />
                    <span>From Postman Collection</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewCaseDropdown(false);
                      setGenerateSourceMode('datadog');
                      setShowGenerateModal(true);
                    }}
                    className="w-full inline-flex items-center justify-start px-2.5 py-2 rounded-lg font-medium text-xs text-foreground hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer select-none whitespace-nowrap group"
                  >
                    <DatadogLogo className="w-3.5 h-3.5 mr-2 shrink-0" />
                    <span>From Datadog Synthetics</span>
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        </div>

        {/* Sub-modules Filter Bar (Shown when selected module has sub-modules) */}
        {selectedModule && modules.filter((m: any) => m.parentId === selectedModule).length > 0 && (
          <div className="flex items-center gap-2 mb-3 p-2 px-3 rounded-xl bg-muted/30 border border-border/40 text-xs flex-wrap">
            <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5 mr-1">
              <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
              Sub-modules in {modules.find((m: any) => m.id === selectedModule)?.name}:
            </span>
            <button
              type="button"
              onClick={() => setSelectedSubmodule(null)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer border",
                selectedSubmodule === null
                  ? "bg-primary text-primary-foreground font-semibold shadow-xs border-primary"
                  : "bg-muted/40 text-muted-foreground border-border/40 hover:text-foreground hover:bg-muted/60"
              )}
            >
              All Sub-modules
            </button>
            {modules.filter((m: any) => m.parentId === selectedModule).map((sub: any) => {
              const count = moduleTotalCount(sub.id);
              const isSelected = selectedSubmodule === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() => setSelectedSubmodule(isSelected ? null : sub.id)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer border flex items-center gap-1.5",
                    isSelected
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs border-primary"
                      : "bg-muted/40 text-muted-foreground border-border/40 hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  <span>{sub.name}</span>
                  <span className={cn(
                    "text-[10px] font-mono px-1.5 py-0.2 rounded-full",
                    isSelected ? "bg-primary-foreground/20 text-primary-foreground font-bold" : "bg-muted text-muted-foreground"
                  )}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Row 3: Active Filters Tags Strip */}
        {(activeFiltersCount > 0 || selectedModule !== null) && (
          <div className="flex items-center gap-1.5 mb-3 flex-wrap text-xs">
            <span className="text-[11px] font-medium text-muted-foreground mr-1">Active filters:</span>
            {selectedModule && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 border border-primary/30 text-primary">
                Module: <strong>{selectedModule === 'no-module' || selectedModule === 'none' ? 'Without Module' : modules.find((m: any) => m.id === selectedModule)?.name}</strong>
                <button type="button" onClick={() => { setSelectedModule(null); setSelectedSubmodule(null); }} className="hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {selectedSubmodule && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/15 border border-primary/40 text-primary font-semibold">
                Sub-module: <strong>{modules.find((m: any) => m.id === selectedSubmodule)?.name}</strong>
                <button type="button" onClick={() => setSelectedSubmodule(null)} className="hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {priorityFilters.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-foreground">
                Priority: <strong className="text-primary">{priorityFilters.join(', ')}</strong>
                <button type="button" onClick={() => setPriorityFilters([])} className="hover:text-destructive cursor-pointer">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {statusFilters.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-foreground capitalize">
                Status: <strong className="text-primary">{statusFilters.join(', ')}</strong>
                <button type="button" onClick={() => setStatusFilters([])} className="hover:text-destructive cursor-pointer">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {typeFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-foreground capitalize">
                Type: <strong className="text-primary">{typeFilter === 'auto' ? 'Automated' : 'Manual'}</strong>
                <button type="button" onClick={() => { setTypeFilter(''); setSourceFilter(''); }} className="hover:text-destructive cursor-pointer">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {sourceFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 border border-primary/30 text-primary">
                Source: <strong>{sourceFilter === 'postman' ? 'Postman' : sourceFilter === 'datadog' ? 'Datadog' : 'None (not integrated)'}</strong>
                <button type="button" onClick={() => setSourceFilter('')} className="hover:text-destructive cursor-pointer">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {reviewStatusFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-foreground capitalize">
                Review: <strong className="text-primary">{reviewStatusFilter.replace('_', ' ')}</strong>
                <button type="button" onClick={() => setReviewStatusFilter('')} className="hover:text-destructive cursor-pointer">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {scenarioFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-foreground capitalize">
                Scenario: <strong className="text-primary">{scenarioFilter.replace('_', ' ')}</strong>
                <button type="button" onClick={() => setScenarioFilter('')} className="hover:text-destructive cursor-pointer">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {authorFilters.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-foreground">
                Author: <strong className="text-primary">{authorFilters.map((a) => members.find((m: any) => String(m.userId) === String(a))?.user?.name || `User #${a}`).join(', ')}</strong>
                <button type="button" onClick={() => setAuthorFilters([])} className="hover:text-destructive cursor-pointer">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {tagFilters.length > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-foreground">
                Tags: <strong className="text-primary">{tagFilters.join(', ')}</strong>
                <button type="button" onClick={() => setTagFilters([])} className="hover:text-destructive cursor-pointer">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {ticketKeyFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/30 text-blue-400 font-mono text-[11px]">
                Ticket: <strong className="text-foreground">{ticketKeyFilter}</strong>
                <button type="button" onClick={() => setTicketKeyFilter('')} className="hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {(createdFrom || createdTo) && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-foreground font-mono text-[11px]">
                Created: <strong className="text-primary">{createdFrom || 'Start'} → {createdTo || 'Now'}</strong>
                <button type="button" onClick={() => { setCreatedFrom(''); setCreatedTo(''); setCreatedPreset(''); }} className="hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {(updatedFrom || updatedTo) && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 border border-border/40 text-foreground font-mono text-[11px]">
                Updated: <strong className="text-primary">{updatedFrom || 'Start'} → {updatedTo || 'Now'}</strong>
                <button type="button" onClick={() => { setUpdatedFrom(''); setUpdatedTo(''); setUpdatedPreset(''); }} className="hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-[11px] text-muted-foreground hover:text-destructive underline cursor-pointer ml-1"
            >
              Clear all
            </button>
          </div>
        )}

        {selectedCaseIds.size > 0 && statusFilters.includes('archived') && (
          <div className="flex items-center gap-2.5 mb-4 p-2.5 px-3.5 rounded-xl bg-card border border-primary/30 shadow-md flex-wrap animate-in fade-in slide-in-from-top-2 duration-150">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary font-mono">
              {selectedCaseIds.size} selected
            </span>
            <div className="h-4 w-px bg-border/40 mx-0.5" />
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkRestoreCases}
              className="h-8 text-xs cursor-pointer gap-1.5 border-border/60 hover:bg-muted font-medium"
            >
              <RotateCcw className="h-3.5 w-3.5 text-emerald-500" />
              <span>Restore</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedCaseIds(new Set())}
              className="h-8 text-xs cursor-pointer gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
              <span>Clear</span>
            </Button>
          </div>
        )}

        {selectedCaseIds.size > 0 && !statusFilters.includes('archived') && (
          <div className="flex items-center gap-2.5 mb-4 p-2.5 px-3.5 rounded-xl bg-card border border-primary/30 shadow-md flex-wrap animate-in fade-in slide-in-from-top-2 duration-150">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary font-mono">
              {selectedCaseIds.size} selected
            </span>
            <Button
              size="sm"
              onClick={() => {
                const ids = Array.from(selectedCaseIds);
                router.push(`/p/${slug}/runs/new?cases=${encodeURIComponent(ids.join(','))}`);
              }}
              className="h-8 text-xs cursor-pointer gap-1.5 gradient-btn text-white font-medium"
              title="Create a test run with the selected cases"
            >
              <Play className="h-3.5 w-3.5" />
              <span>Create run</span>
            </Button>
            {selectedModule &&
              selectedModuleCaseIds.length > 0 &&
              selectedModuleCaseIds.some((id) => !selectedCaseIds.has(id)) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSelectedCaseIds((prev) => {
                      const next = new Set(prev);
                      selectedModuleCaseIds.forEach((id) => next.add(id));
                      return next;
                    });
                  }}
                  className="h-8 text-xs cursor-pointer gap-1.5 text-muted-foreground hover:text-foreground"
                  title="Select every case in this module, including sub-modules"
                >
                  <ListChecks className="h-3.5 w-3.5" />
                  <span>Select all {selectedModuleCaseIds.length} in module</span>
                </Button>
              )}
            <div className="h-4 w-px bg-border/40 mx-0.5" />

            {/* Move to Module Custom Dropdown */}
            <div className="relative">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowMoveMenu(!showMoveMenu)}
                className="h-8 text-xs cursor-pointer flex items-center gap-1.5 border-border/60 hover:bg-muted font-medium"
              >
                <Folder className="h-3.5 w-3.5 text-primary" />
                <span>Move to...</span>
                <ChevronDown className={cn("h-3 w-3 transition-transform duration-150", showMoveMenu && "rotate-180")} />
              </Button>

              {showMoveMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowMoveMenu(false)} />
                  <div className="absolute left-0 top-full mt-1.5 z-50 w-64 max-h-72 overflow-y-auto rounded-xl border border-border/80 bg-popover/95 backdrop-blur-xl shadow-2xl p-1.5 space-y-0.5 text-xs animate-in fade-in-0 zoom-in-95 duration-150">
                    <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/40 mb-1">
                      Move {selectedCaseIds.size} case{selectedCaseIds.size !== 1 ? 's' : ''} to:
                    </div>

                    {/* Without Module (Root) */}
                    <button
                      type="button"
                      onClick={() => {
                        handleMoveCasesToModule(Array.from(selectedCaseIds), null);
                        setShowMoveMenu(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted text-foreground flex items-center gap-2 transition-colors cursor-pointer group"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0" />
                      <span className="font-medium text-xs flex-1">Without Module (Root)</span>
                    </button>

                    {/* Root Modules & Submodules */}
                    {rootModules.map((rm: any) => {
                      const subs = modules.filter((m: any) => m.parentId === rm.id);
                      return (
                        <div key={rm.id} className="space-y-0.5">
                          <button
                            type="button"
                            onClick={() => {
                              handleMoveCasesToModule(Array.from(selectedCaseIds), rm.id);
                              setShowMoveMenu(false);
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted text-foreground flex items-center gap-2 transition-colors cursor-pointer group"
                          >
                            <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="font-semibold text-xs flex-1 truncate">{rm.name}</span>
                          </button>

                          {subs.map((sm: any) => (
                            <button
                              key={sm.id}
                              type="button"
                              onClick={() => {
                                handleMoveCasesToModule(Array.from(selectedCaseIds), sm.id);
                                setShowMoveMenu(false);
                              }}
                              className="w-full text-left pl-6 pr-2.5 py-1 rounded-lg hover:bg-muted text-foreground/80 hover:text-foreground flex items-center gap-1.5 transition-colors cursor-pointer group text-[11px]"
                            >
                              <span className="text-muted-foreground">↳</span>
                              <Folder className="h-3 w-3 text-muted-foreground group-hover:text-primary shrink-0" />
                              <span className="truncate flex-1">{sm.name}</span>
                              <span className="text-[9px] font-mono px-1 rounded bg-muted/60 text-muted-foreground">sub</span>
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            <div className="h-4 w-px bg-border/40 mx-0.5" />

            {/* Bulk Add Tags */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowBulkAddTagsModal(true)}
              className="h-8 text-xs cursor-pointer flex items-center gap-1.5"
            >
              <Tag className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Add Tags</span>
            </Button>

            {/* Bulk Add to Suite */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowBulkAddToSuiteModal(true)}
              className="h-8 text-xs cursor-pointer flex items-center gap-1.5"
            >
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <span>Add to Suite</span>
            </Button>

            {/* Delete */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkArchive}
              className="h-8 text-xs text-red-500 hover:text-red-600 hover:bg-red-500/10 border-red-500/20 cursor-pointer"
            >
              Delete
            </Button>

            {isAdmin && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkMarkActive}
                className="h-8 text-xs text-green-600 hover:text-green-700 hover:bg-green-500/10 border-green-500/20 cursor-pointer"
              >
                Approve &amp; Mark Active
              </Button>
            )}

            <div className="h-4 w-px bg-border/40 mx-0.5" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedCaseIds(new Set())}
              className="h-8 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            >
              Clear
            </Button>
          </div>
        )}

        {casesByModule && casesByModule.length > 0 ? (
          <div className="space-y-3">
            {casesByModule.map((group) => {
              const groupId = group.id || 'no-module';
              const isCollapsed = collapsedModuleIds.has(groupId);
              const directCount = group.directCases?.length ?? group.cases?.length ?? 0;
              const subCasesCount = (group.submodules || []).reduce(
                (sum: number, sm: any) => sum + (sm.cases?.length || 0),
                0
              );
              const totalCount = group.totalCasesCount ?? directCount + subCasesCount;
              const allGroupCaseIds: string[] = [
                ...((group.directCases || group.cases || []).map((c: any) => c.id)),
                ...((group.submodules || []).flatMap((sm: any) => (sm.cases || []).map((c: any) => c.id))),
              ];
              const isGroupAllSelected = allGroupCaseIds.length > 0 && allGroupCaseIds.every((id) => selectedCaseIds.has(id));
              const isGroupSomeSelected = allGroupCaseIds.some((id) => selectedCaseIds.has(id));

              const handleToggleGroupSelection = (checked: boolean) => {
                const next = new Set(selectedCaseIds);
                if (checked) {
                  allGroupCaseIds.forEach((id) => next.add(id));
                } else {
                  allGroupCaseIds.forEach((id) => next.delete(id));
                }
                setSelectedCaseIds(next);
              };

              return (
                <div
                  key={groupId}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (dragOverModuleGroupId !== groupId) {
                      setDragOverModuleGroupId(groupId);
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDragOverModuleGroupId((prev) => (prev === groupId ? null : prev));
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverModuleGroupId(null);
                    try {
                      const raw = e.dataTransfer.getData('application/json');
                      if (raw) {
                        const parsed = JSON.parse(raw);
                        if (parsed?.caseIds) {
                          handleMoveCasesToModule(parsed.caseIds, group.id);
                        }
                      }
                    } catch {}
                  }}
                  className={cn(
                    "rounded-xl border border-border/50 overflow-hidden bg-card/40 shadow-xs transition-all",
                    dragOverModuleGroupId === groupId && "ring-2 ring-primary/60 border-primary/60 bg-primary/[0.03]"
                  )}
                >
                  {/* Depth 0: Top-Level Module Header Bar */}
                  <div
                    className={cn(
                      "group flex items-center justify-between pl-3 pr-3.5 py-2.5 bg-muted/40 hover:bg-muted/60 transition-colors cursor-pointer select-none",
                      !isCollapsed && "border-b border-border/40"
                    )}
                    onClick={() => toggleModuleCollapse(groupId)}
                  >
                    <div className="flex items-center gap-2">
                      {canEdit && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center justify-center shrink-0"
                        >
                          <Checkbox
                            checked={isGroupAllSelected}
                            onCheckedChange={handleToggleGroupSelection}
                            className={cn(
                              "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
                              isGroupSomeSelected && "opacity-100"
                            )}
                            title={`Select all cases in ${group.name}`}
                          />
                        </div>
                      )}
                      <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", isCollapsed && "-rotate-90")} />
                      <Folder className="h-4 w-4 text-primary shrink-0" />
                      <h3 className="font-semibold text-sm text-foreground">{group.name}</h3>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-muted/60 text-muted-foreground font-semibold">
                        {totalCount}
                      </span>
                    </div>

                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {canEdit && quickCreateModuleId !== groupId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (isCollapsed) {
                              toggleModuleCollapse(groupId);
                            }
                            setQuickCreateModuleId(groupId);
                            setQuickCaseTitle('');
                          }}
                          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted font-medium cursor-pointer"
                          title={`Add case in ${group.name}`}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" /> Case
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Inline quick-create row for parent module */}
                  {quickCreateModuleId === groupId && (
                    <div className="p-2.5 pl-[42px] pr-3.5 bg-primary/5 border-b border-primary/20 flex items-center gap-2.5 animate-in fade-in duration-150">
                      <Input
                        placeholder={`Test case title in ${group.name}... (Press Enter to create)`}
                        value={quickCaseTitle}
                        onChange={(e) => setQuickCaseTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && quickCaseTitle.trim()) {
                            e.preventDefault();
                            handleQuickCreateCase(group.id);
                          }
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setQuickCreateModuleId(null);
                            setQuickCaseTitle('');
                          }
                        }}
                        autoFocus
                        className="h-8 text-xs bg-background border-border/60 flex-1"
                      />
                      <Button
                        size="sm"
                        disabled={!quickCaseTitle.trim() || isSubmittingQuick}
                        onClick={() => handleQuickCreateCase(group.id)}
                        className="h-8 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-3 cursor-pointer"
                      >
                        {isSubmittingQuick ? 'Adding...' : 'Add Case'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setQuickCreateModuleId(null);
                          setQuickCaseTitle('');
                        }}
                        className="h-8 text-xs text-muted-foreground hover:text-foreground px-2 cursor-pointer"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}

                  {/* Compact Inline Column Header (Once per expanded top-level module) */}
                  {!isCollapsed && totalCount > 0 && (
                    <div className="py-1.5 flex items-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 bg-muted/35 dark:bg-white/[0.02] border-b border-border/35 select-none">
                      {canEdit && <div className="w-[46px] shrink-0" />}
                      <div className="w-[88px] pl-1 pr-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleHeaderSort('displayId')}
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-foreground cursor-pointer transition-colors",
                            sortColumn === 'displayId' && "text-primary font-bold"
                          )}
                        >
                          <span>ID</span>
                          <ArrowUpDown className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      <div className="flex-1 min-w-[280px] pl-2 pr-4">
                        <button
                          type="button"
                          onClick={() => handleHeaderSort('title')}
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-foreground cursor-pointer transition-colors",
                            sortColumn === 'title' && "text-primary font-bold"
                          )}
                        >
                          <span>Title</span>
                          <ArrowUpDown className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      <div className="max-[768px]:hidden w-[104px] px-5 shrink-0 text-center">
                        <button
                          type="button"
                          onClick={() => handleHeaderSort('priority')}
                          className={cn(
                            "inline-flex items-center justify-center gap-1 hover:text-foreground cursor-pointer transition-colors",
                            sortColumn === 'priority' && "text-primary font-bold"
                          )}
                        >
                          <span>Priority</span>
                          <ArrowUpDown className="h-2.5 w-2.5" />
                        </button>
                      </div>
                      <div className="max-[1199px]:hidden w-[116px] px-5 shrink-0 text-center">
                        <button
                          type="button"
                          onClick={() => handleHeaderSort('type')}
                          className={cn(
                            "inline-flex items-center justify-center gap-1 hover:text-foreground cursor-pointer transition-colors",
                            sortColumn === 'type' && "text-primary font-bold"
                          )}
                        >
                          <span>Mode</span>
                          <ArrowUpDown className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Depth 1: Parent Module's Direct Cases */}
                  {!isCollapsed && (
                    (group.directCases && group.directCases.length > 0) || (group.cases && group.cases.length > 0) ? (
                      <DataTable
                        data={group.directCases || group.cases}
                        columns={columns}
                        onRowClick={(row) => handleOpenCase(row.displayId)}
                        getId={(row) => row.id}
                        selectable={canEdit}
                        selectedIds={selectedCaseIds}
                        onSelectionChange={setSelectedCaseIds}
                        pagination={false}
                        hideHeader={true}
                        checkboxCellClassName="w-[46px] pl-3 pr-1 max-sm:sticky max-sm:left-0 max-sm:z-[2] max-sm:bg-card"
                        rowDraggable={canEdit}
                        onRowDragStart={handleRowDragStart}
                        onRowDrop={handleRowDrop}
                        className="border-0 rounded-none bg-transparent"
                        tableClassName="table-fixed w-full"
                      />
                    ) : !group.submodules?.length ? (
                      <div className="py-6 text-center text-xs text-muted-foreground">
                        No cases in {group.name} yet.{canEdit && quickCreateModuleId !== groupId && (
                          <> Click <span className="text-primary font-semibold cursor-pointer" onClick={() => setQuickCreateModuleId(groupId)}>+ Case</span> above to add one.</>
                        )}
                      </div>
                    ) : null
                  )}

                  {/* Depth 1: Child Sub-modules Enclosed Flush Inside Parent Module Card (Shared row bg & column grid) */}
                  {!isCollapsed && group.submodules && group.submodules.length > 0 && (
                    <div className={cn("divide-y divide-border/40", directCount > 0 && "border-t border-border/40")}>
                      {group.submodules.map((sub: any) => {
                        const isSubCollapsed = collapsedModuleIds.has(sub.id);
                        const subCaseIds: string[] = (sub.cases || []).map((c: any) => c.id);
                        const isSubAllSelected = subCaseIds.length > 0 && subCaseIds.every((id) => selectedCaseIds.has(id));
                        const isSubSomeSelected = subCaseIds.some((id) => selectedCaseIds.has(id));

                        const handleToggleSubSelection = (checked: boolean) => {
                          const next = new Set(selectedCaseIds);
                          if (checked) {
                            subCaseIds.forEach((id) => next.add(id));
                          } else {
                            subCaseIds.forEach((id) => next.delete(id));
                          }
                          setSelectedCaseIds(next);
                        };

                        return (
                          <div key={sub.id}>
                            {/* Depth 1: Submodule Header Bar (pl-[42px] -> chevron at 66px) */}
                            <div
                              className={cn(
                                "group flex items-center justify-between pl-[42px] pr-3.5 py-2 bg-muted/20 hover:bg-muted/35 transition-colors cursor-pointer select-none",
                                !isSubCollapsed && "border-b border-border/35"
                              )}
                              onClick={() => toggleModuleCollapse(sub.id)}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                  const raw = e.dataTransfer.getData('application/json');
                                  if (raw) {
                                    const parsed = JSON.parse(raw);
                                    if (parsed?.caseIds) {
                                      handleMoveCasesToModule(parsed.caseIds, sub.id);
                                    }
                                  }
                                } catch {}
                              }}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                {canEdit && (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center justify-center shrink-0"
                                  >
                                    <Checkbox
                                      checked={isSubAllSelected}
                                      onCheckedChange={handleToggleSubSelection}
                                      className={cn(
                                        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity",
                                        isSubSomeSelected && "opacity-100"
                                      )}
                                      title={`Select all cases in ${sub.name}`}
                                    />
                                  </div>
                                )}
                                <ChevronDown
                                  className={cn(
                                    "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                                    isSubCollapsed && "-rotate-90"
                                  )}
                                />
                                <Folder className="h-3.5 w-3.5 text-primary/85 shrink-0" />
                                <h4 className="font-medium text-xs text-foreground/90">{sub.name}</h4>
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-muted/60 text-muted-foreground font-medium shrink-0">
                                  {sub.totalCasesCount ?? sub.cases.length}
                                </span>
                              </div>

                              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                                {canEdit && quickCreateModuleId !== sub.id && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      if (isSubCollapsed) {
                                        toggleModuleCollapse(sub.id);
                                      }
                                      setQuickCreateModuleId(sub.id);
                                      setQuickCaseTitle('');
                                    }}
                                    className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted font-medium cursor-pointer"
                                    title={`Add case in sub-module ${sub.name}`}
                                  >
                                    <Plus className="h-3 w-3 mr-1" /> Case
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* Inline quick-create row for sub-module */}
                            {quickCreateModuleId === sub.id && (
                              <div className="p-2 pl-[70px] pr-3.5 bg-primary/5 border-b border-primary/20 flex items-center gap-2 animate-in fade-in duration-150">
                                <Input
                                  placeholder={`Test case title in sub-module ${sub.name}... (Press Enter to save)`}
                                  value={quickCaseTitle}
                                  onChange={(e) => setQuickCaseTitle(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && quickCaseTitle.trim()) {
                                      e.preventDefault();
                                      handleQuickCreateCase(sub.id);
                                    }
                                    if (e.key === 'Escape') {
                                      e.preventDefault();
                                      setQuickCreateModuleId(null);
                                      setQuickCaseTitle('');
                                    }
                                  }}
                                  autoFocus
                                  className="h-7 text-xs bg-background border-border/60 flex-1"
                                />
                                <Button
                                  size="sm"
                                  disabled={!quickCaseTitle.trim() || isSubmittingQuick}
                                  onClick={() => handleQuickCreateCase(sub.id)}
                                  className="h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-semibold px-2.5 cursor-pointer"
                                >
                                  {isSubmittingQuick ? 'Adding...' : 'Add'}
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setQuickCreateModuleId(null);
                                    setQuickCaseTitle('');
                                  }}
                                  className="h-7 text-xs text-muted-foreground hover:text-foreground px-2 cursor-pointer"
                                >
                                  Cancel
                                </Button>
                              </div>
                            )}

                            {/* Depth 2: Sub-module Cases */}
                            {!isSubCollapsed && (
                              sub.cases.length > 0 ? (
                                <DataTable
                                  data={sub.cases}
                                  columns={columns}
                                  onRowClick={(row) => handleOpenCase(row.displayId)}
                                  getId={(row) => row.id}
                                  selectable={true}
                                  selectedIds={selectedCaseIds}
                                  onSelectionChange={setSelectedCaseIds}
                                  pagination={false}
                                  hideHeader={true}
                                  checkboxCellClassName="w-[62px] pl-6 pr-1"
                                  rowDraggable={true}
                                  onRowDragStart={handleRowDragStart}
                                  onRowDrop={handleRowDrop}
                                  className="border-0 rounded-none bg-transparent"
                                  tableClassName="table-fixed w-full"
                                />
                              ) : (
                                <div className="py-3 pl-10 pr-4 text-xs text-muted-foreground flex items-center justify-between">
                                  <span>No cases in sub-module {sub.name} yet.</span>
                                  {canEdit && quickCreateModuleId !== sub.id && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setQuickCreateModuleId(sub.id);
                                        setQuickCaseTitle('');
                                      }}
                                      className="text-primary hover:underline font-medium text-xs cursor-pointer"
                                    >
                                      + Add first case
                                    </button>
                                  )}
                                </div>
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-border/50 overflow-hidden bg-card/40 shadow-xs transition-all">
            <DataTable
              data={statusFilters.includes('archived') ? archivedCases : filteredCases}
              columns={statusFilters.includes('archived') ? archivedColumns : columns}
              onRowClick={(row) => {
                if (!statusFilters.includes('archived')) {
                  handleOpenCase(row.displayId);
                }
              }}
              getId={(row) => row.id}
              selectable={canEdit}
              selectedIds={selectedCaseIds}
              onSelectionChange={setSelectedCaseIds}
              pagination={false}
              checkboxCellClassName="w-[46px] pl-3 pr-1 max-sm:sticky max-sm:left-0 max-sm:z-[2] max-sm:bg-card"
              tableClassName="table-fixed w-full"
              rowDraggable={canEdit && !statusFilters.includes('archived')}
              onRowDragStart={handleRowDragStart}
              onRowDrop={handleRowDrop}
              emptyComponent={
              <EmptyState
                icon={FolderOpen}
                heading={
                  statusFilters.includes('archived')
                    ? 'No archived cases'
                    : statusFilters.includes('deprecated')
                    ? 'No deprecated cases'
                    : 'No test cases found'
                }
                subtext={
                  statusFilters.includes('archived')
                    ? 'Archived cases will appear here'
                    : statusFilters.includes('deprecated')
                    ? 'Cases marked as deprecated will appear here'
                    : canEdit
                    ? 'Create your first test case or generate with AI'
                    : 'No test cases have been added to this repository yet'
                }
                action={
                  canEdit && !statusFilters.includes('archived') && !statusFilters.includes('deprecated')
                    ? {
                        label: 'Create Case',
                        onClick: handleCreateCaseDirectly,
                      }
                    : undefined
                }
              />
            }
          />
          </div>
        )}
      </main>

      {/* New Case Modal */}
      <Dialog
        open={showNewCaseModal}
        onOpenChange={(open) => {
          setShowNewCaseModal(open);
          if (!open) {
            setTagInputText('');
            setIsTagInputFocused(false);
            setTicketSearchQuery('');
            setIsTicketInputFocused(false);
          }
        }}
      >
        <DialogContent className="max-w-xl sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>New Test Case</DialogTitle>
          </DialogHeader>
          <div className="space-y-3.5 py-2">
            {/* Title */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                Title <span className="text-red-500">*</span>
              </label>
              <Input
                placeholder="Test case title..."
                value={newCaseForm.title}
                onChange={(e) => setNewCaseForm({ ...newCaseForm, title: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleCreateCaseFromModal()}
                autoFocus
              />
            </div>

            {/* Module & Priority */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Module</label>
                <Select
                  value={newCaseForm.submoduleId || newCaseForm.moduleId}
                  onValueChange={(val) => {
                    const picked = modules.find((m: any) => m.id === val);
                    if (picked?.parentId) {
                      setNewCaseForm({ ...newCaseForm, moduleId: picked.parentId, submoduleId: picked.id });
                    } else {
                      setNewCaseForm({ ...newCaseForm, moduleId: val, submoduleId: '' });
                    }
                  }}
                  options={moduleTreeOptions}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Priority</label>
                <Select
                  value={newCaseForm.priority}
                  onValueChange={(val) => setNewCaseForm({ ...newCaseForm, priority: val })}
                  options={[
                    { value: 'P0', label: 'P0 - Critical' },
                    { value: 'P1', label: 'P1 - High' },
                    { value: 'P2', label: 'P2 - Medium' },
                    { value: 'P3', label: 'P3 - Low' },
                  ]}
                />
              </div>
            </div>

            {/* Dependent Sub-module (Shown if selected module has sub-modules) */}
            {newCaseForm.moduleId && modules.filter((m: any) => m.parentId === newCaseForm.moduleId).length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Sub-module</label>
                <Select
                  value={newCaseForm.submoduleId}
                  onValueChange={(val) => setNewCaseForm({ ...newCaseForm, submoduleId: val })}
                  options={[
                    { value: '', label: `Keep under ${modules.find((m: any) => m.id === newCaseForm.moduleId)?.name} (No sub-module)` },
                    ...modules.filter((m: any) => m.parentId === newCaseForm.moduleId).map((sm: any) => ({ value: sm.id, label: sm.name })),
                  ]}
                />
              </div>
            )}

            {/* Description (Optional) */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Description <span className="text-[10px] text-muted-foreground/70 font-normal lowercase">(optional)</span>
              </label>
              <textarea
                placeholder="Provide background context, preconditions summary, or acceptance criteria..."
                value={newCaseForm.description}
                onChange={(e) => setNewCaseForm({ ...newCaseForm, description: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-xs focus:outline-none focus:border-primary/70 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40 resize-none leading-relaxed transition-colors"
              />
            </div>

            {/* Tags (Optional) */}
            <div className="space-y-1 relative">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Tags <span className="text-[10px] text-muted-foreground/70 font-normal lowercase">(optional)</span>
              </label>

              <div className="relative">
                <Input
                  placeholder="Type tag name and press Enter, or click to pick existing..."
                  value={tagInputText}
                  onChange={(e) => setTagInputText(e.target.value)}
                  onFocus={() => setIsTagInputFocused(true)}
                  onClick={() => setIsTagInputFocused(true)}
                  onBlur={() => {
                    setIsTagInputFocused(false);
                  }}
                  className="h-8.5 text-xs font-mono"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      const val = tagInputText.trim().toLowerCase();
                      if (val && !newCaseForm.tags.includes(val)) {
                        setNewCaseForm({ ...newCaseForm, tags: [...newCaseForm.tags, val] });
                        setTagInputText('');
                      }
                    } else if (e.key === 'Backspace' && !tagInputText && newCaseForm.tags.length > 0) {
                      setNewCaseForm({
                        ...newCaseForm,
                        tags: newCaseForm.tags.slice(0, newCaseForm.tags.length - 1),
                      });
                    }
                  }}
                />

                {/* Floating Suggestions Menu when clicked inside searchbar */}
                {isTagInputFocused && (
                  <div
                    onMouseDown={(e) => e.preventDefault()}
                    className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-xl border border-border/80 bg-popover/95 backdrop-blur-md shadow-xl p-2.5 max-h-48 overflow-y-auto animate-in fade-in-0 zoom-in-95 duration-150"
                  >
                    {modalTagSuggestions.length > 0 ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between px-1 text-[10px] font-semibold tracking-wider uppercase text-muted-foreground">
                          <span>Suggested Tags ({modalTagSuggestions.length})</span>
                          <span className="text-[9px] font-normal lowercase text-muted-foreground/70">click to add</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {modalTagSuggestions.map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => {
                                setNewCaseForm({ ...newCaseForm, tags: [...newCaseForm.tags, t] });
                                setTagInputText('');
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono font-medium bg-muted/80 hover:bg-primary/20 hover:text-primary text-foreground border border-border/50 hover:border-primary/40 transition-colors cursor-pointer"
                            >
                              <span className="text-primary font-bold">+</span>
                              <span>{t}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : tagInputText.trim() ? (
                      <div className="p-1 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-mono">No matching existing tag</span>
                        <button
                          type="button"
                          onClick={() => {
                            const val = tagInputText.trim().toLowerCase();
                            if (val && !newCaseForm.tags.includes(val)) {
                              setNewCaseForm({ ...newCaseForm, tags: [...newCaseForm.tags, val] });
                              setTagInputText('');
                            }
                          }}
                          className="px-2 py-1 rounded-md text-xs font-mono font-semibold bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                        >
                          + Add "{tagInputText.trim().toLowerCase()}"
                        </button>
                      </div>
                    ) : (
                      <div className="p-2 text-xs text-center text-muted-foreground font-mono">
                        No tags found in repository. Type tag and press Enter.
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Selected tags badges */}
              {newCaseForm.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {newCaseForm.tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-primary/15 text-primary text-xs font-mono font-semibold border border-primary/20"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => setNewCaseForm({ ...newCaseForm, tags: newCaseForm.tags.filter((tag) => tag !== t) })}
                        className="hover:text-destructive cursor-pointer transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Linked Ticket Key & Suite (Optional) */}
            <div className="grid grid-cols-2 gap-3 pt-0.5">
              <div className="space-y-1 relative">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                    Linked Ticket <span className="text-[10px] text-muted-foreground/70 font-normal lowercase">(optional)</span>
                  </label>
                  {isPmConnected && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500 font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                      InkaBoard
                    </span>
                  )}
                </div>

                {newCaseForm.ticketKey ? (
                  <div className="flex items-center justify-between h-8 px-2 rounded-lg border border-blue-500/30 bg-blue-500/10 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0 pr-1">
                      <span className="font-mono font-bold text-blue-400 shrink-0 text-xs">{newCaseForm.ticketKey}</span>
                      {ticketOptions.find((t) => t.key === newCaseForm.ticketKey)?.title && (
                        <span className="text-muted-foreground text-[11px] truncate">
                          {ticketOptions.find((t) => t.key === newCaseForm.ticketKey)?.title}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setNewCaseForm({ ...newCaseForm, ticketKey: '' });
                        setTicketSearchQuery('');
                      }}
                      className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                      title="Clear ticket"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Input
                      placeholder={isPmConnected ? "Search InkaBoard or type key..." : "e.g. TECH-22, JIRA-42..."}
                      value={ticketSearchQuery}
                      onChange={(e) => setTicketSearchQuery(e.target.value)}
                      onFocus={() => setIsTicketInputFocused(true)}
                      onClick={() => setIsTicketInputFocused(true)}
                      onBlur={() => setIsTicketInputFocused(false)}
                      className="h-8 text-xs font-mono pr-7"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = ticketSearchQuery.trim().toUpperCase();
                          if (val) {
                            setNewCaseForm({ ...newCaseForm, ticketKey: val });
                            setTicketSearchQuery('');
                            setIsTicketInputFocused(false);
                          }
                        }
                      }}
                    />
                    {loadingTickets && (
                      <div className="absolute right-2 top-2">
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border border-primary border-t-transparent" />
                      </div>
                    )}

                    {/* Ticket Suggestions Menu when clicked inside */}
                    {isTicketInputFocused && (
                      <div
                        onMouseDown={(e) => e.preventDefault()}
                        className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-border/80 bg-popover/95 backdrop-blur-md shadow-xl p-1.5 max-h-56 overflow-y-auto animate-in fade-in-0 zoom-in-95 duration-150 space-y-1"
                      >
                        {/* Option to manually use the typed key */}
                        {ticketSearchQuery.trim() && (
                          <button
                            type="button"
                            onClick={() => {
                              const val = ticketSearchQuery.trim().toUpperCase();
                              setNewCaseForm({ ...newCaseForm, ticketKey: val });
                              setTicketSearchQuery('');
                              setIsTicketInputFocused(false);
                            }}
                            className="w-full text-left p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 flex items-center justify-between text-xs cursor-pointer"
                          >
                            <span className="font-medium">
                              Use manual key <span className="font-mono font-bold uppercase">{ticketSearchQuery.trim().toUpperCase()}</span>
                            </span>
                            <span className="text-[10px] text-muted-foreground">Press Enter</span>
                          </button>
                        )}

                        {filteredTicketOptions.length > 0 ? (
                          <div className="space-y-0.5">
                            <div className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                              <span>{isPmConnected ? 'InkaBoard & Project Tickets' : 'Project Tickets'}</span>
                              <span>{filteredTicketOptions.length} available</span>
                            </div>
                            {filteredTicketOptions.map((t) => (
                              <button
                                key={t.key}
                                type="button"
                                onClick={() => {
                                  setNewCaseForm({ ...newCaseForm, ticketKey: t.key });
                                  setTicketSearchQuery('');
                                  setIsTicketInputFocused(false);
                                }}
                                className="w-full text-left p-1.5 rounded-md hover:bg-muted/70 transition-colors flex items-center justify-between gap-2 text-xs cursor-pointer group"
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
                                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-muted font-medium text-muted-foreground">
                                  {t.status}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : !ticketSearchQuery.trim() ? (
                          <div className="p-2 text-xs text-center text-muted-foreground font-mono">
                            {isPmConnected ? 'No tickets found on InkaBoard. Type ticket key manually.' : 'Type ticket key manually (e.g. TECH-22).'}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Add to Suite <span className="text-[10px] text-muted-foreground/70 font-normal lowercase">(optional)</span>
                </label>
                <Select
                  value={newCaseForm.suiteId}
                  onValueChange={(val) => setNewCaseForm({ ...newCaseForm, suiteId: val })}
                  options={[
                    { value: '', label: 'None' },
                    ...(suites || []).map((s: any) => ({ value: s.id, label: s.name })),
                  ]}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setShowNewCaseModal(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreateCaseFromModal} disabled={!newCaseForm.title.trim()} className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
              Create Test Case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Module Modal */}
      <Dialog open={showCreateModuleModal} onOpenChange={(open) => {
        setShowCreateModuleModal(open);
        if (!open) {
          setModuleForm('');
          setModuleParentId(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{moduleParentId ? 'Create Sub-module' : 'Create Module'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Module Name *</label>
              <Input
                placeholder={moduleParentId ? "e.g. Password Reset, 2FA" : "e.g. Authentication, Billing"}
                value={moduleForm}
                onChange={(e) => setModuleForm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateModule()}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Parent Module (Optional)</label>
              <select
                value={moduleParentId || ''}
                onChange={(e) => setModuleParentId(e.target.value || null)}
                className="w-full h-9 rounded-lg border border-border/60 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">None (Root Module)</option>
                {rootModules.map((m: any) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreateModuleModal(false); setModuleForm(''); setModuleParentId(null); }}>Cancel</Button>
            <Button onClick={handleCreateModule} disabled={!moduleForm.trim()} className="gradient-btn text-white">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GenerateTestCasesDialog
        open={showGenerateModal}
        onOpenChange={setShowGenerateModal}
        projectId={project?.id || ''}
        initialSourceMode={generateSourceMode}
        onSuccess={(createdCases) => {
          const hasActive = Array.isArray(createdCases) && createdCases.some((c: any) => c.status === 'active');
          setStatusFilters(hasActive ? ['active'] : ['draft']);
        }}
      />

      {/* 1. Case Detail Pop-up View (Centered Modal Dialog) */}
      <Dialog
        open={Boolean(activeDrawerCaseId && detailViewType === 'popup')}
        onOpenChange={(open) => { if (!open) handleCloseCaseDrawer(); }}
      >
        <DialogContent
          hideClose
          sheetOnMobile={false}
          className="max-w-7xl w-[96vw] h-[92vh] max-h-[92vh] p-0 overflow-hidden flex flex-col border border-border/80 bg-background shadow-2xl rounded-2xl"
        >
          {persistentDrawerCaseId && (
            <div className="w-full h-full overflow-y-auto">
              <CaseDetailView
                key={`${persistentDrawerCaseId}-popup`}
                caseId={persistentDrawerCaseId}
                onClose={() => handleCloseCaseDrawer(true)}
                isFullPage={false}
                viewMode="popup"
                initialEditMode={openCaseInEditMode}
                onToggleViewMode={toggleDetailViewType}
                onNavigatePrev={handleNavigatePrev}
                onNavigateNext={handleNavigateNext}
                currentIndex={currentCaseIndex >= 0 ? currentCaseIndex : undefined}
                totalCount={currentCasesList.length}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Mobile module drawer: the tree lives in the desktop sidebar. */}
      <Sheet open={modulesSheetOpen} onOpenChange={setModulesSheetOpen}>
        <SheetContent side="left" className="w-[86vw] max-w-[320px] p-0 flex flex-col">
          <SheetHeader className="px-3 py-3 border-b flex-row items-center justify-between space-y-0">
            <SheetTitle className="text-sm font-semibold">Modules</SheetTitle>
            {canEdit && (
              <button
                onClick={() => {
                  setModulesSheetOpen(false);
                  setShowCreateModuleModal(true);
                }}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" /> Module
              </button>
            )}
          </SheetHeader>
          <div className="flex-1 overflow-y-auto module-sidebar-scroll">{moduleTreeBody}</div>
        </SheetContent>
      </Sheet>

      {/* 2. Case Detail Slide-Over Sheet / Drawer */}
      <Sheet
        open={Boolean(activeDrawerCaseId && detailViewType === 'sheet')}
        onOpenChange={(open) => { if (!open) handleCloseCaseDrawer(); }}
      >        <SheetContent
          side="right"
          onClose={() => handleCloseCaseDrawer()}
          hideClose={true}
          className="w-full min-[768px]:w-[88vw] min-[1024px]:w-[78vw] xl:w-full sm:max-w-4xl lg:max-w-5xl xl:max-w-6xl p-0 h-full overflow-y-auto border-l border-border/80 shadow-2xl bg-background"
        >
          {persistentDrawerCaseId && (
            <CaseDetailView
              key={`${persistentDrawerCaseId}-sheet`}
              caseId={persistentDrawerCaseId}
              onClose={() => handleCloseCaseDrawer(true)}
              isFullPage={false}
              viewMode="sheet"
              initialEditMode={openCaseInEditMode}
              onOpenEditInModal={() => {
                setOpenCaseInEditMode(true);
                setDetailViewType('popup');
              }}
              onToggleViewMode={toggleDetailViewType}
              onNavigatePrev={handleNavigatePrev}
              onNavigateNext={handleNavigateNext}
              currentIndex={currentCaseIndex >= 0 ? currentCaseIndex : undefined}
              totalCount={currentCasesList.length}
            />
          )}
        </SheetContent>
      </Sheet>

      <ImportTestCasesDialog
        open={showImportModal}
        onOpenChange={setShowImportModal}
        projectId={project?.id || ''}
        onSuccess={() => setStatusFilters(['draft'])}
      />

      <TagsManagerModal
        open={showTagsModal}
        onOpenChange={setShowTagsModal}
        projectId={project?.id || ''}
        cases={allCases}
        onTagsUpdated={(updatedCases) => {
          setCases(updatedCases);
        }}
      />

      <BulkAddTagsModal
        open={showBulkAddTagsModal}
        onOpenChange={setShowBulkAddTagsModal}
        selectedCaseIds={Array.from(selectedCaseIds)}
        allExistingTags={allUniqueTags}
        onSuccess={() => {
          setSelectedCaseIds(new Set());
        }}
      />

      <BulkAddToSuiteModal
        open={showBulkAddToSuiteModal}
        onOpenChange={setShowBulkAddToSuiteModal}
        selectedCaseIds={Array.from(selectedCaseIds)}
        suites={suites || []}
        onSuccess={() => {
          setSelectedCaseIds(new Set());
        }}
      />

      <Dialog open={showBulkReviewModal} onOpenChange={setShowBulkReviewModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Submit {selectedCaseIds.size} Test Cases for Review</DialogTitle>
            <DialogDescription>
              Assign a reviewer or submit to the project pool for review.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Assign Reviewer
              </label>
              <select
                value={bulkReviewTarget}
                onChange={(e) => setBulkReviewTarget(e.target.value)}
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
              <textarea
                value={bulkReviewComment}
                onChange={(e) => setBulkReviewComment(e.target.value)}
                placeholder="What should the reviewer focus on across these test cases?"
                rows={3}
                className="w-full rounded-lg border border-border/60 bg-background p-3 text-sm resize-none focus:outline-none focus:border-primary/70 focus:ring-1 focus:ring-inset focus:ring-primary/40 transition-colors"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowBulkReviewModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkSubmitReview} disabled={submittingBulkReview}>
              {submittingBulkReview ? 'Submitting...' : `Submit ${selectedCaseIds.size} Cases`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDuplicates} onOpenChange={setShowDuplicates}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="h-4 w-4 text-primary" />
              Duplicate cases
            </DialogTitle>
            <DialogDescription className="text-xs">
              Matched by identical title and automation link. Archiving keeps the
              newest case and moves the older copies to the archive, so pass/fail
              counts stop double-counting them.
            </DialogDescription>
          </DialogHeader>

          {loadingDuplicates ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <LoaderIcon className="h-4 w-4 animate-spin" />
              Scanning repository…
            </div>
          ) : duplicateGroups.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No duplicate cases found.
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
              {duplicateGroups.map((group) => {
                const sorted = [...group.cases].sort(
                  (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
                );
                const newest = sorted[0];
                return (
                  <div
                    key={group.key}
                    className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground">
                          {group.title}
                        </p>
                        <p className="truncate text-[10.5px] text-muted-foreground font-mono">
                          {group.link.replace(/^postman:/, 'Postman · ').replace(/^datadog:/, 'Datadog · ')}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={archivingDuplicates || sorted.length < 2}
                        onClick={() => void archiveDuplicateCases(group)}
                        className="h-7 text-[11px] shrink-0 cursor-pointer"
                      >
                        Archive {sorted.length - 1} older
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {sorted.map((c, idx) => (
                        <span
                          key={c.id}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium',
                            idx === 0
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                              : 'border-border/60 bg-background text-muted-foreground'
                          )}
                        >
                          <span className="font-mono">{c.displayId}</span>
                          {idx === 0 && <span>keep</span>}
                          {c.moduleName && <span className="truncate max-w-[140px]">· {c.moduleName}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {confirmConfig && (
        <ConfirmModal
          open={confirmConfig.open}
          onOpenChange={(open) => !open && setConfirmConfig(null)}
          title={confirmConfig.title}
          description={confirmConfig.description}
          variant={confirmConfig.variant || 'default'}
          requireTypedConfirmation={confirmConfig.requireTypedConfirmation}
          onConfirm={() => {
            confirmConfig.onConfirm();
            setConfirmConfig(null);
          }}
        />
      )}
    </div>
  );
}

function TruncatedText({ text, className }: { text: string; className?: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isClipped, setIsClipped] = useState(false);

  const handleMouseEnter = () => {
    if (textRef.current) {
      setIsClipped(textRef.current.scrollWidth > textRef.current.clientWidth);
    }
  };

  const spanContent = (
    <span
      ref={textRef}
      onMouseEnter={handleMouseEnter}
      className={cn("truncate block text-left", className)}
    >
      {text}
    </span>
  );

  if (isClipped) {
    return (
      <Tooltip content={text} side="top" delay={150}>
        {spanContent}
      </Tooltip>
    );
  }

  return spanContent;
}

function ModuleItem({
  module,
  childModules,
  allModules,
  selectedModule,
  onSelect,
  getCaseCount,
  onRename,
  onDelete,
  onReorder,
  onDragReorder,
  onAddSubmodule,
  onMoveCases,
  index,
  total,
  isSubmodule = false,
  isLastChild = false,
  readOnly = false,
}: {
  module: any;
  childModules: any[];
  allModules: any[];
  selectedModule: string | null;
  onSelect: (id: string) => void;
  getCaseCount: (id: string) => number;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder?: (id: string, dir: -1 | 1) => void;
  onDragReorder?: (draggedId: string, targetId: string) => void;
  onAddSubmodule: (parentId: string) => void;
  onMoveCases?: (caseIds: string[], targetModuleId: string | null) => void;
  index?: number;
  total?: number;
  isSubmodule?: boolean;
  isLastChild?: boolean;
  readOnly?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(module.name);
  const [isCaseDragOver, setIsCaseDragOver] = useState(false);
  const [isModuleDragOver, setIsModuleDragOver] = useState(false);
  const hasChildren = childModules.length > 0;

  return (
    <div className="relative">
      {/* If this is a submodule, render only the horizontal branch line connector */}
      {isSubmodule && (
        <div className="absolute left-[47px] top-4 w-3.5 h-[1.5px] bg-muted-foreground/50 dark:bg-muted-foreground/60 pointer-events-none z-10" />
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
          const types = Array.from(e.dataTransfer.types || []);
          if (types.includes('text/module-id')) {
            if (!isModuleDragOver) setIsModuleDragOver(true);
          } else {
            if (!isCaseDragOver) setIsCaseDragOver(true);
          }
        }}
        onDragLeave={() => {
          setIsCaseDragOver(false);
          setIsModuleDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsCaseDragOver(false);
          setIsModuleDragOver(false);
          try {
            const raw = e.dataTransfer.getData('application/json');
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.caseIds) {
                onMoveCases?.(parsed.caseIds, module.id);
                return;
              }
            }
            const draggedModId = e.dataTransfer.getData('text/module-id');
            if (draggedModId && draggedModId !== module.id) {
              onDragReorder?.(draggedModId, module.id);
            }
          } catch {}
        }}
        className={cn(
          "group flex items-center h-8 min-h-[32px] max-h-[32px] rounded-xl cursor-pointer text-xs transition-colors relative overflow-hidden",
          isSubmodule ? "pl-[62px] pr-2" : "px-2",
          isCaseDragOver && "ring-1 ring-inset ring-primary bg-primary/10 text-primary",
          isModuleDragOver && "ring-1 ring-inset ring-primary/80 bg-primary/10",
          !isCaseDragOver && !isModuleDragOver && selectedModule === module.id
            ? "bg-primary/10 text-primary font-semibold border-l-2 border-primary shadow-2xs"
            : !isCaseDragOver && !isModuleDragOver && "hover:bg-primary/[0.09] dark:hover:bg-white/[0.07] text-foreground/85 hover:text-foreground"
        )}
      >
        {/* 6-dot drag grip handle on hover */}
        {!editing && !readOnly && (
          <div
            draggable={true}
            onDragStart={(e) => {
              e.stopPropagation();
              e.dataTransfer.setData('text/module-id', module.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            className={cn(
              "w-3.5 h-3.5 flex items-center justify-center opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-muted-foreground shrink-0",
              isSubmodule && "-ml-1 mr-0.5"
            )}
            title="Drag to reorder"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical className="h-3 w-3" />
          </div>
        )}

        {/* Chevron for parent modules only */}
        {!isSubmodule && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="w-4 h-4 flex items-center justify-center text-muted-foreground/70 hover:text-foreground shrink-0"
          >
            {hasChildren ? (
              expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )
            ) : (
              <span className="w-3.5" />
            )}
          </button>
        )}

        {editing ? (
          <div className="flex-1 flex items-center gap-1 min-w-0" onClick={(e) => e.stopPropagation()}>
            <input
              className="flex-1 h-6 rounded border border-primary/50 bg-background px-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary min-w-0"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (editName.trim()) {
                    onRename(module.id, editName.trim());
                  }
                  setEditing(false);
                }
                if (e.key === 'Escape') {
                  setEditName(module.name);
                  setEditing(false);
                }
              }}
              autoFocus
            />
            <button
              type="button"
              onClick={() => {
                if (editName.trim()) {
                  onRename(module.id, editName.trim());
                }
                setEditing(false);
              }}
              className="p-1 rounded hover:bg-primary/20 text-primary transition-colors cursor-pointer shrink-0"
              title="Save"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => {
                setEditName(module.name);
                setEditing(false);
              }}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
              title="Cancel"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="flex-1 flex items-center gap-1.5 text-left min-w-0 pr-2"
            onClick={() => onSelect(module.id)}
          >
            <Folder className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
            <TruncatedText text={module.name} className="font-medium text-xs text-foreground/90 flex-1 min-w-0" />
            <span className={cn("text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-muted/60 text-muted-foreground font-medium shrink-0 ml-auto", !readOnly && "group-hover:invisible")}>
              {getCaseCount(module.id)}
            </span>
          </button>
        )}

        {/* Right hover actions overlay the count badge instead of reflowing the row */}
        {!editing && !readOnly && (
          <div className="absolute right-1 top-1/2 z-10 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg bg-surface/95 pl-1 pr-0.5 py-0.5 shadow-sm backdrop-blur-sm group-hover:flex">
            {!module.parentId && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onAddSubmodule(module.id); }}
                className="p-1 rounded hover:bg-primary/15 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Add Sub-module"
              >
                <Plus className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setEditing(true); setEditName(module.name); }}
              className="p-1 rounded hover:bg-primary/15 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Rename"
            >
              <Edit2 className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(module.id); }}
              className="p-1 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>

      {hasChildren && (
        <div
          inert={!expanded}
          className={cn(
            "relative space-y-0.5 overflow-hidden transition-[opacity,max-height] duration-150 ease-out",
            expanded ? "opacity-100 max-h-[1000px] pt-0.5" : "opacity-0 max-h-0 pointer-events-none"
          )}
        >
          {/* Continuous vertical trunk line from bottom of parent row down to center of last child */}
          <div
            className="absolute left-[47px] top-0 bottom-[16px] w-[1.5px] bg-muted-foreground/50 dark:bg-muted-foreground/60 pointer-events-none z-10"
          />

          {childModules.map((child, ci) => (
            <ModuleItem
              key={child.id}
              module={child}
              childModules={allModules
                .filter((m: any) => m.parentId === child.id)
                .sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))}
              allModules={allModules}
              selectedModule={selectedModule}
              onSelect={onSelect}
              getCaseCount={getCaseCount}
              onRename={onRename}
              onDelete={onDelete}
              onReorder={onReorder}
              onDragReorder={onDragReorder}
              onAddSubmodule={onAddSubmodule}
              onMoveCases={onMoveCases}
              index={ci}
              total={childModules.length}
              isSubmodule={true}
              isLastChild={ci === childModules.length - 1}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
}
