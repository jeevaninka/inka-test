'use client';

import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, Search, Edit2, Trash2, Copy, GripVertical, X, Eye, Layers, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/common/DataTable';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { cn } from '@/lib/utils';
import {
  getReusableStepsAction,
  createReusableStepAction,
  updateReusableStepAction,
  deleteReusableStepAction,
  getReusableStepUsageAction,
  cloneReusableStepAction,
  getStepAutocompleteIndexAction,
} from '@/app/actions/steps';
import { getGlobalVariablesAction } from '@/app/actions/variables';
import { VariableAutocomplete } from '@/components/variables/VariableAutocomplete';
import {
  type StepAutocompleteIndex,
  getCachedProjectAutocompleteIndex,
  setCachedProjectAutocompleteRows,
  extractAutocompleteRowsFromCases,
  mergeAutocompleteRows,
  matchActionPrefix,
  matchExpectedResultPrefix,
} from '@/lib/step-autocomplete';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { StepLibraryModal } from '@/components/steps/StepLibraryModal';
import { ConfirmModal } from '@/components/common/ConfirmModal';

interface StepLibraryPageProps {
  slug: string;
}

interface GroupStepItem {
  key: string;
  step: string;
  expectedResult: string;
  data: string;
  imageUrl: string;
}

export function StepLibraryPage({ slug }: StepLibraryPageProps) {
  const { project, modules, cases: projectCases } = useProjectData();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectId = project?.id || slug;

  const stepsQuery = useQuery({
    queryKey: ['reusable-steps', projectId],
    queryFn: () => getReusableStepsAction(projectId),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
  const steps: any[] = useMemo(() => stepsQuery.data ?? [], [stepsQuery.data]);
  const loading = stepsQuery.isLoading;

  const variablesQuery = useQuery({
    queryKey: ['global-variables', projectId],
    queryFn: async () => {
      const vars = await getGlobalVariablesAction(projectId);
      return vars.map((v: any) => ({ key: v.key, scope: 'GLOBAL' as const }));
    },
    enabled: Boolean(project?.id),
    staleTime: 30_000,
  });
  const variables = useMemo(() => variablesQuery.data ?? [], [variablesQuery.data]);

  const invalidateSteps = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['reusable-steps', projectId] }),
    [queryClient, projectId]
  );
  const loadSteps = invalidateSteps;

  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editingStep, setEditingStep] = useState<any | null>(null);
  const [viewingStep, setViewingStep] = useState<any | null>(null);
  const [viewingStepUsage, setViewingStepUsage] = useState<any[]>([]);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [usageSearch, setUsageSearch] = useState('');
  const [viewModalTab, setViewModalTab] = useState<'steps' | 'usage'>('steps');
  const [formData, setFormData] = useState({ title: '', step: '', expectedResult: '', data: '', moduleId: '' });
  const [groupSteps, setGroupSteps] = useState<GroupStepItem[]>([]);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [stepToDeleteObj, setStepToDeleteObj] = useState<any | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'single' | 'group'>('all');
  const [selectedModuleFilter, setSelectedModuleFilter] = useState<string>('all');
  const [autocompleteIndex, setAutocompleteIndex] = useState<StepAutocompleteIndex | null>(() =>
    getCachedProjectAutocompleteIndex(project?.id || slug)
  );

  useEffect(() => {
    const projectId = project?.id || slug;
    if (!projectId) return;
    const cached = getCachedProjectAutocompleteIndex(projectId);
    if (cached) {
      setAutocompleteIndex(cached);
    } else if (projectCases && projectCases.length > 0) {
      const localSeed = extractAutocompleteRowsFromCases(projectCases, steps);
      setAutocompleteIndex(setCachedProjectAutocompleteRows(projectId, localSeed));
    }
    getStepAutocompleteIndexAction(projectId)
      .then((serverRows) => {
        const localSeed = extractAutocompleteRowsFromCases(projectCases || [], steps);
        const merged = mergeAutocompleteRows(serverRows, localSeed);
        setAutocompleteIndex(setCachedProjectAutocompleteRows(projectId, merged));
      })
      .catch(() => {});
  }, [project?.id, slug, projectCases, steps]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createReusableStepAction({
        projectId: project?.id || slug,
        ...formData,
        moduleId: formData.moduleId || null,
        steps: groupSteps.length > 0 ? groupSteps.map((s) => ({
          step: s.step,
          expectedResult: s.expectedResult || null,
          data: s.data || null,
          imageUrl: s.imageUrl || null,
        })) : undefined,
      });
      toast.success('Reusable step created');
      resetForm();
      setShowDialog(false);
      await loadSteps();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await updateReusableStepAction(editingStep!.id, {
        ...formData,
        moduleId: formData.moduleId || null,
        steps: groupSteps.length > 0 ? groupSteps.map((s) => ({
          step: s.step,
          expectedResult: s.expectedResult || null,
          data: s.data || null,
          imageUrl: s.imageUrl || null,
        })) : undefined,
      });
      toast.success('Reusable step updated');
      setEditingStep(null);
      setShowDialog(false);
      resetForm();
      await loadSteps();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCloneStep = async (item: any) => {
    try {
      const cloned = await cloneReusableStepAction(item.id, `Copy of ${item.title}`);
      toast.success(`Cloned reusable step "${cloned.title}"`);
      await loadSteps();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDeleteClick = (item: any) => {
    setStepToDeleteObj(item);
  };

  const confirmDelete = async (strategy: 'convert_to_normal' | 'delete_all' = 'convert_to_normal') => {
    if (!stepToDeleteObj) return;
    try {
      await deleteReusableStepAction(stepToDeleteObj.id, strategy);
      toast.success(
        strategy === 'convert_to_normal'
          ? 'Reusable step deleted (linked steps converted to normal)'
          : 'Reusable step deleted'
      );
      await loadSteps();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setStepToDeleteObj(null);
    }
  };

  const resetForm = () => {
    setFormData({ title: '', step: '', expectedResult: '', data: '', moduleId: '' });
    setGroupSteps([]);
  };

  const openCreateDialog = () => {
    setEditingStep(null);
    resetForm();
    setShowDialog(true);
  };

  const openViewDialog = async (item: any, initialTab: 'steps' | 'usage' = 'steps') => {
    setViewingStep(item);
    setViewModalTab(initialTab);
    setUsageSearch('');
    setLoadingUsage(true);
    try {
      const usage = await getReusableStepUsageAction(item.id);
      setViewingStepUsage(usage);
    } catch (e) {
      toast.error('Failed to load usage data');
    } finally {
      setLoadingUsage(false);
    }
  };

  const openEditDialog = (item: any) => {
    setEditingStep(item);
    const existingSteps = Array.isArray(item.steps) && item.steps.length > 0 ? item.steps : [];
    setFormData({
      title: item.title,
      step: item.step,
      expectedResult: item.expected_result || '',
      data: item.data || '',
      moduleId: item.module_id || item.module?.id || '',
    });
    setGroupSteps(
      existingSteps.map((s: any, i: number) => ({
        key: `step-${i}-${Date.now()}`,
        step: s.step || '',
        expectedResult: s.expectedResult || s.expected_result || '',
        data: s.data || '',
        imageUrl: s.imageUrl || s.image_url || '',
      }))
    );
    setShowDialog(true);
  };

  const addGroupStep = () => {
    setGroupSteps([...groupSteps, { key: `step-${Date.now()}`, step: '', expectedResult: '', data: '', imageUrl: '' }]);
  };

  const updateGroupStep = (key: string, field: string, value: string) => {
    setGroupSteps(groupSteps.map((s) => (s.key === key ? { ...s, [field]: value } : s)));
  };

  const removeGroupStep = (key: string) => {
    setGroupSteps(groupSteps.filter((s) => s.key !== key));
  };

  const isGroup = groupSteps.length > 0;

  const singleCount = steps.filter((s) => !Array.isArray(s.steps) || s.steps.length === 0).length;
  const groupCount = steps.filter((s) => Array.isArray(s.steps) && s.steps.length > 0).length;

  const filteredSteps = steps.filter((s) => {
    const q = search.toLowerCase();
    const gs = Array.isArray(s.steps) && s.steps.length > 0 ? s.steps : null;
    const matchesFilter =
      filterType === 'all'
        ? true
        : filterType === 'single'
        ? !gs
        : !!gs;

    if (!matchesFilter) return false;

    if (selectedModuleFilter !== 'all') {
      const stepModuleId = s.module_id || s.module?.id;
      if (stepModuleId !== selectedModuleFilter) return false;
    }

    return (
      s.title.toLowerCase().includes(q) ||
      s.step.toLowerCase().includes(q) ||
      (s.expected_result || '').toLowerCase().includes(q) ||
      (s.data || '').toLowerCase().includes(q) ||
      (gs && gs.some((g: any) =>
        (g.step || '').toLowerCase().includes(q) ||
        (g.expectedResult || g.expected_result || '').toLowerCase().includes(q) ||
        (g.data || '').toLowerCase().includes(q)
      ))
    );
  });

  const columns = [
    {
      id: 'title',
      header: 'Title / Action',
      accessor: (row: any) => (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground text-sm">{row.title}</span>
            {Array.isArray(row.steps) && row.steps.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-500 dark:text-violet-400 font-mono font-medium border border-violet-500/25">
                {row.steps.length} steps
              </span>
            )}
          </div>
          {row.step && row.step !== row.title && (
            <p className="text-xs text-muted-foreground truncate max-w-sm font-normal">
              {row.step}
            </p>
          )}
        </div>
      ),
    },
    {
      id: 'module',
      header: 'Module',
      accessor: (row: any) => {
        const modName = row.module?.name;
        return modName ? (
          <span className="text-[11px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-medium truncate max-w-[120px] inline-block">
            {modName}
          </span>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        );
      },
    },
    {
      id: 'step',
      header: 'Preview',
      accessor: (row: any) => {
        const gs = Array.isArray(row.steps) && row.steps.length > 0 ? row.steps : null;
        return gs ? (
          <div className="text-xs text-muted-foreground space-y-0.5 max-w-xs">
            {gs.slice(0, 2).map((s: any, i: number) => (
              <div key={i} className="truncate pl-2 border-l-2 border-violet-500/30">{s.step}</div>
            ))}
            {gs.length > 2 && <div className="text-muted-foreground/60">+{gs.length - 2} more</div>}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground max-w-xs truncate block">{row.step}</span>
        );
      },
    },
    {
      id: 'usage',
      header: 'Used In',
      accessor: (row: any) => (
        <button 
          onClick={() => openViewDialog(row, 'usage')}
          className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 font-medium transition-colors cursor-pointer"
          title="View test cases using this step"
        >
          {row._count?.test_case_steps || 0} {row._count?.test_case_steps === 1 ? 'case' : 'cases'}
        </button>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      accessor: (row: any) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" onClick={() => openViewDialog(row, 'steps')} title="View details">
            <Eye className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleCloneStep(row)} title="Clone / Duplicate">
            <Copy className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => openEditDialog(row)} title="Edit in library">
            <Edit2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleDeleteClick(row)} title="Delete" className="text-red-600 hover:text-red-700">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Step Library</h2>
          <p className="text-sm text-muted-foreground">Manage reusable step flows and components across the project</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          New Step
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search reusable steps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Module Filter & Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2">
          {modules && modules.length > 0 && (
            <select
              value={selectedModuleFilter}
              onChange={(e) => setSelectedModuleFilter(e.target.value)}
              className="h-8 px-2.5 rounded-xl border border-border/50 bg-background text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="all">All Modules</option>
              {modules.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-xl border border-border/40 text-xs">
            <button
              onClick={() => setFilterType('all')}
              className={cn(
                "px-3 py-1.5 rounded-lg font-medium transition-colors",
                filterType === 'all'
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              All ({steps.length})
            </button>
            <button
              onClick={() => setFilterType('single')}
              className={cn(
                "px-3 py-1.5 rounded-lg font-medium transition-colors",
                filterType === 'single'
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Single ({singleCount})
            </button>
            <button
              onClick={() => setFilterType('group')}
              className={cn(
                "px-3 py-1.5 rounded-lg font-medium transition-colors",
                filterType === 'group'
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Groups ({groupCount})
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
        <DataTable
          data={filteredSteps}
          columns={columns}
          onRowClick={(row) => openViewDialog(row, 'steps')}
          getId={(row) => row.id}
          loading={loading}
          tableClassName="w-full min-w-[600px]"
          emptyComponent={<p className="py-8 text-sm text-muted-foreground text-center">No reusable steps yet. Create one to get started.</p>}
        />
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{editingStep ? 'Edit Reusable Step' : 'Create Reusable Step'}</DialogTitle>
            <DialogDescription>
              Reusable steps can be inserted into any test case. Changes to the source will flag linked steps as outdated.
              Use multiple steps to create a reusable group.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={editingStep ? handleUpdate : handleCreate} className="flex flex-col flex-1 overflow-hidden">
            <div className="space-y-4 py-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Title</label>
                  <Input
                    value={formData.title}
                    onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                    placeholder="e.g., Login Flow"
                    required
                    className="text-xs h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Module Classification</label>
                  <select
                    value={formData.moduleId}
                    onChange={(e) => setFormData({ ...formData, moduleId: e.target.value })}
                    className="flex h-9 w-full rounded-lg border border-border/50 bg-background px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">No Module</option>
                    {(modules || []).map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Toggle: Single step vs Group */}
              <div className="flex items-center gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!isGroup}
                    onChange={() => setGroupSteps([])}
                    className="text-primary"
                  />
                  Single step
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={isGroup}
                    onChange={() => {
                      if (groupSteps.length === 0) {
                        setGroupSteps([{ key: `step-${Date.now()}`, step: '', expectedResult: '', data: '', imageUrl: '' }]);
                      }
                    }}
                    className="text-primary"
                  />
                  Multiple steps (group)
                </label>
              </div>

              {isGroup ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Steps</label>
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setShowLibraryModal(true)}>
                        <Search className="h-3 w-3 mr-1" /> Insert from Library
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={addGroupStep}>
                        <Plus className="h-3 w-3 mr-1" /> Add Step
                      </Button>
                    </div>
                  </div>
                  <div className="border border-border/50 rounded-lg divide-y divide-border/30">
                    {groupSteps.map((gs, idx) => {
                      const gsActionMatch = matchActionPrefix(autocompleteIndex, gs.step);
                      const gsLiveExpected =
                        !gs.expectedResult.trim() && gsActionMatch?.entry.expectedResult
                          ? gsActionMatch.entry.expectedResult
                          : undefined;
                      const gsExpectedMatch = matchExpectedResultPrefix(
                        autocompleteIndex,
                        gs.expectedResult,
                        gs.step
                      );
                      return (
                      <div key={gs.key} className="p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-mono text-muted-foreground">Step {idx + 1}</span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                const newSteps = [...groupSteps];
                                newSteps.splice(idx + 1, 0, { key: `step-${Date.now()}-${Math.random()}`, step: '', expectedResult: '', data: '', imageUrl: '' });
                                setGroupSteps(newSteps);
                              }}
                              className="p-0.5 text-muted-foreground hover:text-foreground"
                              title="Add step below"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                            {groupSteps.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeGroupStep(gs.key)}
                                className="p-0.5 text-muted-foreground hover:text-red-500"
                                title="Remove step"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <VariableAutocomplete
                              value={gs.step}
                              onChange={(value) => updateGroupStep(gs.key, 'step', value)}
                              placeholder="Step action..."
                              variables={variables}
                              multiline
                              ghostSuffix={gsActionMatch?.ghostSuffix}
                              onAcceptGhost={
                                gsActionMatch && (gsActionMatch.ghostSuffix || gsLiveExpected)
                                  ? () => {
                                      setGroupSteps((prev) =>
                                        prev.map((s) =>
                                          s.key === gs.key
                                            ? {
                                                ...s,
                                                step: gsActionMatch.completedAction,
                                                expectedResult:
                                                  !s.expectedResult.trim() && gsActionMatch.entry.expectedResult
                                                    ? gsActionMatch.entry.expectedResult
                                                    : s.expectedResult,
                                              }
                                            : s
                                        )
                                      );
                                    }
                                  : undefined
                              }
                            />
                          </div>
                          <div className="bg-muted/20">
                            <VariableAutocomplete
                              value={gs.expectedResult}
                              onChange={(value) => updateGroupStep(gs.key, 'expectedResult', value)}
                              placeholder="Expected result..."
                              variables={variables}
                              multiline
                              ghostSuffix={gsLiveExpected || gsExpectedMatch?.ghostSuffix}
                              onAcceptGhost={
                                gsExpectedMatch
                                  ? () => updateGroupStep(gs.key, 'expectedResult', gsExpectedMatch.completedText)
                                  : undefined
                              }
                            />
                          </div>
                        </div>
                        <div>
                          <VariableAutocomplete
                            value={gs.data}
                            onChange={(value) => updateGroupStep(gs.key, 'data', value)}
                            placeholder="Test data (optional)"
                            variables={variables}
                            multiline
                            className="text-xs"
                          />
                        </div>
                      </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                (() => {
                  const singleActionMatch = matchActionPrefix(autocompleteIndex, formData.step);
                  const singleLiveExpected =
                    !formData.expectedResult.trim() && singleActionMatch?.entry.expectedResult
                      ? singleActionMatch.entry.expectedResult
                      : undefined;
                  const singleExpectedMatch = matchExpectedResultPrefix(
                    autocompleteIndex,
                    formData.expectedResult,
                    formData.step
                  );
                  return (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Step Description</label>
                        <VariableAutocomplete
                          value={formData.step}
                          onChange={(value) => setFormData({ ...formData, step: value })}
                          placeholder="Enter username and password, click login"
                          variables={variables}
                          multiline
                          ghostSuffix={singleActionMatch?.ghostSuffix}
                          onAcceptGhost={
                            singleActionMatch && (singleActionMatch.ghostSuffix || singleLiveExpected)
                              ? () => {
                                  setFormData((prev) => ({
                                    ...prev,
                                    step: singleActionMatch.completedAction,
                                    expectedResult:
                                      !prev.expectedResult.trim() && singleActionMatch.entry.expectedResult
                                        ? singleActionMatch.entry.expectedResult
                                        : prev.expectedResult,
                                  }));
                                }
                              : undefined
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Expected Result (optional)</label>
                        <VariableAutocomplete
                          value={formData.expectedResult}
                          onChange={(value) => setFormData({ ...formData, expectedResult: value })}
                          placeholder="User is redirected to dashboard"
                          variables={variables}
                          multiline
                          ghostSuffix={singleLiveExpected || singleExpectedMatch?.ghostSuffix}
                          onAcceptGhost={
                            singleExpectedMatch
                              ? () => setFormData((prev) => ({ ...prev, expectedResult: singleExpectedMatch.completedText }))
                              : undefined
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Test Data (optional)</label>
                        <VariableAutocomplete
                          value={formData.data}
                          onChange={(value) => setFormData({ ...formData, data: value })}
                          placeholder="username: admin, password: secret123"
                          variables={variables}
                          multiline
                        />
                      </div>
                    </>
                  );
                })()
              )}
            </div>
            <DialogFooter className="border-t border-border/30 pt-4">
              <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
              <Button type="submit">{editingStep ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <StepLibraryModal
        open={showLibraryModal}
        onOpenChange={setShowLibraryModal}
        steps={steps}
        loading={loading}
        onSelect={(step) => {
          const newSteps = [...groupSteps];
          // If the selected reusable step is a group itself, flatten and append its steps
          if (Array.isArray(step.steps) && step.steps.length > 0) {
            step.steps.forEach((s: any) => {
              newSteps.push({
                key: `step-${Date.now()}-${Math.random()}`,
                step: s.step || '',
                expectedResult: s.expectedResult || s.expected_result || '',
                data: s.data || '',
                imageUrl: s.imageUrl || s.image_url || ''
              });
            });
          } else {
            // It's a single step
            newSteps.push({
              key: `step-${Date.now()}`,
              step: step.step || '',
              expectedResult: step.expected_result || '',
              data: step.data || '',
              imageUrl: ''
            });
          }
          // Remove empty initial step if it exists and is untouched
          if (newSteps.length > 1 && newSteps[0].step === '' && newSteps[0].expectedResult === '' && newSteps[0].data === '') {
            newSteps.shift();
          }
          setGroupSteps(newSteps);
        }}
      />

      {/* View Reusable Step Dialog */}
      <Dialog open={!!viewingStep} onOpenChange={(open) => { if (!open) setViewingStep(null); }}>
        <DialogContent hideClose={true} className="max-w-3xl max-h-[82vh] flex flex-col bg-card text-card-foreground border border-border/80 shadow-2xl p-0 overflow-hidden rounded-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border/40 bg-muted/20">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                <Layers className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <DialogTitle className="text-base font-bold text-foreground truncate">{viewingStep?.title || 'Reusable Step'}</DialogTitle>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700 dark:text-violet-300 font-mono font-semibold shrink-0">
                    {Array.isArray(viewingStep?.steps) && viewingStep.steps.length > 0 ? `${viewingStep.steps.length} steps` : '1 step'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Reusable step definition and test case usage
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={() => {
                  const stepToEdit = viewingStep;
                  setViewingStep(null);
                  openEditDialog(stepToEdit);
                }}
              >
                <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                Edit in Library
              </Button>
              <button
                type="button"
                onClick={() => setViewingStep(null)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                title="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-2 px-6 pt-3 border-b border-border/30 bg-muted/10 text-xs">
            <button
              onClick={() => setViewModalTab('steps')}
              className={cn(
                "pb-2.5 font-semibold transition-colors border-b-2 cursor-pointer",
                viewModalTab === 'steps'
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              Steps Definition ({Array.isArray(viewingStep?.steps) && viewingStep.steps.length > 0 ? viewingStep.steps.length : 1})
            </button>
            <button
              onClick={() => setViewModalTab('usage')}
              className={cn(
                "pb-2.5 font-semibold transition-colors border-b-2 flex items-center gap-1.5 cursor-pointer",
                viewModalTab === 'usage'
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              <span>Used in Test Cases</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-muted font-mono font-medium">
                {viewingStepUsage.length || viewingStep?._count?.test_case_steps || 0}
              </span>
            </button>
          </div>

          {/* Content Body */}
          <div className="p-6 overflow-y-auto flex-1 space-y-4 min-h-[300px]">
            {viewModalTab === 'steps' ? (
              <div>
                {Array.isArray(viewingStep?.steps) && viewingStep.steps.length > 0 ? (
                  <div className="border border-border/50 rounded-xl overflow-hidden shadow-xs">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead className="bg-muted/40 text-muted-foreground border-b border-border/50 uppercase tracking-wider font-semibold text-[10px]">
                        <tr>
                          <th className="px-3 py-2 w-12 border-r border-border/30">#</th>
                          <th className="px-4 py-2 border-r border-border/30 w-[50%]">Action</th>
                          <th className="px-4 py-2 w-[50%]">Expected Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/30 bg-card">
                        {viewingStep.steps.map((s: any, i: number) => (
                          <tr key={i} className="hover:bg-muted/15 transition-colors">
                            <td className="px-3 py-2.5 text-muted-foreground font-mono align-top border-r border-border/30">
                              {i + 1}
                            </td>
                            <td className="px-4 py-2.5 text-foreground/90 font-medium leading-relaxed align-top border-r border-border/30">
                              <p>{s.step || s.description || '—'}</p>
                              {s.data && (
                                <div className="mt-1 text-[11px] font-mono text-muted-foreground bg-muted/30 px-2 py-0.5 rounded border border-border/30 inline-block">
                                  data · {s.data}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-foreground/80 leading-relaxed align-top">
                              {s.expectedResult || s.expected_result || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-border/50 grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/10">
                    <div>
                      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Action</h4>
                      <p className="text-sm font-medium text-foreground/90 leading-relaxed">
                        {viewingStep?.step || '—'}
                      </p>
                      {viewingStep?.data && (
                        <div className="mt-2 text-xs font-mono text-muted-foreground bg-muted/40 p-1.5 rounded border border-border/30 inline-block">
                          data · {viewingStep.data}
                        </div>
                      )}
                    </div>
                    <div>
                      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Expected Result</h4>
                      <p className="text-sm text-foreground/80 leading-relaxed">
                        {viewingStep?.expected_result || '—'}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Search input in usage tab */}
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search test cases using this step..."
                    value={usageSearch}
                    onChange={(e) => setUsageSearch(e.target.value)}
                    className="pl-9 h-8 text-xs bg-muted/20"
                  />
                </div>

                {loadingUsage ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  (() => {
                    const filteredUsage = viewingStepUsage.filter((c) => {
                      if (!usageSearch.trim()) return true;
                      const q = usageSearch.toLowerCase().trim();
                      return (
                        c.display_id?.toLowerCase().includes(q) ||
                        c.title?.toLowerCase().includes(q) ||
                        c.moduleName?.toLowerCase().includes(q)
                      );
                    });

                    if (filteredUsage.length === 0) {
                      return (
                        <div className="text-sm text-muted-foreground bg-muted/20 p-8 rounded-xl border border-border/40 text-center">
                          {viewingStepUsage.length === 0
                            ? 'This reusable step is not currently used in any active test cases.'
                            : 'No matching test cases found.'}
                        </div>
                      );
                    }

                    return (
                      <div className="border border-border/60 rounded-xl overflow-hidden shadow-2xs bg-card">
                        <table className="w-full text-xs text-left border-collapse table-fixed">
                          <thead>
                            <tr className="bg-muted/40 text-muted-foreground border-b border-border/50 uppercase tracking-wider font-semibold text-[10px]">
                              <th className="px-3 py-2 w-20 border-r border-border/30">ID</th>
                              <th className="px-3 py-2 border-r border-border/30 w-[46%]">Title</th>
                              <th className="px-3 py-2 border-r border-border/30 w-[22%]">Module</th>
                              <th className="px-2 py-2 w-14 text-center border-r border-border/30">Prio</th>
                              <th className="px-3 py-2 w-20 text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/30">
                            {filteredUsage.map((c: any) => (
                              <tr
                                key={c.id}
                                className="hover:bg-muted/30 transition-colors group cursor-pointer"
                                onClick={() => window.open(`/p/${slug}/repository/${c.display_id}`, '_blank')}
                              >
                                {/* ID Column */}
                                <td className="px-3 py-2.5 border-r border-border/30 font-mono font-bold text-primary group-hover:underline truncate align-middle">
                                  {c.display_id}
                                </td>

                                {/* Title Column */}
                                <td className="px-3 py-2.5 border-r border-border/30 font-medium text-foreground group-hover:text-primary transition-colors truncate align-middle">
                                  <span className="truncate block" title={c.title}>{c.title}</span>
                                </td>

                                {/* Module Column */}
                                <td className="px-3 py-2.5 border-r border-border/30 align-middle truncate">
                                  {c.moduleName ? (
                                    <span className="inline-block text-[10px] px-2 py-0.5 rounded-md bg-muted/60 text-muted-foreground font-medium truncate max-w-full" title={c.moduleName}>
                                      {c.moduleName}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground/40 font-mono select-none">—</span>
                                  )}
                                </td>

                                {/* Priority Column */}
                                <td className="px-2 py-2.5 text-center border-r border-border/30 align-middle">
                                  {c.priority ? (
                                    <PriorityBadge priority={c.priority} className="text-[9px] px-1 py-0 inline-block" />
                                  ) : (
                                    <span className="text-muted-foreground/40 font-mono select-none">—</span>
                                  )}
                                </td>

                                {/* Status Column */}
                                <td className="px-3 py-2.5 text-right align-middle">
                                  <span className={cn(
                                    "text-[10px] px-2 py-0.5 rounded-full uppercase font-semibold inline-block",
                                    c.status === 'ACTIVE' ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20" :
                                    c.status === 'DRAFT' ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/20" :
                                    "bg-muted text-muted-foreground border border-border/40"
                                  )}>
                                    {c.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()
                )}
              </div>
            )}
          </div>

          <DialogFooter className="px-6 py-3 border-t border-border/40 bg-muted/10">
            <Button variant="outline" size="sm" onClick={() => setViewingStep(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Reusable Step Dialog with Dependency Handling */}
      {stepToDeleteObj && (
        <Dialog open={!!stepToDeleteObj} onOpenChange={(open) => { if (!open) setStepToDeleteObj(null); }}>
          <DialogContent className="max-w-lg bg-card text-card-foreground border border-border/80 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-destructive flex items-center gap-2">
                <Trash2 className="h-4 w-4" />
                Delete Reusable Step
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {stepToDeleteObj._count?.test_case_steps > 0 ? (
                  <>
                    <strong className="text-foreground">&quot;{stepToDeleteObj.title}&quot;</strong> is currently linked to{' '}
                    <strong className="text-foreground">{stepToDeleteObj._count.test_case_steps} test case(s)</strong>.
                  </>
                ) : (
                  <>Are you sure you want to delete &quot;{stepToDeleteObj.title}&quot; from the library?</>
                )}
              </DialogDescription>
            </DialogHeader>

            {stepToDeleteObj._count?.test_case_steps > 0 ? (
              <div className="space-y-3 py-2">
                <p className="text-xs text-muted-foreground">
                  Choose how to handle the linked test cases:
                </p>

                <div
                  onClick={() => confirmDelete('convert_to_normal')}
                  className="p-3 rounded-xl border border-border/60 hover:border-primary/50 hover:bg-muted/40 transition-all cursor-pointer group bg-muted/10"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                      Convert linked steps to normal steps & delete master (Recommended)
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-medium">Safe</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Test cases keep all their step text and test data as independent custom steps. No test cases will lose steps.
                  </p>
                </div>

                <div
                  onClick={() => confirmDelete('delete_all')}
                  className="p-3 rounded-xl border border-destructive/30 hover:border-destructive/60 hover:bg-destructive/5 transition-all cursor-pointer group"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-destructive transition-colors">
                      Delete master and remove all linked steps from test cases
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">Destructive</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Removes all steps belonging to this reusable step across all {stepToDeleteObj._count.test_case_steps} test cases.
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-2 text-xs text-muted-foreground">
                This reusable step is not used in any test cases. Deleting it will permanently remove it from the library.
              </div>
            )}

            <DialogFooter className="flex items-center justify-end gap-2 border-t border-border/40 pt-3">
              <Button variant="ghost" size="sm" onClick={() => setStepToDeleteObj(null)}>
                Cancel
              </Button>
              {(!stepToDeleteObj._count?.test_case_steps || stepToDeleteObj._count?.test_case_steps === 0) && (
                <Button variant="destructive" size="sm" onClick={() => confirmDelete('convert_to_normal')}>
                  Delete Reusable Step
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}