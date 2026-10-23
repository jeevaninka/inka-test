'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Database,
  Plus,
  Trash2,
  FileSpreadsheet,
  Globe,
  Sliders,
  Check,
  ExternalLink,
  Table as TableIcon,
  X,
  Lock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { cn, formatVariableName } from '@/lib/utils';
import {
  getDatasetsAction,
  linkTestCaseDatasetAction,
  updateTestCaseLocalDatasetAction,
} from '@/app/actions/datasets';
import {
  getTestCaseLocalVariablesAction,
  createVariableAction,
  deleteVariableAction,
  setVariableValueAction,
  getEnvironmentsAction,
} from '@/app/actions/variables';

interface CaseParametersTabProps {
  testCaseId: string;
  projectId: string;
  projectSlug: string;
  isLocked?: boolean;
  initialDatasetId?: string | null;
  initialLocalDataset?: { parameters: string[]; rows: any[] } | null;
  onParametersChange?: (params: string[]) => void;
}

export function CaseParametersTab({
  testCaseId,
  projectId,
  projectSlug,
  isLocked = false,
  initialDatasetId,
  initialLocalDataset,
  onParametersChange,
}: CaseParametersTabProps) {
  const [datasetMode, setDatasetMode] = useState<'none' | 'shared' | 'local'>(() => {
    if (initialDatasetId) return 'shared';
    if (initialLocalDataset && Array.isArray(initialLocalDataset.parameters) && initialLocalDataset.parameters.length > 0) {
      return 'local';
    }
    return 'none';
  });

  const [availableDatasets, setAvailableDatasets] = useState<any[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(initialDatasetId || '');
  const [localParams, setLocalParams] = useState<string[]>(initialLocalDataset?.parameters || ['param1']);
  const [localRows, setLocalRows] = useState<any[]>(initialLocalDataset?.rows || [{ id: '1', param1: '' }]);
  const [newParamInput, setNewParamInput] = useState('');
  const [localVars, setLocalVars] = useState<any[]>([]);
  const [environments, setEnvironments] = useState<any[]>([]);
  const [showAddVarModal, setShowAddVarModal] = useState(false);
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarDefault, setNewVarDefault] = useState('');
  const [newVarIsSecret, setNewVarIsSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeLocalTab, setActiveLocalTab] = useState<'grid' | 'csv'>('grid');
  const [csvText, setCsvText] = useState('');

  // Load shared datasets and local variables
  const loadData = useCallback(async () => {
    try {
      const [dsList, envsList, varsList] = await Promise.all([
        getDatasetsAction(projectId),
        getEnvironmentsAction(projectId),
        getTestCaseLocalVariablesAction(testCaseId),
      ]);
      setAvailableDatasets(dsList);
      setEnvironments(envsList);
      setLocalVars(varsList);
    } catch {
      /* silent */
    }
  }, [projectId, testCaseId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Notify parent of available parameter keys for autocompletion
  const lastNotifiedParamsRef = useRef<string>('');
  useEffect(() => {
    let params: string[] = [];
    if (datasetMode === 'shared') {
      const found = availableDatasets.find((d) => d.id === selectedDatasetId);
      if (found?.parameters) params = found.parameters;
    } else if (datasetMode === 'local') {
      params = localParams;
    }
    const key = JSON.stringify(params);
    if (lastNotifiedParamsRef.current !== key) {
      lastNotifiedParamsRef.current = key;
      onParametersChange?.(params);
    }
  }, [datasetMode, selectedDatasetId, localParams, availableDatasets, onParametersChange]);

  const handleSaveDatasetMode = async () => {
    setSaving(true);
    try {
      if (datasetMode === 'shared') {
        if (!selectedDatasetId) {
          toast.error('Please select a shared dataset');
          setSaving(false);
          return;
        }
        await linkTestCaseDatasetAction(testCaseId, selectedDatasetId);
        await updateTestCaseLocalDatasetAction(testCaseId, null);
        toast.success('Linked shared dataset');
      } else if (datasetMode === 'local') {
        if (localParams.length === 0) {
          toast.error('Define at least one parameter');
          setSaving(false);
          return;
        }
        await linkTestCaseDatasetAction(testCaseId, null);
        await updateTestCaseLocalDatasetAction(testCaseId, {
          parameters: localParams,
          rows: localRows,
        });
        toast.success('Saved local dataset');
      } else {
        await linkTestCaseDatasetAction(testCaseId, null);
        await updateTestCaseLocalDatasetAction(testCaseId, null);
        toast.success('Removed dataset binding');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to update dataset settings');
    } finally {
      setSaving(false);
    }
  };

  // Add parameter to local dataset
  const handleAddLocalParam = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newParamInput.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!clean) return;
    if (localParams.includes(clean)) {
      toast.error('Parameter already exists');
      return;
    }
    const next = [...localParams, clean];
    setLocalParams(next);
    setLocalRows(localRows.map((r) => ({ ...r, [clean]: r[clean] || '' })));
    setNewParamInput('');
  };

  const handleRemoveLocalParam = (param: string) => {
    if (localParams.length <= 1) {
      toast.error('At least one parameter is required');
      return;
    }
    setLocalParams(localParams.filter((p) => p !== param));
    setLocalRows(localRows.map((r) => {
      const copy = { ...r };
      delete copy[param];
      return copy;
    }));
  };

  const handleAddLocalRow = () => {
    const newRow: any = { id: `row-${Date.now()}` };
    localParams.forEach((p) => {
      newRow[p] = '';
    });
    setLocalRows([...localRows, newRow]);
  };

  const handleUpdateLocalCell = (rowIndex: number, param: string, val: string) => {
    const next = [...localRows];
    next[rowIndex] = { ...next[rowIndex], [param]: val };
    setLocalRows(next);
  };

  const handleRemoveLocalRow = (rowIndex: number) => {
    if (localRows.length <= 1) {
      toast.error('At least one iteration row is required');
      return;
    }
    setLocalRows(localRows.filter((_, idx) => idx !== rowIndex));
  };

  // Local variable creation
  const handleCreateLocalVar = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newVarKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (!clean) {
      toast.error('Key is required');
      return;
    }
    try {
      await createVariableAction({
        projectId,
        testCaseId,
        key: clean,
        scope: 'LOCAL',
        defaultValue: newVarDefault,
        isSecret: newVarIsSecret,
      });
      toast.success(`Local variable ${formatVariableName(clean)} created`);
      setNewVarKey('');
      setNewVarDefault('');
      setNewVarIsSecret(false);
      setShowAddVarModal(false);
      const updated = await getTestCaseLocalVariablesAction(testCaseId);
      setLocalVars(updated);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create local variable');
    }
  };

  const handleDeleteLocalVar = async (varId: string) => {
    try {
      await deleteVariableAction(varId);
      toast.success('Local variable removed');
      setLocalVars(localVars.filter((v) => v.id !== varId));
    } catch (err: any) {
      toast.error('Failed to delete variable');
    }
  };

  const selectedSharedDs = availableDatasets.find((d) => d.id === selectedDatasetId);

  return (
    <div className="space-y-6 max-w-4xl py-2">
      {/* SECTION 1: DATASET / PARAMETRISATION */}
      <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Data-Driven Testing (Parametrisation)</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Run this test case across multiple iterations with variable test data payloads
              </p>
            </div>
          </div>
          {!isLocked && (
            <Button size="sm" onClick={handleSaveDatasetMode} disabled={saving} className="h-8 text-xs font-semibold">
              <Check className="h-3.5 w-3.5 mr-1.5" />
              Save Dataset Settings
            </Button>
          )}
        </div>

        {/* Dataset Mode Radios */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div
            onClick={() => !isLocked && setDatasetMode('none')}
            className={cn(
              'p-3.5 rounded-xl border text-xs cursor-pointer transition-all',
              datasetMode === 'none'
                ? 'border-primary bg-primary/5 ring-1 ring-primary'
                : 'border-border/60 hover:bg-muted/30'
            )}
          >
            <div className="font-semibold text-foreground">Standard (No Dataset)</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Case executes once per test run with fixed steps.
            </p>
          </div>

          <div
            onClick={() => !isLocked && setDatasetMode('shared')}
            className={cn(
              'p-3.5 rounded-xl border text-xs cursor-pointer transition-all',
              datasetMode === 'shared'
                ? 'border-orange-500 bg-orange-500/5 ring-1 ring-orange-500'
                : 'border-border/60 hover:bg-muted/30'
            )}
          >
            <div className="font-semibold text-foreground flex items-center justify-between">
              <span>Shared Project Dataset</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-orange-500/15 text-orange-600 font-mono">Shared</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Attach a reusable dataset managed in Project Settings.
            </p>
          </div>

          <div
            onClick={() => !isLocked && setDatasetMode('local')}
            className={cn(
              'p-3.5 rounded-xl border text-xs cursor-pointer transition-all',
              datasetMode === 'local'
                ? 'border-orange-500 bg-orange-500/5 ring-1 ring-orange-500'
                : 'border-border/60 hover:bg-muted/30'
            )}
          >
            <div className="font-semibold text-foreground flex items-center justify-between">
              <span>Case-Specific Dataset</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-mono">Custom</span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Define custom parameters and rows unique to this test case.
            </p>
          </div>
        </div>

        {/* SHARED DATASET VIEW */}
        {datasetMode === 'shared' && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                  Select Project Dataset
                </label>
                <select
                  value={selectedDatasetId}
                  onChange={(e) => setSelectedDatasetId(e.target.value)}
                  disabled={isLocked}
                  className="flex h-9 w-full rounded-xl border border-border/60 bg-background px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Select a shared dataset...</option>
                  {availableDatasets.map((ds) => (
                    <option key={ds.id} value={ds.id}>
                      {ds.name} ({ds.parameters.length} parameters, {ds.rows.length} rows)
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-5">
                <a
                  href={`/p/${projectSlug}/configuration/datasets`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1 font-medium"
                >
                  Manage Datasets <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            {selectedSharedDs && (
              <div className="p-3.5 rounded-xl border border-border/60 bg-muted/20 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">
                    Available Parameters in Steps:
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    {selectedSharedDs.rows?.length || 0} iterations
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(selectedSharedDs.parameters || []).map((param: string) => (
                    <span
                      key={param}
                      className="px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-700 dark:text-orange-300 border border-orange-500/30 font-mono text-xs font-medium"
                    >
                      &#123;{param}&#125;
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* CASE-SPECIFIC LOCAL DATASET EDITOR */}
        {datasetMode === 'local' && (
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between border-b border-border/30 pb-2">
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveLocalTab('grid')}
                  className={cn(
                    'px-2.5 py-1 rounded-md font-semibold flex items-center gap-1.5 transition-colors cursor-pointer',
                    activeLocalTab === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <TableIcon className="h-3.5 w-3.5" />
                  Table Grid
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const header = localParams.join(',');
                    const cRows = localRows.map((r) =>
                      localParams.map((p) => `"${(r[p] || '').replace(/"/g, '""')}"`).join(',')
                    );
                    setCsvText([header, ...cRows].join('\n'));
                    setActiveLocalTab('csv');
                  }}
                  className={cn(
                    'px-2.5 py-1 rounded-md font-semibold flex items-center gap-1.5 transition-colors cursor-pointer',
                    activeLocalTab === 'csv' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  CSV Paste
                </button>
              </div>
              <span className="text-xs text-muted-foreground font-mono">
                {localParams.length} params · {localRows.length} iterations
              </span>
            </div>

            {activeLocalTab === 'grid' ? (
              <div className="space-y-3">
                {/* Parameters header */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase mr-1">
                    Parameters:
                  </span>
                  {localParams.map((param) => (
                    <span
                      key={param}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-700 dark:text-orange-300 border border-orange-500/30 font-mono text-xs font-medium"
                    >
                      <span>&#123;{param}&#125;</span>
                      {!isLocked && (
                        <button
                          type="button"
                          onClick={() => handleRemoveLocalParam(param)}
                          className="hover:text-destructive cursor-pointer p-0.5"
                          title="Remove parameter"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  ))}

                  {!isLocked && (
                    <div className="inline-flex items-center gap-1">
                      <Input
                        value={newParamInput}
                        onChange={(e) => setNewParamInput(e.target.value)}
                        placeholder="+ param"
                        className="h-6 w-24 text-xs font-mono px-2 py-0"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddLocalParam(e);
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleAddLocalParam}
                        disabled={!newParamInput.trim()}
                        className="h-6 px-1.5 text-xs"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Rows Table */}
                <div className="border border-border/70 rounded-xl overflow-x-auto bg-card">
                  <table className="w-full text-xs text-left border-collapse table-fixed">
                    <thead>
                      <tr className="bg-muted/40 text-muted-foreground border-b border-border/50 uppercase tracking-wider font-semibold text-[10px]">
                        <th className="px-3 py-2 w-12 border-r border-border/30 text-center">#</th>
                        {localParams.map((p) => (
                          <th key={p} className="px-3 py-2 border-r border-border/30 font-mono text-orange-600 dark:text-orange-400">
                            &#123;{p}&#125;
                          </th>
                        ))}
                        {!isLocked && <th className="px-2 py-2 w-10 text-center"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {localRows.map((row, rIdx) => (
                        <tr key={row.id || rIdx} className="hover:bg-muted/20 transition-colors">
                          <td className="px-2 py-1.5 text-center font-mono text-muted-foreground border-r border-border/30">
                            {rIdx + 1}
                          </td>
                          {localParams.map((p) => (
                            <td key={p} className="px-2 py-1 border-r border-border/30">
                              <input
                                type="text"
                                value={row[p] || ''}
                                onChange={(e) => handleUpdateLocalCell(rIdx, p, e.target.value)}
                                disabled={isLocked}
                                placeholder={`Value for ${p}`}
                                className="w-full bg-transparent px-1.5 py-0.5 text-xs font-mono text-foreground focus:outline-none focus:bg-muted/40 rounded transition-colors"
                              />
                            </td>
                          ))}
                          {!isLocked && (
                            <td className="px-2 py-1 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveLocalRow(rIdx)}
                                className="p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                                title="Delete row"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {!isLocked && (
                  <Button type="button" variant="outline" size="sm" onClick={handleAddLocalRow} className="h-7 text-xs">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Row
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                  disabled={isLocked}
                  placeholder={'param1,param2\nval1,val2\nval3,val4'}
                  className="w-full h-36 font-mono text-xs p-3 rounded-xl border border-border/60 bg-muted/20 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                />
                {!isLocked && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const lines = csvText.trim().split('\n').map((l) => l.trim()).filter(Boolean);
                      if (lines.length < 2) {
                        toast.error('CSV needs header and at least 1 row');
                        return;
                      }
                      const hParts = lines[0].split(',').map((p) => p.replace(/["']/g, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '')).filter(Boolean);
                      const parsedRows: any[] = [];
                      for (let i = 1; i < lines.length; i++) {
                        const parts = lines[i].split(',').map((col) => col.replace(/^["']|["']$/g, '').trim());
                        const rObj: any = { id: `row-${i}-${Date.now()}` };
                        hParts.forEach((p, idx) => {
                          rObj[p] = parts[idx] || '';
                        });
                        parsedRows.push(rObj);
                      }
                      setLocalParams(hParts);
                      setLocalRows(parsedRows);
                      setActiveLocalTab('grid');
                      toast.success(`Imported ${parsedRows.length} rows`);
                    }}
                    className="h-7 text-xs"
                  >
                    Parse CSV into Grid
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* SECTION 2: LOCAL VARIABLE OVERRIDES */}
      <div className="bg-card border border-border/60 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-border/40">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
              <Globe className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Local Variable Overrides</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Variables scoped strictly to this test case. Overrides global project variables.
              </p>
            </div>
          </div>
          {!isLocked && (
            <Button size="sm" variant="outline" onClick={() => setShowAddVarModal(true)} className="h-8 text-xs font-semibold">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Local Variable
            </Button>
          )}
        </div>

        {localVars.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center italic">
            No local variable overrides configured for this test case. Global environment variables will be used.
          </p>
        ) : (
          <div className="border border-border/60 rounded-xl overflow-hidden bg-card">
            <table className="w-full text-xs text-left border-collapse table-fixed">
              <thead>
                <tr className="bg-muted/40 text-muted-foreground border-b border-border/50 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="px-3 py-2 w-[25%] border-r border-border/30">Variable Key</th>
                  <th className="px-3 py-2 w-[35%] border-r border-border/30">Default Value</th>
                  <th className="px-3 py-2">Environment Overrides</th>
                  {!isLocked && <th className="px-2 py-2 w-12 text-center"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {localVars.map((v) => (
                  <tr key={v.id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono font-bold text-sky-600 dark:text-sky-400 border-r border-border/30">
                      <div className="flex items-center gap-1.5">
                        <span>{formatVariableName(v.key)}</span>
                        {v.is_secret && <Lock className="h-3 w-3 text-amber-500 shrink-0" />}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-foreground border-r border-border/30 truncate">
                      {v.default_value || <span className="text-muted-foreground/40">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(v.values || []).map((val: any) => (
                          <span
                            key={val.id}
                            className="px-2 py-0.5 rounded bg-muted/60 font-mono text-[10px] text-foreground border border-border/40"
                          >
                            {val.environment?.name}: {val.value}
                          </span>
                        ))}
                      </div>
                    </td>
                    {!isLocked && (
                      <td className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteLocalVar(v.id)}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
                          title="Delete local variable"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ADD LOCAL VARIABLE MODAL */}
      <Dialog open={showAddVarModal} onOpenChange={setShowAddVarModal}>
        <DialogContent className="max-w-md bg-card border border-border/80 shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">Add Local Variable Override</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateLocalVar} className="space-y-4 py-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Variable Key
              </label>
              <Input
                value={newVarKey}
                onChange={(e) => setNewVarKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                placeholder="e.g. AUTH_TOKEN, SPECIFIC_URL"
                className="font-mono text-sm uppercase"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Default Value
              </label>
              <Input
                value={newVarDefault}
                onChange={(e) => setNewVarDefault(e.target.value)}
                placeholder="Value for this test case"
                className="font-mono text-xs"
              />
            </div>

            <div className="pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={newVarIsSecret}
                  onChange={(e) => setNewVarIsSecret(e.target.checked)}
                  className="rounded border-border/50 text-primary"
                />
                <span>Mask as sensitive secret (••••••••)</span>
              </label>
            </div>

            <DialogFooter className="pt-3 border-t border-border/40">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddVarModal(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm">
                Create Local Variable
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
