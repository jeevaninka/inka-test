"use client";

import { useParams } from 'next/navigation';
import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { StatusBadge } from '@/components/common/StatusBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { AutomationFilter } from '@/components/common/AutomationFilter';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { X, Plus, Search, Trash2, Loader2, History, Play, Activity, User, Save, Edit2, Check, FileText, Share2, Clock, BarChart2 } from 'lucide-react';
import { UserAvatar } from '@/components/common/UserAvatar';
import { RunStatusBadge } from '@/components/common/RunStatusBadge';
import { ResultStatusBadge } from '@/components/common/ResultStatusBadge';
import { caseMatchesMode, caseMatchesSource, getAutomationFilterCounts } from '@/lib/cases/automation-source';
import { Tooltip } from '@/components/ui/tooltip';
import { ProgressCircle } from '@/components/common/ProgressCircle';
import { CreateRunModal } from '@/components/runs/CreateRunModal';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  getSuiteCasesAction,
  archiveTestSuiteAction,
  getSuiteHistoryAction,
  getSuiteRunHistoryAction,
  saveSuiteCasesAction,
  updateTestSuiteAction
} from '@/app/actions/suites';

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

export default function SuiteDetailPage() {
  const params = useParams();
  const { slug, suiteId } = params as Record<string, string>;
  const router = useRouter();
  const { project, suites, setSuites, cases: allCases, modules, members, canEdit = true } = useProjectData();
  const suite = suites.find((s) => s.id === suiteId);
  const [suiteCases, setSuiteCases] = useState<any[]>([]); // Database truth
  const [draftCases, setDraftCases] = useState<any[]>([]); // Local edits
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [caseSearchQuery, setCaseSearchQuery] = useState('');

  // Title Editing State
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleText, setEditingTitleText] = useState('');

  // Dialog and search/filter state for adding new cases
  const [showAddCasesDialog, setShowAddCasesDialog] = useState(false);
  const [addCasesSearchQuery, setAddCasesSearchQuery] = useState('');
  const [addCasesModuleFilter, setAddCasesModuleFilter] = useState('');
  const [addCasesPriorityFilter, setAddCasesPriorityFilter] = useState('');
  const [addCasesModeFilter, setAddCasesModeFilter] = useState('');
  const [addCasesSourceFilter, setAddCasesSourceFilter] = useState('');
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());

  // Bulk Edit State
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<string | null>(null);
  const [showBulkRemoveConfirm, setShowBulkRemoveConfirm] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);

  // New states for History & Runs tabs
  const [activeTab, setActiveTab] = useState('cases');
  const [historyLogs, setHistoryLogs] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);

  useEffect(() => {
    if (!suiteId) return;
    setLoading(true);
    getSuiteCasesAction(suiteId).then((data) => {
      setSuiteCases(data);
      setDraftCases(data.map((c) => ({ ...c, assigneeId: c.assignee_id }))); // Map over assignee_id
      setLoading(false);
    }).catch(() => {
      setLoading(false);
    });

    // Prefetch run history so count and latest run status are immediately available
    getSuiteRunHistoryAction(suiteId).then((data) => {
      setRunHistory(data);
    }).catch(() => {});
  }, [suiteId]);

  useEffect(() => {
    if (activeTab === 'history' && suiteId) {
      setLoadingHistory(true);
      getSuiteHistoryAction(suiteId).then((data) => {
        setHistoryLogs(data);
        setLoadingHistory(false);
      }).catch(() => {
        setLoadingHistory(false);
      });
    } else if (activeTab === 'runs' && suiteId) {
      setLoadingRuns(true);
      getSuiteRunHistoryAction(suiteId).then((data) => {
        setRunHistory(data);
        setLoadingRuns(false);
      }).catch(() => {
        setLoadingRuns(false);
      });
    }
  }, [activeTab, suiteId]);

  const latestRun = useMemo(() => {
    return runHistory.length > 0 ? runHistory[0] : null;
  }, [runHistory]);

  const hasDraftChanges = useMemo(() => {
    if (draftCases.length !== suiteCases.length) return true;
    for (let i = 0; i < draftCases.length; i++) {
      if (draftCases[i].id !== suiteCases[i].id) return true;
      if (draftCases[i].assigneeId !== suiteCases[i].assignee_id) return true;
    }
    return false;
  }, [draftCases, suiteCases]);

  // Warn on unsaved changes when navigating away
  useEffect(() => {
    if (!hasDraftChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasDraftChanges]);

  const availableCases = useMemo(() => allCases.filter(
    (c: any) => !draftCases.some((dc: any) => dc.id === c.id) && c.status === 'active'
  ), [allCases, draftCases]);

  const addCasesAutomationCounts = useMemo(
    () => getAutomationFilterCounts(availableCases),
    [availableCases]
  );

  // Filter suite cases by caseSearchQuery
  const filteredDraftCases = useMemo(() => {
    const q = caseSearchQuery.toLowerCase().trim();
    if (!q) return draftCases;
    return draftCases.filter(
      (c) => c.title?.toLowerCase().includes(q) || (c.displayId || c.id || '').toLowerCase().includes(q)
    );
  }, [draftCases, caseSearchQuery]);

  // Filter available cases to add by search, module, priority, mode and automation source
  const filteredAvailableCases = useMemo(() => {
    const filtered = availableCases.filter((c) => {
      if (addCasesSearchQuery) {
        const q = addCasesSearchQuery.toLowerCase().trim();
        const matchTitle = c.title.toLowerCase().includes(q);
        const matchId = c.displayId.toLowerCase().includes(q);
        if (!matchTitle && !matchId) return false;
      }
      if (addCasesModuleFilter && c.moduleId !== addCasesModuleFilter) return false;
      if (addCasesPriorityFilter && c.priority !== addCasesPriorityFilter) return false;
      if (addCasesModeFilter && !caseMatchesMode(c, addCasesModeFilter)) return false;
      if (addCasesSourceFilter && !caseMatchesSource(c, addCasesSourceFilter)) return false;
      return true;
    });
    return filtered.sort((a, b) => compareCaseAsc(a, b, addCasesSearchQuery));
  }, [availableCases, addCasesSearchQuery, addCasesModuleFilter, addCasesPriorityFilter, addCasesModeFilter, addCasesSourceFilter]);

  const handleSaveSuiteTitle = async () => {
    if (!editingTitleText.trim() || !suite) return;
    try {
      const updated = await updateTestSuiteAction(suite.id, { name: editingTitleText.trim() });
      setSuites(suites.map((s: any) => (s.id === suite.id ? { ...s, name: updated.name } : s)));
      toast.success('Suite title updated');
      setIsEditingTitle(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update title');
    }
  };

  // Group suite cases by module
  const draftCasesByModule = useMemo(() => {
    const groups: { moduleName: string; moduleId: string | null; cases: any[] }[] = [];
    const moduleMap = new Map<string | null, any[]>();

    for (const tc of filteredDraftCases) {
      const key = tc.moduleId || null;
      if (!moduleMap.has(key)) moduleMap.set(key, []);
      moduleMap.get(key)!.push(tc);
    }

    for (const [moduleId, cases] of moduleMap) {
      if (moduleId) {
        const mod = modules.find((m: any) => m.id === moduleId);
        groups.push({ moduleName: mod?.name || 'Unknown', moduleId, cases });
      } else {
        groups.push({ moduleName: 'Unassigned', moduleId: null, cases });
      }
    }

    // Sort groups alphabetically, but keep Unassigned at the bottom
    groups.sort((a, b) => {
      if (a.moduleId === null) return 1;
      if (b.moduleId === null) return -1;
      return a.moduleName.localeCompare(b.moduleName);
    });

    return groups;
  }, [filteredDraftCases, modules]);

  if (!project || !suite) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const handleAddCases = () => {
    const newCases = Array.from(selectedToAdd).map((id) => {
      const tc = allCases.find((c) => c.id === id);
      return { ...tc, assigneeId: null };
    });
    setDraftCases([...draftCases, ...newCases]);
    setSelectedToAdd(new Set());
    setShowAddCasesDialog(false);
    setAddCasesSearchQuery('');
  };

  const handleRemoveCase = (caseId: string) => {
    setShowRemoveConfirm(caseId);
  };

  const confirmRemoveCase = () => {
    if (!showRemoveConfirm) return;
    setDraftCases(draftCases.filter((c) => c.id !== showRemoveConfirm));
    setSelectedDraftIds((prev) => {
      const next = new Set(prev);
      next.delete(showRemoveConfirm);
      return next;
    });
    setShowRemoveConfirm(null);
  };

  const handleBulkRemove = () => {
    setShowBulkRemoveConfirm(true);
  };

  const confirmBulkRemove = () => {
    setDraftCases(draftCases.filter((c) => !selectedDraftIds.has(c.id)));
    setSelectedDraftIds(new Set());
    setShowBulkRemoveConfirm(false);
  };

  const handleBulkAssign = (assigneeId: number | null) => {
    setDraftCases(draftCases.map((c) => {
      if (selectedDraftIds.has(c.id)) {
        return { ...c, assigneeId };
      }
      return c;
    }));
    toast.success(assigneeId ? 'Cases assigned' : 'Cases unassigned');
  };

  const handleAssignSingle = (caseId: string, assigneeId: number | null) => {
    setDraftCases(draftCases.map((c) => {
      if (c.id === caseId) {
        return { ...c, assigneeId };
      }
      return c;
    }));
  };

  const handleSaveSuite = async () => {
    setIsSaving(true);
    try {
      await saveSuiteCasesAction(suiteId, draftCases.map((c) => ({
        id: c.id,
        assigneeId: c.assigneeId,
      })));
      toast.success('Suite updated');
      const updated = await getSuiteCasesAction(suiteId);
      setSuiteCases(updated);
      setDraftCases(updated.map((c) => ({ ...c, assigneeId: c.assignee_id })));
      setSuites(suites.map((s: any) => (s.id === suiteId ? { ...s, caseCount: updated.length } : s)));
      if (activeTab === 'history') {
        getSuiteHistoryAction(suiteId).then(setHistoryLogs);
      }
    } catch (e: any) {
      toast.error(e.message || 'Failed to save suite');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelUpdate = () => {
    setDraftCases(suiteCases.map((c) => ({ ...c, assigneeId: c.assignee_id })));
    setSelectedDraftIds(new Set());
    setCaseSearchQuery('');
  };

  const selectAllInGroup = (ids: string[], checked: boolean) => {
    setSelectedDraftIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  return (
    <div className="p-6 relative min-h-screen pb-24">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/p/${slug}/suites`)} className="text-muted-foreground hover:text-foreground">
            ← Suites
          </Button>
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <Input
                value={editingTitleText}
                onChange={(e) => setEditingTitleText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveSuiteTitle();
                  if (e.key === 'Escape') setIsEditingTitle(false);
                }}
                className="h-9 text-lg font-bold w-80 bg-background"
                autoFocus
              />
              <Button size="sm" onClick={handleSaveSuiteTitle} className="h-9 px-3">
                <Check className="h-4 w-4 mr-1" /> Save
              </Button>
              <Button size="sm" variant="outline" onClick={() => setIsEditingTitle(false)} className="h-9 px-3">
                Cancel
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h1 className="text-2xl font-bold">{suite.name}</h1>
              {canEdit && (
                <button
                  onClick={() => {
                    setIsEditingTitle(true);
                    setEditingTitleText(suite.name);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity"
                  title="Edit suite title"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gradient-btn text-white" onClick={() => setShowRunModal(true)}>
              <Play className="h-4 w-4 mr-2" />
              Run Suite
            </Button>
            <Button variant="ghost" className="text-red-600" onClick={() => setShowDeleteModal(true)}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        )}
      </div>

      {/* Latest Run Banner */}
      {latestRun && (
        <div className="mb-4 p-3 rounded-xl border border-border/70 bg-card/60 backdrop-blur-xs flex items-center justify-between gap-4 flex-wrap shadow-xs">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider bg-muted px-2 py-0.5 rounded border border-border/40 font-mono">
              Latest Run
            </span>
            <button
              onClick={() => router.push(`/p/${slug}/runs/${latestRun.id}`)}
              className="text-sm font-bold text-foreground hover:text-primary hover:underline transition-colors flex items-center gap-1.5"
            >
              <span>{latestRun.name}</span>
              <span className="font-mono text-xs text-muted-foreground font-normal">#{latestRun.id}</span>
            </button>
            <RunStatusBadge status={latestRun.status} />
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              {latestRun.stats.pass}/{latestRun.stats.total} Passed ({latestRun.stats.passRate}%)
            </span>
            {latestRun.environment && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium capitalize">
                {latestRun.environment}
              </span>
            )}
            {latestRun.startedAt && (
              <span className="text-xs text-muted-foreground font-mono">
                · {new Date(latestRun.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5 hover:bg-primary/10 hover:text-primary hover:border-primary/40 font-medium"
              onClick={() => router.push(`/p/${slug}/runs/${latestRun.id}/report`)}
            >
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span>View Report</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1.5 font-medium"
              onClick={() => router.push(`/p/${slug}/runs/${latestRun.id}`)}
            >
              <Play className="h-3.5 w-3.5" />
              <span>Open Run</span>
            </Button>
          </div>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-3 w-[430px]">
          <TabsTrigger value="cases">Cases ({draftCases.length})</TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Activity</TabsTrigger>
          <TabsTrigger value="runs" className="flex items-center gap-1.5">
            <Play className="h-3.5 w-3.5" /> Run History
            {runHistory.length > 0 && (
              <span className="ml-1 text-[11px] px-1.5 py-0.2 rounded-full bg-primary/15 text-primary font-bold">
                {runHistory.length}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cases" className="mt-4 space-y-4 w-full">
          {/* Header Toolbar containing search currently added cases and Add Cases button */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search cases in suite..."
                value={caseSearchQuery}
                onChange={(e) => setCaseSearchQuery(e.target.value)}
                className="pl-10 h-9"
              />
            </div>
            {canEdit && (
              <Button size="sm" onClick={() => setShowAddCasesDialog(true)} className="gradient-btn text-white h-9 shrink-0">
                <Plus className="h-4 w-4 mr-1.5" />
                Add Cases
              </Button>
            )}
          </div>

          {selectedDraftIds.size > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/50 sticky top-4 z-20 shadow-sm backdrop-blur-md">
              <span className="text-sm font-medium">{selectedDraftIds.size} selected</span>
              <div className="h-4 w-px bg-border mx-1" />
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Bulk Assign:</span>
                <div className="w-48">
                  <AssigneeDropdown 
                    assignedTo={null}
                    members={members}
                    onAssign={handleBulkAssign}
                  />
                </div>
              </div>
              <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600 hover:bg-red-500/10 ml-auto" onClick={handleBulkRemove}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Remove
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelectedDraftIds(new Set())}>
                <X className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            </div>
          )}

          {filteredDraftCases.length === 0 ? (
            <div className="border border-dashed rounded-xl py-12 flex flex-col items-center justify-center text-center p-4">
              {caseSearchQuery ? (
                <>
                  <p className="text-sm font-semibold text-foreground">No matching cases in this suite</p>
                  <p className="text-xs text-muted-foreground mt-1">Try resetting or refining your search keywords.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-foreground">No cases in this suite yet</p>
                  <p className="text-xs text-muted-foreground mt-1 mb-4">Add your first test cases to get started.</p>
                  <Button size="sm" onClick={() => setShowAddCasesDialog(true)}>
                    <Plus className="h-4 w-4 mr-1.5" /> Add Cases
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-6 w-full">
              {draftCasesByModule.map((group) => {
                const groupSelected = group.cases.length > 0 && group.cases.every((c: any) => selectedDraftIds.has(c.id));
                return (
                  <div key={group.moduleName} className="space-y-0 rounded-lg border border-border/60 overflow-hidden bg-card shadow-sm w-full">
                    <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-foreground uppercase tracking-wider bg-muted/20 border-b border-border/50">
                      <Checkbox
                        checked={groupSelected}
                        onCheckedChange={(checked) => selectAllInGroup(group.cases.map(c => c.id), !!checked)}
                        className="mr-2"
                      />
                      {group.moduleName} ({group.cases.length})
                    </div>
                    <div className="flex items-center px-4 py-2 text-[10px] text-muted-foreground font-semibold uppercase tracking-wider bg-background border-b border-border/30">
                      <span className="w-6 shrink-0" />
                      <span className="w-8 shrink-0 text-center font-mono">#</span>
                      <span className="w-24 shrink-0 font-mono">Key</span>
                      <span className="flex-1 min-w-0 ml-2">Title</span>
                      <span className="w-40 shrink-0 text-left pl-2">Assignee</span>
                      <span className="w-24 shrink-0 text-left">Priority</span>
                      <span className="w-8 shrink-0" />
                    </div>
                    <div className="divide-y divide-border/30">
                      {group.cases.map((tc) => {
                        const serialNum = filteredDraftCases.findIndex((c: any) => c.id === tc.id) + 1;
                        const caseKey = tc.displayId || tc.display_id || tc.id;
                        const caseRouteParam = tc.id || tc.displayId;

                        return (
                          <div key={tc.id} className={cn("group flex items-center px-4 py-2 hover:bg-muted/30 transition-colors", selectedDraftIds.has(tc.id) && "bg-violet-50 dark:bg-violet-950/20")}>
                            <Checkbox
                              checked={selectedDraftIds.has(tc.id)}
                              onCheckedChange={(checked) => {
                                setSelectedDraftIds(prev => {
                                  const next = new Set(prev);
                                  if (checked) next.add(tc.id); else next.delete(tc.id);
                                  return next;
                                });
                              }}
                              className="mr-3 shrink-0"
                            />
                            <span className="w-8 shrink-0 text-center font-mono text-xs text-muted-foreground">
                              {serialNum}
                            </span>
                            <span 
                              className="w-24 shrink-0 font-mono text-xs text-primary font-semibold truncate cursor-pointer hover:underline" 
                              onClick={() => router.push(`/p/${slug}/repository/${caseRouteParam}`)}
                              title={caseKey}
                            >
                              {caseKey}
                            </span>
                            <div className="flex-1 min-w-0 ml-2 pr-4 flex items-center gap-2">
                              <span 
                                className="truncate text-sm font-medium cursor-pointer group-hover:text-primary transition-colors" 
                                onClick={() => router.push(`/p/${slug}/repository/${caseRouteParam}`)}
                                title={tc.title}
                              >
                                {tc.title}
                              </span>
                            </div>
                            <div className="w-40 shrink-0 pr-4">
                              <AssigneeDropdown
                                assignedTo={tc.assigneeId}
                                members={members}
                                onAssign={async (userId) => handleAssignSingle(tc.id, userId)}
                              />
                            </div>
                            <div className="w-24 shrink-0 flex justify-start">
                              <PriorityBadge priority={tc.priority} />
                            </div>
                            <button 
                              className="w-8 shrink-0 flex items-center justify-center p-1 text-muted-foreground hover:text-red-600 transition-colors cursor-pointer" 
                              onClick={() => handleRemoveCase(tc.id)}
                              title="Remove case from suite"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Activity Log Tab */}
        <TabsContent value="history" className="mt-4 w-full">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : historyLogs.length === 0 ? (
            <EmptyState icon={History} heading="No activity recorded" subtext="All edits made to this suite will be displayed here." />
          ) : (
            <div className="border border-border/60 rounded-xl bg-card overflow-hidden">
              <div className="relative p-6 space-y-6">
                <div className="absolute left-11 top-6 bottom-6 w-[1.5px] bg-border/80" />
                {historyLogs.map((log) => (
                  <div key={log.id} className="relative flex items-start gap-4">
                    <div className="z-10 bg-card rounded-full p-1 border border-border/80 shadow-sm shrink-0">
                      {log.user ? (
                        <UserAvatar
                          userId={log.user.id}
                          name={log.user.name}
                          fullName={log.user.fullName}
                          imageUrl={log.user.avatarUrl}
                          color={log.user.avatarColor}
                          initials={log.user.avatarInitials}
                          size="sm"
                        />
                      ) : (
                        <div className="h-6 w-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold">
                          SYS
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                      <p className="text-sm text-foreground">
                        <span className="font-semibold text-primary mr-1">{log.user?.name || 'System'}</span>
                        {log.action}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(log.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </TabsContent>

        {/* Run History Tab */}
        <TabsContent value="runs" className="mt-4 w-full space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground">Suite Execution Runs</h3>
              <p className="text-xs text-muted-foreground">Historical test runs, pass rates, execution verdicts, and reports for this suite.</p>
            </div>
            <Button
              size="sm"
              className="gradient-btn text-white h-8 text-xs gap-1.5 shrink-0"
              onClick={() => setShowRunModal(true)}
            >
              <Play className="h-3.5 w-3.5" />
              <span>Run Suite</span>
            </Button>
          </div>

          {loadingRuns ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : runHistory.length === 0 ? (
            <div className="border border-dashed border-border/80 rounded-xl p-12 text-center space-y-3 bg-card/40">
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                <Play className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-bold">No runs recorded yet</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                This suite has not been executed yet. Start a new test run to execute and verify its test cases.
              </p>
              <Button
                size="sm"
                className="gradient-btn text-white mt-2 text-xs"
                onClick={() => setShowRunModal(true)}
              >
                <Play className="h-3.5 w-3.5 mr-1.5" />
                <span>Start First Run</span>
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {runHistory.map((run) => {
                const total = run.stats?.total || 0;
                const pass = run.stats?.pass || 0;
                const fail = run.stats?.fail || 0;
                const blocked = run.stats?.blocked || 0;
                const skip = run.stats?.skip || 0;
                const invalid = run.stats?.invalid || 0;
                const started = run.stats?.started || 0;
                const pending = run.stats?.pending || 0;
                const passRate = run.stats?.passRate ?? (total > 0 ? Math.round((pass / total) * 100) : 0);

                return (
                  <div 
                    key={run.id} 
                    onClick={() => router.push(`/p/${slug}/runs/${run.id}`)}
                    className="border border-border/70 rounded-xl p-4 bg-card hover:bg-muted/20 transition-all cursor-pointer flex flex-col md:flex-row items-start md:items-center justify-between gap-4 group shadow-xs"
                  >
                    {/* Left: Metadata */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-bold text-foreground text-sm group-hover:text-primary group-hover:underline transition-colors">
                          {run.name}
                        </span>
                        <span className="text-xs font-mono text-muted-foreground bg-muted/70 px-1.5 py-0.5 rounded border border-border/40 font-medium">
                          #{run.id}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted font-medium capitalize text-muted-foreground">
                          {run.environment}
                        </span>
                        {run.buildVersion && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono font-medium">
                            {run.buildVersion}
                          </span>
                        )}
                        <RunStatusBadge status={run.status} />
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        {run.creator && (
                          <div className="flex items-center gap-1.5 shrink-0">
                            <UserAvatar
                              userId={run.creator.id}
                              name={run.creator.name}
                              fullName={run.creator.fullName}
                              imageUrl={run.creator.avatarUrl}
                              color={run.creator.avatarColor}
                              initials={run.creator.avatarInitials}
                              size="sm"
                              className="h-4 w-4 text-[9px]"
                            />
                            <span>By {run.creator.name}</span>
                          </div>
                        )}
                        <span>·</span>
                        <span>
                          Ran {new Date(run.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        {run.durationMinutes && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-1 font-mono">
                              <Clock className="h-3 w-3" />
                              <span>{run.durationMinutes}m duration</span>
                            </span>
                          </>
                        )}
                      </div>

                      {/* Status Chips Breakdown */}
                      <div className="flex items-center gap-1.5 pt-1 flex-wrap text-[10px]">
                        {pass > 0 && (
                          <span className="px-1.5 py-0.5 rounded font-bold bg-emerald-600 text-white shadow-xs">
                            {pass} Pass
                          </span>
                        )}
                        {fail > 0 && (
                          <span className="px-1.5 py-0.5 rounded font-bold bg-red-600 text-white shadow-xs">
                            {fail} Fail
                          </span>
                        )}
                        {blocked > 0 && (
                          <span className="px-1.5 py-0.5 rounded font-bold bg-amber-600 text-white shadow-xs">
                            {blocked} Blocked
                          </span>
                        )}
                        {invalid > 0 && (
                          <span className="px-1.5 py-0.5 rounded font-bold bg-violet-600 text-white shadow-xs">
                            {invalid} Invalid
                          </span>
                        )}
                        {skip > 0 && (
                          <span className="px-1.5 py-0.5 rounded font-bold bg-zinc-600 text-white shadow-xs">
                            {skip} Skip
                          </span>
                        )}
                        {started > 0 && (
                          <span className="px-1.5 py-0.5 rounded font-bold bg-[#4aa8ff]/15 text-[#4aa8ff] border border-[#4aa8ff]/30 inline-flex items-center gap-1">
                            <i className="running-dot mr-0.5" />
                            {started} Running
                          </span>
                        )}
                        {pending > 0 && (
                          <span className="px-1.5 py-0.5 rounded font-medium bg-muted text-muted-foreground border border-border/40">
                            {pending} Pending
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Center/Right: ProgressCircle & Direct Actions */}
                    <div className="flex items-center gap-4 shrink-0 w-full md:w-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-border/40">
                      <div className="flex items-center gap-2.5">
                        <ProgressCircle
                          segments={{
                            pass,
                            fail,
                            blocked,
                            invalid,
                            skip,
                            total,
                          }}
                          size={28}
                          strokeWidth={3}
                        />
                        <div className="flex flex-col text-left">
                          <span className="font-mono font-bold text-xs text-foreground leading-tight">
                            {pass}/{total}
                          </span>
                          <span className="text-[10px] font-mono text-muted-foreground leading-tight">
                            {passRate}% pass
                          </span>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1.5">
                        <Tooltip content="View full test run report">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2.5 text-xs gap-1.5 hover:bg-primary/10 hover:text-primary hover:border-primary/40 font-medium"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/p/${slug}/runs/${run.id}/report`);
                            }}
                          >
                            <FileText className="h-3.5 w-3.5 text-primary" />
                            <span className="hidden sm:inline">Report</span>
                          </Button>
                        </Tooltip>

                        <Tooltip content="Open execution console">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 px-2.5 text-xs gap-1.5 font-medium"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/p/${slug}/runs/${run.id}`);
                            }}
                          >
                            <Play className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">Run</span>
                          </Button>
                        </Tooltip>

                        <Tooltip content="Copy report link">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (typeof window !== 'undefined') {
                                const url = `${window.location.origin}/p/${slug}/runs/${run.id}/report`;
                                navigator.clipboard.writeText(url);
                                toast.success('Report link copied to clipboard');
                              }
                            }}
                          >
                            <Share2 className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Draft Save Actions Footer */}
      {hasDraftChanges && (
        <div className="fixed bottom-0 left-0 right-0 md:left-48 bg-background border-t border-border p-4 flex items-center justify-between z-50 animate-slide-up shadow-lg shadow-black/10">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-sm font-medium">Unsaved changes to suite cases</span>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={handleCancelUpdate} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSaveSuite} disabled={isSaving} className="gradient-btn text-white">
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {isSaving ? 'Saving...' : 'Update Suite'}
            </Button>
          </div>
        </div>
      )}

      {/* Add Cases Modal */}
      <Dialog open={showAddCasesDialog} onOpenChange={(open) => { setShowAddCasesDialog(open); if (!open) { setSelectedToAdd(new Set()); setAddCasesSearchQuery(''); setAddCasesModuleFilter(''); setAddCasesPriorityFilter(''); setAddCasesModeFilter(''); setAddCasesSourceFilter(''); } }}>
        <DialogContent className="max-w-3xl w-[95vw] max-h-[85vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle>Add Cases to Suite</DialogTitle>
          </DialogHeader>

          <div className="px-6 pb-3 space-y-3 shrink-0">
            {/* Search and Filters Bar */}
            <div className="flex items-center gap-3">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search cases by title or ID..."
                  value={addCasesSearchQuery}
                  onChange={(e) => setAddCasesSearchQuery(e.target.value)}
                  className="pl-10 h-9 text-xs"
                />
              </div>

              <Select
                value={addCasesModuleFilter}
                onValueChange={setAddCasesModuleFilter}
                options={[
                  { value: '', label: 'All Modules' },
                  ...modules.map((m: any) => ({ value: m.id, label: m.name })),
                ]}
                className="w-44 h-9"
              />

              <Select
                value={addCasesPriorityFilter}
                onValueChange={setAddCasesPriorityFilter}
                options={[
                  { value: '', label: 'All Priorities' },
                  { value: 'P0', label: 'P0' },
                  { value: 'P1', label: 'P1' },
                  { value: 'P2', label: 'P2' },
                  { value: 'P3', label: 'P3' },
                ]}
                className="w-36 h-9"
              />
            </div>

            {/* Mode + automation source (interconnected) */}
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground shrink-0">
                Mode
              </span>
              <AutomationFilter
                mode={addCasesModeFilter}
                source={addCasesSourceFilter}
                counts={addCasesAutomationCounts}
                compact
                onChange={({ mode, source }) => {
                  setAddCasesModeFilter(mode);
                  setAddCasesSourceFilter(source);
                }}
              />
            </div>

            {/* Select All Filtered Bar */}
            {filteredAvailableCases.length > 0 && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-muted/40 rounded-lg text-xs font-semibold text-muted-foreground">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={filteredAvailableCases.length > 0 && filteredAvailableCases.every((tc) => selectedToAdd.has(tc.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const newSet = new Set(selectedToAdd);
                        filteredAvailableCases.forEach((tc) => newSet.add(tc.id));
                        setSelectedToAdd(newSet);
                      } else {
                        const newSet = new Set(selectedToAdd);
                        filteredAvailableCases.forEach((tc) => newSet.delete(tc.id));
                        setSelectedToAdd(newSet);
                      }
                    }}
                    className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                  />
                  <span>Select All Filtered ({filteredAvailableCases.length})</span>
                </label>
                <span>{selectedToAdd.size} selected</span>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-6 divide-y divide-border border-y border-border/50 bg-muted/5">
            {filteredAvailableCases.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-12">
                {(addCasesSearchQuery || addCasesModuleFilter || addCasesPriorityFilter || addCasesModeFilter || addCasesSourceFilter) ? 'No available cases match your filters' : 'No available cases to add'}
              </div>
            ) : (
              filteredAvailableCases.map((tc) => {
                const moduleName = modules.find((m: any) => m.id === tc.moduleId)?.name;

                return (
                  <label
                    key={tc.id}
                    className="flex items-center gap-3 py-3 hover:bg-muted/10 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={selectedToAdd.has(tc.id)}
                      onCheckedChange={(checked) => {
                        const newSet = new Set(selectedToAdd);
                        if (checked) newSet.add(tc.id);
                        else newSet.delete(tc.id);
                        setSelectedToAdd(newSet);
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground shrink-0">{tc.displayId}</span>
                        <span className="text-sm truncate font-medium text-foreground">{tc.title}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <PriorityBadge priority={tc.priority} />
                        {moduleName && (
                          <span className="text-[11px] px-2 py-0.5 rounded-full border font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 border-emerald-200/30 truncate max-w-[150px]">
                            {moduleName}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          <DialogFooter className="p-6 pt-4 shrink-0 flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">{selectedToAdd.size} selected</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => { setShowAddCasesDialog(false); setSelectedToAdd(new Set()); setAddCasesSearchQuery(''); setAddCasesModuleFilter(''); setAddCasesPriorityFilter(''); }}>
                Cancel
              </Button>
              <Button onClick={handleAddCases} disabled={selectedToAdd.size === 0} className="gradient-btn text-white">
                Add {selectedToAdd.size > 0 ? selectedToAdd.size : ''} Case{selectedToAdd.size > 1 ? 's' : ''}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={showRemoveConfirm !== null}
        onOpenChange={(open) => { if (!open) setShowRemoveConfirm(null); }}
        title="Remove Case"
        description="Are you sure you want to remove this test case from the suite?"
        onConfirm={confirmRemoveCase}
        variant="destructive"
      />

      <ConfirmModal
        open={showBulkRemoveConfirm}
        onOpenChange={setShowBulkRemoveConfirm}
        title={`Remove ${selectedDraftIds.size} Case(s)`}
        description={`Are you sure you want to remove these ${selectedDraftIds.size} test cases from the suite?`}
        onConfirm={confirmBulkRemove}
        variant="destructive"
      />

      <ConfirmModal
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        title="Delete Test Suite"
        description="Are you sure you want to delete this suite? It will be removed from your active suites. Test cases and execution history are preserved."
        confirmLabel="Delete Suite"
        requireTypedConfirmation="DELETE"
        onConfirm={async () => {
          try {
            await archiveTestSuiteAction(suiteId);
            setSuites(suites.filter((s: any) => s.id !== suiteId));
            toast.success('Suite deleted');
            router.push(`/p/${slug}/suites`);
          } catch (e: any) {
            toast.error(e.message || 'Failed to delete suite');
          }
        }}
        variant="destructive"
      />

      <CreateRunModal
        open={showRunModal}
        onOpenChange={setShowRunModal}
        slug={slug}
        initialSuiteId={suite.id}
      />
    </div>
  );
}

function AssigneeDropdown({ assignedTo, members, onAssign }: { assignedTo: number | null; members: any[]; onAssign: (assigneeId: number | null) => void }) {
  const [open, setOpen] = useState(false);
  const assignee = members.find((m: any) => m.userId === assignedTo)?.user;

  return (
    <div className="relative w-full">
      <button 
        className="flex items-center gap-1.5 p-1 rounded hover:bg-muted/50 cursor-pointer w-full text-left outline-none focus:ring-1 focus:ring-primary border border-border"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        {assignee ? (
          <>
            <UserAvatar name={assignee.name} imageUrl={assignee.avatarUrl} size="sm" />
            <span className="text-xs truncate font-medium flex-1">
              {assignee.name}
            </span>
          </>
        ) : (
          <>
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted border border-dashed border-muted-foreground/30 opacity-70">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <span className="text-[11px] text-muted-foreground italic px-1 flex-1 font-medium">Unassigned</span>
          </>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border bg-popover shadow-lg py-1 max-h-60 overflow-y-auto">
            <button
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted italic text-muted-foreground transition-colors flex items-center gap-2"
              onClick={(e) => {
                e.stopPropagation();
                onAssign(null);
                setOpen(false);
              }}
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted border border-dashed border-muted-foreground/30 opacity-70">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <span className="truncate flex-1 font-medium px-1">Unassigned</span>
            </button>
            {members.map((m: any) => (
              <button
                key={m.userId}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted flex items-center gap-2 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onAssign(m.userId);
                  setOpen(false);
                }}
              >
                <UserAvatar name={m.user.name} imageUrl={m.user.avatarUrl} size="sm" />
                <span className="truncate flex-1 font-medium">{m.user.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}