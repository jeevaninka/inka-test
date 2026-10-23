'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Database,
  Search,
  Pencil,
  FileSpreadsheet,
  X,
  Upload,
  Check,
  Table as TableIcon,
  Sparkles,
  Loader2,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/common/DataTable';
import {
  getDatasetsAction,
  createDatasetAction,
  updateDatasetAction,
  deleteDatasetAction,
} from '@/app/actions/datasets';
import { generateDatasetRowsAction } from '@/app/actions/ai';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { cn } from '@/lib/utils';

interface DatasetsPageProps {
  projectId: string;
}

export function DatasetsPage({ projectId }: DatasetsPageProps) {
  const [datasets, setDatasets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDialog, setShowDialog] = useState(false);
  const [editingDataset, setEditingDataset] = useState<any | null>(null);
  const [datasetToDelete, setDatasetToDelete] = useState<any | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDatasetsAction(projectId);
      setDatasets(data);
    } catch (err: any) {
      toast.error('Failed to load datasets');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenCreate = () => {
    setEditingDataset(null);
    setShowDialog(true);
  };

  const handleOpenEdit = (ds: any) => {
    setEditingDataset(ds);
    setShowDialog(true);
  };

  const handleSave = async (data: {
    name: string;
    description?: string;
    parameters: string[];
    rows: any[];
  }) => {
    try {
      if (editingDataset) {
        await updateDatasetAction(editingDataset.id, data);
        toast.success(`Dataset "${data.name}" updated`);
      } else {
        await createDatasetAction({
          projectId,
          ...data,
        });
        toast.success(`Dataset "${data.name}" created`);
      }
      setShowDialog(false);
      setEditingDataset(null);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save dataset');
    }
  };

  const confirmDelete = async () => {
    if (!datasetToDelete) return;
    try {
      await deleteDatasetAction(datasetToDelete.id);
      toast.success(`Dataset "${datasetToDelete.name}" deleted`);
      setDatasetToDelete(null);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete dataset');
    }
  };

  const filteredDatasets = useMemo(() => {
    if (!search.trim()) return datasets;
    const q = search.toLowerCase().trim();
    return datasets.filter((ds) => {
      if (ds.name.toLowerCase().includes(q)) return true;
      if (ds.description && ds.description.toLowerCase().includes(q)) return true;
      if (ds.parameters && ds.parameters.some((p: string) => p.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [datasets, search]);

  const columns = [
    {
      id: 'name',
      header: 'Dataset Name',
      accessor: (row: any) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground text-xs">{row.name}</span>
          </div>
          {row.description && (
            <p className="text-[11px] text-muted-foreground truncate max-w-xs mt-0.5">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      id: 'parameters',
      header: 'Parameters',
      accessor: (row: any) => (
        <div className="flex flex-wrap gap-1 max-w-sm">
          {row.parameters && row.parameters.length > 0 ? (
            row.parameters.map((param: string) => (
              <span
                key={param}
                className="px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-700 dark:text-orange-300 border border-orange-500/25 font-mono text-[10px] font-medium"
              >
                &#123;{param}&#125;
              </span>
            ))
          ) : (
            <span className="text-muted-foreground/40 text-xs">—</span>
          )}
        </div>
      ),
    },
    {
      id: 'rows',
      header: 'Iterations',
      accessor: (row: any) => (
        <span className="text-xs px-2 py-0.5 rounded-md bg-muted font-mono font-medium">
          {row.rows?.length || 0} rows
        </span>
      ),
    },
    {
      id: 'cases',
      header: 'Used In',
      accessor: (row: any) => (
        <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium font-sans">
          {row.casesCount || 0} case{row.casesCount !== 1 ? 's' : ''}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      accessor: (row: any) => (
        <div className="flex gap-1 justify-end">
          <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(row)}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => setDatasetToDelete(row)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold">Datasets & Parametrisation</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define shared data matrices (parameters & iteration rows) for data-driven testing
          </p>
        </div>
        <Button onClick={handleOpenCreate} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          New Dataset
        </Button>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search datasets by name or parameter..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-xs bg-card/60"
          />
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          {filteredDatasets.length} {filteredDatasets.length === 1 ? 'dataset' : 'datasets'}
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
        <DataTable
          data={filteredDatasets}
          columns={columns}
          getId={(r) => r.id}
          loading={loading}
          tableClassName="w-full min-w-[600px]"
          emptyComponent={
            <div className="py-12 text-center space-y-3">
              <Database className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-semibold">No datasets created yet</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Datasets let you run a single test case across multiple iterations with parameters like &#123;role&#125;, &#123;username&#125;, and &#123;expected_code&#125;.
              </p>
              <Button size="sm" onClick={handleOpenCreate}>
                <Plus className="h-4 w-4 mr-1.5" />
                Create First Dataset
              </Button>
            </div>
          }
        />
      </div>

      {/* Dataset Editor Modal */}
      {showDialog && (
        <DatasetEditorDialog
          open={showDialog}
          projectId={projectId}
          dataset={editingDataset}
          onSave={handleSave}
          onCancel={() => {
            setShowDialog(false);
            setEditingDataset(null);
          }}
        />
      )}

      {/* Delete Confirmation */}
      {datasetToDelete && (
        <ConfirmModal
          open={!!datasetToDelete}
          onOpenChange={(open) => !open && setDatasetToDelete(null)}
          title={`Delete Dataset "${datasetToDelete.name}"`}
          description={
            datasetToDelete.casesCount > 0
              ? `Warning: "${datasetToDelete.name}" is attached to ${datasetToDelete.casesCount} test cases. Deleting it will unlink those test cases from this dataset. Are you sure?`
              : `Are you sure you want to delete dataset "${datasetToDelete.name}"? This action cannot be undone.`
          }
          confirmLabel="Delete Dataset"
          variant="destructive"
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}

/**
 * Interactive Dataset Table & CSV Builder Dialog
 */
function DatasetEditorDialog({
  open,
  projectId,
  dataset,
  onSave,
  onCancel,
}: {
  open: boolean;
  projectId: string;
  dataset: any | null;
  onSave: (data: { name: string; description?: string; parameters: string[]; rows: any[] }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(dataset?.name || '');
  const [description, setDescription] = useState(dataset?.description || '');
  const [parameters, setParameters] = useState<string[]>(dataset?.parameters || ['username', 'role']);
  const [rows, setRows] = useState<any[]>(dataset?.rows || [{ id: '1', username: '', role: '' }]);
  const [activeTab, setActiveTab] = useState<'grid' | 'csv'>('grid');
  const [csvText, setCsvText] = useState('');

  // AI Row Generator state
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [aiConstraints, setAiConstraints] = useState('');
  const [aiCount, setAiCount] = useState<number>(5);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);

  const handleGenerateAiRows = async (constraintsOverride?: string) => {
    const cleanParams = parameters.map((p) => p.trim()).filter(Boolean);
    if (cleanParams.length === 0) {
      toast.error('Define at least one parameter column first');
      return;
    }

    const effectiveConstraints =
      constraintsOverride !== undefined ? constraintsOverride.trim() : aiConstraints.trim();

    setIsGeneratingAi(true);
    try {
      const nonBlankExisting = rows.filter((r) =>
        cleanParams.some((p) => String(r[p] ?? '').trim() !== '')
      );
      const generated = await generateDatasetRowsAction({
        projectId,
        input: {
          parameters: cleanParams,
          existingRows: nonBlankExisting,
          constraints: effectiveConstraints || undefined,
          count: aiCount,
          datasetName: name.trim() || undefined,
          datasetDescription: description.trim() || undefined,
        },
      });

      if (generated && generated.length > 0) {
        const newDraftRows = generated.map((item, idx) => ({
          id: `ai-row-${Date.now()}-${idx}`,
          ...item.values,
          _aiDraft: true,
          _scenario: item.scenarioType,
          _note: item.note,
        }));
        setRows([...nonBlankExisting, ...newDraftRows]);
        setShowAiGenerator(false);
        toast.success(`Inserted ${newDraftRows.length} draft rows — review and click Save to confirm`);
      } else {
        toast.info('No rows generated');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate dataset rows');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleAddColumn = () => {
    const newName = `param_${parameters.length + 1}`;
    setParameters([...parameters, newName]);
    setRows(rows.map((r) => ({ ...r, [newName]: '' })));
  };

  const handleUpdateColumnName = (colIdx: number, newName: string) => {
    const clean = newName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    const oldName = parameters[colIdx];
    const nextParams = [...parameters];
    nextParams[colIdx] = clean;
    setParameters(nextParams);
    if (oldName !== clean) {
      setRows(
        rows.map((r) => {
          const copy = { ...r };
          copy[clean] = copy[oldName] || '';
          delete copy[oldName];
          return copy;
        })
      );
    }
  };

  const handleRemoveColumn = (colIdx: number) => {
    if (parameters.length <= 1) {
      toast.error('A dataset must have at least one parameter column');
      return;
    }
    const toRemove = parameters[colIdx];
    setParameters(parameters.filter((_, i) => i !== colIdx));
    setRows(
      rows.map((r) => {
        const copy = { ...r };
        delete copy[toRemove];
        return copy;
      })
    );
  };

  const handleAddRow = () => {
    const newRow: any = { id: `row-${Date.now()}` };
    parameters.forEach((p) => {
      newRow[p] = '';
    });
    setRows([...rows, newRow]);
  };

  const handleUpdateRowCell = (rowIndex: number, paramKey: string, val: string) => {
    const nextRows = [...rows];
    nextRows[rowIndex] = { ...nextRows[rowIndex], [paramKey]: val };
    setRows(nextRows);
  };

  const handleRemoveRow = (rowIndex: number) => {
    if (rows.length <= 1) {
      toast.error('Dataset must have at least one iteration row');
      return;
    }
    setRows(rows.filter((_, idx) => idx !== rowIndex));
  };

  // Convert current grid to CSV
  const syncToCsv = () => {
    if (parameters.length === 0) return;
    const header = parameters.join(',');
    const csvRows = rows.map((r) =>
      parameters.map((p) => `"${(r[p] || '').replace(/"/g, '""')}"`).join(',')
    );
    setCsvText([header, ...csvRows].join('\n'));
  };

  // Import CSV text into parameters and rows
  const handleImportCsv = () => {
    if (!csvText.trim()) return;
    const lines = csvText.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      toast.error('CSV must have a header row and at least one data row');
      return;
    }

    const headerParts = lines[0].split(',').map((h) => h.replace(/["']/g, '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '')).filter(Boolean);
    if (headerParts.length === 0) {
      toast.error('Invalid CSV header');
      return;
    }

    const parsedRows: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map((col) => col.replace(/^["']|["']$/g, '').trim());
      const rowObj: any = { id: `row-${i}-${Date.now()}` };
      headerParts.forEach((param, pIdx) => {
        rowObj[param] = parts[pIdx] || '';
      });
      parsedRows.push(rowObj);
    }

    setParameters(headerParts);
    setRows(parsedRows);
    setActiveTab('grid');
    toast.success(`Imported ${parsedRows.length} iteration rows with ${headerParts.length} parameters`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Dataset name is required');
      return;
    }
    if (parameters.length === 0) {
      toast.error('Please define at least one parameter');
      return;
    }
    const cleanRows = rows.map((r) => {
      const copy = { ...r };
      delete copy._aiDraft;
      delete copy._scenario;
      delete copy._note;
      return copy;
    });
    onSave({
      name: name.trim(),
      description: description.trim(),
      parameters,
      rows: cleanRows,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col bg-card border border-border/80 shadow-2xl p-6 overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-base font-bold flex items-center gap-2">
            <Database className="h-4 w-4 text-orange-500" />
            {dataset ? 'Edit Dataset' : 'Create Dataset'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden space-y-4 py-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Dataset Name
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. User Roles Matrix, Checkout Payments"
                required
                className="text-xs h-8"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Description (optional)
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What scenarios this dataset tests"
                className="text-xs h-8"
              />
            </div>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('grid')}
                className={cn(
                  'px-2.5 py-1 rounded-md font-semibold flex items-center gap-1.5 transition-colors cursor-pointer',
                  activeTab === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <TableIcon className="h-3.5 w-3.5" />
                Data Grid
              </button>
              <button
                type="button"
                onClick={() => {
                  syncToCsv();
                  setActiveTab('csv');
                }}
                className={cn(
                  'px-2.5 py-1 rounded-md font-semibold flex items-center gap-1.5 transition-colors cursor-pointer',
                  activeTab === 'csv' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" />
                CSV Paste / Export
              </button>
            </div>
            <span className="text-xs text-muted-foreground">
              {parameters.length} params · {rows.length} rows
            </span>
          </div>

          {activeTab === 'grid' ? (
            <div className="flex flex-col flex-1 overflow-hidden space-y-3">
              {/* Data Rows Table with Integrated Editable Column Headers */}
              <div className="flex-1 overflow-auto border border-border/70 rounded-xl bg-card">
                <table className="w-full text-xs text-left border-collapse table-fixed">
                  <thead className="bg-muted/40 border-b border-border/50 font-mono text-[11px] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 w-12 border-r border-border/30 text-center select-none">#</th>
                      {parameters.map((p, pIdx) => (
                        <th key={pIdx} className="px-2 py-2 border-r border-border/30 min-w-[170px]">
                          <div className="relative flex items-center h-8 rounded-lg border border-border/80 bg-background px-2.5 shadow-2xs focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all">
                            <input
                              value={p}
                              onChange={(e) => handleUpdateColumnName(pIdx, e.target.value)}
                              placeholder="param_name"
                              className="w-full bg-transparent text-xs font-mono font-bold text-foreground focus:outline-none placeholder:text-muted-foreground/40 pr-1"
                            />
                            {p && (
                              <span className="px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400 font-mono text-[10px] font-bold border border-orange-500/25 shrink-0 select-none mr-1 pointer-events-none">
                                &#123;{p}&#125;
                              </span>
                            )}
                            {parameters.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveColumn(pIdx)}
                                className="text-muted-foreground/50 hover:text-destructive cursor-pointer p-0.5 rounded transition-colors shrink-0"
                                title="Delete column"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="px-2 py-2 border-r border-border/30 w-32">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={handleAddColumn}
                          className="h-8 px-2.5 text-xs font-medium border-dashed border-border/70 hover:border-primary/50 text-muted-foreground hover:text-primary cursor-pointer flex items-center gap-1 shadow-2xs w-full justify-center"
                          title="Add parameter column"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Column</span>
                        </Button>
                      </th>
                      <th className="px-2 py-2 w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20 font-mono">
                    {rows.map((row, rIdx) => (
                      <tr
                        key={row.id || rIdx}
                        className={cn(
                          'hover:bg-muted/10 transition-colors',
                          row._aiDraft && 'bg-primary/[0.04]'
                        )}
                      >
                        <td className="px-2 py-2 text-center text-muted-foreground/60 text-xs border-r border-border/30 select-none">
                          <div>{rIdx + 1}</div>
                          {row._aiDraft && (
                            <span
                              className="inline-block mt-0.5 text-[8.5px] px-1 py-0.2 rounded bg-primary/15 text-primary border border-primary/30 font-sans font-bold uppercase"
                              title={row._note ? `${row._scenario || 'AI'}: ${row._note}` : 'Unsaved AI draft row'}
                            >
                              {row._scenario === 'Boundary'
                                ? 'Bnd'
                                : row._scenario === 'Negative'
                                ? 'Neg'
                                : 'AI'}
                            </span>
                          )}
                        </td>
                        {parameters.map((p) => (
                          <td key={p} className="px-2 py-1.5 border-r border-border/30">
                            <Input
                              type="text"
                              value={row[p] ?? ''}
                              onChange={(e) => handleUpdateRowCell(rIdx, p, e.target.value)}
                              placeholder={`Value`}
                              className="h-8 text-xs font-mono bg-background border-border/70 focus-visible:ring-1 focus-visible:ring-primary shadow-2xs"
                            />
                          </td>
                        ))}
                        <td className="border-r border-border/30"></td>
                        <td className="px-2 py-1.5 text-center">
                          {rows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(rIdx)}
                              className="p-1 text-muted-foreground/60 hover:text-destructive transition-colors cursor-pointer rounded"
                              title="Delete row"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {showAiGenerator && (
                <div className="p-2.5 rounded-xl border border-primary/30 bg-primary/5 flex items-center gap-2 flex-wrap">
                  <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                  <Input
                    value={aiConstraints}
                    onChange={(e) => setAiConstraints(e.target.value)}
                    placeholder="Optional rules/boundaries (e.g. Age 18–65, SI ₹5L–₹1Cr, valid & invalid pincodes)..."
                    className="h-7 text-xs flex-1 min-w-[220px] bg-background"
                    disabled={isGeneratingAi}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleGenerateAiRows();
                      }
                    }}
                  />
                  <Input
                    type="number"
                    min={1}
                    max={15}
                    value={aiCount}
                    onChange={(e) => setAiCount(Math.min(15, Math.max(1, parseInt(e.target.value, 10) || 5)))}
                    className="h-7 w-16 text-xs font-mono bg-background text-center"
                    disabled={isGeneratingAi}
                    title="Number of rows to generate"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={isGeneratingAi}
                    onClick={() => handleGenerateAiRows(aiConstraints)}
                    className="h-7 px-3 text-xs font-semibold cursor-pointer gap-1"
                  >
                    {isGeneratingAi ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3" />
                        <span>Generate Drafts</span>
                      </>
                    )}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setShowAiGenerator(false)}
                    className="p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                    title="Close"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleAddRow} className="h-7 text-xs font-medium cursor-pointer shadow-xs">
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Iteration Row
                  </Button>
                  <div className="inline-flex items-center rounded-lg border border-primary/30 bg-background overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      disabled={isGeneratingAi}
                      onClick={() => handleGenerateAiRows('')}
                      className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50"
                      title="Generate rows with AI (Auto)"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>{isGeneratingAi ? 'Generating...' : 'Generate Rows'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isGeneratingAi}
                      onClick={() => setShowAiGenerator((prev) => !prev)}
                      className={cn(
                        'inline-flex items-center gap-0.5 h-7 px-2 border-l border-primary/25 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50',
                        showAiGenerator && 'bg-primary/15'
                      )}
                      title="Customize prompt or boundary constraints"
                    >
                      <span>{showAiGenerator ? 'Custom' : 'Auto'}</span>
                      <ChevronDown
                        className={cn(
                          'h-3 w-3 transition-transform duration-150',
                          showAiGenerator && 'rotate-180'
                        )}
                      />
                    </button>
                  </div>
                </div>
                <span className="text-[11px] text-muted-foreground font-mono">
                  Each row creates one test iteration during test execution.
                </span>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col space-y-2 overflow-hidden">
              <label className="text-xs text-muted-foreground">
                Paste or edit CSV format (first row is parameter names, followed by values):
              </label>
              <textarea
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={'username,role,expected_code\nadmin,Admin,200\nguest,Guest,403'}
                className="flex-1 font-mono text-xs p-3 rounded-xl border border-border/60 bg-muted/20 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex justify-end pt-1">
                <Button type="button" size="sm" onClick={handleImportCsv} className="h-7 text-xs">
                  <Upload className="h-3 w-3 mr-1.5" />
                  Parse CSV into Grid
                </Button>
              </div>
            </div>
          )}

          <DialogFooter className="pt-3 border-t border-border/40">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              {dataset ? 'Update Dataset' : 'Create Dataset'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
