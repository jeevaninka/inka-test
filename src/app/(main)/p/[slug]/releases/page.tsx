"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  Rocket,
  Plus,
  Play,
  RotateCcw,
  Check,
  X,
  ExternalLink,
  ChevronDown,
  Sparkles,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Trash2,
  FileText,
  Tag,
  Folder,
  Layers,
  ArrowRight,
  ShieldAlert,
  MoreVertical,
} from 'lucide-react';
import {
  getProjectReleasesAction,
  createReleaseAction,
  updateReleaseAction,
  deleteReleaseAction,
  addTicketsToReleaseAction,
  syncReleaseTicketsAction,
  toggleTicketExemptionAction,
  deleteReleaseTicketAction,
  syncTicketCasesAction,
  linkRunToReleaseAction,
  unlinkRunFromReleaseAction,
  approveReleaseAction,
  rejectReleaseAction,
  reopenReleaseAction,
  getInkaBoardActiveReleasesAction,
  importReleaseFromInkaBoardAction,
  searchInkaBoardTicketsAction,
  generateAndSaveAiCasesAction,
  type ReleaseOverviewItem,
} from '@/app/actions/releases';
import { bulkAddTagsAction } from '@/app/actions/cases';
import { generateCasesAction } from '@/app/actions/ai';
import { ProgressCircle } from '@/components/common/ProgressCircle';
import { UserAvatar } from '@/components/common/UserAvatar';

export default function ReleasesPage() {
  const params = useParams();
  const slug = params?.slug as string;
  const router = useRouter();
  const { project, cases = [], runs = [], modules = [], members = [], currentUser, setCases, canEdit = true } = useProjectData();

  const [releases, setReleases] = useState<ReleaseOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<'active' | 'all'>('active');
  const [releaseSearchQuery, setReleaseSearchQuery] = useState('');
  const [openReleaseId, setOpenReleaseId] = useState<string | null>(null);
  const [activeTabByRelease, setActiveTabByRelease] = useState<Record<string, 'tickets' | 'runs'>>({});
  const [openTicketMenuId, setOpenTicketMenuId] = useState<string | null>(null);
  const [openRunMenuId, setOpenRunMenuId] = useState<string | null>(null);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createModalMode, setCreateModalMode] = useState<'import' | 'custom'>('import');
  const [createForm, setCreateForm] = useState({ name: '', dueDate: '' });
  const [creating, setCreating] = useState(false);
  const [remoteReleases, setRemoteReleases] = useState<any[]>([]);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [selectedRemoteReleaseId, setSelectedRemoteReleaseId] = useState<string | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [importingRemote, setImportingRemote] = useState(false);

  // Add Tickets Modal
  const [addTicketReleaseId, setAddTicketReleaseId] = useState<string | null>(null);
  const [addTicketInput, setAddTicketInput] = useState('');
  const [addTicketSearchQuery, setAddTicketSearchQuery] = useState('');
  const [inkaBoardSearchResults, setInkaBoardSearchResults] = useState<any[]>([]);
  const [searchingInkaBoard, setSearchingInkaBoard] = useState(false);
  const [selectedTicketKeys, setSelectedTicketKeys] = useState<string[]>([]);
  const [addingTickets, setAddingTickets] = useState(false);
  const [syncingReleaseId, setSyncingReleaseId] = useState<string | null>(null);
  const [justGeneratedIds, setJustGeneratedIds] = useState<Set<string>>(new Set());

  // Link Run Modal
  const [linkRunReleaseId, setLinkRunReleaseId] = useState<string | null>(null);
  const [linkRunSearchQuery, setLinkRunSearchQuery] = useState('');
  const [selectedRunToLink, setSelectedRunToLink] = useState<string | null>(null);
  const [linkingRun, setLinkingRun] = useState(false);

  // Link Test Cases to Ticket Modal
  const [linkCaseModalData, setLinkCaseModalData] = useState<{
    releaseId: string;
    ticketId: string;
    ticketKey: string;
    ticketTitle: string;
    ticketStatus: string;
  } | null>(null);
  const [caseSearchQuery, setCaseSearchQuery] = useState('');
  const [showFiltersDrawer, setShowFiltersDrawer] = useState(false);
  const [selectedTagFilter, setSelectedTagFilter] = useState('');
  const [selectedModuleFilter, setSelectedModuleFilter] = useState('');
  const [selectedPriorityFilter, setSelectedPriorityFilter] = useState('');
  const [selectedCaseIds, setSelectedCaseIds] = useState<Set<string>>(new Set());
  const [savingCaseLinks, setSavingCaseLinks] = useState(false);
  const [generatingAiCases, setGeneratingAiCases] = useState(false);
  const [showReleaseAiCustom, setShowReleaseAiCustom] = useState(false);
  const [releaseAiPrompt, setReleaseAiPrompt] = useState('');
  const [releaseAiCount, setReleaseAiCount] = useState<number>(2);

  // Approval Modal
  const [approveReleaseTarget, setApproveReleaseTarget] = useState<ReleaseOverviewItem | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [approving, setApproving] = useState(false);

  // Rejection Modal
  const [rejectReleaseTarget, setRejectReleaseTarget] = useState<ReleaseOverviewItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionBugLink, setRejectionBugLink] = useState('');
  const [rejecting, setRejecting] = useState(false);

  // Load Releases Data
  const loadReleases = useCallback(async () => {
    if (!project?.id) return;
    try {
      const data = await getProjectReleasesAction(project.id);
      setReleases(data);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load releases');
    } finally {
      setLoading(false);
    }
  }, [project?.id]);

  useEffect(() => {
    loadReleases();
  }, [project?.id]);

  // Close kebab menus on outside click
  useEffect(() => {
    const handleOutsideClick = () => {
      setOpenTicketMenuId(null);
      setOpenRunMenuId(null);
    };
    if (openTicketMenuId || openRunMenuId) {
      window.addEventListener('click', handleOutsideClick);
      return () => window.removeEventListener('click', handleOutsideClick);
    }
  }, [openTicketMenuId, openRunMenuId]);

  // Debounced InkaBoard ticket search across accessible spaces
  useEffect(() => {
    if (!addTicketReleaseId || !project?.id || !addTicketSearchQuery.trim()) {
      setInkaBoardSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingInkaBoard(true);
      try {
        const res = await searchInkaBoardTicketsAction(project.id, addTicketSearchQuery.trim());
        setInkaBoardSearchResults(res || []);
      } catch {
        setInkaBoardSearchResults([]);
      } finally {
        setSearchingInkaBoard(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [addTicketSearchQuery, addTicketReleaseId, project?.id]);

  // Filtered releases list and counts
  const activeCount = useMemo(() => {
    return releases.filter((r) => r.status === 'IN_TESTING' || r.status === 'NOT_STARTED').length;
  }, [releases]);

  const allCount = releases.length;

  const filteredReleases = useMemo(() => {
    const q = releaseSearchQuery.trim().toLowerCase();
    return releases.filter((r) => {
      if (activeFilter === 'active' && r.status !== 'IN_TESTING' && r.status !== 'NOT_STARTED') {
        return false;
      }
      if (q) {
        const matchName = r.name.toLowerCase().includes(q);
        const matchKey = (r.externalRef || '').toLowerCase().includes(q);
        if (!matchName && !matchKey) return false;
      }
      return true;
    });
  }, [releases, activeFilter, releaseSearchQuery]);

  // Extract all unique tags across repository cases for filtering
  const allUniqueTags = useMemo(() => {
    const tags = new Set<string>();
    cases.forEach((c: any) => {
      (c.tags || []).forEach((t: string) => {
        if (!t.startsWith('ticket:')) tags.add(t);
      });
    });
    return Array.from(tags).sort();
  }, [cases]);

  // Filtered cases for Link Case Modal
  const modalFilteredCases = useMemo(() => {
    if (!linkCaseModalData) return [];
    const q = caseSearchQuery.trim().toLowerCase();

    return cases.filter((c: any) => {
      if (q) {
        const matchId = (c.displayId || c.id || '').toLowerCase().includes(q);
        const matchTitle = (c.title || '').toLowerCase().includes(q);
        const matchTag = (c.tags || []).some((t: string) => t.toLowerCase().includes(q));
        if (!matchId && !matchTitle && !matchTag) return false;
      }
      if (selectedTagFilter && !(c.tags || []).includes(selectedTagFilter)) {
        return false;
      }
      if (selectedModuleFilter && c.moduleId !== selectedModuleFilter) {
        return false;
      }
      if (selectedPriorityFilter && (c.priority || '').toUpperCase() !== selectedPriorityFilter.toUpperCase()) {
        return false;
      }
      return true;
    });
  }, [cases, linkCaseModalData, caseSearchQuery, selectedTagFilter, selectedModuleFilter, selectedPriorityFilter]);

  const activeModalFilterCount = [selectedTagFilter, selectedModuleFilter, selectedPriorityFilter].filter(Boolean).length;

  const availableRunsForModal = useMemo(() => {
    const q = linkRunSearchQuery.trim().toLowerCase();
    return runs.filter((r: any) => {
      if (!q) return true;
      const matchName = (r.name || '').toLowerCase().includes(q);
      const matchId = (r.id || '').toLowerCase().includes(q);
      const matchEnv = (r.environment || '').toLowerCase().includes(q);
      return matchName || matchId || matchEnv;
    });
  }, [runs, linkRunSearchQuery]);

  // Handlers
  const handleOpenCreateModal = async () => {
    setShowCreateModal(true);
    setCreateForm({ name: '', dueDate: '' });
    if (project?.id) {
      setLoadingRemote(true);
      try {
        const res = await getInkaBoardActiveReleasesAction(project.id);
        setRemoteConnected(res.connected);
        setRemoteReleases(res.releases);
        if (res.connected && res.releases.length > 0) {
          setCreateModalMode('import');
          setSelectedRemoteReleaseId(res.releases[0].id);
        } else {
          setCreateModalMode('custom');
        }
      } catch {
        setRemoteConnected(false);
        setCreateModalMode('custom');
      } finally {
        setLoadingRemote(false);
      }
    }
  };

  const handleImportRemoteRelease = async () => {
    if (!project?.id || !selectedRemoteReleaseId) {
      toast.error('Please select an InkaBoard release to import');
      return;
    }
    setImportingRemote(true);
    try {
      const imported = await importReleaseFromInkaBoardAction({
        projectId: project.id,
        externalReleaseId: selectedRemoteReleaseId,
      });
      toast.success(`Imported release "${imported.name}" with ${imported.tickets?.length || 0} ticket(s)`);
      setShowCreateModal(false);
      setOpenReleaseId(imported.id);
      await loadReleases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to import release from InkaBoard');
    } finally {
      setImportingRemote(false);
    }
  };

  const handleCreateRelease = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name.trim()) {
      toast.error('Release name is required');
      return;
    }
    if (!project?.id) return;

    setCreating(true);
    try {
      const created = await createReleaseAction({
        projectId: project.id,
        name: createForm.name.trim(),
        dueDate: createForm.dueDate || null,
      });
      toast.success(`Release "${created.name}" created`);
      setShowCreateModal(false);
      setCreateForm({ name: '', dueDate: '' });
      setOpenReleaseId(created.id);
      await loadReleases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create release');
    } finally {
      setCreating(false);
    }
  };

  const handleAddTickets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addTicketReleaseId) return;

    const typedKeys = addTicketInput
      .split(/[\s,]+/)
      .map((k) => k.trim().toUpperCase())
      .filter(Boolean);

    const keys = Array.from(new Set([...selectedTicketKeys, ...typedKeys]));
    if (keys.length === 0) {
      toast.error('Please search or enter at least one ticket key');
      return;
    }

    setAddingTickets(true);
    try {
      await addTicketsToReleaseAction(addTicketReleaseId, keys);
      toast.success(`Added ${keys.length} ticket(s) to release`);
      setAddTicketReleaseId(null);
      setAddTicketInput('');
      setAddTicketSearchQuery('');
      setSelectedTicketKeys([]);
      setInkaBoardSearchResults([]);
      await loadReleases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add tickets');
    } finally {
      setAddingTickets(false);
    }
  };

  const handleSyncTickets = async (releaseId: string) => {
    setSyncingReleaseId(releaseId);
    try {
      toast.info('Checking InkaBoard for updates...');
      const res = await syncReleaseTicketsAction(releaseId);
      if (res.addedCount && res.addedCount > 0) {
        toast.success(`Synced ${res.addedCount} new ticket(s) from InkaBoard`);
      } else {
        toast.success('InkaBoard release is up to date');
      }
      await loadReleases();
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to sync tickets from InkaBoard');
    } finally {
      setSyncingReleaseId(null);
    }
  };

  const handleToggleExempt = async (ticketId: string, currentExempt: boolean) => {
    try {
      await toggleTicketExemptionAction(ticketId, !currentExempt);
      toast.info(currentExempt ? 'Ticket now requires test cases' : 'Ticket exempted from test cases');
      await loadReleases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update ticket exemption');
    }
  };

  const handleDeleteTicket = async (ticketId: string) => {
    try {
      await deleteReleaseTicketAction(ticketId);
      toast.info('Ticket removed from release');
      await loadReleases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove ticket');
    }
  };

  const handleLinkRun = async () => {
    if (!linkRunReleaseId || !selectedRunToLink) {
      toast.error('Please select a test run to link');
      return;
    }

    setLinkingRun(true);
    try {
      await linkRunToReleaseAction(selectedRunToLink, linkRunReleaseId);
      toast.success('Test run linked to release');
      setLinkRunReleaseId(null);
      setSelectedRunToLink(null);
      await loadReleases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to link test run');
    } finally {
      setLinkingRun(false);
    }
  };

  const handleUnlinkRun = async (runId: string) => {
    try {
      await unlinkRunFromReleaseAction(runId);
      toast.info('Test run unlinked from release');
      await loadReleases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to unlink run');
    }
  };

  // Open Link Case Modal
  const openLinkCaseModal = (rel: ReleaseOverviewItem, t: any) => {
    setLinkCaseModalData({
      releaseId: rel.id,
      ticketId: t.id,
      ticketKey: t.ticketKey,
      ticketTitle: t.title || `${t.ticketKey} Verification`,
      ticketStatus: t.ticketStatus || 'In QA',
    });
    setCaseSearchQuery('');
    setSelectedTagFilter('');
    setSelectedModuleFilter('');
    setSelectedPriorityFilter('');
    setShowFiltersDrawer(false);

    // Pre-select cases already carrying this ticket's label or tracked in release
    const preselected = new Set<string>();
    (t.caseIds || []).forEach((id: string) => preselected.add(id));
    cases.forEach((c: any) => {
      const allTags = [...(c.labels || []), ...(c.tags || [])].map((s: string) => s.toUpperCase());
      if (allTags.includes(`TICKET:${t.ticketKey.toUpperCase()}`) || allTags.includes(t.ticketKey.toUpperCase())) {
        preselected.add(c.id);
      }
    });
    setSelectedCaseIds(preselected);
  };

  const handleConfirmLinkCases = async () => {
    if (!linkCaseModalData || !project?.id) return;
    const caseIdsArray = Array.from(selectedCaseIds);
    setSavingCaseLinks(true);

    try {
      await syncTicketCasesAction({
        projectId: project.id,
        ticketKey: linkCaseModalData.ticketKey,
        selectedCaseIds: caseIdsArray,
      });

      const lowerKey = linkCaseModalData.ticketKey.toLowerCase();
      const tagKey = `ticket:${lowerKey}`;
      if (setCases) {
        const updatedCases = cases.map((c: any) => {
          const isSelected = selectedCaseIds.has(c.id);
          const existingTags = c.tags || [];
          const existingLabels = c.labels || [];
          const isMatch = (val: string) => {
            const v = String(val || '').toLowerCase().trim();
            return v === lowerKey || v === tagKey;
          };

          if (isSelected) {
            const merged = Array.from(new Set([...existingTags, tagKey, lowerKey]));
            return { ...c, tags: merged };
          } else if (existingTags.some(isMatch) || existingLabels.some(isMatch)) {
            return {
              ...c,
              tags: existingTags.filter((t: string) => !isMatch(t)),
              labels: existingLabels.filter((l: string) => !isMatch(l)),
            };
          }
          return c;
        });
        setCases(updatedCases);
      }

      toast.success(`Linked ${caseIdsArray.length} test case(s) to ${linkCaseModalData.ticketKey}`);
      setLinkCaseModalData(null);
      await loadReleases();
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to link test cases');
    } finally {
      setSavingCaseLinks(false);
    }
  };

  const handleAiGenerateCases = async (customInstructionsOverride?: string) => {
    if (!linkCaseModalData || !project?.id) return;
    setGeneratingAiCases(true);
    toast.info('Generating & saving test cases with AI...');

    try {
      const effectiveCustom =
        customInstructionsOverride !== undefined
          ? customInstructionsOverride.trim()
          : undefined;
      const generated = await generateAndSaveAiCasesAction({
        projectId: project.id,
        ticketKey: linkCaseModalData.ticketKey,
        ticketTitle: linkCaseModalData.ticketTitle,
        count: releaseAiCount || 2,
        customInstructions: effectiveCustom || undefined,
      });

      if (generated && generated.length > 0) {
        if (setCases) {
          setCases([...generated, ...cases]);
        }
        setSelectedCaseIds((prev) => {
          const next = new Set(prev);
          generated.forEach((c: any) => next.add(c.id));
          return next;
        });
        setJustGeneratedIds(new Set(generated.map((c: any) => c.id)));
        setShowReleaseAiCustom(false);
        toast.success(`Generated & selected ${generated.length} test case(s) for ${linkCaseModalData.ticketKey}`);
      }

      await loadReleases();
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'AI case generation failed');
    } finally {
      setGeneratingAiCases(false);
    }
  };

  // Approval Execution
  const handleConfirmApproval = async () => {
    if (!approveReleaseTarget) return;
    setApproving(true);

    try {
      await approveReleaseAction(approveReleaseTarget.id, approvalNote.trim() || undefined);
      toast.success(`Release "${approveReleaseTarget.name}" approved`);
      setApproveReleaseTarget(null);
      setApprovalNote('');
      await loadReleases();
    } catch (err: any) {
      toast.error(err.message || 'Approval failed');
    } finally {
      setApproving(false);
    }
  };

  // Rejection Execution
  const handleConfirmRejection = async () => {
    if (!rejectReleaseTarget) return;
    if (!rejectionReason.trim() || rejectionReason.trim().length < 5) {
      toast.error('Rejection reason must be at least 5 characters');
      return;
    }

    setRejecting(true);
    try {
      await rejectReleaseAction(
        rejectReleaseTarget.id,
        rejectionReason.trim(),
        rejectionBugLink.trim() || undefined
      );
      toast.error(`Release "${rejectReleaseTarget.name}" marked as Rejected`);
      setRejectReleaseTarget(null);
      setRejectionReason('');
      setRejectionBugLink('');
      await loadReleases();
    } catch (err: any) {
      toast.error(err.message || 'Rejection failed');
    } finally {
      setRejecting(false);
    }
  };

  const handleReopen = async (relId: string, relName: string) => {
    try {
      await reopenReleaseAction(relId);
      toast.info(`Release "${relName}" re-opened for testing`);
      await loadReleases();
    } catch (err: any) {
      toast.error(err.message || 'Failed to re-open release');
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-3.5">
      {/* Row 1: Title, Active/All Tabs & New Release Button */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Releases</h1>
          <div className="inline-flex items-center rounded-xl border border-border/60 bg-muted/20 p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setActiveFilter('active')}
              className={cn(
                'px-3 py-1 rounded-lg transition-colors cursor-pointer',
                activeFilter === 'active'
                  ? 'bg-primary/15 text-primary font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Active ({activeCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveFilter('all')}
              className={cn(
                'px-3 py-1 rounded-lg transition-colors cursor-pointer',
                activeFilter === 'all'
                  ? 'bg-primary/15 text-primary font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              All ({allCount})
            </button>
          </div>
        </div>

        {canEdit && (
          <button
            onClick={handleOpenCreateModal}
            className="gradient-btn text-white h-9 px-4 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            New Release
          </button>
        )}
      </div>

      {/* Row 2: Search Bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative w-full max-w-sm">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={releaseSearchQuery}
            onChange={(e) => setReleaseSearchQuery(e.target.value)}
            placeholder="Search releases..."
            className="w-full h-8 bg-background border border-input rounded-xl pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-primary/50"
          />
          {releaseSearchQuery && (
            <button
              type="button"
              onClick={() => setReleaseSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Releases Table */}
      <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
        <table className="w-full min-w-[520px] text-left text-xs">
          <thead className="bg-white/[0.015] border-b border-border/50 text-muted-foreground uppercase tracking-wider text-[11px]">
            <tr>
              <th className="h-11 px-3 font-semibold">Release</th>
              <th className="h-11 px-3 font-semibold w-[120px] whitespace-nowrap">Test Execution</th>
              <th className="hidden lg:table-cell h-11 px-3 font-semibold w-[130px] whitespace-nowrap">Test Coverage</th>
              <th className="hidden sm:table-cell h-11 px-3 font-semibold w-[120px] whitespace-nowrap">Due Date</th>
              <th className="hidden xl:table-cell h-11 px-3 font-semibold w-[80px] text-center whitespace-nowrap">Author</th>
              <th className="h-11 px-3 font-semibold w-[145px] whitespace-nowrap">Status</th>
              <th className="h-11 pl-2 pr-3 font-semibold text-right w-[44px]"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50 text-foreground">
            {loading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  Loading releases...
                </td>
              </tr>
            ) : filteredReleases.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  No releases found. Click <strong>+ New Release</strong> to create one.
                </td>
              </tr>
            ) : (
              filteredReleases.map((rel) => {
                const isOpen = openReleaseId === rel.id;
                const activeTab = activeTabByRelease[rel.id] || 'runs';
                const isLocked = rel.status === 'APPROVED' || rel.status === 'REJECTED' || !canEdit;
                const passPct = rel.metrics && rel.metrics.total > 0 ? (rel.metrics.pass / rel.metrics.total) * 100 : 0;
                const failPct = rel.metrics && rel.metrics.total > 0 ? (rel.metrics.fail / rel.metrics.total) * 100 : 0;
                const blockedPct = rel.metrics && rel.metrics.total > 0 ? (rel.metrics.blocked / rel.metrics.total) * 100 : 0;
                const invalidPct = rel.metrics && rel.metrics.total > 0 ? (rel.metrics.invalid / rel.metrics.total) * 100 : 0;
                const skipPct = rel.metrics && rel.metrics.total > 0 ? (rel.metrics.skip / rel.metrics.total) * 100 : 0;

                const creatorMember = members.find(
                  (m: any) => rel.createdBy?.id && Number(m.userId || m.user?.id) === Number(rel.createdBy.id)
                )?.user;
                const authorName =
                  creatorMember?.name ||
                  rel.createdBy?.name ||
                  currentUser?.name ||
                  'Creator';
                const authorImage =
                  creatorMember?.avatarUrl ||
                  rel.createdBy?.imageUrl ||
                  (rel.createdBy ? null : currentUser?.image) ||
                  null;
                const authorColor =
                  creatorMember?.avatarColor || rel.createdBy?.avatarColor || null;
                const authorInitials =
                  creatorMember?.avatarInitials || rel.createdBy?.avatarInitials || null;

                return (
                  <React.Fragment key={rel.id}>
                    {/* Summary Row */}
                    <tr
                      onClick={() => setOpenReleaseId(isOpen ? null : rel.id)}
                      className="hover:bg-primary/[0.06] dark:hover:bg-white/[0.05] transition-colors cursor-pointer group"
                    >
                      {/* 1. Release Column: Name (teal on hover) + Source tag/link + Created Date/Time */}
                      <td className="py-3.5 px-3">
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="font-semibold text-foreground group-hover:text-primary transition-colors text-sm truncate"
                              title={rel.name}
                            >
                              {rel.name}
                            </span>
                            {rel.externalRef ? (
                              rel.externalUrl ? (
                                <a
                                  href={rel.externalUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60 text-[10px] font-medium shrink-0 transition-colors"
                                  title="Open release in InkaBoard"
                                >
                                  <span>InkaBoard</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-muted/50 text-muted-foreground border border-border/50 text-[10px] font-medium shrink-0">
                                  InkaBoard
                                </span>
                              )
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.2 rounded bg-muted/40 text-muted-foreground border border-border/50 text-[10px] font-medium shrink-0">
                                Custom
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-muted-foreground mt-0.5 truncate">
                            Created {format(new Date(rel.createdAt), 'MMM d, yyyy · h:mm a')}
                          </span>
                        </div>
                      </td>

                      {/* 2. Test Execution */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {rel.metrics ? (
                          <Tooltip
                            side="top"
                            className="whitespace-normal p-0 max-w-none bg-transparent border-0 shadow-none"
                            content={
                              <div className="p-3 space-y-2.5 w-64 text-left bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl">
                                <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                                  <span className="text-[11px] font-semibold text-slate-200">Execution Progress</span>
                                  <span className="text-[11px] font-mono font-bold text-emerald-400">{rel.metrics.completedPct}% completed</span>
                                </div>
                                <div className="h-1.5 w-full rounded-full overflow-hidden bg-slate-800 flex">
                                  {passPct > 0 && <div style={{ width: `${passPct}%` }} className="bg-emerald-500 h-full" />}
                                  {failPct > 0 && <div style={{ width: `${failPct}%` }} className="bg-rose-500 h-full" />}
                                  {blockedPct > 0 && <div style={{ width: `${blockedPct}%` }} className="bg-amber-500 h-full" />}
                                  {invalidPct > 0 && <div style={{ width: `${invalidPct}%` }} className="bg-violet-500 h-full" />}
                                  {skipPct > 0 && <div style={{ width: `${skipPct}%` }} className="bg-slate-400 h-full" />}
                                </div>
                                <div className="space-y-1.5 text-[11px]">
                                  <div className="flex items-center justify-between text-slate-300">
                                    <span className="flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                      Passed
                                    </span>
                                    <span className="font-mono font-medium text-emerald-400">{rel.metrics.pass}</span>
                                  </div>
                                  {rel.metrics.fail > 0 && (
                                    <div className="flex items-center justify-between text-slate-300">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                        Failed
                                      </span>
                                      <span className="font-mono font-medium text-rose-400">{rel.metrics.fail}</span>
                                    </div>
                                  )}
                                  {rel.metrics.blocked > 0 && (
                                    <div className="flex items-center justify-between text-slate-300">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                        Blocked
                                      </span>
                                      <span className="font-mono font-medium text-amber-400">{rel.metrics.blocked}</span>
                                    </div>
                                  )}
                                  {rel.metrics.pend > 0 && (
                                    <div className="flex items-center justify-between text-slate-300">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                        Pending
                                      </span>
                                      <span className="font-mono font-medium text-slate-400">{rel.metrics.pend}</span>
                                    </div>
                                  )}
                                  {rel.metrics.skip > 0 && (
                                    <div className="flex items-center justify-between text-slate-300">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                        Skipped
                                      </span>
                                      <span className="font-mono font-medium text-slate-300">{rel.metrics.skip}</span>
                                    </div>
                                  )}
                                  {rel.metrics.invalid > 0 && (
                                    <div className="flex items-center justify-between text-slate-300">
                                      <span className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                        Invalid
                                      </span>
                                      <span className="font-mono font-medium text-violet-400">{rel.metrics.invalid}</span>
                                    </div>
                                  )}
                                </div>
                                <div className="pt-1.5 border-t border-white/10 text-[10px] text-slate-400">
                                  {rel.metrics.caseCount} cases across {rel.metrics.runCount} {rel.metrics.runCount === 1 ? 'run' : 'runs'}
                                </div>
                              </div>
                            }
                          >
                            <div className="flex items-center gap-2.5 cursor-pointer w-fit text-xs">
                              <ProgressCircle
                                segments={{
                                  pass: rel.metrics.pass,
                                  fail: rel.metrics.fail,
                                  blocked: rel.metrics.blocked,
                                  invalid: rel.metrics.invalid,
                                  skip: rel.metrics.skip,
                                  total: rel.metrics.total,
                                }}
                                size={26}
                                strokeWidth={3}
                              />
                              <span className="font-semibold font-mono text-[11px] text-foreground">
                                {rel.metrics.completedPct}%
                              </span>
                            </div>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground text-xs">No runs linked</span>
                        )}
                      </td>

                      {/* 3. Test Coverage: 1-line compact layout with rich Hover Card */}
                      <td className="hidden lg:table-cell py-3.5 px-3 whitespace-nowrap">
                        {rel.coverage.totalTickets > 0 ? (
                          (() => {
                            const covPct = Math.round((rel.coverage.coveredTickets / rel.coverage.totalTickets) * 100);
                            return (
                              <Tooltip
                                side="top"
                                className="whitespace-normal p-0 max-w-none bg-transparent border-0 shadow-none"
                                content={
                                  <div className="p-3 space-y-2.5 w-60 text-left bg-[#121622]/95 border border-white/15 rounded-xl shadow-2xl backdrop-blur-xl">
                                    <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                                      <span className="text-[11px] font-semibold text-slate-200">Test Coverage</span>
                                      <span className="text-[11px] font-mono font-bold text-primary">{covPct}% covered</span>
                                    </div>
                                    <div className="flex items-center justify-center py-2">
                                      <ProgressCircle
                                        value={covPct}
                                        size={44}
                                        strokeWidth={4.5}
                                        showDot={true}
                                        showPercentage={true}
                                      />
                                    </div>
                                    <div className="space-y-1.5 text-[11px]">
                                      <div className="flex items-center justify-between text-slate-300">
                                        <span className="flex items-center gap-1.5">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                          Covered with tests
                                        </span>
                                        <span className="font-mono font-medium text-emerald-400">{rel.coverage.coveredTickets}</span>
                                      </div>
                                      {rel.coverage.uncoveredCount > 0 && (
                                        <div className="flex items-center justify-between text-slate-300">
                                          <span className="flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                            Without tests
                                          </span>
                                          <span className="font-mono font-medium text-amber-400">{rel.coverage.uncoveredCount}</span>
                                        </div>
                                      )}
                                    </div>
                                    <div className="pt-1.5 border-t border-white/10 text-[10px] text-slate-400">
                                      {rel.coverage.totalTickets} total tickets in release
                                    </div>
                                  </div>
                                }
                              >
                                <div className="flex items-center gap-2.5 cursor-pointer text-xs w-fit">
                                  <ProgressCircle
                                    value={covPct}
                                    size={26}
                                    strokeWidth={3}
                                  />
                                  <span className={`font-semibold font-mono text-[11px] ${covPct === 100 ? 'text-emerald-500' : 'text-foreground'}`}>
                                    {covPct}%
                                  </span>
                                  <span className="text-[11px] text-muted-foreground font-mono">
                                    ({rel.coverage.coveredTickets}/{rel.coverage.totalTickets})
                                  </span>
                                </div>
                              </Tooltip>
                            );
                          })()
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>

                      {/* 4. Due Date */}
                      <td className="hidden sm:table-cell py-3.5 px-3 text-xs whitespace-nowrap">
                        <span className={cn('block truncate', rel.isOverdue ? 'text-rose-500 font-bold' : rel.isDueToday ? 'text-amber-500 font-semibold' : 'text-muted-foreground')} title={rel.timelineText}>
                          {rel.timelineText}
                        </span>
                      </td>

                      {/* 5. Author (Avatar only + Name on hover) */}
                      <td className="hidden xl:table-cell py-3.5 px-3 text-center whitespace-nowrap">
                        <Tooltip content={authorName} side="top">
                          <div className="flex items-center justify-center">
                            <UserAvatar
                              userId={rel.createdBy?.id ?? currentUser?.id}
                              name={authorName}
                              fullName={creatorMember?.fullName || rel.createdBy?.name}
                              imageUrl={authorImage}
                              color={authorColor}
                              initials={authorInitials}
                              size="sm"
                              className="shrink-0 mx-auto"
                            />
                          </div>
                        </Tooltip>
                      </td>

                      {/* 6. Status (Consolidated Status + Sign-off, last data column) */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {rel.status === 'APPROVED' ? (
                          <Tooltip content={rel.blockerSummary} side="top">
                            <span className="inline-flex max-w-full items-center gap-2 text-xs font-medium text-emerald-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                              <span className="truncate">Approved</span>
                            </span>
                          </Tooltip>
                        ) : rel.status === 'REJECTED' ? (
                          <Tooltip content={rel.blockerSummary} side="top">
                            <span className="inline-flex max-w-full items-center gap-2 text-xs font-medium text-rose-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                              <span className="truncate">Rejected</span>
                            </span>
                          </Tooltip>
                        ) : rel.status === 'IN_TESTING' ? (
                          rel.blockerSummary === 'Ready for sign-off' ? (
                            <span className="inline-flex max-w-full items-center gap-2 text-xs font-medium text-primary">
                              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                              <span className="truncate">Ready for Sign-off</span>
                            </span>
                          ) : (
                            <span className="inline-flex max-w-full items-center gap-2 text-xs font-medium text-foreground">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                              <span className="truncate">In Testing</span>
                            </span>
                          )
                        ) : (
                          <span className="inline-flex max-w-full items-center gap-2 text-xs font-medium text-muted-foreground">
                            <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60 shrink-0" />
                            <span className="truncate">Not Started</span>
                          </span>
                        )}
                      </td>

                      {/* 7. Expand Chevron */}
                      <td className="py-3.5 pl-2 pr-3 text-right">
                        <span className="inline-flex h-5 w-5 items-center justify-center">
                          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                        </span>
                      </td>
                    </tr>

                    {/* In-Row Accordion Expansion Row */}
                    {isOpen && (
                      <tr className="bg-muted/10 border-b border-border/50">
                        <td colSpan={7} className="p-4 px-6 space-y-3.5">
                          {/* Segmented Tab Switcher (Runs vs Tickets) + Action buttons inside */}
                          <div className="flex items-center justify-between border-b border-border/40 pb-3 flex-wrap gap-3">
                            <div className="inline-flex rounded-xl border border-border/60 bg-muted/20 p-1 text-xs font-medium">
                              <button
                                onClick={() => setActiveTabByRelease({ ...activeTabByRelease, [rel.id]: 'runs' })}
                                className={`px-3 py-1 rounded-lg transition-all ${
                                  activeTab === 'runs'
                                    ? 'bg-primary/20 text-primary font-semibold shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                Test runs ({rel.runs.length})
                              </button>
                              <button
                                onClick={() => setActiveTabByRelease({ ...activeTabByRelease, [rel.id]: 'tickets' })}
                                className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
                                  activeTab === 'tickets'
                                    ? 'bg-primary/20 text-primary font-semibold shadow-xs'
                                    : 'text-muted-foreground hover:text-foreground'
                                }`}
                              >
                                <span>Tickets ({rel.tickets.length})</span>
                                {rel.coverage.uncoveredCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
                              </button>
                            </div>

                            {canEdit && (
                              <div className="flex items-center gap-3">
                                {rel.status === 'IN_TESTING' ? (
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => setRejectReleaseTarget(rel)}
                                      className="h-9 px-4 rounded-xl border border-rose-500/30 bg-rose-500/[0.08] hover:bg-rose-500/15 text-rose-400 hover:text-rose-300 text-xs font-semibold transition-all flex items-center justify-center cursor-pointer shadow-sm"
                                    >
                                      Reject
                                    </button>
                                    <button
                                      onClick={() => setApproveReleaseTarget(rel)}
                                      className="gradient-btn text-white h-9 px-4 rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center justify-center cursor-pointer"
                                    >
                                      Approve Release
                                    </button>
                                  </div>
                                ) : isLocked ? (
                                  <div className="flex items-center gap-2.5">
                                    <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-normal">
                                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />
                                      Locked ({rel.status === 'APPROVED' ? 'Approved' : 'Rejected'}). Re-open to modify.
                                    </span>
                                    <button
                                      onClick={() => handleReopen(rel.id, rel.name)}
                                      className="h-9 px-4 rounded-xl bg-muted/40 hover:bg-muted text-foreground border border-border/60 text-xs font-semibold transition-all flex items-center justify-center cursor-pointer shadow-sm"
                                    >
                                      Re-open
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            )}
                          </div>

                          {/* TAB 1: TICKETS TAB */}
                          {activeTab === 'tickets' && (
                            <div className="space-y-2.5 text-xs">
                              {/* Tab Top Bar: Action Buttons in Header */}
                              <div className="flex items-center justify-between pb-1">
                                <span className="font-semibold text-foreground text-xs">
                                  Tickets in this release ({rel.tickets.length})
                                </span>
                                {!isLocked && (
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={() => setAddTicketReleaseId(rel.id)}
                                      className="text-primary hover:underline text-xs font-semibold flex items-center gap-1"
                                    >
                                      + Add tickets
                                    </button>
                                    {rel.externalRef && (
                                      <>
                                        <span className="text-muted-foreground/40">·</span>
                                        <button
                                          onClick={() => handleSyncTickets(rel.id)}
                                          disabled={syncingReleaseId === rel.id}
                                          className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors disabled:opacity-50"
                                          title="Check InkaBoard for newly added tickets"
                                        >
                                          <RotateCcw className={`w-3 h-3 ${syncingReleaseId === rel.id ? 'animate-spin' : ''}`} />
                                          <span>{syncingReleaseId === rel.id ? 'Syncing...' : 'Sync InkaBoard'}</span>
                                        </button>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>

                              <div className="border border-border/50 rounded-xl divide-y divide-border/30 bg-background/50 max-h-64 overflow-y-auto custom-scrollbar">
                                {rel.tickets.length === 0 ? (
                                  <div className="p-4 text-center text-muted-foreground">
                                    No tickets in this release yet. Click <strong>+ Add tickets</strong> above or import from InkaBoard.
                                  </div>
                                ) : (
                                  rel.tickets.map((t) => {
                                    const isNeedsCases = !t.exempt && !t.isStillToDo && t.caseCount === 0;

                                    return (
                                      <div key={t.id} className="p-2.5 px-3.5 flex items-center justify-between hover:bg-muted/20 transition-colors">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                          <span className="font-mono font-bold text-foreground">
                                            {t.ticketKey}
                                          </span>
                                          <span className="truncate font-medium text-foreground">{t.title}</span>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                          {t.exempt ? (
                                            <span className="text-[11px] text-muted-foreground font-mono">Exempt (no tests needed)</span>
                                          ) : isLocked ? (
                                            <div className="flex items-center gap-1.5">
                                              {t.caseCount > 0 ? (
                                                <Tooltip
                                                  side="top"
                                                  interactive={true}
                                                  className="whitespace-normal p-0 max-w-none bg-transparent border-0 shadow-none"
                                                  content={
                                                    <div className="p-3 space-y-2 w-72 text-left bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl">
                                                      <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                                                        <span className="text-[11px] font-semibold text-slate-200">
                                                          Linked Test Cases ({t.caseCount})
                                                        </span>
                                                        <span className="text-[10px] text-primary font-mono font-bold">{t.ticketKey}</span>
                                                      </div>
                                                      <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                                                        {t.cases && t.cases.length > 0 ? (
                                                          t.cases.map((c) => (
                                                            <button
                                                              key={c.id}
                                                              type="button"
                                                              onClick={() => router.push(`/p/${slug}/repository?case=${c.id}`)}
                                                              className="w-full text-left p-1.5 rounded-lg hover:bg-white/10 flex items-center justify-between gap-2 group transition-colors cursor-pointer"
                                                            >
                                                              <div className="min-w-0 flex-1 flex items-start gap-1.5 text-[11px]">
                                                                <span className="font-mono text-primary font-semibold shrink-0 group-hover:underline">
                                                                  {c.displayId || 'Case'}:
                                                                </span>
                                                                <span className="truncate text-slate-200 group-hover:text-white" title={c.title}>
                                                                  {c.title}
                                                                </span>
                                                              </div>
                                                              <ExternalLink className="w-3 h-3 text-muted-foreground opacity-60 group-hover:opacity-100 shrink-0" />
                                                            </button>
                                                          ))
                                                        ) : (
                                                          <div className="text-[11px] text-slate-400">
                                                            {t.caseCount} cases covering this ticket
                                                          </div>
                                                        )}
                                                      </div>
                                                    </div>
                                                  }
                                                >
                                                  <span className="text-[11px] text-muted-foreground cursor-pointer underline decoration-dotted hover:text-foreground transition-colors">
                                                    {t.caseCount} {t.caseCount === 1 ? 'case' : 'cases'}
                                                  </span>
                                                </Tooltip>
                                              ) : (
                                                <span className="text-[11px] text-muted-foreground/70 font-mono">No cases linked</span>
                                              )}
                                            </div>
                                          ) : t.isStillToDo && t.caseCount === 0 ? (
                                            <div className="flex items-center gap-2">
                                              <span className="text-[11px] text-muted-foreground/80 font-mono">Not ready for QA</span>
                                              <button
                                                onClick={() => openLinkCaseModal(rel, t)}
                                                className="text-muted-foreground hover:text-primary text-[11px] underline"
                                              >
                                                + Link case
                                              </button>
                                            </div>
                                          ) : isNeedsCases ? (
                                            <button
                                              onClick={() => openLinkCaseModal(rel, t)}
                                              className="px-2.5 py-1 rounded-lg bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 text-[11px] font-semibold transition-all"
                                            >
                                              + Link case
                                            </button>
                                          ) : (
                                            <div className="flex items-center gap-1.5">
                                              <Tooltip
                                                side="top"
                                                interactive={true}
                                                className="whitespace-normal p-0 max-w-none bg-transparent border-0 shadow-none"
                                                content={
                                                  <div className="p-3 space-y-2 w-72 text-left bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl">
                                                    <div className="flex items-center justify-between border-b border-white/10 pb-1.5">
                                                      <span className="text-[11px] font-semibold text-slate-200">
                                                        Linked Test Cases ({t.caseCount})
                                                      </span>
                                                      <span className="text-[10px] text-primary font-mono font-bold">{t.ticketKey}</span>
                                                    </div>
                                                    <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                                                      {t.cases && t.cases.length > 0 ? (
                                                        t.cases.map((c) => (
                                                          <button
                                                            key={c.id}
                                                            type="button"
                                                            onClick={() => router.push(`/p/${slug}/repository?case=${c.id}`)}
                                                            className="w-full text-left p-1.5 rounded-lg hover:bg-white/10 flex items-center justify-between gap-2 group transition-colors cursor-pointer"
                                                          >
                                                            <div className="min-w-0 flex-1 flex items-start gap-1.5 text-[11px]">
                                                              <span className="font-mono text-primary font-semibold shrink-0 group-hover:underline">
                                                                {c.displayId || 'Case'}:
                                                              </span>
                                                              <span className="truncate text-slate-200 group-hover:text-white" title={c.title}>
                                                                {c.title}
                                                              </span>
                                                            </div>
                                                            <ExternalLink className="w-3 h-3 text-muted-foreground opacity-60 group-hover:opacity-100 shrink-0" />
                                                          </button>
                                                        ))
                                                      ) : (
                                                        <div className="text-[11px] text-slate-400">
                                                          {t.caseCount} cases covering this ticket
                                                        </div>
                                                      )}
                                                    </div>
                                                  </div>
                                                }
                                              >
                                                <span className="text-[11px] text-muted-foreground cursor-pointer underline decoration-dotted hover:text-foreground transition-colors">
                                                  {t.caseCount} {t.caseCount === 1 ? 'case' : 'cases'}
                                                </span>
                                              </Tooltip>
                                              <button
                                                onClick={() => openLinkCaseModal(rel, t)}
                                                className="text-muted-foreground hover:text-primary text-[11px] underline ml-1"
                                              >
                                                Edit
                                              </button>
                                            </div>
                                          )}

                                          {/* Ticket ⋯ Menu */}
                                          {!isLocked && (
                                            <div 
                                              className="relative"
                                              onMouseEnter={() => setOpenTicketMenuId(t.id)}
                                              onMouseLeave={() => setOpenTicketMenuId(null)}
                                            >
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setOpenTicketMenuId(openTicketMenuId === t.id ? null : t.id);
                                                }}
                                                className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                                                title="More options"
                                              >
                                                <MoreVertical className="w-3.5 h-3.5" />
                                              </button>

                                              {openTicketMenuId === t.id && (
                                                <div
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="absolute right-0 top-full mt-1 z-30 w-44 rounded-xl border border-border/80 bg-card p-1 shadow-lg text-xs space-y-0.5"
                                                >
                                                  <button
                                                    onClick={() => {
                                                      setOpenTicketMenuId(null);
                                                      handleToggleExempt(t.id, t.exempt);
                                                    }}
                                                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted text-foreground flex items-center justify-between"
                                                  >
                                                    <span>{t.exempt ? 'Require test cases' : 'Exempt from QA'}</span>
                                                  </button>
                                                  <button
                                                    onClick={() => {
                                                      setOpenTicketMenuId(null);
                                                      if (confirm(`Remove ticket ${t.ticketKey} from this release?`)) {
                                                        handleDeleteTicket(t.id);
                                                      }
                                                    }}
                                                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 text-rose-500 flex items-center justify-between"
                                                  >
                                                    <span>Remove from release</span>
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          )}

                          {/* TAB 2: TEST RUNS TAB */}
                          {activeTab === 'runs' && (
                            <div className="space-y-2 text-xs">
                              <div className="border border-border/50 rounded-xl divide-y divide-border/30 bg-background/50">
                                {rel.runs.length === 0 ? (
                                  <div className="p-4 text-center text-muted-foreground">
                                    No test runs linked yet. Link a run below to evaluate this release.
                                  </div>
                                ) : (
                                  rel.runs.map((r) => {
                                    const completed = (r.pass || 0) + (r.fail || 0) + (r.blocked || 0) + (r.skip || 0) + (r.invalid || 0);
                                    const total = completed + (r.pend || 0);
                                    const isFullyExecuted = total > 0 && completed === total;
                                    const rPassPct = total > 0 ? ((r.pass || 0) / total) * 100 : 0;
                                    const rFailPct = total > 0 ? ((r.fail || 0) / total) * 100 : 0;
                                    const rBlockedPct = total > 0 ? ((r.blocked || 0) / total) * 100 : 0;
                                    const rInvalidPct = total > 0 ? ((r.invalid || 0) / total) * 100 : 0;
                                    const rSkipPct = total > 0 ? ((r.skip || 0) / total) * 100 : 0;

                                    return (
                                      <div key={r.id} className="p-3 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                          <span className="font-mono text-primary font-bold">{r.id}</span>
                                          <span className="font-semibold text-foreground">{r.name}</span>
                                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-muted/40 text-foreground border border-border/40">
                                            {r.environment}
                                          </span>

                                          {/* Simplified status: Mini segmented bar + execution progress + exception highlight + tooltip */}
                                          <Tooltip
                                            side="top"
                                            className="whitespace-normal p-0 max-w-none bg-transparent border-0 shadow-none"
                                            content={
                                              <div className="p-3 space-y-2 w-52 text-left bg-popover text-popover-foreground border border-border rounded-xl shadow-xl text-xs">
                                                <div className="flex items-center justify-between border-b border-border/50 pb-1.5 font-semibold text-foreground">
                                                  <span>Run Breakdown</span>
                                                  <span className="font-mono">{total} cases</span>
                                                </div>
                                                <div className="space-y-1.5 text-[11px]">
                                                  <div className="flex items-center justify-between text-muted-foreground">
                                                    <span className="flex items-center gap-1.5">
                                                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                                      Passed
                                                    </span>
                                                    <span className="font-mono font-medium text-emerald-400">{r.pass}</span>
                                                  </div>
                                                  {r.fail > 0 && (
                                                    <div className="flex items-center justify-between text-muted-foreground">
                                                      <span className="flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                                        Failed
                                                      </span>
                                                      <span className="font-mono font-medium text-rose-400">{r.fail}</span>
                                                    </div>
                                                  )}
                                                  {r.blocked > 0 && (
                                                    <div className="flex items-center justify-between text-muted-foreground">
                                                      <span className="flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                                                        Blocked
                                                      </span>
                                                      <span className="font-mono font-medium text-amber-400">{r.blocked}</span>
                                                    </div>
                                                  )}
                                                  {r.invalid > 0 && (
                                                    <div className="flex items-center justify-between text-muted-foreground">
                                                      <span className="flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                                                        Invalid
                                                      </span>
                                                      <span className="font-mono font-medium text-violet-400">{r.invalid}</span>
                                                    </div>
                                                  )}
                                                  {r.skip > 0 && (
                                                    <div className="flex items-center justify-between text-muted-foreground">
                                                      <span className="flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                                                        Skipped
                                                      </span>
                                                      <span className="font-mono font-medium text-slate-300">{r.skip}</span>
                                                    </div>
                                                  )}
                                                  {r.pend > 0 && (
                                                    <div className="flex items-center justify-between text-muted-foreground">
                                                      <span className="flex items-center gap-1.5">
                                                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/60" />
                                                        Pending
                                                      </span>
                                                      <span className="font-mono font-medium text-muted-foreground">{r.pend}</span>
                                                    </div>
                                                  )}
                                                </div>
                                              </div>
                                            }
                                          >
                                            <div className="flex items-center gap-2 cursor-pointer py-0.5">
                                              <ProgressCircle
                                                segments={{
                                                  pass: r.pass,
                                                  fail: r.fail,
                                                  blocked: r.blocked,
                                                  invalid: r.invalid,
                                                  skip: r.skip,
                                                  total: total,
                                                }}
                                                size={22}
                                                strokeWidth={2.5}
                                              />

                                              {isFullyExecuted && r.fail === 0 && r.blocked === 0 ? (
                                                <span className="text-[11px] font-mono text-emerald-400 font-semibold">
                                                  {r.pass}/{total} passed
                                                </span>
                                              ) : (
                                                <span className="text-[11px] font-mono text-muted-foreground">
                                                  <span className="text-foreground font-semibold">{completed}</span>/{total} executed
                                                </span>
                                              )}

                                              {r.fail > 0 && (
                                                <span className="text-[11px] font-semibold text-rose-400 font-mono">
                                                  · {r.fail} failed
                                                </span>
                                              )}
                                              {r.blocked > 0 && (
                                                <span className="text-[11px] font-semibold text-amber-400 font-mono">
                                                  · {r.blocked} blocked
                                                </span>
                                              )}
                                            </div>
                                          </Tooltip>
                                          <span className="text-muted-foreground/50 text-[11px]">({r.timeAgoText})</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          <button
                                            onClick={() => router.push(`/p/${slug}/runs/${r.id}`)}
                                            className="px-2.5 py-1 rounded-lg bg-muted/40 hover:bg-muted text-primary border border-border/60 text-[11px] font-medium"
                                          >
                                            Open ↗
                                          </button>

                                          {/* Run ⋯ Menu (Only when not locked) */}
                                          {!isLocked && (
                                            <div 
                                              className="relative"
                                              onMouseEnter={() => setOpenRunMenuId(r.id)}
                                              onMouseLeave={() => setOpenRunMenuId(null)}
                                            >
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setOpenRunMenuId(openRunMenuId === r.id ? null : r.id);
                                                }}
                                                className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground"
                                                title="More options"
                                              >
                                                <MoreVertical className="w-3.5 h-3.5" />
                                              </button>

                                              {openRunMenuId === r.id && (
                                                <div
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="absolute right-0 top-full mt-1 z-30 w-44 rounded-xl border border-border/80 bg-card p-1 shadow-lg text-xs space-y-0.5"
                                                >
                                                  <button
                                                    onClick={() => {
                                                      setOpenRunMenuId(null);
                                                      if (confirm(`Unlink test run ${r.id} from this release?`)) {
                                                        handleUnlinkRun(r.id);
                                                      }
                                                    }}
                                                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10 text-rose-500 flex items-center justify-between"
                                                  >
                                                    <span>Unlink from release</span>
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                              {!isLocked && (
                                <div className="pt-1">
                                  <button
                                    onClick={() => setLinkRunReleaseId(rel.id)}
                                    className="text-primary hover:underline text-xs font-semibold flex items-center gap-1"
                                  >
                                    + Link an existing test run
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL 1: CREATE / IMPORT RELEASE */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent hideClose className="max-w-md bg-popover text-popover-foreground border border-border p-5 space-y-4 rounded-2xl shadow-2xl">
          <div className="flex items-center justify-between border-b border-border/50 pb-3">
            <h3 className="text-sm font-bold text-foreground">New Release</h3>
            <button onClick={() => setShowCreateModal(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Mode Tabs: Import from InkaBoard vs Custom Release */}
          <div className="inline-flex w-full rounded-xl border border-border/60 bg-muted/20 p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => setCreateModalMode('import')}
              className={`flex-1 py-1.5 rounded-lg transition-all ${
                createModalMode === 'import'
                  ? 'bg-primary/20 text-primary font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Import from InkaBoard
            </button>
            <button
              type="button"
              onClick={() => setCreateModalMode('custom')}
              className={`flex-1 py-1.5 rounded-lg transition-all ${
                createModalMode === 'custom'
                  ? 'bg-primary/20 text-primary font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Custom Release
            </button>
          </div>

            {/* TAB 1: IMPORT FROM INKABOARD */}
            {createModalMode === 'import' && (
              <div className="text-xs space-y-3.5">
                {loadingRemote ? (
                  <div className="p-6 text-center text-muted-foreground">
                    Checking InkaBoard active releases...
                  </div>
                ) : !remoteConnected ? (
                  <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-2">
                    <p className="text-foreground font-semibold">PM Integration Not Connected</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Connect your InkaBoard credentials in <strong>Settings &gt; Integrations</strong> to import active releases automatically, or create a custom release manually.
                    </p>
                    <button
                      type="button"
                      onClick={() => setCreateModalMode('custom')}
                      className="text-primary font-semibold underline text-xs"
                    >
                      Switch to Custom Release →
                    </button>
                  </div>
                ) : remoteReleases.length === 0 ? (
                  <div className="p-4 rounded-xl border border-border/60 bg-muted/20 space-y-2 text-center">
                    <p className="text-foreground font-semibold">No Active Releases Found</p>
                    <p className="text-[11px] text-muted-foreground">All releases in InkaBoard are released, or none were found.</p>
                    <div className="flex items-center justify-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={handleOpenCreateModal}
                        className="text-primary font-semibold text-xs flex items-center gap-1"
                      >
                        <RotateCcw className="w-3 h-3" /> Refresh InkaBoard
                      </button>
                      <span className="text-muted-foreground">·</span>
                      <button
                        type="button"
                        onClick={() => setCreateModalMode('custom')}
                        className="text-primary font-semibold underline text-xs"
                      >
                        Create Custom Release →
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-medium text-foreground">
                          Select InkaBoard Release
                        </label>
                        <button
                          type="button"
                          onClick={handleOpenCreateModal}
                          className="text-primary hover:underline text-[11px] flex items-center gap-1"
                        >
                          <RotateCcw className="w-3 h-3" /> Refresh
                        </button>
                      </div>
                      <select
                        value={selectedRemoteReleaseId || ''}
                        onChange={(e) => setSelectedRemoteReleaseId(e.target.value)}
                        className="w-full bg-background border border-border/60 rounded-xl px-3 py-2 text-foreground text-xs focus:outline-none focus:border-primary"
                      >
                        {remoteReleases.map((r: any) => (
                          <option key={r.id} value={r.id}>
                            {r.name} {r.versionTag ? `(${r.versionTag})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Preview Strip of the Selected InkaBoard Release */}
                    {(() => {
                      const sel = remoteReleases.find((r) => r.id === selectedRemoteReleaseId);
                      if (!sel) return null;
                      return (
                        <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 space-y-1.5 text-[11px]">
                          <div className="flex justify-between font-semibold text-foreground">
                            <span>{sel.name}</span>
                            {sel.versionTag && <span className="font-mono text-primary">{sel.versionTag}</span>}
                          </div>
                          <div className="flex justify-between text-muted-foreground">
                            <span suppressHydrationWarning>Due Date: {sel.releaseDate ? new Date(sel.releaseDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'None'}</span>
                            {typeof sel.ticketCount === 'number' && (
                              <span className="text-primary font-medium">{sel.ticketCount} ticket(s) attached</span>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                            Importing will create this release in InkaTest and sync all attached tickets automatically.
                          </p>
                        </div>
                      );
                    })()}

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
                      <button
                        type="button"
                        onClick={() => setShowCreateModal(false)}
                        className="px-3 py-1.5 rounded-xl border border-border text-foreground hover:bg-muted text-xs font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleImportRemoteRelease}
                        disabled={importingRemote || !selectedRemoteReleaseId}
                        className="gradient-btn text-white px-4 py-1.5 rounded-xl text-xs font-semibold shadow-sm disabled:opacity-50"
                      >
                        {importingRemote ? 'Importing...' : 'Import Release & Tickets'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TAB 2: CUSTOM MANUAL RELEASE */}
            {createModalMode === 'custom' && (
              <form onSubmit={handleCreateRelease} className="text-xs space-y-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">
                    Release Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                    placeholder="e.g. Release 2026.12 - v2.5.0"
                    className="w-full bg-background border border-border/60 rounded-xl px-3 py-2 text-foreground text-xs focus:outline-none focus:border-primary"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Include the version in the name for simplicity.</p>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">
                    Target Due Date <span className="text-muted-foreground font-normal">(Optional)</span>
                  </label>
                  <input
                    type="date"
                    value={createForm.dueDate}
                    onChange={(e) => setCreateForm({ ...createForm, dueDate: e.target.value })}
                    className="w-full bg-background border border-border/60 rounded-xl px-3 py-2 text-foreground text-xs focus:outline-none focus:border-primary"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-3 py-1.5 rounded-xl border border-border text-foreground hover:bg-muted text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="gradient-btn text-white px-4 py-1.5 rounded-xl text-xs font-semibold shadow-sm disabled:opacity-50"
                  >
                    {creating ? 'Saving...' : 'Save Custom Release'}
                  </button>
                </div>
              </form>
            )}
        </DialogContent>
      </Dialog>

      {/* MODAL 2: ADD TICKETS */}
      <Dialog
        open={Boolean(addTicketReleaseId)}
        onOpenChange={(open) => {
          if (!open) {
            setAddTicketReleaseId(null);
            setAddTicketSearchQuery('');
            setSelectedTicketKeys([]);
            setInkaBoardSearchResults([]);
          }
        }}
      >
        <DialogContent hideClose className="max-w-md bg-popover text-popover-foreground border border-border p-5 space-y-4 rounded-2xl shadow-2xl">
          <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">Add Tickets to Release</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Search or enter ticket keys across accessible spaces.</p>
              </div>
              <button
                onClick={() => {
                  setAddTicketReleaseId(null);
                  setAddTicketSearchQuery('');
                  setSelectedTicketKeys([]);
                  setInkaBoardSearchResults([]);
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddTickets} className="text-xs space-y-3.5">
              {/* Selected tickets pills */}
              {selectedTicketKeys.length > 0 && (
                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-foreground">
                    Selected to add ({selectedTicketKeys.length}):
                  </label>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto custom-scrollbar p-1.5 rounded-lg border border-border/40 bg-muted/10">
                    {selectedTicketKeys.map((key) => (
                      <span
                        key={key}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/25 font-mono text-xs font-semibold"
                      >
                        {key}
                        <button
                          type="button"
                          onClick={() => setSelectedTicketKeys((prev) => prev.filter((k) => k !== key))}
                          className="hover:text-rose-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Live InkaBoard Search */}
              <div>
                <label className="block font-medium text-foreground mb-1">
                  Search InkaBoard Tickets
                </label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={addTicketSearchQuery}
                    onChange={(e) => setAddTicketSearchQuery(e.target.value)}
                    placeholder="Search by key (e.g. TECH-56) or title..."
                    className="w-full bg-background border border-border/60 rounded-xl pl-8 pr-8 py-2 text-foreground text-xs placeholder-muted-foreground focus:outline-none focus:border-primary"
                  />
                  {searchingInkaBoard && (
                    <RotateCcw className="w-3.5 h-3.5 text-primary animate-spin absolute right-3 top-2.5" />
                  )}
                </div>

                {/* Dropdown of search results */}
                {inkaBoardSearchResults.length > 0 && (
                  <div className="mt-1.5 max-h-40 overflow-y-auto custom-scrollbar border border-border/60 rounded-xl bg-card divide-y divide-border/30 shadow-xl">
                    {inkaBoardSearchResults.map((item) => {
                      const isAlreadySelected = selectedTicketKeys.includes(item.key);
                      return (
                        <div
                          key={item.key}
                          onClick={() => {
                            if (isAlreadySelected) {
                              setSelectedTicketKeys((prev) => prev.filter((k) => k !== item.key));
                            } else {
                              setSelectedTicketKeys((prev) => [...prev, item.key]);
                            }
                          }}
                          className={`p-2 px-3 flex items-center justify-between cursor-pointer transition-colors ${
                            isAlreadySelected ? 'bg-primary/10' : 'hover:bg-muted/40'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-primary font-bold">{item.key}</span>
                              {item.spaceName && (
                                <span className="text-[9px] px-1.5 py-0.2 rounded bg-muted/60 text-muted-foreground border border-border/40">
                                  {item.spaceName}
                                </span>
                              )}
                              <span className="text-[9px] font-mono text-muted-foreground">
                                {item.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-foreground truncate mt-0.5">{item.title}</p>
                          </div>
                          <span className={`text-[10px] font-semibold shrink-0 ml-2 ${isAlreadySelected ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}>
                            {isAlreadySelected ? '✓ Selected' : '+ Add'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Direct Key Entry Fallback */}
              <div>
                <label className="block font-medium text-foreground mb-1">
                  Or Paste Ticket Keys Directly
                </label>
                <input
                  type="text"
                  value={addTicketInput}
                  onChange={(e) => setAddTicketInput(e.target.value)}
                  placeholder="e.g. BRD-101, BRD-102"
                  className="w-full bg-background border border-border/60 rounded-xl px-3 py-1.5 text-foreground text-xs font-mono focus:outline-none focus:border-primary"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">Separate multiple keys with commas.</p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
                <button
                  type="button"
                  onClick={() => {
                    setAddTicketReleaseId(null);
                    setAddTicketSearchQuery('');
                    setSelectedTicketKeys([]);
                    setInkaBoardSearchResults([]);
                  }}
                  className="px-3 py-1.5 rounded-xl border border-border text-foreground hover:bg-muted text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingTickets || (selectedTicketKeys.length === 0 && !addTicketInput.trim())}
                  className="gradient-btn text-white px-4 py-1.5 rounded-xl text-xs font-semibold shadow-sm disabled:opacity-50"
                >
                  {addingTickets ? 'Syncing...' : 'Sync & Add'}
                </button>
              </div>
            </form>
        </DialogContent>
      </Dialog>

      {/* MODAL 3: LINK TEST RUN */}
      <Dialog open={Boolean(linkRunReleaseId)} onOpenChange={(open) => { if (!open) setLinkRunReleaseId(null); }}>
        <DialogContent hideClose className="max-w-md bg-card border-border/80 p-5 space-y-4 rounded-2xl shadow-2xl">
          <div className="flex items-center justify-between border-b border-border/50 pb-3">
            <div>
              <h3 className="text-sm font-bold text-foreground">Link Test Run</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Select a run whose verdicts evaluate this release.</p>
            </div>
            <button onClick={() => setLinkRunReleaseId(null)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Run Search Bar */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-2.5" />
            <input
              type="text"
              value={linkRunSearchQuery}
              onChange={(e) => setLinkRunSearchQuery(e.target.value)}
              placeholder="Search runs by name, ID, or environment..."
              className="w-full bg-background border border-border/60 rounded-xl pl-8 pr-3 py-1.5 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-2 text-xs max-h-64 overflow-y-auto custom-scrollbar border border-border/60 rounded-xl p-2 bg-background/50">
            {availableRunsForModal.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">No matching test runs found.</div>
            ) : (
              availableRunsForModal.map((r: any) => {
                const isSelected = selectedRunToLink === r.id;
                return (
                  <div
                    key={r.id}
                    onClick={() => setSelectedRunToLink(r.id)}
                    className={`p-2.5 rounded-lg border transition-all flex items-center justify-between cursor-pointer ${
                      isSelected ? 'border-primary/50 bg-primary/10' : 'border-border/40 bg-card hover:border-border'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        name="linkRunRadio"
                        checked={isSelected}
                        onChange={() => setSelectedRunToLink(r.id)}
                        className="text-primary focus:ring-0"
                      />
                      <div>
                        <span className="font-bold text-foreground">{r.name}</span>
                        <span className="font-mono text-primary ml-1.5">{r.id}</span>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {r.environment} • {r.status}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
            <button
              type="button"
              onClick={() => setLinkRunReleaseId(null)}
              className="px-3 py-1.5 rounded-xl border border-border text-foreground hover:bg-muted text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleLinkRun}
              disabled={linkingRun || !selectedRunToLink}
              className="gradient-btn text-white px-4 py-1.5 rounded-xl text-xs font-semibold shadow-sm disabled:opacity-50"
            >
              {linkingRun ? 'Linking...' : 'Link Run'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MODAL 4: LINK TEST CASES TO TICKET (Streamlined + AI button) */}
      <Dialog open={Boolean(linkCaseModalData)} onOpenChange={(open) => { if (!open) setLinkCaseModalData(null); }}>
        {linkCaseModalData && (
          <DialogContent hideClose className="max-w-xl bg-card border-border/80 p-0 rounded-2xl shadow-2xl max-h-[85vh] flex flex-col overflow-hidden">
            {/* Pinned Header */}
            <div className="p-4 px-5 border-b border-border/50 bg-card flex items-center justify-between shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-primary uppercase tracking-wider">Link Test Cases</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-mono text-primary font-bold text-xs bg-primary/15 px-2 py-0.5 rounded border border-primary/25">
                    {linkCaseModalData.ticketKey}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-muted/40 text-muted-foreground">
                    {linkCaseModalData.ticketStatus}
                  </span>
                </div>
                <h2 className="text-sm font-semibold text-foreground mt-0.5 truncate">{linkCaseModalData.ticketTitle}</h2>
              </div>
              <button onClick={() => setLinkCaseModalData(null)} className="p-1.5 text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search & Filters Toolbar */}
            <div className="p-3 px-5 border-b border-border/40 bg-muted/10 shrink-0 space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={caseSearchQuery}
                    onChange={(e) => setCaseSearchQuery(e.target.value)}
                    placeholder="Search by title, TC-ID, or tag..."
                    className="w-full bg-background border border-border/60 rounded-xl pl-9 pr-3 py-1.5 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setShowFiltersDrawer(!showFiltersDrawer)}
                  className="px-3 py-1.5 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted text-xs font-semibold text-foreground flex items-center gap-1.5 transition-all"
                >
                  <Filter className="w-3.5 h-3.5 text-primary" />
                  <span>Filters ({selectedTagFilter ? 1 : 0})</span>
                </button>
              </div>

              {/* Collapsible Filters Box */}
              {showFiltersDrawer && (
                <div className="pt-2 border-t border-border/40 flex items-center gap-2">
                  <label className="text-[10px] text-muted-foreground uppercase font-semibold shrink-0">Tag:</label>
                  <select
                    value={selectedTagFilter}
                    onChange={(e) => setSelectedTagFilter(e.target.value)}
                    className="bg-background border border-border/60 rounded-lg px-2.5 py-1 text-xs text-foreground focus:outline-none"
                  >
                    <option value="">All Tags</option>
                    {allUniqueTags.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                <label className="flex items-center gap-1.5 cursor-pointer text-foreground">
                  <input
                    type="checkbox"
                    checked={modalFilteredCases.length > 0 && modalFilteredCases.every((c: any) => selectedCaseIds.has(c.id))}
                    onChange={(e) => {
                      const next = new Set(selectedCaseIds);
                      if (e.target.checked) {
                        modalFilteredCases.forEach((c: any) => next.add(c.id));
                      } else {
                        modalFilteredCases.forEach((c: any) => next.delete(c.id));
                      }
                      setSelectedCaseIds(next);
                    }}
                    className="rounded border-border text-primary focus:ring-0"
                  />
                  <span>Select all matching ({modalFilteredCases.length})</span>
                </label>
                <span className="font-mono text-primary font-semibold">{selectedCaseIds.size} selected</span>
              </div>
            </div>

            {/* Scrollable Cases List */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 px-5 space-y-1.5 bg-background/50 text-xs">
              {modalFilteredCases.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  No matching test cases found. Use <strong>✨ Generate with AI</strong> to create them.
                </div>
              ) : (
                modalFilteredCases.map((c: any) => {
                  const isSelected = selectedCaseIds.has(c.id);

                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        const next = new Set(selectedCaseIds);
                        if (isSelected) next.delete(c.id);
                        else next.add(c.id);
                        setSelectedCaseIds(next);
                      }}
                      className={`p-2.5 rounded-lg border transition-all flex items-center gap-3 cursor-pointer ${
                        isSelected ? 'border-primary/50 bg-primary/10' : 'border-border/40 bg-card hover:border-border'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="rounded border-border text-primary focus:ring-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-primary font-bold shrink-0">{c.displayId || c.id}</span>
                          <span className="font-semibold text-foreground truncate">{c.title}</span>
                          {justGeneratedIds.has(c.id) && (
                            <span className="px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 text-[10px] font-semibold shrink-0 animate-pulse">
                              ✨ Just generated
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Optional Custom AI Prompt Bar */}
            {showReleaseAiCustom && (
              <div className="px-5 py-2.5 border-t border-primary/25 bg-primary/5 space-y-2 shrink-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[11px] font-semibold text-primary flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    <span>Custom Prompt for {linkCaseModalData.ticketKey}</span>
                  </span>
                  <div className="flex items-center gap-1 flex-wrap">
                    {[
                      'Negative & edge cases only',
                      'Critical P0 happy-path flow',
                      'Include boundary validation checks',
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setReleaseAiPrompt(preset)}
                        className="text-[10px] px-2 py-0.5 rounded-full border border-primary/25 bg-background/80 hover:bg-primary/10 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={releaseAiPrompt}
                    onChange={(e) => setReleaseAiPrompt(e.target.value)}
                    placeholder="Custom prompt: e.g. Focus on payment webhook failure scenarios..."
                    disabled={generatingAiCases}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAiGenerateCases(releaseAiPrompt);
                      }
                    }}
                    className="flex-1 h-7 rounded-lg border border-border/80 bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60"
                  />
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={releaseAiCount}
                    onChange={(e) => setReleaseAiCount(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 2)))}
                    disabled={generatingAiCases}
                    title="Number of cases to generate"
                    className="w-14 h-7 rounded-lg border border-border/80 bg-background text-center font-mono text-xs text-foreground"
                  />
                  <button
                    type="button"
                    disabled={generatingAiCases}
                    onClick={() => handleAiGenerateCases(releaseAiPrompt)}
                    className="h-7 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 cursor-pointer shrink-0"
                  >
                    {generatingAiCases ? 'Generating...' : 'Run'}
                  </button>
                </div>
              </div>
            )}

            {/* Pinned Footer */}
            <div className="p-3 px-5 border-t border-border/50 bg-card flex items-center justify-between shrink-0">
              <div className="inline-flex items-center rounded-lg border border-primary/30 bg-primary/10 overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleAiGenerateCases('')}
                  disabled={generatingAiCases}
                  className="px-3 py-1.5 hover:bg-primary/20 text-primary text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
                  title="Generate test cases with AI (Auto)"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{generatingAiCases ? 'Generating...' : '✨ Generate with AI'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowReleaseAiCustom((prev) => !prev)}
                  disabled={generatingAiCases}
                  className={cn(
                    'px-2 py-1.5 border-l border-primary/25 hover:bg-primary/20 text-primary text-[11px] font-medium flex items-center gap-1 transition-all disabled:opacity-50 cursor-pointer',
                    showReleaseAiCustom && 'bg-primary/20'
                  )}
                  title="Customize AI prompt and count"
                >
                  <span>{showReleaseAiCustom ? 'Custom' : 'Auto'}</span>
                  <ChevronDown
                    className={cn(
                      'w-3 h-3 transition-transform duration-150',
                      showReleaseAiCustom && 'rotate-180'
                    )}
                  />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setLinkCaseModalData(null)}
                  className="px-3 py-1.5 rounded-xl border border-border text-foreground hover:bg-muted text-xs font-medium"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmLinkCases}
                  disabled={savingCaseLinks || selectedCaseIds.size === 0}
                  className="gradient-btn text-white px-4 py-1.5 rounded-xl text-xs font-semibold shadow-sm disabled:opacity-40"
                >
                  {savingCaseLinks ? 'Linking...' : selectedCaseIds.size > 0 ? `Link ${selectedCaseIds.size} cases` : 'Link Cases'}
                </button>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* MODAL 5: APPROVE CONFIRMATION */}
      <Dialog open={Boolean(approveReleaseTarget)} onOpenChange={(open) => { if (!open) setApproveReleaseTarget(null); }}>
        {approveReleaseTarget && (
          <DialogContent hideClose className="max-w-md bg-popover text-popover-foreground border border-border p-5 space-y-4 rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <h3 className="text-sm font-bold text-foreground">Approve {approveReleaseTarget.name}?</h3>
              <button onClick={() => setApproveReleaseTarget(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs space-y-3">
              {/* Checks summary */}
              <div className="space-y-1.5">
                {!approveReleaseTarget.metrics || approveReleaseTarget.metrics.runCount === 0 ? (
                  <div className="p-2 px-3 rounded-lg border border-border/40 bg-background flex items-center justify-between">
                    <span className="text-foreground">No test runs have been linked</span>
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded text-rose-500 bg-rose-500/10">Blocking</span>
                  </div>
                ) : approveReleaseTarget.metrics.fail > 0 ? (
                  <div className="p-2 px-3 rounded-lg border border-border/40 bg-background flex items-center justify-between">
                    <span className="text-foreground">{approveReleaseTarget.metrics.fail} failing tests across linked runs</span>
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded text-rose-500 bg-rose-500/10">Blocking</span>
                  </div>
                ) : approveReleaseTarget.metrics.pend > 0 ? (
                  <div className="p-2 px-3 rounded-lg border border-border/40 bg-background flex items-center justify-between">
                    <span className="text-foreground">{approveReleaseTarget.metrics.pend} pending tests still unexecuted</span>
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded text-amber-500 bg-amber-500/10">Warning</span>
                  </div>
                ) : (
                  <div className="p-2 px-3 rounded-lg border border-border/40 bg-background flex items-center justify-between">
                    <span className="text-foreground">All {approveReleaseTarget.metrics.pass} tests passed across linked runs</span>
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded text-emerald-500 bg-emerald-500/10">Passed</span>
                  </div>
                )}
              </div>

              {approveReleaseTarget.metrics && approveReleaseTarget.metrics.pend > 0 && (
                <div>
                  <label className="block font-medium text-foreground mb-1">
                    Override Reason <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    value={approvalNote}
                    onChange={(e) => setApprovalNote(e.target.value)}
                    placeholder="e.g. 3 pending tests are cosmetic UI checks; verified on staging."
                    className="w-full bg-background border border-border/60 rounded-xl p-2.5 text-foreground text-xs focus:outline-none focus:border-primary/70 focus:ring-1 focus:ring-inset focus:ring-primary/40 transition-colors"
                  />
                  <p className="text-[10px] text-muted-foreground mt-0.5">Recorded with your sign-off in the release audit log.</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
              <button
                type="button"
                onClick={() => setApproveReleaseTarget(null)}
                className="px-3 py-1.5 rounded-xl border border-border text-foreground hover:bg-muted text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApproval}
                disabled={
                  approving ||
                  !approveReleaseTarget.metrics ||
                  approveReleaseTarget.metrics.fail > 0 ||
                  (approveReleaseTarget.metrics.pend > 0 && approvalNote.trim().length < 5)
                }
                className="gradient-btn text-white px-4 py-1.5 rounded-xl text-xs font-semibold shadow-sm disabled:opacity-40"
              >
                {approving ? 'Approving...' : approveReleaseTarget.metrics && approveReleaseTarget.metrics.pend > 0 ? 'Approve with Override' : 'Approve Release'}
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>

      {/* MODAL 6: REJECT CONFIRMATION */}
      <Dialog open={Boolean(rejectReleaseTarget)} onOpenChange={(open) => { if (!open) setRejectReleaseTarget(null); }}>
        {rejectReleaseTarget && (
          <DialogContent hideClose className="max-w-md bg-popover text-popover-foreground border border-border p-5 space-y-4 rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <h3 className="text-sm font-bold text-rose-500">Reject Release QA Status</h3>
              <button onClick={() => setRejectReleaseTarget(null)} className="text-muted-foreground hover:text-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs space-y-3">
              <div>
                <label className="block font-medium text-foreground mb-1.5">Quick Reasons</label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    'Blocking defect identified during regression',
                    'Incomplete test execution across core flows',
                    'Staging environment instability during test execution',
                    'Release scope deferred to next iteration',
                  ].map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setRejectionReason(chip)}
                      className="px-2 py-0.5 rounded-lg bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/40 text-[11px]"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">
                  Rejection Reason <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={2}
                  required
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Explain why this release is rejected..."
                  className="w-full bg-background border border-border/60 rounded-xl p-2.5 text-foreground text-xs focus:outline-none focus:border-rose-500/70 focus:ring-1 focus:ring-inset focus:ring-rose-500/40 transition-colors"
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">
                  Link Bug / Defect <span className="text-muted-foreground font-normal">(Optional)</span>
                </label>
                <input
                  type="text"
                  value={rejectionBugLink}
                  onChange={(e) => setRejectionBugLink(e.target.value)}
                  placeholder="e.g. DEF-104 Payment Gateway 504 Timeout"
                  className="w-full bg-background border border-border/60 rounded-xl px-3 py-1.5 text-foreground text-xs font-mono focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/50">
              <button
                type="button"
                onClick={() => setRejectReleaseTarget(null)}
                className="px-3 py-1.5 rounded-xl border border-border text-foreground hover:bg-muted text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRejection}
                disabled={rejecting || rejectionReason.trim().length < 5}
                className="bg-rose-600 hover:bg-rose-500 text-white px-4 py-1.5 rounded-xl text-xs font-semibold shadow-sm disabled:opacity-50"
              >
                {rejecting ? 'Rejecting...' : 'Reject Release'}
              </button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
