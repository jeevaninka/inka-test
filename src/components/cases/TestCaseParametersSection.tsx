'use client';

import React, { useState } from 'react';
import {
  Database,
  Plus,
  Trash2,
  X,
  GripVertical,
  ChevronDown,
  Sparkles,
  Layers,
  ArrowRight,
  ExternalLink,
  Edit3,
  Table as TableIcon,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { generateDatasetRowsAction } from '@/app/actions/ai';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export interface SingleParamBlock {
  id: string;
  type: 'single';
  param: string;
  values: string[];
}

export interface GroupParamBlock {
  id: string;
  type: 'group';
  params: string[];
  rows: Record<string, string>[];
}

export type ParamBlock = SingleParamBlock | GroupParamBlock;

export interface SerializedDataset {
  parameters: string[];
  rows: any[];
  blocks: ParamBlock[];
}

export function parseDatasetToBlocks(localDataset: any, dataset: any): ParamBlock[] {
  if (localDataset?.blocks && Array.isArray(localDataset.blocks) && localDataset.blocks.length > 0) {
    return localDataset.blocks;
  }
  const source = localDataset || dataset;
  if (!source || !Array.isArray(source.parameters) || source.parameters.length === 0) {
    return [];
  }
  if (source.parameters.length === 1) {
    const param = source.parameters[0];
    const values = (source.rows || []).map((r: any) => String(r[param] ?? ''));
    return [
      {
        id: 'block-1',
        type: 'single',
        param,
        values: values.length > 0 ? values : [''],
      },
    ];
  }
  return [
    {
      id: 'block-1',
      type: 'group',
      params: source.parameters,
      rows: (source.rows || []).map((r: any) => ({ ...r })),
    },
  ];
}

export function serializeBlocksToDataset(blocks: ParamBlock[]): SerializedDataset {
  if (!blocks || blocks.length === 0) {
    return { parameters: [], rows: [], blocks: [] };
  }

  const allParamsSet = new Set<string>();
  const blockItems: Array<Array<Record<string, string>>> = [];

  for (const b of blocks) {
    if (b.type === 'single') {
      const clean = (b.param || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      if (!clean) continue;
      allParamsSet.add(clean);
      const vals = (b.values && b.values.length > 0) ? b.values : [''];
      blockItems.push(vals.map((v) => ({ [clean]: String(v ?? '') })));
    } else if (b.type === 'group') {
      const cleanedParams = (b.params || [])
        .map((p) => (p || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, ''))
        .filter(Boolean);
      if (cleanedParams.length === 0) continue;
      cleanedParams.forEach((p) => allParamsSet.add(p));
      const srcRows = (b.rows && b.rows.length > 0) ? b.rows : [{}];
      blockItems.push(
        srcRows.map((r) => {
          const item: Record<string, string> = {};
          cleanedParams.forEach((p) => {
            item[p] = String(r[p] ?? '');
          });
          return item;
        })
      );
    }
  }

  const parameters = Array.from(allParamsSet);
  if (parameters.length === 0 || blockItems.length === 0) {
    return { parameters, rows: [], blocks };
  }

  // Cartesian Product across all independent blocks
  const cartesian = blockItems.reduce<Array<Record<string, string>>>(
    (acc, curr) => {
      if (acc.length === 0) return curr;
      if (curr.length === 0) return acc;
      const res: Array<Record<string, string>> = [];
      for (const a of acc) {
        for (const c of curr) {
          res.push({ ...a, ...c });
        }
      }
      return res;
    },
    []
  );

  const rows = cartesian.map((rowObj, index) => ({
    id: String(index + 1),
    ...rowObj,
  }));

  const cleanBlocks: ParamBlock[] = blocks.map((b) => {
    if (b.type === 'group') {
      return {
        ...b,
        rows: (b.rows || []).map((r) => {
          const copy = { ...r };
          delete copy._aiDraft;
          delete copy._scenario;
          return copy;
        }),
      };
    }
    return b;
  });

  return { parameters, rows, blocks: cleanBlocks };
}

interface TestCaseParametersSectionProps {
  blocks: ParamBlock[];
  onChange: (nextBlocks: ParamBlock[]) => void;
  isEditing: boolean;
  disabled?: boolean;
  onRequestEdit?: () => void;
  projectSlug?: string;
  projectId?: string;
  caseContext?: {
    title?: string;
    description?: string;
    preConditions?: string;
    steps?: string[];
  };
}

export function TestCaseParametersSection({
  blocks,
  onChange,
  isEditing,
  disabled = false,
  onRequestEdit,
  projectSlug,
  projectId,
  caseContext,
}: TestCaseParametersSectionProps) {
  const [isExpanded, setIsExpanded] = useState(() => blocks.length > 0);
  const [showCombinationsModal, setShowCombinationsModal] = useState(false);

  // AI Row Generator state per block
  const [activeAiBlockId, setActiveAiBlockId] = useState<string | null>(null);
  const [aiConstraints, setAiConstraints] = useState('');
  const [aiCount, setAiCount] = useState<number>(5);
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);

  const handleGenerateForBlock = async (block: ParamBlock, constraintsOverride?: string) => {
    if (!projectId) {
      toast.error('Project context missing');
      return;
    }

    const paramsList =
      block.type === 'single'
        ? [block.param.trim()].filter(Boolean)
        : block.params.map((p) => p.trim()).filter(Boolean);

    if (paramsList.length === 0) {
      toast.error('Define parameter name(s) first');
      return;
    }

    const existingRows =
      block.type === 'single'
        ? block.values
            .filter((v) => v.trim() !== '')
            .map((v) => ({ [paramsList[0]]: v }))
        : block.rows.filter((r) =>
            paramsList.some((p) => String(r[p] ?? '').trim() !== '')
          );

    const effectiveConstraints =
      constraintsOverride !== undefined ? constraintsOverride.trim() : aiConstraints.trim();

    setIsGeneratingAi(true);
    try {
      const generated = await generateDatasetRowsAction({
        projectId,
        input: {
          parameters: paramsList,
          existingRows,
          constraints: effectiveConstraints || undefined,
          count: aiCount,
          caseContext,
        },
      });

      if (generated && generated.length > 0) {
        if (block.type === 'single') {
          const pName = paramsList[0];
          const newVals = generated
            .map((g) => String(g.values[pName] ?? '').trim())
            .filter(Boolean);
          const nonBlankOld = block.values.filter((v) => v.trim() !== '');
          const merged = Array.from(new Set([...nonBlankOld, ...newVals]));
          onChange(
            blocks.map((b) =>
              b.id === block.id && b.type === 'single'
                ? { ...b, values: merged.length > 0 ? merged : [''] }
                : b
            )
          );
        } else {
          const newRows = generated.map((g) => ({
            ...g.values,
            _aiDraft: 'true',
            _scenario: g.scenarioType,
          }));
          onChange(
            blocks.map((b) =>
              b.id === block.id && b.type === 'group'
                ? { ...b, rows: [...existingRows, ...newRows] }
                : b
            )
          );
        }
        setActiveAiBlockId(null);
        toast.success(`Inserted ${generated.length} draft values — click Save to confirm`);
      } else {
        toast.info('No values generated');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate values');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  React.useEffect(() => {
    if (blocks.length > 0) {
      setIsExpanded(true);
    }
  }, [blocks.length]);

  const serialized = React.useMemo(() => serializeBlocksToDataset(blocks), [blocks]);
  const totalParamsCount = serialized.parameters.length;
  const totalIterationsCount = serialized.rows.length;

  // Actions
  const handleAddSingleParam = () => {
    const newBlock: SingleParamBlock = {
      id: `param-${Date.now()}`,
      type: 'single',
      param: `param_${blocks.length + 1}`,
      values: [''],
    };
    onChange([...blocks, newBlock]);
    setIsExpanded(true);
  };

  const handleAddGroupParam = () => {
    const newBlock: GroupParamBlock = {
      id: `group-${Date.now()}`,
      type: 'group',
      params: ['param_a', 'param_b'],
      rows: [
        { param_a: '', param_b: '' },
        { param_a: '', param_b: '' },
      ],
    };
    onChange([...blocks, newBlock]);
    setIsExpanded(true);
  };

  const handleRemoveBlock = (blockId: string) => {
    onChange(blocks.filter((b) => b.id !== blockId));
  };

  // Single block handlers
  const handleUpdateSingleParamName = (blockId: string, name: string) => {
    const clean = name.toLowerCase().replace(/[^a-z0-9_]/g, '');
    onChange(
      blocks.map((b) => (b.id === blockId && b.type === 'single' ? { ...b, param: clean } : b))
    );
  };

  const handleAddSingleValue = (blockId: string) => {
    onChange(
      blocks.map((b) =>
        b.id === blockId && b.type === 'single' ? { ...b, values: [...b.values, ''] } : b
      )
    );
  };

  const handleUpdateSingleValue = (blockId: string, idx: number, val: string) => {
    onChange(
      blocks.map((b) => {
        if (b.id === blockId && b.type === 'single') {
          const nextVals = [...b.values];
          nextVals[idx] = val;
          return { ...b, values: nextVals };
        }
        return b;
      })
    );
  };

  const handleRemoveSingleValue = (blockId: string, idx: number) => {
    onChange(
      blocks.map((b) => {
        if (b.id === blockId && b.type === 'single') {
          if (b.values.length <= 1) return { ...b, values: [''] };
          return { ...b, values: b.values.filter((_, i) => i !== idx) };
        }
        return b;
      })
    );
  };

  // Group block handlers
  const handleAddGroupColumn = (blockId: string) => {
    onChange(
      blocks.map((b) => {
        if (b.id === blockId && b.type === 'group') {
          const newCol = `col_${b.params.length + 1}`;
          const nextParams = [...b.params, newCol];
          const nextRows = b.rows.map((r) => ({ ...r, [newCol]: '' }));
          return { ...b, params: nextParams, rows: nextRows };
        }
        return b;
      })
    );
  };

  const handleUpdateGroupParamName = (blockId: string, colIdx: number, newName: string) => {
    const clean = newName.toLowerCase().replace(/[^a-z0-9_]/g, '');
    onChange(
      blocks.map((b) => {
        if (b.id === blockId && b.type === 'group') {
          const oldName = b.params[colIdx];
          const nextParams = [...b.params];
          nextParams[colIdx] = clean;
          const nextRows = b.rows.map((r) => {
            const copy = { ...r };
            if (oldName !== clean) {
              copy[clean] = copy[oldName] || '';
              delete copy[oldName];
            }
            return copy;
          });
          return { ...b, params: nextParams, rows: nextRows };
        }
        return b;
      })
    );
  };

  const handleRemoveGroupColumn = (blockId: string, colIdx: number) => {
    onChange(
      blocks.map((b) => {
        if (b.id === blockId && b.type === 'group') {
          if (b.params.length <= 1) return b;
          const toRemove = b.params[colIdx];
          const nextParams = b.params.filter((_, i) => i !== colIdx);
          const nextRows = b.rows.map((r) => {
            const copy = { ...r };
            delete copy[toRemove];
            return copy;
          });
          return { ...b, params: nextParams, rows: nextRows };
        }
        return b;
      })
    );
  };

  const handleAddGroupRow = (blockId: string) => {
    onChange(
      blocks.map((b) => {
        if (b.id === blockId && b.type === 'group') {
          const newRow: Record<string, string> = {};
          b.params.forEach((p) => {
            newRow[p] = '';
          });
          return { ...b, rows: [...b.rows, newRow] };
        }
        return b;
      })
    );
  };

  const handleUpdateGroupCell = (blockId: string, rowIdx: number, colName: string, val: string) => {
    onChange(
      blocks.map((b) => {
        if (b.id === blockId && b.type === 'group') {
          const nextRows = [...b.rows];
          nextRows[rowIdx] = { ...nextRows[rowIdx], [colName]: val };
          return { ...b, rows: nextRows };
        }
        return b;
      })
    );
  };

  const handleRemoveGroupRow = (blockId: string, rowIdx: number) => {
    onChange(
      blocks.map((b) => {
        if (b.id === blockId && b.type === 'group') {
          if (b.rows.length <= 1) {
            const blankRow: Record<string, string> = {};
            b.params.forEach((p) => {
              blankRow[p] = '';
            });
            return { ...b, rows: [blankRow] };
          }
          return { ...b, rows: b.rows.filter((_, i) => i !== rowIdx) };
        }
        return b;
      })
    );
  };

  return (
    <div className="border border-border/40 rounded-xl overflow-hidden bg-card/50 shadow-xs">
      {/* Collapsible Header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between px-3.5 py-2 bg-muted/20 border-b border-border/20 cursor-pointer hover:bg-muted/30 transition-colors select-none"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-foreground/90">
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 transition-transform text-muted-foreground',
              !isExpanded && '-rotate-90'
            )}
          />
          <span>Parameters (Test Data)</span>
          <Database className="h-3.5 w-3.5 text-muted-foreground" />
          {totalParamsCount > 0 && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-semibold border border-border/50">
              {totalParamsCount} {totalParamsCount === 1 ? 'param' : 'params'} · {totalIterationsCount} {totalIterationsCount === 1 ? 'iteration' : 'iterations'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <span className="text-[11px] font-normal text-muted-foreground mr-1 hidden sm:inline-block">
            Data-driven test scenarios
          </span>
          {isEditing && !disabled ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleAddSingleParam}
              className="h-6 px-2 text-[11px] text-primary hover:bg-primary/10 cursor-pointer"
            >
              <Plus className="h-3 w-3 mr-1" />
              <span>Add Parameter</span>
            </Button>
          ) : !disabled && onRequestEdit ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                onRequestEdit();
                if (blocks.length === 0) handleAddSingleParam();
                else setIsExpanded(true);
              }}
              className="h-6 px-2 text-[11px] text-primary hover:bg-primary/10 cursor-pointer"
            >
              <Plus className="h-3 w-3 mr-1" />
              <span>Add Parameter</span>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="p-3.5 space-y-3.5">
          {blocks.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-border/60 bg-muted/10 text-center space-y-2">
              <Database className="h-6 w-6 text-muted-foreground/50 mx-auto" />
              <p className="text-xs text-foreground font-medium">No parameters defined</p>
              <p className="text-[11px] text-muted-foreground max-w-sm mx-auto">
                Parameters let you run this test case across multiple iterations with values like{' '}
                <code className="text-foreground/90 bg-muted/60 px-1 py-0.5 rounded border border-border/40 font-mono">&#123;mobile&#125;</code> or{' '}
                <code className="text-foreground/90 bg-muted/60 px-1 py-0.5 rounded border border-border/40 font-mono">&#123;username&#125;</code>.
              </p>
              {isEditing && !disabled ? (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAddSingleParam}
                    className="h-7 text-xs bg-primary text-primary-foreground font-medium shadow-xs cursor-pointer"
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add Parameter
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleAddGroupParam}
                    className="h-7 text-xs font-medium cursor-pointer"
                  >
                    <Layers className="h-3 w-3 mr-1" /> Add Parameter Group
                  </Button>
                </div>
              ) : !disabled && onRequestEdit ? (
                <div className="flex items-center justify-center gap-2 pt-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onRequestEdit();
                      handleAddSingleParam();
                    }}
                    className="h-7 text-xs bg-primary text-primary-foreground font-medium shadow-xs cursor-pointer"
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add Parameter
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      onRequestEdit();
                      handleAddGroupParam();
                    }}
                    className="h-7 text-xs font-medium cursor-pointer"
                  >
                    <Layers className="h-3 w-3 mr-1" /> Add Parameter Group
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {blocks.map((block) => {
                if (block.type === 'single') {
                  // Type A: Single Parameter with multiple values (Screenshot 1 Top Block)
                  return (
                    <div
                      key={block.id}
                      className="p-3 rounded-xl border border-border/60 bg-card/60 space-y-2 shadow-2xs"
                    >
                      <div className="flex items-start gap-3">
                        {/* Parameter Name Column */}
                        <div className="w-48 shrink-0">
                          <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
                            Parameter
                          </label>
                          {isEditing && !disabled ? (
                            <div className="relative flex items-center">
                              <Input
                                value={block.param}
                                onChange={(e) => handleUpdateSingleParamName(block.id, e.target.value)}
                                placeholder="param_name"
                                className="h-8 pl-3 pr-20 text-xs font-mono font-bold bg-background border-border/80 shadow-2xs text-foreground focus-visible:ring-1 focus-visible:ring-primary"
                              />
                              {block.param && (
                                <span className="absolute right-2 px-1.5 py-0.5 rounded bg-muted/80 text-foreground/80 font-mono text-[10px] font-semibold border border-border/50 pointer-events-none select-none">
                                  {block.param}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-muted/80 border border-border/60 text-foreground/90 font-mono text-xs font-semibold">
                              {block.param}
                            </span>
                          )}
                        </div>

                        {/* Parameter Values Column */}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
                            Values ({block.values.length} iterations)
                          </label>
                          <div className="space-y-1.5">
                            {block.values.map((val, vIdx) => (
                              <div key={vIdx} className="flex items-center gap-2">
                                <span className="text-[11px] font-mono text-muted-foreground/60 w-5 text-right select-none">
                                  #{vIdx + 1}
                                </span>
                                {isEditing && !disabled ? (
                                  <div className="flex-1 relative flex items-center">
                                    <Input
                                      value={val}
                                      onChange={(e) =>
                                        handleUpdateSingleValue(block.id, vIdx, e.target.value)
                                      }
                                      placeholder={`Value ${vIdx + 1}`}
                                      className="h-8 text-xs font-mono bg-background pr-7"
                                    />
                                    {block.values.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveSingleValue(block.id, vIdx)}
                                        className="absolute right-2 text-muted-foreground/60 hover:text-destructive cursor-pointer p-0.5"
                                        title="Remove value"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex-1 px-3 py-1 rounded-md bg-muted/40 border border-border/40 text-xs font-mono text-foreground">
                                    {val || <span className="text-muted-foreground/40 italic">empty</span>}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          {isEditing && !disabled && (
                            <div className="space-y-2 pt-1">
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleAddSingleValue(block.id)}
                                  className="h-6 px-2 text-[11px] text-primary hover:bg-primary/10 cursor-pointer"
                                >
                                  <Plus className="h-3 w-3 mr-1" />
                                  <span>Add value</span>
                                </Button>
                                {projectId && (
                                  <div className="inline-flex items-center rounded-md border border-primary/25 bg-primary/5 overflow-hidden">
                                    <button
                                      type="button"
                                      disabled={isGeneratingAi}
                                      onClick={() => handleGenerateForBlock(block, '')}
                                      className="inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50"
                                      title="Generate parameter values with AI (Auto)"
                                    >
                                      <Sparkles className="h-3 w-3" />
                                      <span>{isGeneratingAi ? 'Generating...' : 'Generate Values'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={isGeneratingAi}
                                      onClick={() =>
                                        setActiveAiBlockId(activeAiBlockId === block.id ? null : block.id)
                                      }
                                      className={cn(
                                        'inline-flex items-center gap-0.5 h-6 px-1.5 border-l border-primary/20 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50',
                                        activeAiBlockId === block.id && 'bg-primary/15'
                                      )}
                                      title="Customize prompt or boundary constraints"
                                    >
                                      <span>{activeAiBlockId === block.id ? 'Custom' : 'Auto'}</span>
                                      <ChevronDown
                                        className={cn(
                                          'h-2.5 w-2.5 transition-transform duration-150',
                                          activeAiBlockId === block.id && 'rotate-180'
                                        )}
                                      />
                                    </button>
                                  </div>
                                )}
                              </div>

                              {activeAiBlockId === block.id && (
                                <div className="p-2 rounded-lg border border-primary/30 bg-primary/5 flex items-center gap-2 flex-wrap">
                                  <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                                  <Input
                                    value={aiConstraints}
                                    onChange={(e) => setAiConstraints(e.target.value)}
                                    placeholder={`Optional rules for ${block.param || 'parameter'} (e.g. min 18, max 65)...`}
                                    className="h-7 text-xs flex-1 min-w-[180px] bg-background"
                                    disabled={isGeneratingAi}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleGenerateForBlock(block);
                                      }
                                    }}
                                  />
                                  <Input
                                    type="number"
                                    min={1}
                                    max={15}
                                    value={aiCount}
                                    onChange={(e) =>
                                      setAiCount(Math.min(15, Math.max(1, parseInt(e.target.value, 10) || 5)))
                                    }
                                    className="h-7 w-14 text-xs font-mono bg-background text-center"
                                    disabled={isGeneratingAi}
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    disabled={isGeneratingAi}
                                    onClick={() => handleGenerateForBlock(block)}
                                    className="h-7 px-2.5 text-xs font-semibold cursor-pointer gap-1"
                                  >
                                    {isGeneratingAi ? (
                                      <>
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        <span>Generating...</span>
                                      </>
                                    ) : (
                                      <span>Generate</span>
                                    )}
                                  </Button>
                                  <button
                                    type="button"
                                    onClick={() => setActiveAiBlockId(null)}
                                    className="p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Delete Parameter Button */}
                        {isEditing && !disabled && (
                          <Tooltip content="Remove parameter" side="left">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRemoveBlock(block.id)}
                              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer shrink-0 mt-5"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                  );
                }

                // Type B: Parameter Group (Multi-column table - Screenshot 1 Bottom Block)
                return (
                  <div
                    key={block.id}
                    className="p-3 rounded-xl border border-border/60 bg-card/60 space-y-2.5 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs font-bold text-foreground">
                          Parameter Group ({block.params.length} columns · {block.rows.length} rows)
                        </span>
                      </div>
                      {isEditing && !disabled && (
                        <Tooltip content="Remove parameter group" side="left">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleRemoveBlock(block.id)}
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                      )}
                    </div>

                    {/* Table View of Linked Columns & Rows */}
                    <div className="overflow-x-auto no-scrollbar border border-border/50 rounded-lg">
                      <table className="w-full text-xs text-left">
                        <thead className="bg-muted/40 border-b border-border/50 font-mono text-[11px] text-muted-foreground">
                          <tr>
                            <th className="w-8 px-2 py-2 text-center text-muted-foreground/60 select-none">#</th>
                            {block.params.map((col, cIdx) => (
                              <th key={cIdx} className="px-2 py-2 min-w-[160px]">
                                {isEditing && !disabled ? (
                                  <div className="relative flex items-center h-8 rounded-lg border border-border/80 bg-background px-2.5 shadow-2xs focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all">
                                    <input
                                      value={col}
                                      onChange={(e) =>
                                        handleUpdateGroupParamName(block.id, cIdx, e.target.value)
                                      }
                                      placeholder="param_name"
                                      className="w-full bg-transparent text-xs font-mono font-bold text-foreground focus:outline-none placeholder:text-muted-foreground/40 pr-1"
                                    />
                                    {col && (
                                      <span className="px-1.5 py-0.5 rounded bg-muted/80 text-foreground/80 font-mono text-[10px] font-semibold border border-border/50 shrink-0 select-none mr-1 pointer-events-none">
                                        {col}
                                      </span>
                                    )}
                                    {block.params.length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveGroupColumn(block.id, cIdx)}
                                        className="text-muted-foreground/50 hover:text-destructive cursor-pointer p-0.5 rounded transition-colors shrink-0"
                                        title="Delete column"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/80 border border-border/60 text-foreground/90 font-mono text-xs font-semibold">
                                    {col}
                                  </span>
                                )}
                              </th>
                            ))}
                            {isEditing && !disabled && (
                              <th className="px-2 py-2 text-left min-w-[120px]">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleAddGroupColumn(block.id)}
                                  className="h-8 px-2.5 text-xs font-medium border-dashed border-border/70 hover:border-primary/50 text-muted-foreground hover:text-primary cursor-pointer flex items-center gap-1 shadow-2xs"
                                  title="Add parameter column"
                                >
                                  <Plus className="h-3 w-3" />
                                  <span>Column</span>
                                </Button>
                              </th>
                            )}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/20 font-mono">
                          {block.rows.map((row, rIdx) => (
                            <tr
                              key={rIdx}
                              className={cn(
                                'hover:bg-muted/10 transition-colors',
                                row._aiDraft === 'true' && 'bg-primary/[0.04]'
                              )}
                            >
                              <td className="px-2 py-1.5 text-center text-muted-foreground/60 text-[10px]">
                                <div>{rIdx + 1}</div>
                                {row._aiDraft === 'true' && (
                                  <span className="inline-block mt-0.5 text-[8px] px-1 py-0.2 rounded bg-primary/15 text-primary border border-primary/30 font-sans font-bold uppercase">
                                    {row._scenario === 'Boundary'
                                      ? 'Bnd'
                                      : row._scenario === 'Negative'
                                      ? 'Neg'
                                      : 'AI'}
                                  </span>
                                )}
                              </td>
                              {block.params.map((col, cIdx) => (
                                <td key={cIdx} className="px-2 py-1.5">
                                  {isEditing && !disabled ? (
                                    <Input
                                      value={row[col] ?? ''}
                                      onChange={(e) =>
                                        handleUpdateGroupCell(block.id, rIdx, col, e.target.value)
                                      }
                                      placeholder={`Value`}
                                      className="h-8 text-xs font-mono bg-background border-border/70 focus-visible:ring-1 focus-visible:ring-primary shadow-2xs"
                                    />
                                  ) : (
                                    <span className="text-foreground">
                                      {row[col] || (
                                        <span className="text-muted-foreground/40 italic">empty</span>
                                      )}
                                    </span>
                                  )}
                                </td>
                              ))}
                              {isEditing && !disabled && (
                                <td className="px-2 py-1.5 text-right">
                                  {block.rows.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => handleRemoveGroupRow(block.id, rIdx)}
                                      className="text-muted-foreground/60 hover:text-destructive cursor-pointer p-1"
                                      title="Remove row"
                                    >
                                      <X className="h-3 w-3" />
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {isEditing && !disabled && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleAddGroupRow(block.id)}
                            className="h-6 px-2 text-[11px] text-primary hover:bg-primary/10 cursor-pointer"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            <span>Add row</span>
                          </Button>
                          {projectId && (
                            <div className="inline-flex items-center rounded-md border border-primary/25 bg-primary/5 overflow-hidden">
                              <button
                                type="button"
                                disabled={isGeneratingAi}
                                onClick={() => handleGenerateForBlock(block, '')}
                                className="inline-flex items-center gap-1 h-6 px-2 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50"
                                title="Generate parameter rows with AI (Auto)"
                              >
                                <Sparkles className="h-3 w-3" />
                                <span>{isGeneratingAi ? 'Generating...' : 'Generate Rows'}</span>
                              </button>
                              <button
                                type="button"
                                disabled={isGeneratingAi}
                                onClick={() =>
                                  setActiveAiBlockId(activeAiBlockId === block.id ? null : block.id)
                                }
                                className={cn(
                                  'inline-flex items-center gap-0.5 h-6 px-1.5 border-l border-primary/20 text-[10px] font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50',
                                  activeAiBlockId === block.id && 'bg-primary/15'
                                )}
                                title="Customize prompt or boundary constraints"
                              >
                                <span>{activeAiBlockId === block.id ? 'Custom' : 'Auto'}</span>
                                <ChevronDown
                                  className={cn(
                                    'h-2.5 w-2.5 transition-transform duration-150',
                                    activeAiBlockId === block.id && 'rotate-180'
                                  )}
                                />
                              </button>
                            </div>
                          )}
                        </div>

                        {activeAiBlockId === block.id && (
                          <div className="p-2 rounded-lg border border-primary/30 bg-primary/5 flex items-center gap-2 flex-wrap">
                            <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
                            <Input
                              value={aiConstraints}
                              onChange={(e) => setAiConstraints(e.target.value)}
                              placeholder="Optional rules/boundaries (e.g. Age 18–65, SI ₹5L–₹1Cr, Maharashtra pincodes)..."
                              className="h-7 text-xs flex-1 min-w-[200px] bg-background"
                              disabled={isGeneratingAi}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleGenerateForBlock(block);
                                }
                              }}
                            />
                            <Input
                              type="number"
                              min={1}
                              max={15}
                              value={aiCount}
                              onChange={(e) =>
                                setAiCount(Math.min(15, Math.max(1, parseInt(e.target.value, 10) || 5)))
                              }
                              className="h-7 w-14 text-xs font-mono bg-background text-center"
                              disabled={isGeneratingAi}
                            />
                            <Button
                              type="button"
                              size="sm"
                              disabled={isGeneratingAi}
                              onClick={() => handleGenerateForBlock(block)}
                              className="h-7 px-2.5 text-xs font-semibold cursor-pointer gap-1"
                            >
                              {isGeneratingAi ? (
                                <>
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  <span>Generating...</span>
                                </>
                              ) : (
                                <span>Generate Drafts</span>
                              )}
                            </Button>
                            <button
                              type="button"
                              onClick={() => setActiveAiBlockId(null)}
                              className="p-1 text-muted-foreground hover:text-foreground cursor-pointer"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Bottom Buttons in Edit Mode */}
              {isEditing && !disabled ? (
                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleAddSingleParam}
                    className="h-7 text-xs font-medium cursor-pointer"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    <span>Add Parameter</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={handleAddGroupParam}
                    className="h-7 text-xs font-medium cursor-pointer"
                  >
                    <Layers className="h-3 w-3 mr-1" />
                    <span>Add Parameter Group</span>
                  </Button>
                  {serialized.rows.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowCombinationsModal(true)}
                      className="h-7 text-xs font-medium cursor-pointer text-muted-foreground hover:text-foreground ml-auto"
                    >
                      <TableIcon className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                      <span>View Combinations ({serialized.rows.length})</span>
                    </Button>
                  )}
                </div>
              ) : !disabled && onRequestEdit ? (
                <div className="pt-1 flex items-center gap-2 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onRequestEdit}
                    className="h-7 text-xs font-medium cursor-pointer text-primary border-primary/30 hover:bg-primary/10"
                  >
                    <Edit3 className="h-3 w-3 mr-1" />
                    <span>Edit Parameters & Values</span>
                  </Button>
                  {serialized.rows.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowCombinationsModal(true)}
                      className="h-7 px-2.5 text-xs font-medium cursor-pointer text-muted-foreground hover:text-foreground border-border/60 hover:bg-muted/40 shadow-2xs"
                    >
                      <TableIcon className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                      <span>View Combinations ({serialized.rows.length})</span>
                    </Button>
                  )}
                </div>
              ) : serialized.rows.length > 0 ? (
                <div className="pt-1 flex items-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setShowCombinationsModal(true)}
                    className="h-7 px-2.5 text-xs font-medium cursor-pointer text-muted-foreground hover:text-foreground border-border/60 hover:bg-muted/40 shadow-2xs"
                  >
                    <TableIcon className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                    <span>View Combinations ({serialized.rows.length})</span>
                  </Button>
                </div>
              ) : null}
            </div>
          )}

          {/* Global Environment Variables Reference Note */}
          <div className="pt-2.5 border-t border-border/30 flex items-center justify-between text-[11px] text-muted-foreground flex-wrap gap-2">
            <span>
              🌐 Global Environment Variables (<code className="text-sky-500 font-mono text-[10.5px] bg-sky-500/10 px-1 py-0.5 rounded">&#123;&#123;BASE_URL&#125;&#125;</code>, etc.) are configured in Project Settings.
            </span>
            {projectSlug && (
              <a
                href={`/p/${projectSlug}/configuration/variables`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline font-medium cursor-pointer"
              >
                <span>Manage Variables</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}

      {/* Combinations Modal Dialog */}
      <Dialog open={showCombinationsModal} onOpenChange={setShowCombinationsModal}>
        <DialogContent className="max-w-2xl bg-card border-border/80 shadow-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-bold font-mono">
              <TableIcon className="h-4 w-4 text-muted-foreground" />
              <span>Generated Iterations ({serialized.rows.length} combinations)</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground font-mono">
              Formula: {blocks.map((b) => (b.type === 'single' ? `${b.values.length} (${b.param})` : `${b.rows.length} (${b.params.join(', ')})`)).join(' × ')} = {serialized.rows.length} total iterations
            </DialogDescription>
          </DialogHeader>

          <div className="border border-border/60 rounded-xl overflow-hidden bg-background max-h-96 overflow-y-auto mt-2">
            <table className="w-full text-xs font-mono">
              <thead className="bg-muted/40 text-muted-foreground border-b border-border/40 text-[10.5px] uppercase font-semibold">
                <tr>
                  <th className="px-3 py-2 text-left w-12">#</th>
                  {serialized.parameters.map((p) => (
                    <th key={p} className="px-3 py-2 text-left text-foreground/90 font-mono">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {serialized.rows.map((row, rIdx) => (
                  <tr key={row.id || rIdx} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-1.5 text-muted-foreground font-bold">{rIdx + 1}</td>
                    {serialized.parameters.map((p) => (
                      <td key={p} className="px-3 py-1.5 text-foreground/90 font-mono">
                        {row[p] || <span className="text-muted-foreground/30 italic">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowCombinationsModal(false)}
              className="text-xs cursor-pointer"
            >
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
