'use client';

import { useState, useEffect, useCallback, useMemo, useRef, forwardRef, useImperativeHandle, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus,
  ArrowUp,
  ArrowDown,
  Trash2,
  AlertTriangle,
  MoreVertical,
  Pencil,
  Check,
  Copy,
  List,
  GripVertical,
  Paperclip,
  Square,
  CheckSquare,
  X,
  Sparkles,
  RefreshCcw,
  RefreshCw,
  Maximize2,
  Image as ImageIcon,
  ExternalLink,
  AlertCircle,
  Layers,
  Unlink,
  Eye,
  Link as LinkIcon,
  Link2,
  ChevronDown,
  ChevronRight,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { cn, formatVariableName } from '@/lib/utils';
import { ReusableStepBadge } from './ReusableStepBadge';
import { DatadogStepBadges } from '@/components/cases/DatadogStepsTable';
import { parseDatadogStepMeta } from '@/lib/integrations/datadog-steps';
import { StepLibraryModal } from './StepLibraryModal';
import { VariableAutocomplete } from '@/components/variables/VariableAutocomplete';
import { LinkifiedText } from '@/components/common/LinkifiedText';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  getReusableStepsAction,
  getTestCaseStepsAction,
  createTestCaseStepAction,
  updateTestCaseStepAction,
  deleteTestCaseStepAction,
  reorderTestCaseStepsAction,
  saveTestCaseStepsBulkAction,
  updateStepFromSourceAction,
  convertStepToCustomAction,
  uploadStepImageAction,
  removeStepImageAction,
  updateReusableStepAction,
  cloneReusableStepAction,
  detachReusableGroupAction,
  syncReusableGroupAction,
  getStepAutocompleteIndexAction,
} from '@/app/actions/steps';
import {
  getGlobalVariablesAction,
  getTestCaseLocalVariablesAction,
  createVariableAction,
} from '@/app/actions/variables';
import { addParameterToTestCaseAction } from '@/app/actions/datasets';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import {
  type StepAutocompleteIndex,
  getCachedProjectAutocompleteIndex,
  setCachedProjectAutocompleteRows,
  recordStepsIntoProjectCache,
  extractAutocompleteRowsFromCases,
  mergeAutocompleteRows,
  matchActionPrefix,
  matchExpectedResultPrefix,
} from '@/lib/step-autocomplete';

interface StepItem {
  id: string;
  order: number;
  step: string;
  expected_result: string | null;
  data: string | null;
  /** Compact provider metadata (Datadog stepId/badges/subtest group). */
  meta?: string | null;
  image_url: string | null;
  reusable_step_id: string | null;
  reusable_step_item_id: string | null;
  is_outdated: boolean;
  ai_generated?: boolean;
  reusable_step?: {
    id: string;
    title: string;
    step: string;
    expected_result: string | null;
    data: string | null;
    steps: any[];
    _count?: { test_case_steps: number };
  } | null;
  _isNew?: boolean; // Ephemeral flag for new steps
  _isEphemeralBlank?: boolean; // Unpersisted default blank step in edit mode
}

function isStepCompletelyEmpty(s: StepItem): boolean {
  return (
    (!s.step || !s.step.trim()) &&
    (!s.expected_result || !s.expected_result.trim()) &&
    (!s.data || !s.data.trim()) &&
    !s.image_url &&
    !s.reusable_step_id
  );
}

function createEphemeralBlankStep(testCaseId: string, order = 1): StepItem {
  return {
    id: `draft-blank-${testCaseId}`,
    order,
    step: '',
    expected_result: null,
    data: null,
    image_url: null,
    reusable_step_id: null,
    reusable_step_item_id: null,
    is_outdated: false,
    _isNew: true,
    _isEphemeralBlank: true,
  };
}

function GroupDropdownMenu({
  onViewSource,
  onDetach,
  onRemove,
  onEditMaster,
}: {
  onViewSource: () => void;
  onDetach: () => void;
  onRemove: () => void;
  onEditMaster?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number }>({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuElRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const el = btnRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const right = Math.max(8, window.innerWidth - rect.right);
    if (spaceBelow < 200) {
      setMenuPos({ bottom: window.innerHeight - rect.top + 6, right });
    } else {
      setMenuPos({ top: rect.bottom + 6, right });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        btnRef.current &&
        !btnRef.current.contains(target) &&
        menuElRef.current &&
        !menuElRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    const handleScrollOrResize = () => updatePosition();
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [open, updatePosition]);

  return (
    <div 
      className="relative"
      onMouseEnter={() => {
        if (!open) updatePosition();
        setOpen(true);
      }}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!open) updatePosition();
          setOpen(!open);
        }}
        className="p-1 rounded-md text-foreground/80 hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
        title="More actions"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
            <div
              ref={menuElRef}
              style={{
                position: 'fixed',
                top: menuPos.top !== undefined ? `${menuPos.top}px` : undefined,
                bottom: menuPos.bottom !== undefined ? `${menuPos.bottom}px` : undefined,
                right: `${menuPos.right}px`,
              }}
              onClick={(e) => e.stopPropagation()}
              className="z-[9999] w-48 bg-popover text-popover-foreground border border-border rounded-xl shadow-xl py-1 divide-y divide-border/40 text-xs animate-in fade-in-0 zoom-in-95 duration-100"
            >
              <div className="py-0.5">
                {onEditMaster && (
                  <button
                    type="button"
                    onClick={() => {
                      onEditMaster();
                      setOpen(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-primary font-semibold transition-colors cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>Edit Shared Step</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onDetach();
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-foreground font-medium transition-colors cursor-pointer"
                >
                  <Unlink className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Unlink Steps</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onViewSource();
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2 text-foreground font-medium transition-colors cursor-pointer"
                >
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>View Original</span>
                </button>
              </div>
              <div className="py-0.5">
                <button
                  type="button"
                  onClick={() => {
                    onRemove();
                    setOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-destructive/10 text-destructive flex items-center gap-2 font-semibold transition-colors cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Steps</span>
                </button>
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}

function SortableSharedGroup({
  blockId,
  disabled,
  className,
  children,
}: {
  blockId: string;
  disabled?: boolean;
  className?: string;
  children: (dragHandleProps: { attributes: any; listeners: any }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: blockId,
    disabled: Boolean(disabled),
  });

  const style = {
    transform: transform ? CSS.Transform.toString(transform) : undefined,
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        className,
        isDragging && 'ring-1 ring-primary/30 shadow-md z-50 relative bg-card'
      )}
    >
      {children({ attributes, listeners })}
    </div>
  );
}

const SortableStep = memo(function SortableStep({
  step,
  index,
  total,
  onUpdate,
  onSaveStep,
  onDelete,
  onDuplicate,
  onMove,
  onUpdateFromSource,
  onConvertToCustom,
  onAddAbove,
  onAddBelow,
  onViewSource,
  disabled,
  variables,
  parameters = [],
  onCreateVariable,
  onCreateParameter,
  selectionMode,
  isSelected,
  onToggleSelect,
  onConvertToReusable,
  isInsideGroup = false,
  autocompleteIndex,
  onCommitStepToIndex,
  onRequestEdit,
}: {
  step: StepItem;
  index: number;
  total: number;
  onUpdate: (id: string, field: string, value: any) => void;
  onSaveStep?: (id: string, backup?: StepItem | null) => void;
  onDelete: (id: string) => void;
  onDuplicate: (step: StepItem) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onUpdateFromSource: (id: string) => void;
  onConvertToCustom: (id: string) => void;
  onAddAbove: (id: string) => void;
  onAddBelow: (id: string) => void;
  onViewSource?: (step: StepItem) => void;
  disabled: boolean;
  variables: any[];
  parameters?: any[];
  onCreateVariable?: (key: string) => Promise<void> | void;
  onCreateParameter?: (param: string) => Promise<void> | void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onConvertToReusable?: (id: string) => void;
  isInsideGroup?: boolean;
  autocompleteIndex?: StepAutocompleteIndex | null;
  onCommitStepToIndex?: (step: StepItem) => void;
  onRequestEdit?: (stepId?: string, stepOrder?: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
    disabled: Boolean(disabled || isInsideGroup),
  });

  const style = isInsideGroup
    ? undefined
    : {
        transform: transform ? CSS.Transform.toString(transform) : undefined,
        transition,
      };

  const isNearBottom = index >= total - 3 && total > 3;
  const [showData, setShowData] = useState(!!step.data);
  const [editingField, setEditingField] = useState<'step' | 'expected_result' | 'data' | null>(
    step._isNew ? 'step' : null
  );
  const [showMenu, setShowMenu] = useState(false);
  const [stepMenuPos, setStepMenuPos] = useState<{ top?: number; bottom?: number; right: number }>({ top: 0, right: 0 });
  const [backupStep, setBackupStep] = useState<StepItem | null>(null);
  const [imageError, setImageError] = useState(false);
  const [isViewingFullImage, setIsViewingFullImage] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const menuPopupRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const updateStepMenuPos = useCallback(() => {
    const el = menuBtnRef.current;
    if (!el || typeof window === 'undefined') return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const right = Math.max(8, window.innerWidth - rect.right);
    if (spaceBelow < 240) {
      setStepMenuPos({ bottom: window.innerHeight - rect.top + 6, right });
    } else {
      setStepMenuPos({ top: rect.bottom + 6, right });
    }
  }, []);

  const actionMatch = useMemo(() => {
    if (disabled || editingField !== 'step') return null;
    return matchActionPrefix(autocompleteIndex, step.step);
  }, [disabled, editingField, autocompleteIndex, step.step]);

  const liveExpectedSuggestion = useMemo(() => {
    if (disabled || editingField !== 'step') return null;
    if (step.expected_result && step.expected_result.trim().length > 0) return null;
    return actionMatch?.entry.expectedResult || null;
  }, [disabled, editingField, step.expected_result, actionMatch]);

  const expectedMatch = useMemo(() => {
    if (disabled || editingField !== 'expected_result') return null;
    return matchExpectedResultPrefix(autocompleteIndex, step.expected_result || '', step.step);
  }, [disabled, editingField, autocompleteIndex, step.expected_result, step.step]);

  const handleAcceptActionSuggestion = useCallback(() => {
    if (!actionMatch) return;
    const wasExact = actionMatch.isExact;
    if (actionMatch.ghostSuffix) {
      onUpdate(step.id, 'step', actionMatch.completedAction);
    }
    if ((!step.expected_result || !step.expected_result.trim()) && actionMatch.entry.expectedResult) {
      onUpdate(step.id, 'expected_result', actionMatch.entry.expectedResult);
    }
    if (wasExact) {
      setEditingField('expected_result');
    }
  }, [actionMatch, onUpdate, step.id, step.expected_result]);

  const handleAcceptExpectedSuggestion = useCallback(() => {
    if (!expectedMatch) return;
    onUpdate(step.id, 'expected_result', expectedMatch.completedText);
  }, [expectedMatch, onUpdate, step.id]);

  useEffect(() => {
    if (step.data) setShowData(true);
    else setShowData(false);
  }, [step.data]);

  useEffect(() => {
    setImageError(false);
  }, [step.image_url]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        (!menuPopupRef.current || !menuPopupRef.current.contains(target))
      ) {
        setShowMenu(false);
      }
      if (
        rowRef.current &&
        !rowRef.current.contains(target) &&
        (!menuPopupRef.current || !menuPopupRef.current.contains(target))
      ) {
        if (editingField) {
          onCommitStepToIndex?.(step);
          setEditingField(null);
          setBackupStep(null);
        }
      }
    }
    const handleScrollOrResize = () => {
      if (showMenu) updateStepMenuPos();
    };
    document.addEventListener('mousedown', handleClickOutside);
    if (showMenu) {
      window.addEventListener('scroll', handleScrollOrResize, true);
      window.addEventListener('resize', handleScrollOrResize);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [editingField, onCommitStepToIndex, step, showMenu, updateStepMenuPos]);

  const startEditingField = (field: 'step' | 'expected_result' | 'data') => {
    if (disabled) return;
    if (!backupStep) {
      setBackupStep({ ...step });
    }
    setEditingField(field);
  };

  const handleFieldBlur = (e: React.FocusEvent) => {
    if (rowRef.current && !rowRef.current.contains(e.relatedTarget as Node)) {
      if (editingField) {
        onCommitStepToIndex?.(step);
        setEditingField(null);
        setBackupStep(null);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (backupStep) {
        onUpdate(step.id, 'step', backupStep.step);
        onUpdate(step.id, 'expected_result', backupStep.expected_result);
        onUpdate(step.id, 'data', backupStep.data);
      }
      setEditingField(null);
      setBackupStep(null);
    } else if (e.key === 'Tab') {
      if (editingField === 'step' && !e.shiftKey) {
        e.preventDefault();
        startEditingField('expected_result');
      } else if (editingField === 'expected_result' && e.shiftKey) {
        e.preventDefault();
        startEditingField('step');
      } else if (editingField === 'data' && e.shiftKey) {
        e.preventDefault();
        startEditingField('expected_result');
      }
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || disabled) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault();
        e.stopPropagation();

        try {
          const formData = new FormData();
          formData.append('stepId', step.id);
          formData.append('file', file);
          const res = await uploadStepImageAction(formData);
          if (res?.key) {
            onUpdate(step.id, 'image_url', res.key);
            setImageError(false);
            toast.success('Screenshot pasted & attached to step');
          }
        } catch (err: any) {
          toast.error(err.message || 'Failed to attach pasted image');
        }
        break;
      }
    }
  };

  const isLinked = !!step.reusable_step_id;

  return (
    <div
      id={`step-row-${step.order}`}
      data-step-order={step.order}
      ref={(node) => {
        if (!isInsideGroup) setNodeRef(node);
        (rowRef as any).current = node;
      }}
      style={style}
      onBlur={handleFieldBlur}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onClick={
        selectionMode
          ? (e) => {
              e.stopPropagation();
              onToggleSelect?.(step.id);
            }
          : undefined
      }
      className={cn(
        "border-b border-zinc-200/80 dark:border-border/30 last:border-b-0 bg-card transition-colors duration-150 ease-out relative group",
        showMenu && 'z-40 shadow-xs',
        isDragging && 'bg-primary/5 shadow-sm ring-1 ring-primary/20 z-50',
        !isDragging && !showMenu && 'hover:bg-primary/[0.04] dark:hover:bg-white/[0.04]',
        isInsideGroup && 'bg-zinc-50/45 dark:bg-muted/[0.025] text-foreground/80',
        selectionMode && 'cursor-pointer select-none',
        selectionMode && isSelected && 'bg-primary/[0.06]'
      )}
    >
      <div className={cn(
        "grid items-start py-2.5 min-w-0 w-full",
        selectionMode
          ? (disabled ? 'grid-cols-[40px_48px_minmax(0,1.2fr)_minmax(0,1.2fr)]' : 'grid-cols-[40px_48px_minmax(0,1.2fr)_minmax(0,1.2fr)_80px]')
          : (disabled ? 'grid-cols-[48px_minmax(0,1.2fr)_minmax(0,1.2fr)]' : 'grid-cols-[48px_minmax(0,1.2fr)_minmax(0,1.2fr)_80px]')
      )}>
        {/* Selection checkbox (only in selection mode) */}
        {selectionMode && (
          <div
            className="flex items-center justify-center pt-0.5 border-r border-zinc-200 dark:border-border/20 h-full"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={Boolean(isSelected)}
              onCheckedChange={() => onToggleSelect?.(step.id)}
            />
          </div>
        )}

        {/* Left Controls — drag grip + order */}
        <div className="flex items-center justify-center gap-0.5 px-1 pt-0.5 select-none border-r border-zinc-200 dark:border-border/20 h-full">
          {!disabled && !isInsideGroup && !selectionMode && (
            <span
              {...attributes}
              {...listeners}
              className="p-0.5 text-muted-foreground hover:text-foreground cursor-grab"
              title="Drag to reorder"
            >
              <GripVertical className="h-3 w-3 opacity-60 group-hover:opacity-100" />
            </span>
          )}
          <span className="font-mono text-xs text-muted-foreground font-medium">
            #{step.order}
          </span>
          {!disabled && !isInsideGroup && !selectionMode && (
            <div className="flex flex-col invisible group-hover:visible -my-1">
              <button
                onClick={() => onMove(step.id, -1)}
                className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-10"
                disabled={index === 0}
                title="Move up"
              >
                <ArrowUp className="h-2.5 w-2.5" />
              </button>
              <button
                onClick={() => onMove(step.id, 1)}
                className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-10"
                disabled={index === total - 1}
                title="Move down"
              >
                <ArrowDown className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>

        {/* Action Column */}
        <div className="px-3 min-w-0 flex flex-col gap-1 items-start w-full border-r border-zinc-200 dark:border-border/20">
          {editingField === 'step' ? (
            <VariableAutocomplete
              value={step.step}
              onChange={(value) => onUpdate(step.id, 'step', value)}
              placeholder="Step action..."
              className="text-sm w-full"
              variables={variables}
              parameters={parameters}
              onCreateVariable={onCreateVariable}
              onCreateParameter={onCreateParameter}
              multiline
              autoFocus
              ghostSuffix={actionMatch?.ghostSuffix}
              onAcceptGhost={
                actionMatch && (actionMatch.ghostSuffix || liveExpectedSuggestion)
                  ? handleAcceptActionSuggestion
                  : undefined
              }
            />
          ) : (
            <div
              onClick={() => startEditingField('step')}
              className="text-sm leading-5 w-full flex items-start gap-1.5 min-w-0 break-words cursor-text min-h-[22px]"
            >
              <div className={cn("flex-1 min-w-0", isInsideGroup && "text-foreground/80")}>
                <LinkifiedText
                  text={step.step}
                  className={cn("text-sm", isInsideGroup && "text-foreground/80")}
                  variables={variables}
                  parameters={parameters}
                  onTextChange={(newText) => {
                    onUpdate(step.id, 'step', newText);
                  }}
                  editable={!disabled}
                />
                {!step.step && <span className="text-muted-foreground italic opacity-60">Click to enter step action...</span>}
              </div>
              {step.ai_generated && (
                <span title="Generated by AI" className="shrink-0 mt-0.5">
                  <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                </span>
              )}
              {(() => {
                const meta = parseDatadogStepMeta(step.meta);
                if (!meta) return null;
                const hasMeta = Boolean(meta.subtestGroup) || (meta.badges?.length || 0) > 0;
                if (!hasMeta) return null;
                return (
                  <span className="flex flex-wrap items-center gap-1">
                    {meta.subtestGroup && (
                      <span
                        className="text-[9.5px] px-1.5 py-0.5 rounded border border-primary/25 bg-primary/[0.06] text-primary font-medium leading-none"
                        title="Datadog subtest group"
                      >
                        {meta.subtestGroup}
                      </span>
                    )}
                    <DatadogStepBadges badges={meta.badges} />
                  </span>
                );
              })()}
            </div>
          )}

          {/* Data box */}
          {(step.data || showData || editingField === 'data') && (
            <div className="flex items-start gap-1.5 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-1 mt-1 max-w-full w-full">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide shrink-0 mt-0.5">data</span>
              <span className="text-border/30 select-none mt-0.5">·</span>
              {editingField === 'data' ? (
                <VariableAutocomplete
                  value={step.data || ''}
                  onChange={(value) => onUpdate(step.id, 'data', value)}
                  placeholder="Test data (supports multiline, variables {{KEY}}, params {param})..."
                  className="text-xs flex-1"
                  variables={variables}
                  parameters={parameters}
                  onCreateVariable={onCreateVariable}
                  onCreateParameter={onCreateParameter}
                  multiline={true}
                  autoFocus
                />
              ) : (
                <div
                  onClick={() => startEditingField('data')}
                  className="text-xs text-foreground/90 flex-1 min-w-0 break-words cursor-text whitespace-pre-wrap leading-relaxed"
                >
                  <LinkifiedText
                    text={(step.data || '').replace(/^URL:\s*[^|]+\|\s*Body:\s*/i, '')}
                    className="text-xs whitespace-pre-wrap"
                    variables={variables}
                    parameters={parameters}
                    onTextChange={(newText) => {
                      onUpdate(step.id, 'data', newText);
                    }}
                    editable={!disabled}
                  />
                  {!step.data && <span className="text-muted-foreground italic">No test data</span>}
                </div>
              )}
              {editingField !== 'data' && !disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(step.id, 'data', '');
                    setShowData(false);
                  }}
                  className="ml-auto text-muted-foreground hover:text-destructive transition-opacity p-0.5 shrink-0 cursor-pointer"
                  title="Remove data"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Expected Result Column + Attachment Preview beside it */}
        <div className={cn("px-3 min-w-0 flex items-start justify-between w-full h-full gap-2", isInsideGroup ? "bg-transparent text-foreground/75" : "bg-muted/[0.04]", !disabled && "border-r border-zinc-200/80 dark:border-border/20")}>
          <div className="flex-1 min-w-0">
            {editingField === 'expected_result' ? (
              <VariableAutocomplete
                value={step.expected_result || ''}
                onChange={(value) => onUpdate(step.id, 'expected_result', value)}
                placeholder="Expected result..."
                className="text-sm w-full"
                variables={variables}
                parameters={parameters}
                onCreateVariable={onCreateVariable}
                onCreateParameter={onCreateParameter}
                multiline
                autoFocus
                ghostSuffix={expectedMatch?.ghostSuffix}
                onAcceptGhost={expectedMatch ? handleAcceptExpectedSuggestion : undefined}
              />
            ) : (
              <div
                onClick={() => startEditingField('expected_result')}
                className="text-sm leading-6 w-full min-w-0 break-words whitespace-pre-line text-foreground/90 cursor-text min-h-[22px]"
              >
                <LinkifiedText
                  text={
                    step.expected_result &&
                    step.expected_result.includes(' · ') &&
                    !step.expected_result.includes('\n')
                      ? step.expected_result
                          .replace(/\bisbelow\b/gi, 'is below')
                          .split(' · ')
                          .map((s) => s.trim())
                          .filter(Boolean)
                          .map((s) => (s.startsWith('✓') || s.startsWith('•') ? s : `✓ ${s}`))
                          .join('\n')
                      : step.expected_result || ''
                  }
                  className="text-sm whitespace-pre-line"
                  variables={variables}
                  parameters={parameters}
                  onTextChange={(newText) => {
                    onUpdate(step.id, 'expected_result', newText);
                  }}
                  editable={!disabled}
                />
                {!step.expected_result && liveExpectedSuggestion ? (
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleAcceptActionSuggestion();
                    }}
                    className="inline-flex flex-wrap items-center gap-1.5 text-left text-sm leading-5 text-muted-foreground/55 hover:text-muted-foreground/85 transition-colors cursor-pointer select-none py-1"
                    title="Press Tab or click to apply suggested Expected Result"
                  >
                    <span>{liveExpectedSuggestion}</span>
                    <span className="inline-flex items-center rounded border border-border/60 bg-muted/60 px-1 py-0 text-[10px] leading-4 font-mono text-muted-foreground/75 shrink-0">
                      Tab
                    </span>
                  </button>
                ) : (
                  !step.expected_result && <span className="text-muted-foreground italic opacity-60">Click to enter expected result...</span>
                )}
              </div>
            )}
          </div>

          {/* Compact Attachment Thumbnail on right of Expected Result */}
          {step.image_url && (
            <div className="shrink-0 flex items-start gap-1">
              {imageError ? (
                <div className="h-8 w-8 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-500 flex items-center justify-center text-xs" title="Attachment unavailable">
                  <AlertCircle className="h-4 w-4" />
                </div>
              ) : (
                <div className="relative group/thumb h-8 w-8 rounded-md border border-border/60 overflow-hidden bg-muted/40 shrink-0">
                  <img
                    src={`/api/steps/${step.id}/image`}
                    alt="Attachment thumbnail"
                    className="h-full w-full object-cover cursor-zoom-in"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsViewingFullImage(true);
                    }}
                    onError={() => setImageError(true)}
                  />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/thumb:opacity-100 transition-opacity flex items-center justify-center gap-0.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsViewingFullImage(true);
                      }}
                      className="p-0.5 text-white hover:text-primary transition-colors"
                      title="Preview full size"
                    >
                      <Maximize2 className="h-3 w-3" />
                    </button>
                    {!disabled && (
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.stopPropagation();
                          try {
                            await removeStepImageAction(step.id);
                            onUpdate(step.id, 'image_url', null);
                            toast.success('Removed attachment');
                          } catch (err: any) {
                            toast.error(err.message);
                          }
                        }}
                        className="p-0.5 text-white hover:text-red-400 transition-colors"
                        title="Remove image"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Hover Edit Pencil in View Mode */}
        {disabled && onRequestEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRequestEdit(step.id, step.order);
            }}
            title="Edit test steps"
            className="absolute right-2.5 top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg bg-background/95 hover:bg-muted border border-border/60 text-muted-foreground hover:text-foreground shadow-xs cursor-pointer z-10"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}

        {/* Right Controls — Action Menu (Only in edit mode) */}
        {!disabled && (
          <div className="w-[80px] shrink-0 flex items-center justify-end px-2 gap-1 relative opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => onAddBelow(step.id)}
              title="Add step below"
              className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <div ref={menuRef} className="relative">
              <button
                ref={menuBtnRef}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!showMenu) updateStepMenuPos();
                  setShowMenu(!showMenu);
                }}
                className="p-1 text-foreground/75 hover:text-foreground hover:bg-muted rounded-md transition-colors cursor-pointer"
              >
                <MoreVertical className="h-3.5 w-3.5" />
              </button>
              {showMenu &&
                typeof document !== 'undefined' &&
                createPortal(
                  <>
                    <div className="fixed inset-0 z-[9998]" onClick={() => setShowMenu(false)} />
                    <div
                      ref={menuPopupRef}
                      style={{
                        position: 'fixed',
                        top: stepMenuPos.top !== undefined ? `${stepMenuPos.top}px` : undefined,
                        bottom: stepMenuPos.bottom !== undefined ? `${stepMenuPos.bottom}px` : undefined,
                        right: `${stepMenuPos.right}px`,
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="z-[9999] w-48 bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl p-1 flex flex-col text-xs animate-in fade-in-0 zoom-in-95 duration-100"
                    >
                      <button
                        type="button"
                        onClick={() => { onAddAbove(step.id); setShowMenu(false); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted rounded-lg text-left text-foreground font-medium cursor-pointer"
                      >
                        <ArrowUp className="h-3.5 w-3.5 text-muted-foreground" />
                        Add step above
                      </button>
                      <button
                        type="button"
                        onClick={() => { onAddBelow(step.id); setShowMenu(false); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted rounded-lg text-left text-foreground font-medium cursor-pointer"
                      >
                        <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                        Add step below
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowData(true);
                          startEditingField('data');
                          setShowMenu(false);
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted rounded-lg text-left text-foreground font-medium cursor-pointer"
                      >
                        <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                        {step.data ? 'Edit step data' : 'Add step data'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMenu(false);
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = 'image/*';
                          input.onchange = async (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (!file) return;
                            try {
                              const formData = new FormData();
                              formData.append('stepId', step.id);
                              formData.append('file', file);
                              const res = await uploadStepImageAction(formData);
                              if (res.success && res.key) {
                                onUpdate(step.id, 'image_url', res.key);
                                toast.success('Attachment uploaded');
                              } else {
                                toast.error((res as any).error || 'Failed to upload attachment');
                              }
                            } catch (e: any) {
                              toast.error(e.message);
                            }
                          };
                          input.click();
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted rounded-lg text-left text-foreground font-medium cursor-pointer"
                      >
                        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                        Attachments
                      </button>
                      <button
                        type="button"
                        onClick={() => { onDuplicate(step); setShowMenu(false); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted rounded-lg text-left text-foreground font-medium cursor-pointer"
                      >
                        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                        Duplicate
                      </button>
                      {!isInsideGroup && (
                        isLinked ? (
                          <>
                            <button
                              type="button"
                              onClick={() => { onViewSource?.(step); setShowMenu(false); }}
                              className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted rounded-lg text-left text-primary font-medium cursor-pointer"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View Original
                            </button>
                            <button
                              type="button"
                              onClick={() => { onConvertToCustom(step.id); setShowMenu(false); }}
                              className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted rounded-lg text-left text-foreground font-medium cursor-pointer"
                            >
                              <Unlink className="h-3.5 w-3.5 text-muted-foreground" />
                              Unlink Shared Step
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { onConvertToReusable?.(step.id); setShowMenu(false); }}
                            className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted rounded-lg text-left text-primary font-semibold cursor-pointer"
                          >
                            <LinkIcon className="h-3.5 w-3.5" />
                            Save as Shared Step
                          </button>
                        )
                      )}
                      <div className="border-t border-border/50 my-1" />
                      <button
                        type="button"
                        onClick={() => { onDelete(step.id); setShowMenu(false); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-destructive/10 rounded-lg text-left text-destructive font-semibold cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete step
                      </button>
                    </div>
                  </>,
                  document.body
                )}
            </div>
          </div>
        )}
      </div>

      {/* Full Image Preview Lightbox */}
      {isViewingFullImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in-0 duration-150">
          <div className="relative max-w-4xl max-h-[90vh] bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Step #{step.order} Attachment</span>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={`/api/steps/${step.id}/image`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1 text-xs rounded-lg border border-border/50 hover:bg-muted inline-flex items-center gap-1.5 transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                  Open Original
                </a>
                <button
                  type="button"
                  onClick={() => setIsViewingFullImage(false)}
                  className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="p-4 flex items-center justify-center overflow-auto max-h-[calc(90vh-60px)]">
              <img
                src={`/api/steps/${step.id}/image`}
                alt={`Step ${step.order} attachment full`}
                className="max-h-[70vh] max-w-full object-contain rounded-lg shadow-md"
              />
            </div>
          </div>
        </div>
      )}

      {/* Outdated warning row for individual standalone step */}
      {step.is_outdated && !isInsideGroup && (
        <div className="grid grid-cols-1 border-t border-border/50 bg-amber-500/10 dark:bg-amber-500/5">
          <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-300">
            <RefreshCcw className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>
              Source reusable step was updated.
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs ml-auto bg-amber-500 text-white hover:bg-amber-600"
              onClick={() => onUpdateFromSource(step.id)}
            >
              Update from source
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onConvertToCustom(step.id)}
            >
              Convert to normal
            </Button>
          </div>
        </div>
      )}
    </div>
  );
});

interface StepEditorProps {
  testCaseId: string;
  projectId: string;
  initialSteps?: StepItem[];
  initialVariables?: any[];
  parameters?: Array<{ key: string; datasetName?: string; sampleValue?: string }>;
  onStepChange?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  disabled?: boolean;
  isFullPage?: boolean;
  onCreateParameter?: (param: string) => void;
  onRequestEdit?: (stepId?: string, stepOrder?: number) => void;
}

export interface StepEditorHandle {
  saveAll: () => Promise<StepItem[]>;
  discardAll: () => Promise<void>;
}

const fetchedProjectServerIndex = new Set<string>();

export const StepEditor = forwardRef<StepEditorHandle, StepEditorProps>(function StepEditor(
  { testCaseId, projectId, initialSteps = [], initialVariables, parameters = [], onStepChange, onDirtyChange, disabled = false, isFullPage = false, onCreateParameter, onRequestEdit },
  ref
) {
  const { cases: projectCases } = useProjectData();
  const [items, setItems] = useState<StepItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySteps, setLibrarySteps] = useState<any[]>([]);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [variables, setVariables] = useState<any[]>(initialVariables || []);
  const [autocompleteIndex, setAutocompleteIndex] = useState<StepAutocompleteIndex | null>(() =>
    getCachedProjectAutocompleteIndex(projectId)
  );
  const [syncDiffModal, setSyncDiffModal] = useState<{
    open: boolean;
    reusableStepId: string;
    title: string;
    currentSteps: any[];
    sourceSteps: any[];
  } | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedStepIds, setSelectedStepIds] = useState<Set<string>>(new Set());
  const [showReusableGroupModal, setShowReusableGroupModal] = useState(false);
  const [reusableGroupTitle, setReusableGroupTitle] = useState('');
  const [showReusableEditDialog, setShowReusableEditDialog] = useState(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(new Set());

  const toggleGroupCollapse = (groupId: string) => {
    setCollapsedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const [pendingReusableEdit, setPendingReusableEdit] = useState<{
    stepId: string;
    step: string;
    expectedResult?: string | null;
    data?: string | null;
    reusableStepId: string;
    reusableStepItemId?: string | null;
    reusableStepTitle: string;
    affectedCount: number;
  } | null>(null);

  const loadVariables = useCallback(async () => {
    try {
      const [globalVars, localVars] = await Promise.all([
        getGlobalVariablesAction(projectId),
        getTestCaseLocalVariablesAction(testCaseId),
      ]);
      const all: any[] = [
        ...localVars.map((v: any) => ({ ...v, scope: 'LOCAL' as const })),
        ...globalVars.map((v: any) => ({ ...v, scope: 'GLOBAL' as const })),
      ];
      setVariables(all);
    } catch {
      // silent
    }
  }, [projectId, testCaseId]);

  const handleCreateVariableInline = useCallback(
    async (key: string) => {
      try {
        const clean = key.toUpperCase().replace(/[^A-Z0-9_]/g, '');
        if (!clean) return;
        await createVariableAction({
          projectId,
          key: clean,
          scope: 'GLOBAL',
        });
        toast.success(`Global variable ${formatVariableName(clean)} created`);
        await loadVariables();
      } catch (e: any) {
        toast.error(e.message || 'Failed to create variable');
      }
    },
    [projectId, loadVariables]
  );

  const handleCreateParameterInline = useCallback(
    async (param: string) => {
      try {
        const clean = param.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!clean) return;
        await addParameterToTestCaseAction(testCaseId, clean);
        toast.success(`Parameter {${clean}} added to this test case`);
        if (onStepChange) onStepChange();
      } catch (e: any) {
        toast.error(e.message || 'Failed to add parameter');
      }
    },
    [testCaseId, onStepChange]
  );

  useEffect(() => {
    if (initialVariables !== undefined) {
      setVariables(initialVariables);
      return;
    }
    if (!disabled) {
      loadVariables();
    }
  }, [initialVariables, disabled, loadVariables]);

  // Build / hydrate deterministic step autocomplete index (2-char bucket index)
  useEffect(() => {
    if (!projectId) return;

    const cached = getCachedProjectAutocompleteIndex(projectId);
    if (cached) {
      setAutocompleteIndex(cached);
      return;
    }

    if (projectCases && projectCases.length > 0) {
      const localSeed = extractAutocompleteRowsFromCases(projectCases, librarySteps);
      setAutocompleteIndex(setCachedProjectAutocompleteRows(projectId, localSeed));
      return;
    }

    if (!fetchedProjectServerIndex.has(projectId)) {
      fetchedProjectServerIndex.add(projectId);
      getStepAutocompleteIndexAction(projectId)
        .then((serverRows) => {
          const localSeed = extractAutocompleteRowsFromCases(projectCases || [], librarySteps);
          const merged = mergeAutocompleteRows(serverRows, localSeed);
          setAutocompleteIndex(setCachedProjectAutocompleteRows(projectId, merged));
        })
        .catch(() => {
          fetchedProjectServerIndex.delete(projectId);
        });
    }
  }, [projectId, projectCases, librarySteps]);

  const handleCommitStepToIndex = useCallback(
    (committedStep: StepItem) => {
      if (!projectId || !committedStep.step || committedStep.step.trim().length < 2) return;
      const updated = recordStepsIntoProjectCache(projectId, [committedStep]);
      if (updated) setAutocompleteIndex(updated);
    },
    [projectId]
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  useEffect(() => {
    // Only overwrite items from initialSteps if the user is not actively editing with unsaved local changes
    if (!dirty) {
      if (initialSteps.length === 0 && !disabled) {
        setItems((prev) =>
          prev.length === 1 && prev[0]._isEphemeralBlank
            ? prev
            : [createEphemeralBlankStep(testCaseId, 1)]
        );
      } else {
        setItems(
          initialSteps.map((s, idx) => ({
            ...s,
            id: s.id || `step-${testCaseId}-${s.order ?? idx + 1}`,
          }))
        );
      }
    }
  }, [initialSteps, dirty, disabled, testCaseId]);

  useEffect(() => {
    if (initialSteps.length === 0 && !disabled) {
      setItems([createEphemeralBlankStep(testCaseId, 1)]);
    } else {
      setItems(
        initialSteps.map((s, idx) => ({
          ...s,
          id: s.id || `step-${testCaseId}-${s.order ?? idx + 1}`,
        }))
      );
    }
    setDirty(false);
  }, [testCaseId]);

  // When transitioning between view mode and edit mode:
  // - Entering edit mode with 0 steps -> insert default blank Step #1
  // - Exiting edit mode -> strip any completely empty steps (and delete from DB if persisted)
  useEffect(() => {
    if (!disabled) {
      setItems((prev) =>
        prev.length === 0 ? [createEphemeralBlankStep(testCaseId, 1)] : prev
      );
    } else {
      setItems((prev) => {
        const emptyPersisted = prev.filter(
          (s) => !s._isEphemeralBlank && isStepCompletelyEmpty(s)
        );
        if (emptyPersisted.length > 0) {
          Promise.all(
            emptyPersisted.map((s) => deleteTestCaseStepAction(s.id).catch(() => {}))
          );
        }
        const remaining = prev
          .filter((s) => !isStepCompletelyEmpty(s))
          .map((s, idx) => ({ ...s, order: idx + 1 }));
        return remaining.length === prev.length ? prev : remaining;
      });
    }
  }, [disabled, testCaseId]);

  useEffect(() => {
    const isDifferent = () => {
      const effectiveItems = items.filter((s) => !isStepCompletelyEmpty(s));
      const effectiveInitial = initialSteps.filter((s) => !isStepCompletelyEmpty(s));
      if (effectiveItems.length !== effectiveInitial.length) return true;
      for (let i = 0; i < effectiveItems.length; i++) {
        const item = effectiveItems[i];
        const initial = effectiveInitial.find((s) => s.id === item.id);
        if (!initial) return true;
        if ((item.step || '').trim() !== (initial.step || '').trim()) return true;
        if ((item.expected_result || '').trim() !== (initial.expected_result || '').trim()) return true;
        if ((item.data || '').trim() !== (initial.data || '').trim()) return true;
        if ((item.image_url || '') !== (initial.image_url || '')) return true;
        if (item.order !== initial.order) return true;
      }
      return false;
    };
    setDirty(isDifferent());
  }, [items, initialSteps]);

  useEffect(() => {
    if (onDirtyChange) onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  useImperativeHandle(ref, () => ({
    saveAll: async () => {
      setSaving(true);
      try {
        const emptySteps = items.filter((s) => isStepCompletelyEmpty(s));
        const nonEmptySteps = items
          .filter((s) => !isStepCompletelyEmpty(s))
          .map((s, idx) => ({ ...s, order: idx + 1 }));

        const emptyPersistedIds = emptySteps
          .filter((s) => !s._isEphemeralBlank && s.id)
          .map((s) => s.id);

        const refreshed = await saveTestCaseStepsBulkAction({
          testCaseId,
          deleteIds: emptyPersistedIds,
          steps: nonEmptySteps.map((step) => ({
            id: step._isEphemeralBlank ? undefined : step.id,
            isNew: Boolean(step._isEphemeralBlank),
            order: step.order,
            step: step.step,
            expectedResult: step.expected_result ?? undefined,
            data: (step.data === '' || step.data === null || !step.data) ? '' : step.data.trim(),
            imageUrl: step.image_url,
            reusableStepId: step.reusable_step_id,
            reusableStepItemId: step.reusable_step_item_id,
          })),
        });

        const savedSteps: StepItem[] = refreshed.map((s: any) => ({
          id: s.id,
          order: s.order,
          step: s.step,
          expected_result: s.expected_result,
          data: s.data,
          image_url: s.image_url,
          reusable_step_id: s.reusable_step_id,
          reusable_step_item_id: s.reusable_step_item_id,
          reusable_step: s.reusable_step,
          is_outdated: s.is_outdated,
          _isNew: false,
          _isEphemeralBlank: false,
        }));

        setItems(savedSteps);
        const updatedIndex = recordStepsIntoProjectCache(projectId, savedSteps);
        if (updatedIndex) setAutocompleteIndex(updatedIndex);
        setDirty(false);
        return savedSteps;
      } catch (e: any) {
        throw e;
      } finally {
        setSaving(false);
      }
    },
    discardAll: async () => {
      // Delete persisted _isNew steps (and any empty persisted steps) from DB to avoid orphaned records
      const toDeleteIds = items
        .filter((s) => !s._isEphemeralBlank && (s._isNew || isStepCompletelyEmpty(s)))
        .map((s) => s.id);
      if (toDeleteIds.length > 0) {
        await Promise.all(toDeleteIds.map((id) => deleteTestCaseStepAction(id).catch(() => {})));
      }
      // Revert step records in DB to initialSteps
      for (const orig of initialSteps) {
        await updateTestCaseStepAction(orig.id, {
          step: orig.step,
          expectedResult: orig.expected_result || undefined,
          data: orig.data === '' ? '' : (orig.data || undefined),
        }).catch(() => {});
      }
      setItems(initialSteps);
      setDirty(false);
      if (onDirtyChange) onDirtyChange(false);
    },
  }), [dirty, items, initialSteps, testCaseId, projectId, onDirtyChange]);

  const handleConvertToReusable = useCallback((stepId: string) => {
    setSelectionMode(true);
    setSelectedStepIds(new Set([stepId]));
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedStepIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCancelSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedStepIds(new Set());
  }, []);

  const handleSaveReusableGroup = useCallback(async () => {
    if (!reusableGroupTitle.trim()) { toast.error('Enter a group name'); return; }
    if (selectedStepIds.size === 0) { toast.error('Select at least one step'); return; }

    const selectedSteps = items.filter((s) => selectedStepIds.has(s.id));
    const stepsData = selectedSteps.map((s) => ({
      step: s.step,
      expectedResult: s.expected_result,
      data: s.data,
      imageUrl: s.image_url,
    }));

    try {
      const { createReusableStepGroupAction } = await import('@/app/actions/steps');
      await createReusableStepGroupAction({
        projectId,
        title: reusableGroupTitle.trim(),
        steps: stepsData,
        testCaseStepIds: selectedSteps.map((s) => s.id),
      });
      toast.success(`Reusable step group "${reusableGroupTitle.trim()}" created`);
      setReusableGroupTitle('');
      setShowReusableGroupModal(false);
      setSelectionMode(false);
      setSelectedStepIds(new Set());
      if (onStepChange) onStepChange();
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [items, selectedStepIds, projectId, reusableGroupTitle]);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const steps = await getReusableStepsAction(projectId);
      setLibrarySteps(steps);
    } catch {
      // silent
    } finally {
      setLibraryLoading(false);
    }
  }, [projectId]);

  const stepGroups = useMemo(() => {
    const groups: {
      blockId: string;
      type: 'single' | 'group';
      steps: StepItem[];
      reusableStepId?: string;
      title?: string;
      isOutdated?: boolean;
      casesCount: number;
    }[] = [];
    let i = 0;
    while (i < items.length) {
      if (items[i].reusable_step_id) {
        const group: StepItem[] = [items[i]];
        let j = i + 1;
        while (j < items.length && items[j].reusable_step_id === items[i].reusable_step_id) {
          group.push(items[j]);
          j++;
        }
        const hasOutdated = group.some((s) => s.is_outdated);
        const casesCount =
          (items[i].reusable_step as any)?.casesCount ||
          items[i].reusable_step?._count?.test_case_steps ||
          1;
        const reusableId = items[i].reusable_step_id!;
        groups.push({
          blockId: `group:${reusableId}:${group[0].id}`,
          type: 'group',
          steps: group,
          reusableStepId: reusableId,
          title: items[i].reusable_step?.title || items[i].reusable_step?.step || 'Reusable Step Group',
          isOutdated: hasOutdated,
          casesCount,
        });
        i = j;
      } else {
        groups.push({
          blockId: items[i].id,
          type: 'single',
          steps: [items[i]],
          casesCount: 1,
        });
        i++;
      }
    }
    return groups;
  }, [items]);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldBlockIndex = stepGroups.findIndex((g) => g.blockId === active.id);
      const newBlockIndex = stepGroups.findIndex((g) => g.blockId === over.id);
      if (oldBlockIndex === -1 || newBlockIndex === -1 || oldBlockIndex === newBlockIndex) return;

      const reorderedBlocks = arrayMove(stepGroups, oldBlockIndex, newBlockIndex);
      const reordered = reorderedBlocks
        .flatMap((g) => g.steps)
        .map((s, i) => ({
          ...s,
          order: i + 1,
        }));

      setItems(reordered);
      setDirty(true);

      try {
        await reorderTestCaseStepsAction(
          testCaseId,
          reordered.map((s) => s.id)
        );
      } catch {
        toast.error('Failed to save order');
      }
    },
    [stepGroups, testCaseId]
  );

  const materializeEphemeralSteps = useCallback(
    async (currentItems: StepItem[], dropEmptyEphemeral = false): Promise<StepItem[]> => {
      const result: StepItem[] = [];
      for (let i = 0; i < currentItems.length; i++) {
        const s = currentItems[i];
        if (s._isEphemeralBlank) {
          if (dropEmptyEphemeral && isStepCompletelyEmpty(s)) {
            continue;
          }
          const created = await createTestCaseStepAction({
            testCaseId,
            order: result.length + 1,
            step: s.step || '',
            expectedResult: s.expected_result ?? undefined,
            data: s.data?.trim() || undefined,
          });
          result.push({
            ...s,
            id: created.id,
            order: result.length + 1,
            _isEphemeralBlank: false,
            _isNew: true,
          });
        } else {
          result.push({
            ...s,
            order: result.length + 1,
          });
        }
      }
      return result;
    },
    [testCaseId]
  );

  const addNewStep = useCallback(async () => {
    try {
      const baseItems = await materializeEphemeralSteps(items, false);
      const newOrder = baseItems.length + 1;
      const created = await createTestCaseStepAction({
        testCaseId,
        order: newOrder,
        step: '',
      });
      setItems([
        ...baseItems,
        {
          ...created,
          expected_result: created.expected_result,
          data: created.data,
          reusable_step_id: null,
          is_outdated: false,
          _isNew: true,
        },
      ]);
      setDirty(true);
      if (onStepChange) onStepChange();
    } catch (e: any) {
      toast.error(e.message);
    }
    setShowAddMenu(false);
  }, [items, testCaseId, onStepChange, materializeEphemeralSteps]);

  const handleInsertFromLibrary = useCallback(
    async (reusableStep: any) => {
      const groupSteps = reusableStep.steps && Array.isArray(reusableStep.steps) && reusableStep.steps.length > 0
        ? reusableStep.steps
        : null;

      try {
        const baseItems = await materializeEphemeralSteps(items, true);
        if (groupSteps) {
          // Multi-step group — insert all steps
          const newItems: StepItem[] = [];
          for (let i = 0; i < groupSteps.length; i++) {
            const s = groupSteps[i];
            const created = await createTestCaseStepAction({
              testCaseId,
              order: baseItems.length + newItems.length + 1,
              step: s.step || '',
              expectedResult: s.expectedResult || s.expected_result || undefined,
              data: s.data || undefined,
              imageUrl: s.imageUrl || s.image_url || undefined,
              reusableStepId: reusableStep.id,
              reusableStepItemId: String(i),
            });
            newItems.push({
              ...created,
              expected_result: created.expected_result,
              data: created.data,
              image_url: created.image_url,
              reusable_step_id: reusableStep.id,
              reusable_step_item_id: String(i),
              is_outdated: false,
              reusable_step: {
                id: reusableStep.id,
                title: reusableStep.title,
                step: '',
                expected_result: null,
                data: null,
                steps: reusableStep.steps || [],
              },
              _isNew: false,
            });
          }
          setItems([...baseItems, ...newItems]);
        } else {
          // Single step — existing behavior
          const created = await createTestCaseStepAction({
            testCaseId,
            order: baseItems.length + 1,
            step: reusableStep.step,
            expectedResult: reusableStep.expected_result,
            data: reusableStep.data,
            reusableStepId: reusableStep.id,
          });
          setItems([
            ...baseItems,
            {
              ...created,
              expected_result: created.expected_result,
              data: created.data,
              reusable_step_id: reusableStep.id,
              is_outdated: false,
              reusable_step: {
                id: reusableStep.id,
                title: reusableStep.title,
                step: reusableStep.step,
                expected_result: reusableStep.expected_result,
                data: reusableStep.data,
                steps: [],
              },
              _isNew: false,
            },
          ]);
        }
        setDirty(true);
        if (onStepChange) onStepChange();
      } catch (e: any) {
        toast.error(e.message);
      }
      setShowLibrary(false);
    },
    [items, testCaseId, onStepChange, materializeEphemeralSteps]
  );

  const handleUpdate = useCallback(
    (id: string, field: string, value: any) => {
      setItems((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
      setDirty(true);
      if (onDirtyChange) onDirtyChange(true);
    },
    [onDirtyChange]
  );

  const handleSaveStep = useCallback(
    async (id: string, backup?: StepItem | null) => {
      const step = items.find((s) => s.id === id);
      if (!step) return;

      const targetStep = backup ? { ...step, ...backup } : step;

      const hasChanged = !backup || 
        step.step !== backup.step || 
        step.expected_result !== backup.expected_result || 
        step.data !== backup.data;

      if (!hasChanged) return;

      if (step.reusable_step_id && step.reusable_step) {
        setPendingReusableEdit({
          stepId: id,
          step: targetStep.step,
          expectedResult: targetStep.expected_result,
          data: targetStep.data,
          reusableStepId: step.reusable_step_id,
          reusableStepItemId: step.reusable_step_item_id,
          reusableStepTitle: step.reusable_step.title || step.reusable_step.step,
          affectedCount: (step.reusable_step as any).casesCount || step.reusable_step._count?.test_case_steps || 1,
        });
        setShowReusableEditDialog(true);
        return;
      }
    },
    [items, onStepChange]
  );

  const handleReusableEditLocal = useCallback(async () => {
    if (!pendingReusableEdit) return;
    const { stepId, step, expectedResult, data } = pendingReusableEdit;
    try {
      await convertStepToCustomAction(stepId);
      await updateTestCaseStepAction(stepId, {
        step,
        expectedResult: expectedResult || undefined,
        data: data === '' ? undefined : (data || undefined),
      });
      setItems((prev) =>
        prev.map((s) =>
          s.id === stepId
            ? { ...s, step, expected_result: expectedResult ?? null, data: data ?? null, reusable_step_id: null, reusable_step: null, is_outdated: false }
            : s
        )
      );
      setDirty(true);
      toast.success('Detached and updated in this test case only');
      if (onStepChange) onStepChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setShowReusableEditDialog(false);
      setPendingReusableEdit(null);
    }
  }, [pendingReusableEdit, onStepChange]);

  const handleReusableEditLibrary = useCallback(async () => {
    if (!pendingReusableEdit) return;
    const { stepId, step, expectedResult, data, reusableStepId, reusableStepItemId, affectedCount } = pendingReusableEdit;
    try {
      await updateReusableStepAction(reusableStepId, {
        step,
        expectedResult: expectedResult || undefined,
        data: data === '' ? undefined : (data || undefined),
        currentTestCaseId: testCaseId,
        reusableStepItemId: reusableStepItemId || undefined,
      });
      await updateTestCaseStepAction(stepId, {
        step,
        expectedResult: expectedResult || undefined,
        data: data === '' ? undefined : (data || undefined),
        isOutdated: false,
      });
      setItems((prev) =>
        prev.map((s) =>
          s.id === stepId
            ? { ...s, step, expected_result: expectedResult ?? null, data: data ?? null, is_outdated: false }
            : s
        )
      );
      setDirty(true);
      toast.success(`Updated step library master (${affectedCount} test case${affectedCount !== 1 ? 's' : ''} affected)`);
      if (onStepChange) onStepChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setShowReusableEditDialog(false);
      setPendingReusableEdit(null);
    }
  }, [pendingReusableEdit, testCaseId, onStepChange]);

  const handleReusableFork = useCallback(async () => {
    if (!pendingReusableEdit) return;
    const { stepId, step, expectedResult, data, reusableStepId, reusableStepTitle } = pendingReusableEdit;
    try {
      const cloned = await cloneReusableStepAction(reusableStepId, `${reusableStepTitle} (Fork)`);
      await updateReusableStepAction(cloned.id, {
        step,
        expectedResult: expectedResult || undefined,
        data: data === '' ? undefined : (data || undefined),
      });
      await updateTestCaseStepAction(stepId, {
        step,
        expectedResult: expectedResult || undefined,
        data: data === '' ? undefined : (data || undefined),
        reusableStepId: cloned.id,
        isOutdated: false,
      });
      setItems((prev) =>
        prev.map((s) =>
          s.id === stepId
            ? {
                ...s,
                step,
                expected_result: expectedResult ?? null,
                data: data ?? null,
                reusable_step_id: cloned.id,
                reusable_step: cloned as any,
                is_outdated: false,
              }
            : s
        )
      );
      setDirty(true);
      toast.success(`Forked to new reusable step "${cloned.title}"`);
      if (onStepChange) onStepChange();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setShowReusableEditDialog(false);
      setPendingReusableEdit(null);
    }
  }, [pendingReusableEdit, onStepChange]);

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    try {
      await Promise.all(
        items.map((step) =>
          updateTestCaseStepAction(step.id, {
            step: step.step,
            expectedResult: step.expected_result ?? undefined,
            data: step.data?.trim() || undefined,
          })
        )
      );
      setDirty(false);
      toast.success('All steps saved');
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }, [items]);

  const handleDelete = useCallback(
    async (id: string) => {
      const target = items.find((s) => s.id === id);
      try {
        if (target && !target._isEphemeralBlank) {
          await deleteTestCaseStepAction(id);
        }
        setItems((prev) => prev.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i + 1 })));
        setDirty(true);
        if (onStepChange) onStepChange();
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [items, onStepChange]
  );

  const handleDuplicate = useCallback(
    async (step: StepItem) => {
      try {
        const baseItems = await materializeEphemeralSteps(items, false);
        const newOrder = baseItems.length + 1;
        const created = await createTestCaseStepAction({
          testCaseId,
          order: newOrder,
          step: step.step,
          expectedResult: step.expected_result ?? undefined,
          data: step.data ?? undefined,
        });
        setItems([
          ...baseItems,
          {
            ...created,
            expected_result: created.expected_result,
            data: created.data,
            reusable_step_id: null,
            is_outdated: false,
            _isNew: true,
          },
        ]);
        setDirty(true);
        if (onStepChange) onStepChange();
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [items, testCaseId, onStepChange, materializeEphemeralSteps]
  );

  const handleAddAbove = useCallback(
    async (id: string) => {
      const idx = items.findIndex((s) => s.id === id);
      if (idx === -1) return;

      try {
        const baseItems = await materializeEphemeralSteps(items, false);
        const targetOrder = baseItems[idx].order;
        const created = await createTestCaseStepAction({
          testCaseId,
          order: targetOrder,
          step: '',
        });

        const newStep = {
          ...created,
          expected_result: created.expected_result,
          data: created.data,
          reusable_step_id: null,
          is_outdated: false,
          _isNew: true,
        };

        const newItems = [...baseItems];
        newItems.splice(idx, 0, newStep);

        const reordered = newItems.map((s, i) => ({ ...s, order: i + 1 }));
        setItems(reordered);
        setDirty(true);

        await reorderTestCaseStepsAction(
          testCaseId,
          reordered.map((s) => s.id)
        );

        if (onStepChange) onStepChange();
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [items, testCaseId, onStepChange, materializeEphemeralSteps]
  );

  const handleAddBelow = useCallback(
    async (id: string) => {
      const idx = items.findIndex((s) => s.id === id);
      if (idx === -1) return;

      try {
        const baseItems = await materializeEphemeralSteps(items, false);
        const newOrder = baseItems[idx].order + 1;
        const created = await createTestCaseStepAction({
          testCaseId,
          order: newOrder,
          step: '',
        });

        const newStep = {
          ...created,
          expected_result: created.expected_result,
          data: created.data,
          reusable_step_id: null,
          is_outdated: false,
          _isNew: true,
        };

        // Insert right below the current item
        const newItems = [...baseItems];
        newItems.splice(idx + 1, 0, newStep);

        // Fix orders
        const reordered = newItems.map((s, i) => ({ ...s, order: i + 1 }));
        setItems(reordered);
        setDirty(true);

        await reorderTestCaseStepsAction(
          testCaseId,
          reordered.map((s) => s.id)
        );

        if (onStepChange) onStepChange();
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [items, testCaseId, onStepChange, materializeEphemeralSteps]
  );

  const handleMove = useCallback(
    (id: string, dir: -1 | 1) => {
      const idx = items.findIndex((s) => s.id === id);
      if (idx === -1) return;
      if (items[idx]?.reusable_step_id) return;

      let target = idx + dir;
      if (target < 0 || target >= items.length) return;

      // If the target step belongs to a shared step group, jump across the entire shared step group
      const targetStep = items[target];
      if (targetStep?.reusable_step_id) {
        const groupId = targetStep.reusable_step_id;
        const groupIndices = items
          .map((s, i) => (s.reusable_step_id === groupId ? i : -1))
          .filter((i) => i !== -1);
        target = dir === -1 ? Math.min(...groupIndices) : Math.max(...groupIndices);
      }

      const reordered = arrayMove(items, idx, target).map((s, i) => ({
        ...s,
        order: i + 1,
      }));
      setItems(reordered);
      setDirty(true);

      reorderTestCaseStepsAction(
        testCaseId,
        reordered.map((s) => s.id)
      ).catch(() => toast.error('Failed to save order'));
    },
    [items, testCaseId]
  );

  const handleUpdateFromSource = useCallback(
    (id: string) => {
      const step = items.find((s) => s.id === id);
      if (!step?.reusable_step) return;
      const sourceSteps = [{
        step: step.reusable_step.step,
        expectedResult: step.reusable_step.expected_result,
        data: step.reusable_step.data,
      }];
      setSyncDiffModal({
        open: true,
        reusableStepId: step.reusable_step_id || '',
        title: step.reusable_step.title || 'Reusable Step',
        currentSteps: [step],
        sourceSteps,
      });
    },
    [items]
  );

  const handleSyncGroup = useCallback(
    (reusableStepId: string) => {
      const groupSteps = items.filter((s) => s.reusable_step_id === reusableStepId);
      const first = groupSteps[0];
      const sourceSteps = Array.isArray(first?.reusable_step?.steps) && first.reusable_step.steps.length > 0
        ? (first.reusable_step.steps as any[])
        : [{ step: first?.reusable_step?.step || '', expectedResult: first?.reusable_step?.expected_result, data: first?.reusable_step?.data }];
      setSyncDiffModal({
        open: true,
        reusableStepId,
        title: first?.reusable_step?.title || 'Reusable Step Group',
        currentSteps: groupSteps,
        sourceSteps,
      });
    },
    [items]
  );

  const executeConfirmedSync = useCallback(async () => {
    if (!syncDiffModal) return;
    try {
      await syncReusableGroupAction(testCaseId, syncDiffModal.reusableStepId);
      const updatedSteps = await getTestCaseStepsAction(testCaseId);
      setItems(updatedSteps as any);
      setDirty(true);
      toast.success('Reusable step synchronized with library');
      setSyncDiffModal(null);
      if (onStepChange) onStepChange();
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [syncDiffModal, testCaseId, onStepChange]);

  const handleConvertToCustom = useCallback(
    async (id: string) => {
      try {
        await convertStepToCustomAction(id);
        setItems((prev) =>
          prev.map((s) => (s.id === id ? { ...s, reusable_step_id: null, reusable_step: null, is_outdated: false } : s))
        );
        setDirty(true);
        toast.success('Step converted to normal step');
      } catch (e: any) {
        toast.error(e.message);
      }
    }, []
  );

  const [viewSourceStep, setViewSourceStep] = useState<StepItem | null>(null);
  const handleViewSource = useCallback((step: StepItem) => {
    setViewSourceStep(step);
  }, []);

  const [confirmDeleteGroupId, setConfirmDeleteGroupId] = useState<string | null>(null);

  const handleDeleteGroup = useCallback(async (reusableStepId: string) => {
    const ids = items.filter((s) => s.reusable_step_id === reusableStepId).map((s) => s.id);
    for (const id of ids) {
      await deleteTestCaseStepAction(id).catch(() => {});
    }
    setItems((prev) => prev.filter((s) => s.reusable_step_id !== reusableStepId));
    setDirty(true);
    toast.success('Removed reusable step from this test case');
    if (onStepChange) onStepChange();
  }, [items, onStepChange]);

  const handleConvertGroupToNormal = useCallback(async (reusableStepId: string) => {
    try {
      await detachReusableGroupAction(testCaseId, reusableStepId);
      setItems((prev) =>
        prev.map((s) =>
          s.reusable_step_id === reusableStepId
            ? { ...s, reusable_step_id: null, reusable_step: null, is_outdated: false }
            : s
        )
      );
      setDirty(true);
      toast.success('Converted to normal steps');
      if (onStepChange) onStepChange();
    } catch (e: any) {
      toast.error(e.message);
    }
  }, [testCaseId, onStepChange]);

  return (
    <div className="w-full">
      <div className="rounded-xl border border-zinc-200/90 dark:border-border/40 overflow-hidden bg-card shadow-2xs">
        {/* Table header */}
        <div className={cn(
          "grid items-center bg-zinc-100/70 dark:bg-muted/40 border-b border-zinc-200/90 dark:border-border/40 text-xs font-semibold text-muted-foreground uppercase tracking-wider",
          selectionMode
            ? (disabled ? 'grid-cols-[40px_48px_minmax(0,1.2fr)_minmax(0,1.2fr)]' : 'grid-cols-[40px_48px_minmax(0,1.2fr)_minmax(0,1.2fr)_80px]')
            : (disabled ? 'grid-cols-[48px_minmax(0,1.2fr)_minmax(0,1.2fr)]' : 'grid-cols-[48px_minmax(0,1.2fr)_minmax(0,1.2fr)_80px]')
        )}>
          {selectionMode && (
            <div className="px-2 py-2 text-center border-r border-zinc-200/80 dark:border-border/20 flex items-center justify-center">
              <Checkbox
                checked={selectedStepIds.size === items.length && items.length > 0}
                onCheckedChange={() => {
                  if (selectedStepIds.size === items.length) {
                    setSelectedStepIds(new Set());
                  } else {
                    setSelectedStepIds(new Set(items.map((s) => s.id)));
                  }
                }}
                title={selectedStepIds.size === items.length ? "Deselect all" : "Select all"}
              />
            </div>
          )}
          <div className="px-2 py-2 text-center font-mono border-r border-zinc-200/80 dark:border-border/20">#</div>
          <div className="px-3 py-2 border-r border-zinc-200/80 dark:border-border/20">Action</div>
          <div className={cn("px-3 py-2", !disabled && "border-r border-zinc-200/80 dark:border-border/20")}>
            Expected Result
          </div>
          {!disabled && <div className="px-3 py-2"></div>}
        </div>

        {/* Steps */}
        <div className="divide-y divide-zinc-200/80 dark:divide-border/20">
        {items.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {disabled
              ? 'No test steps defined.'
              : 'No steps yet. Click "Add Step" below to get started.'}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={stepGroups.map((g) => g.blockId)} strategy={verticalListSortingStrategy}>
              {stepGroups.map((group) => {
                if (group.type === 'single') {
                  const step = group.steps[0];
                  return (
                    <SortableStep
                      key={step.id}
                      step={step}
                      index={items.indexOf(step)}
                      total={items.length}
                      onUpdate={handleUpdate}
                      onSaveStep={handleSaveStep}
                      onDelete={handleDelete}
                      onDuplicate={handleDuplicate}
                      onMove={handleMove}
                      onUpdateFromSource={handleUpdateFromSource}
                      onConvertToCustom={handleConvertToCustom}
                      onAddAbove={handleAddAbove}
                      onAddBelow={handleAddBelow}
                      onViewSource={handleViewSource}
                      disabled={disabled}
                      variables={variables}
                      parameters={parameters}
                      onCreateVariable={handleCreateVariableInline}
                      onCreateParameter={onCreateParameter || handleCreateParameterInline}
                      selectionMode={selectionMode}
                      isSelected={selectedStepIds.has(step.id)}
                      onToggleSelect={handleToggleSelect}
                      onConvertToReusable={handleConvertToReusable}
                      autocompleteIndex={autocompleteIndex}
                      onCommitStepToIndex={handleCommitStepToIndex}
                      onRequestEdit={onRequestEdit}
                    />
                  );
                } else {
                  const isDeletable = typeof confirmDeleteGroupId === 'string' && confirmDeleteGroupId === group.reusableStepId;
                  const isCollapsed = collapsedGroupIds.has(group.reusableStepId!);
                  return (
                    <SortableSharedGroup
                      key={group.blockId}
                      blockId={group.blockId}
                      disabled={disabled}
                      className={cn(
                        "border-b border-zinc-200/80 dark:border-border/30 last:border-b-0 transition-all",
                        group.isOutdated
                          ? "bg-amber-500/[0.03] dark:bg-amber-950/20"
                          : "bg-zinc-50/40 dark:bg-muted/[0.03]"
                      )}
                    >
                      {({ attributes: groupDragAttrs, listeners: groupDragListeners }) => (
                        <>
                          <div
                            onClick={() => toggleGroupCollapse(group.reusableStepId!)}
                            className="flex items-center justify-between px-3 py-2 text-xs font-medium border-b border-zinc-200/70 dark:border-border/25 bg-zinc-100/55 dark:bg-muted/20 hover:bg-zinc-100/80 dark:hover:bg-muted/35 transition-colors cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              {!disabled && (
                                <span
                                  {...groupDragAttrs}
                                  {...groupDragListeners}
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-0.5 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing shrink-0"
                                  title="Drag to reorder shared step block"
                                >
                                  <GripVertical className="h-3.5 w-3.5 opacity-70 hover:opacity-100" />
                                </span>
                              )}
                              <span className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors shrink-0">
                                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform text-muted-foreground", isCollapsed && "-rotate-90")} />
                              </span>
                              <span className="font-semibold text-foreground/85 truncate text-xs">{group.title}</span>
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/[0.08] text-primary/90 font-mono text-[10px] font-medium border border-primary/20 shrink-0 select-none">
                                <Link2 className="h-3 w-3" />
                                <span>Shared Step</span>
                              </span>
                              {group.isOutdated && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400 font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 shrink-0">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
                                  Updated in Library
                                </span>
                              )}
                            </div>

                            {/* Write/mutation controls only shown in Edit Mode (!disabled) */}
                            {!disabled && (
                              <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                {group.isOutdated && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleSyncGroup(group.reusableStepId!); }}
                                    className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs transition-colors inline-flex items-center gap-1 cursor-pointer"
                                    title="Sync to latest version from Step Library"
                                  >
                                    <RefreshCw className="h-3 w-3" />
                                    <span>Sync</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const first = group.steps[0];
                                    setPendingReusableEdit({
                                      stepId: first.id,
                                      step: first.step,
                                      expectedResult: first.expected_result,
                                      data: first.data,
                                      reusableStepId: group.reusableStepId!,
                                      reusableStepItemId: first.reusable_step_item_id,
                                      reusableStepTitle: group.title || 'Reusable Step Group',
                                      affectedCount: group.casesCount,
                                    });
                                    setShowReusableEditDialog(true);
                                  }}
                                  className="px-2.5 py-1 rounded-lg text-xs font-semibold text-foreground bg-card hover:bg-muted border border-border shadow-2xs transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                                  title="Edit Shared Step"
                                >
                                  <Pencil className="h-3 w-3 text-primary" />
                                  <span>Edit</span>
                                </button>
                                <GroupDropdownMenu
                                  onViewSource={() => handleViewSource(group.steps[0])}
                                  onDetach={() => handleConvertGroupToNormal(group.reusableStepId!)}
                                  onRemove={() => setConfirmDeleteGroupId(group.reusableStepId!)}
                                  onEditMaster={() => {
                                    const first = group.steps[0];
                                    setPendingReusableEdit({
                                      stepId: first.id,
                                      step: first.step,
                                      expectedResult: first.expected_result,
                                      data: first.data,
                                      reusableStepId: group.reusableStepId!,
                                      reusableStepItemId: first.reusable_step_item_id,
                                      reusableStepTitle: group.title || 'Reusable Step Group',
                                      affectedCount: group.casesCount,
                                    });
                                    setShowReusableEditDialog(true);
                                  }}
                                />
                              </div>
                            )}
                          </div>

                          {isDeletable && !disabled && (
                            <div className="flex items-center justify-between gap-2 px-3 py-2 bg-destructive/10 border-b border-destructive/20 text-xs" onClick={(e) => e.stopPropagation()}>
                              <span className="text-destructive font-medium">Remove all {group.steps.length} steps in this group from this test case?</span>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => { handleDeleteGroup(group.reusableStepId!); setConfirmDeleteGroupId(null); }}
                                  className="px-2.5 py-1 rounded-md text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 font-medium transition-colors cursor-pointer"
                                >
                                  Confirm Remove
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteGroupId(null)}
                                  className="px-2.5 py-1 rounded-md text-xs text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {!isCollapsed && (
                            <div className="divide-y divide-zinc-200/80 dark:divide-border/20">
                              {group.steps.map((step) => (
                                <SortableStep
                                  key={step.id}
                                  step={step}
                                  index={items.indexOf(step)}
                                  total={items.length}
                                  onUpdate={handleUpdate}
                                  onSaveStep={handleSaveStep}
                                  onDelete={handleDelete}
                                  onDuplicate={handleDuplicate}
                                  onMove={handleMove}
                                  onUpdateFromSource={handleUpdateFromSource}
                                  onConvertToCustom={handleConvertToCustom}
                                  onAddAbove={handleAddAbove}
                                  onAddBelow={handleAddBelow}
                                  onViewSource={handleViewSource}
                                  disabled={disabled}
                                  variables={variables}
                                  parameters={parameters}
                                  onCreateVariable={handleCreateVariableInline}
                                  onCreateParameter={onCreateParameter || handleCreateParameterInline}
                                  selectionMode={selectionMode}
                                  isSelected={selectedStepIds.has(step.id)}
                                  onToggleSelect={handleToggleSelect}
                                  onConvertToReusable={handleConvertToReusable}
                                  isInsideGroup={true}
                                  autocompleteIndex={autocompleteIndex}
                                  onCommitStepToIndex={handleCommitStepToIndex}
                                />
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </SortableSharedGroup>
                  );
                }
              })}
            </SortableContext>
          </DndContext>
        )}
        </div>
      </div>

      {/* Bottom bar */}
      {!disabled && (
        <div className="flex items-center gap-2 pt-3 flex-wrap">
          {selectionMode ? (
            <div className="flex items-center gap-2 flex-wrap animate-in fade-in-0 duration-150">
              <Button
                type="button"
                variant="default"
                className="cursor-pointer"
                disabled={selectedStepIds.size === 0}
                onClick={() => setShowReusableGroupModal(true)}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>
                  Convert to Shared Step{selectedStepIds.size > 0 ? ` (${selectedStepIds.size})` : ''}
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={handleCancelSelection}
              >
                Cancel
              </Button>
              <span className="text-xs text-muted-foreground ml-1 select-none">
                {selectedStepIds.size === 0
                  ? 'Select one or more steps above'
                  : `${selectedStepIds.size} of ${items.length} selected`}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Button
                  type="button"
                  onClick={() => setShowAddMenu((s) => !s)}
                  variant="outline"
                  className="cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Step</span>
                </Button>
                {showAddMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowAddMenu(false)} />
                    <div className="absolute bottom-full left-0 mb-1.5 z-50 bg-popover border border-border rounded-xl shadow-lg p-1 min-w-[160px]">
                      <button
                        type="button"
                        onClick={addNewStep}
                        className="w-full text-left px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-muted transition-colors cursor-pointer"
                      >
                        Empty Step
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          loadLibrary();
                          setShowLibrary(true);
                          setShowAddMenu(false);
                        }}
                        className="w-full text-left px-3 py-1.5 text-xs font-medium rounded-lg hover:bg-muted transition-colors cursor-pointer"
                      >
                        From Library
                      </button>
                    </div>
                  </>
                )}
              </div>
              {items.some((s) => !isStepCompletelyEmpty(s)) && (
                <Button
                  type="button"
                  variant="outline"
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={() => setSelectionMode(true)}
                  title="Select steps to convert into a shared step group"
                >
                  <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Select Steps</span>
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Library Modal */}
      <StepLibraryModal
        open={showLibrary}
        onOpenChange={setShowLibrary}
        steps={librarySteps}
        loading={libraryLoading}
        onSelect={handleInsertFromLibrary}
      />

      {/* Create Reusable Step Group Modal */}
      <Dialog open={showReusableGroupModal} onOpenChange={setShowReusableGroupModal}>
        <DialogContent className="max-w-md bg-card text-card-foreground border border-border/80 shadow-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2 text-foreground">
              <Layers className="h-4 w-4 text-muted-foreground" />
              <DialogTitle className="text-base font-semibold">Convert to Shared Step</DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              Save the selected steps to the Step Library so they can be reused across test cases.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground block">Shared Step Name</label>
              <Input
                value={reusableGroupTitle}
                onChange={(e) => setReusableGroupTitle(e.target.value)}
                className="h-9 text-xs"
                placeholder="e.g. Login with Mobile OTP"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && reusableGroupTitle.trim()) handleSaveReusableGroup();
                }}
              />
            </div>

            {selectedStepIds.size > 0 && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-muted-foreground block">
                  Included Steps ({selectedStepIds.size})
                </span>
                <div className="rounded-xl border border-border/60 bg-muted/20 divide-y divide-border/30 max-h-40 overflow-y-auto text-xs">
                  {items
                    .filter((s) => selectedStepIds.has(s.id))
                    .map((s, idx) => (
                      <div key={s.id} className="px-3 py-2 flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[11px] text-muted-foreground font-semibold shrink-0">
                          {idx + 1}.
                        </span>
                        <span className="truncate text-foreground/90">{s.step || 'Empty step'}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowReusableGroupModal(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveReusableGroup} disabled={!reusableGroupTitle.trim()}>
              Save to Library
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Redesigned Update Reusable Step Decision Modal */}
      <Dialog open={showReusableEditDialog} onOpenChange={setShowReusableEditDialog}>
        <DialogContent className="max-w-lg bg-card text-card-foreground border border-border/80 shadow-2xl p-6">
          <DialogHeader>
            <div className="flex items-center gap-2 text-violet-600 dark:text-violet-400">
              <Layers className="h-5 w-5" />
              <DialogTitle className="text-base font-semibold">Update Reusable Step</DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              You edited a step linked to <strong className="text-foreground">&quot;{pendingReusableEdit?.reusableStepTitle}&quot;</strong> in the Step Library (used in {pendingReusableEdit?.affectedCount || 1} test cases).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-3">
            {/* Option 1: Convert to Normal (Detach) */}
            <div
              onClick={handleReusableEditLocal}
              className="p-3.5 rounded-xl border border-border/60 hover:border-primary/50 hover:bg-muted/40 transition-all cursor-pointer group flex items-start gap-3 bg-muted/10"
            >
              <div className="h-8 w-8 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                <Unlink className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                    Update this test case only (Detach)
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 font-medium">Safe</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  Converts this step into an independent normal step for this test case. Other test cases and the Step Library remain completely unchanged.
                </p>
              </div>
            </div>

            {/* Option 2: Update Library Master */}
            <div
              onClick={handleReusableEditLibrary}
              className="p-3.5 rounded-xl border border-border/60 hover:border-violet-500/50 hover:bg-muted/40 transition-all cursor-pointer group flex items-start gap-3 bg-muted/10"
            >
              <div className="h-8 w-8 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                <Layers className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground group-hover:text-violet-600 transition-colors">
                    Update Step Library Master
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-medium">
                    Affects {pendingReusableEdit?.affectedCount || 1} cases
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  Updates the master definition in the library. All test cases referencing this step will receive the update.
                </p>
              </div>
            </div>

            {/* Option 3: Save as New Reusable Step (Fork) */}
            <div
              onClick={handleReusableFork}
              className="p-3.5 rounded-xl border border-border/60 hover:border-indigo-500/50 hover:bg-muted/40 transition-all cursor-pointer group flex items-start gap-3 bg-muted/10"
            >
              <div className="h-8 w-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                <Copy className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground group-hover:text-indigo-600 transition-colors">
                    Save as New Reusable Step (Fork)
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 font-medium">New Library Item</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                  Creates a new reusable step in the library and connects this test case to the new version.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-border/40 pt-3 flex items-center justify-between sm:justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowReusableEditDialog(false);
                setPendingReusableEdit(null);
              }}
              className="text-xs text-muted-foreground"
            >
              Cancel (Discard Edit)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewSourceStep} onOpenChange={(open) => !open && setViewSourceStep(null)}>
        <DialogContent className="max-w-2xl bg-card text-card-foreground border border-border/80 shadow-2xl">
          <DialogHeader>
            <DialogTitle>Reusable Step Source</DialogTitle>
            <DialogDescription>
              Read-only view of the original reusable step from library.
            </DialogDescription>
          </DialogHeader>
          {viewSourceStep?.reusable_step && (
            <div className="space-y-4 py-2 text-sm">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Step</label>
                <div className="p-2 bg-muted/30 rounded border border-border/50">{viewSourceStep.reusable_step.step}</div>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Expected Result</label>
                <div className="p-2 bg-muted/30 rounded border border-border/50">{viewSourceStep.reusable_step.expected_result || <span className="italic text-muted-foreground">None</span>}</div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setViewSourceStep(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reusable Step Sync Diff Preview Modal */}
      <Dialog open={!!syncDiffModal} onOpenChange={(open) => { if (!open) setSyncDiffModal(null); }}>
        <DialogContent className="max-w-3xl bg-card text-card-foreground border border-border/80 shadow-2xl p-6">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary">
              <RefreshCw className="h-4 w-4" />
              <DialogTitle className="text-base font-semibold">
                Sync with Step Library: &ldquo;{syncDiffModal?.title}&rdquo;
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Review differences before applying changes. Syncing will update step descriptions and expected outcomes to match the master in the library.
            </DialogDescription>
          </DialogHeader>

          {syncDiffModal && (
            <div className="border border-border/70 rounded-xl overflow-hidden text-xs my-3 max-h-[55vh] overflow-y-auto bg-card shadow-xs">
              <table className="w-full text-left border-collapse table-fixed">
                <thead>
                  <tr className="bg-muted/40 text-muted-foreground uppercase text-[10px] font-semibold border-b border-border/50 tracking-wider">
                    <th className="px-3 py-2 w-12 border-r border-border/30 text-center">#</th>
                    <th className="px-3 py-2 w-[47%] border-r border-border/30">Current in This Test Case</th>
                    <th className="px-3 py-2 w-[47%]">Updated Master in Library</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {syncDiffModal.sourceSteps.map((source, idx) => {
                    const current = syncDiffModal.currentSteps[idx];
                    const isStepDiff = current && current.step !== (source.step || source.description);
                    const isExpDiff = current && (current.expected_result || null) !== (source.expectedResult || source.expected_result || null);

                    return (
                      <tr key={idx} className="hover:bg-muted/15 transition-colors">
                        <td className="px-2 py-2 text-center font-mono text-muted-foreground border-r border-border/30 align-top">
                          {idx + 1}
                        </td>
                        <td className="px-3 py-2 border-r border-border/30 align-top space-y-1">
                          {current ? (
                            <>
                              <div className={cn("text-xs font-medium", isStepDiff && "text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 rounded")}>
                                {current.step || <span className="italic opacity-50">Empty</span>}
                              </div>
                              {current.expected_result && (
                                <div className={cn("text-[11px] text-muted-foreground", isExpDiff && "text-amber-600 dark:text-amber-400")}>
                                  Exp: {current.expected_result}
                                </div>
                              )}
                              {current.data && (
                                <div className="text-[10px] font-mono text-muted-foreground bg-muted/40 px-1 rounded inline-block">
                                  data: {current.data}
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="text-muted-foreground/50 italic text-[11px]">Step does not exist in case</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top space-y-1 bg-primary/5">
                          <div className={cn("text-xs font-medium text-foreground", isStepDiff && "text-sky-600 dark:text-sky-400 font-semibold")}>
                            {source.step || source.description || <span className="italic opacity-50">Empty</span>}
                          </div>
                          {(source.expectedResult || source.expected_result) && (
                            <div className={cn("text-[11px] text-muted-foreground", isExpDiff && "text-sky-600 dark:text-sky-400")}>
                              Exp: {source.expectedResult || source.expected_result}
                            </div>
                          )}
                          {source.data && (
                            <div className="text-[10px] font-mono text-muted-foreground bg-muted/40 px-1 rounded inline-block">
                              data: {source.data}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter className="gap-2 border-t border-border/40 pt-3">
            <Button variant="ghost" size="sm" onClick={() => setSyncDiffModal(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={executeConfirmedSync} className="bg-primary text-primary-foreground">
              Accept &amp; Update to Latest
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});
