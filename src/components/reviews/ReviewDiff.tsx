'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  PlusCircle,
  MinusCircle,
  Edit3,
  Columns,
  AlignJustify,
  FileText,
  Tag,
  AlertTriangle,
  ImageIcon,
  MessageSquare,
  MessageSquarePlus,
  Check,
  X,
  Send,
} from 'lucide-react';
import { cn, maskSensitiveData } from '@/lib/utils';
import { UserAvatar } from '@/components/common/UserAvatar';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';

export interface Step {
  order: number;
  step: string;
  expectedResult?: string | null;
  expected_result?: string | null;
  data?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
}

export interface StepCommentItem {
  id: string;
  stepOrder: number;
  authorId: number;
  authorName: string;
  authorImage?: string | null;
  body: string;
  createdAt: string;
  resolved?: boolean;
}

export interface ReviewDiffProps {
  before: {
    steps: Step[];
    preConditions?: string | null;
    postConditions?: string | null;
    title?: string | null;
    priority?: string | null;
    type?: string | null;
    description?: string | null;
  };
  after: {
    steps: Step[];
    preConditions?: string | null;
    postConditions?: string | null;
    title?: string | null;
    priority?: string | null;
    type?: string | null;
    description?: string | null;
  };
  baselineLabel?: string;
  revisionLabel?: string;
  defaultCollapsed?: boolean;
  defaultViewMode?: 'split' | 'unified';

  // Step-level commenting
  stepComments?: StepCommentItem[];
  onAddStepComment?: (stepOrder: number, body: string) => Promise<void>;
  onResolveStepComment?: (commentId: string) => Promise<void>;
  onDeleteStepComment?: (commentId: string) => Promise<void>;
  currentUserId?: number | null;
}

export function computeStringSimilarity(strA: string, strB: string): number {
  const a = (strA || '').trim().toLowerCase();
  const b = (strB || '').trim().toLowerCase();
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  let common = 0;
  wordsA.forEach((w) => {
    if (wordsB.has(w)) common++;
  });
  const total = new Set([...wordsA, ...wordsB]).size;
  return total === 0 ? 0 : common / total;
}

function renderWordDiff(oldText: string, newText: string, mode: 'before' | 'after') {
  if (!oldText && !newText) return null;
  if (!oldText) {
    return mode === 'after' ? (
      <span className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold px-1 py-0.5 rounded border border-emerald-500/25">
        {newText}
      </span>
    ) : null;
  }
  if (!newText) {
    return mode === 'before' ? (
      <span className="line-through bg-rose-500/15 text-rose-600 dark:text-rose-400 px-0.5 rounded font-medium">
        {oldText}
      </span>
    ) : null;
  }
  if (oldText === newText) {
    return <span>{mode === 'before' ? oldText : newText}</span>;
  }

  const oldTokens = oldText.split(/(\s+|[.,;!?()]+)/).filter(Boolean);
  const newTokens = newText.split(/(\s+|[.,;!?()]+)/).filter(Boolean);

  const n = oldTokens.length;
  const m = newTokens.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (oldTokens[i].toLowerCase() === newTokens[j].toLowerCase()) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  if (mode === 'before') {
    let i = n;
    let j = m;
    const matchedOld = new Set<number>();
    while (i > 0 && j > 0) {
      if (oldTokens[i - 1].toLowerCase() === newTokens[j - 1].toLowerCase()) {
        matchedOld.add(i - 1);
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return (
      <>
        {oldTokens.map((tok, idx) => {
          if (matchedOld.has(idx) || /^\s+$/.test(tok)) {
            return <span key={idx}>{tok}</span>;
          }
          return (
            <span
              key={idx}
              className="line-through bg-rose-500/15 text-rose-600 dark:text-rose-400 px-0.5 rounded font-medium"
            >
              {tok}
            </span>
          );
        })}
      </>
    );
  } else {
    let i = n;
    let j = m;
    const matchedNew = new Set<number>();
    while (i > 0 && j > 0) {
      if (oldTokens[i - 1].toLowerCase() === newTokens[j - 1].toLowerCase()) {
        matchedNew.add(j - 1);
        i--;
        j--;
      } else if (dp[i - 1][j] >= dp[i][j - 1]) {
        i--;
      } else {
        j--;
      }
    }

    return (
      <>
        {newTokens.map((tok, idx) => {
          if (matchedNew.has(idx) || /^\s+$/.test(tok)) {
            return <span key={idx}>{tok}</span>;
          }
          return (
            <span
              key={idx}
              className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold px-1 py-0.5 rounded border border-emerald-500/25"
            >
              {tok}
            </span>
          );
        })}
      </>
    );
  }
}

export interface AlignedDiff {
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  displayOrder: number;
  before?: Step;
  after?: Step;
}

export function alignSteps(beforeSteps: Step[], afterSteps: Step[]): AlignedDiff[] {
  const n = beforeSteps.length;
  const m = afterSteps.length;

  if (n === 0 && m === 0) return [];
  if (n === 0) {
    return afterSteps.map((s, idx) => ({
      type: 'added',
      displayOrder: idx + 1,
      after: s,
    }));
  }
  if (m === 0) {
    return beforeSteps.map((s, idx) => ({
      type: 'removed',
      displayOrder: idx + 1,
      before: s,
    }));
  }

  // Cost matrix for DP alignment
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const b = beforeSteps[i];
      const a = afterSteps[j];
      const sim = computeStringSimilarity(b.step, a.step);

      let matchScore = 0;
      if (b.step === a.step) {
        matchScore = 2.0;
      } else if (sim >= 0.4) {
        matchScore = 0.5 + sim;
      }

      if (matchScore > 0) {
        dp[i + 1][j + 1] = Math.max(
          dp[i][j] + matchScore,
          dp[i + 1][j],
          dp[i][j + 1]
        );
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to assemble aligned sequence
  let i = n;
  let j = m;
  const alignedReversed: { b?: Step; a?: Step }[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const b = beforeSteps[i - 1];
      const a = afterSteps[j - 1];
      const sim = computeStringSimilarity(b.step, a.step);
      const isMatch = b.step === a.step || sim >= 0.4;

      if (isMatch && dp[i][j] === dp[i - 1][j - 1] + (b.step === a.step ? 2.0 : 0.5 + sim)) {
        alignedReversed.push({ b, a });
        i--;
        j--;
        continue;
      }
    }

    if (j > 0 && (i === 0 || dp[i][j] === dp[i][j - 1])) {
      alignedReversed.push({ a: afterSteps[j - 1] });
      j--;
    } else if (i > 0 && (j === 0 || dp[i][j] === dp[i - 1][j])) {
      alignedReversed.push({ b: beforeSteps[i - 1] });
      i--;
    } else {
      if (i > 0) {
        alignedReversed.push({ b: beforeSteps[i - 1] });
        i--;
      }
      if (j > 0) {
        alignedReversed.push({ a: afterSteps[j - 1] });
        j--;
      }
    }
  }

  const aligned = alignedReversed.reverse();

  let stepNumber = 1;
  return aligned.map((pair) => {
    if (!pair.b && pair.a) {
      return {
        type: 'added',
        displayOrder: stepNumber++,
        after: pair.a,
      };
    }
    if (pair.b && !pair.a) {
      return {
        type: 'removed',
        displayOrder: pair.b.order,
        before: pair.b,
      };
    }

    const b = pair.b!;
    const a = pair.a!;
    const bExp = b.expectedResult ?? b.expected_result ?? null;
    const aExp = a.expectedResult ?? a.expected_result ?? null;
    const bData = b.data ?? null;
    const aData = a.data ?? null;
    const bImg = b.imageUrl ?? b.image_url ?? null;
    const aImg = a.imageUrl ?? a.image_url ?? null;

    const isChanged = b.step !== a.step || bExp !== aExp || bData !== aData || bImg !== aImg;

    return {
      type: isChanged ? 'modified' : 'unchanged',
      displayOrder: stepNumber++,
      before: b,
      after: a,
    };
  });
}

export function ReviewDiff({
  before,
  after,
  baselineLabel = 'Baseline Version',
  revisionLabel = 'Proposed Revision',
  defaultCollapsed = false,
  defaultViewMode = 'unified',
  stepComments = [],
  onAddStepComment,
  onResolveStepComment,
  onDeleteStepComment,
  currentUserId,
}: ReviewDiffProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>(defaultViewMode);

  // Active composer for step comment
  const [activeStepComposer, setActiveStepComposer] = useState<number | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const beforeSteps = before?.steps || [];
  const afterSteps = after?.steps || [];
  const isFirstReview = beforeSteps.length === 0;

  const diffs = alignSteps(beforeSteps, afterSteps);

  let addedCount = 0;
  let removedCount = 0;
  let modifiedCount = 0;

  diffs.forEach((d) => {
    if (d.type === 'added') addedCount++;
    if (d.type === 'removed') removedCount++;
    if (d.type === 'modified') modifiedCount++;
  });

  const preChanged = (before?.preConditions || '').trim() !== (after?.preConditions || '').trim();
  const postChanged = (before?.postConditions || '').trim() !== (after?.postConditions || '').trim();
  const titleChanged = Boolean(before?.title && after?.title && before.title.trim() !== after.title.trim());
  const priorityChanged = Boolean(before?.priority && after?.priority && before.priority !== after.priority);
  const typeChanged = Boolean(before?.type && after?.type && before.type !== after.type);
  const descChanged = Boolean(
    before?.description !== undefined &&
    after?.description !== undefined &&
    (before.description || '').trim() !== (after.description || '').trim()
  );

  const metadataChangesCount =
    (preChanged ? 1 : 0) +
    (postChanged ? 1 : 0) +
    (titleChanged ? 1 : 0) +
    (priorityChanged ? 1 : 0) +
    (typeChanged ? 1 : 0) +
    (descChanged ? 1 : 0);

  const totalChanges = addedCount + removedCount + modifiedCount + metadataChangesCount;
  const isPureAddOrRemove = modifiedCount === 0 && metadataChangesCount === 0 && (addedCount > 0 || removedCount > 0);
  const activeViewMode = isPureAddOrRemove ? 'unified' : viewMode;

  const handlePostComment = async (stepOrder: number) => {
    if (!commentInput.trim() || !onAddStepComment) return;
    setSubmittingComment(true);
    try {
      await onAddStepComment(stepOrder, commentInput.trim());
      setCommentInput('');
      setActiveStepComposer(null);
    } catch {
      // silent catch or handled by parent
    } finally {
      setSubmittingComment(false);
    }
  };

  const renderStepCommentsBlock = (stepOrder: number) => {
    const commentsForThisStep = stepComments.filter((c) => c.stepOrder === stepOrder);
    const isOpenComposer = activeStepComposer === stepOrder;

    if (commentsForThisStep.length === 0 && !isOpenComposer) return null;

    return (
      <div className="mt-2.5 pt-2.5 border-t border-border/40 space-y-2">
        {/* Existing step comments */}
        {commentsForThisStep.map((c) => (
          <div
            key={c.id}
            className={cn(
              "p-2.5 rounded-xl border text-xs space-y-1.5 transition-all",
              c.resolved
                ? "bg-muted/30 border-border/40 opacity-70"
                : "bg-amber-500/5 dark:bg-amber-950/20 border-amber-500/25 text-foreground"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <UserAvatar name={c.authorName} imageUrl={c.authorImage} size="sm" className="h-4 w-4 text-[9px]" />
                <span className="font-semibold text-foreground text-[11px]">{c.authorName}</span>
                <span className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                </span>
                {c.resolved && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-semibold">
                    ✓ Resolved
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1">
                {onResolveStepComment && (
                  <button
                    type="button"
                    onClick={() => onResolveStepComment(c.id)}
                    className="text-[10px] font-medium text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-muted"
                  >
                    {c.resolved ? "Reopen" : "Resolve"}
                  </button>
                )}
                {onDeleteStepComment && c.authorId === currentUserId && (
                  <button
                    type="button"
                    onClick={() => onDeleteStepComment(c.id)}
                    className="text-[10px] text-muted-foreground hover:text-red-500 transition-colors cursor-pointer p-0.5 rounded hover:bg-muted"
                    title="Delete note"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            <p className="text-xs text-foreground/90 leading-relaxed pl-5 whitespace-pre-wrap">
              {c.body}
            </p>
          </div>
        ))}

        {/* Inline Composer */}
        {isOpenComposer && (
          <div className="p-2.5 rounded-xl border border-primary/30 bg-card shadow-xs space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary">
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Feedback on Step {stepOrder}:</span>
            </div>
            <textarea
              value={commentInput}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder="e.g. Please clarify expected status code or add boundary test data..."
              className="w-full min-h-[64px] p-2.5 text-xs rounded-lg border border-border/60 bg-background text-foreground resize-none focus:outline-none focus:border-primary/70 focus:ring-1 focus:ring-inset focus:ring-primary/40 transition-colors"
              autoFocus
            />
            <div className="flex items-center justify-end gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => {
                  setActiveStepComposer(null);
                  setCommentInput('');
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs bg-primary text-primary-foreground font-medium"
                disabled={!commentInput.trim() || submittingComment}
                onClick={() => handlePostComment(stepOrder)}
              >
                <Send className="h-3 w-3 mr-1" />
                {submittingComment ? 'Posting...' : 'Post Note'}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (totalChanges === 0) {
    return (
      <div className="text-sm text-muted-foreground italic border border-border/50 rounded-2xl p-6 bg-muted/10 text-center">
        No differences detected compared to the baseline version.
      </div>
    );
  }

  return (
    <div className="border border-border/60 rounded-2xl overflow-hidden bg-card shadow-xs">
      {/* Top Header Controls */}
      <div className="flex items-center justify-between p-3.5 bg-muted/30 border-b border-border/40 flex-wrap gap-2">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-semibold hover:text-primary transition-colors cursor-pointer"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <span>
            {isFirstReview
              ? `${after.steps.length} steps in proposed draft`
              : `${totalChanges} change${totalChanges === 1 ? '' : 's'} detected`}
          </span>
          {!isFirstReview && (
            <div className="flex items-center gap-1.5 ml-2 flex-wrap">
              {addedCount > 0 && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-medium">
                  +{addedCount} added
                </span>
              )}
            {removedCount > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-medium">
                -{removedCount} removed
              </span>
            )}
            {modifiedCount > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">
                ~{modifiedCount} modified
              </span>
            )}
            {metadataChangesCount > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 font-medium">
                {metadataChangesCount} metadata
              </span>
            )}
            {stepComments.length > 0 && (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20 font-medium flex items-center gap-1">
                <MessageSquare className="h-3 w-3" />
                {stepComments.length} note{stepComments.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}
      </button>

        {/* View Mode Toggle: Split vs. Unified */}
        {!isCollapsed && !isPureAddOrRemove && (
          <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-lg border border-border/50">
            <button
              type="button"
              onClick={() => setViewMode('split')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer',
                activeViewMode === 'split'
                  ? 'bg-background text-foreground shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Columns className="h-3.5 w-3.5" />
              <span>Side-by-Side</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('unified')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer',
                activeViewMode === 'unified'
                  ? 'bg-background text-foreground shadow-2xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <AlignJustify className="h-3.5 w-3.5" />
              <span>Unified</span>
            </button>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="p-4 space-y-6">
          {/* Metadata Changelog Section if attributes changed */}
          {(titleChanged || priorityChanged || typeChanged || descChanged) && (
            <div className="p-3.5 rounded-xl border border-blue-500/20 bg-blue-500/[0.03] space-y-2 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 block">
                Metadata Changes
              </span>

              {titleChanged && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-muted-foreground min-w-[70px]">Title:</span>
                  <span className="line-through text-rose-500/80">{before?.title}</span>
                  <span className="text-muted-foreground">&rarr;</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{after?.title}</span>
                </div>
              )}

              {priorityChanged && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-muted-foreground min-w-[70px]">Priority:</span>
                  <span className="line-through text-rose-500/80">{before?.priority}</span>
                  <span className="text-muted-foreground">&rarr;</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{after?.priority}</span>
                </div>
              )}

              {typeChanged && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-muted-foreground min-w-[70px]">Type:</span>
                  <span className="line-through text-rose-500/80">{before?.type}</span>
                  <span className="text-muted-foreground">&rarr;</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{after?.type}</span>
                </div>
              )}

              {descChanged && (
                <div className="space-y-1.5 pt-1.5 border-t border-border/30">
                  <span className="font-semibold text-muted-foreground block text-[11px]">Description:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className={cn(
                      "p-2.5 rounded-lg bg-card/60 border border-border/50 text-xs",
                      before?.description ? "text-muted-foreground line-through" : "text-muted-foreground/60 italic"
                    )}>
                      {before?.description || '— No description previously —'}
                    </div>
                    <div className={cn(
                      "p-2.5 rounded-lg bg-card border border-border/50 text-xs",
                      after?.description ? "text-foreground font-medium" : "text-muted-foreground/60 italic"
                    )}>
                      {after?.description || '— No description —'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* SIDE-BY-SIDE SPLIT VIEW MODE */}
          {/* ========================================================================= */}
          {activeViewMode === 'split' && (
            <div className="space-y-6">
              {/* Column Headers */}
              {(preChanged || postChanged || modifiedCount > 0 || addedCount > 0 || removedCount > 0) && (
                <div className="grid grid-cols-2 gap-4 pb-2 border-b border-border/40 font-semibold text-xs text-muted-foreground uppercase tracking-wider">
                  <div className="flex items-center gap-2 text-foreground/80">
                    <span className="h-2 w-2 rounded-full bg-rose-500/80 inline-block" />
                    <span>{baselineLabel}</span>
                  </div>
                  <div className="flex items-center gap-2 text-foreground/80">
                    <span className="h-2 w-2 rounded-full bg-emerald-500/80 inline-block" />
                    <span>{revisionLabel}</span>
                  </div>
                </div>
              )}

              {/* Conditions Side-by-Side */}
              {(preChanged || postChanged) && (
                <div className="space-y-4 pb-4 border-b border-border/30">
                  {preChanged && (
                    <div>
                      <h5 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                        Pre-conditions
                      </h5>
                      <div className="grid grid-cols-2 gap-4">
                        <div
                          className={cn(
                            'p-3.5 rounded-xl text-xs border border-border/60 bg-muted/20 text-foreground',
                            before?.preConditions
                              ? 'border-l-[3px] border-l-rose-500/70'
                              : 'border-dashed border-border/40 text-muted-foreground italic'
                          )}
                        >
                          {before?.preConditions || '— None —'}
                        </div>
                        <div
                          className={cn(
                            'p-3.5 rounded-xl text-xs border border-border/60 bg-card text-foreground font-normal',
                            after?.preConditions
                              ? 'border-l-[3px] border-l-emerald-500/80'
                              : 'border-dashed border-border/40 text-muted-foreground italic'
                          )}
                        >
                          {after?.preConditions || '— None —'}
                        </div>
                      </div>
                    </div>
                  )}

                  {postChanged && (
                    <div>
                      <h5 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1.5">
                        Post-conditions
                      </h5>
                      <div className="grid grid-cols-2 gap-4">
                        <div
                          className={cn(
                            'p-3.5 rounded-xl text-xs border border-border/60 bg-muted/20 text-foreground',
                            before?.postConditions
                              ? 'border-l-[3px] border-l-rose-500/70'
                              : 'border-dashed border-border/40 text-muted-foreground italic'
                          )}
                        >
                          {before?.postConditions || '— None —'}
                        </div>
                        <div
                          className={cn(
                            'p-3.5 rounded-xl text-xs border border-border/60 bg-card text-foreground font-normal',
                            after?.postConditions
                              ? 'border-l-[3px] border-l-emerald-500/80'
                              : 'border-dashed border-border/40 text-muted-foreground italic'
                          )}
                        >
                          {after?.postConditions || '— None —'}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Steps Comparison Side-by-Side */}
              {diffs.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h5 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                      Steps Comparison
                    </h5>
                    <span className="text-[11px] text-muted-foreground font-normal">
                      Hover on any step to leave specific inline notes
                    </span>
                  </div>

                  <div className="space-y-3">
                    {diffs.map((d, i) => {
                      const bExp = d.before?.expectedResult ?? d.before?.expected_result;
                      const aExp = d.after?.expectedResult ?? d.after?.expected_result;
                      const bData = d.before?.data;
                      const aData = d.after?.data;
                      const commentsForStep = stepComments.filter((c) => c.stepOrder === d.displayOrder);

                      if (d.type === 'unchanged') {
                        return (
                          <div
                            key={i}
                            className="p-3.5 rounded-xl border border-border/40 bg-card/40 flex flex-col gap-2 text-xs opacity-75 hover:opacity-100 transition-all group"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                <span className="font-mono font-medium text-muted-foreground shrink-0 mt-0.5">
                                  {d.displayOrder}.
                                </span>
                                <div className="flex-1 min-w-0 space-y-0.5">
                                  <p className="text-foreground/90 font-normal">{d.after!.step}</p>
                                  {aExp && (
                                    <p className="text-[11px] text-muted-foreground">Expected: {aExp}</p>
                                  )}
                                  {aData && (
                                    <p className="text-[11px] text-muted-foreground">Data: {maskSensitiveData(aData)}</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {onAddStepComment && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveStepComposer(activeStepComposer === d.displayOrder ? null : d.displayOrder);
                                      setCommentInput('');
                                    }}
                                    className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-muted transition-all cursor-pointer"
                                  >
                                    <MessageSquarePlus className="h-3 w-3" />
                                    <span>Comment</span>
                                  </button>
                                )}
                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground font-medium">
                                  Unchanged
                                </span>
                              </div>
                            </div>
                            {renderStepCommentsBlock(d.displayOrder)}
                          </div>
                        );
                      }

                      if (d.type === 'removed') {
                        return (
                          <div
                            key={i}
                            className="p-3.5 rounded-xl border border-border/70 border-l-[3px] border-l-rose-500 bg-card/60 dark:bg-zinc-900/40 text-muted-foreground shadow-2xs group relative"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5 min-w-0 flex-1 line-through opacity-75">
                                <span className="font-mono font-bold text-xs text-rose-500 shrink-0 mt-0.5">
                                  {d.before!.order}.
                                </span>
                                <div className="flex-1 min-w-0 space-y-1">
                                  <p className="font-normal text-muted-foreground text-xs sm:text-sm leading-relaxed">
                                    {d.before!.step}
                                  </p>
                                  {bExp && (
                                    <p className="text-xs opacity-75 mt-1">
                                      <span className="font-semibold uppercase text-[10px] tracking-wider mr-1">
                                        Expected:
                                      </span>
                                      {bExp}
                                    </p>
                                  )}
                                   {bData && (
                                     <p className="text-xs opacity-75 mt-0.5">
                                       <span className="font-semibold uppercase text-[10px] tracking-wider mr-1">
                                         Data:
                                       </span>
                                       {maskSensitiveData(bData)}
                                     </p>
                                   )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {onAddStepComment && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveStepComposer(activeStepComposer === d.displayOrder ? null : d.displayOrder);
                                      setCommentInput('');
                                    }}
                                    className="opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-muted transition-all cursor-pointer"
                                  >
                                    <MessageSquarePlus className="h-3 w-3" />
                                    <span>Comment</span>
                                  </button>
                                )}
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                                  − Removed
                                </span>
                              </div>
                            </div>
                            {renderStepCommentsBlock(d.displayOrder)}
                          </div>
                        );
                      }

                      if (d.type === 'added') {
                        return (
                          <div
                            key={i}
                            className={cn(
                              "p-3.5 rounded-xl border border-border/70 bg-card dark:bg-zinc-900/60 shadow-2xs group relative",
                              !isFirstReview && "border-l-[3px] border-l-emerald-500"
                            )}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                <span className={cn(
                                  "font-mono font-bold text-xs shrink-0 mt-0.5",
                                  isFirstReview ? "text-foreground" : "text-emerald-600 dark:text-emerald-400"
                                )}>
                                  {d.displayOrder}.
                                </span>
                                <div className="flex-1 min-w-0 space-y-1">
                                  <p className="font-medium text-foreground text-xs sm:text-sm leading-relaxed">
                                    {d.after!.step}
                                  </p>
                                  {aExp && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      <span className="font-semibold text-foreground/80 uppercase text-[10px] tracking-wider mr-1.5">
                                        Expected:
                                      </span>
                                      {aExp}
                                    </p>
                                  )}
                                   {aData && (
                                     <p className="text-xs text-muted-foreground mt-0.5">
                                       <span className="font-semibold text-foreground/80 uppercase text-[10px] tracking-wider mr-1.5">
                                         Data:
                                       </span>
                                       {maskSensitiveData(aData)}
                                     </p>
                                   )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {onAddStepComment && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveStepComposer(activeStepComposer === d.displayOrder ? null : d.displayOrder);
                                      setCommentInput('');
                                    }}
                                    className={cn(
                                      "flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-all cursor-pointer",
                                      commentsForStep.length > 0
                                        ? "text-primary bg-primary/10 hover:bg-primary/15"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted opacity-80 group-hover:opacity-100"
                                    )}
                                    title="Add inline review comment on this step"
                                  >
                                    <MessageSquarePlus className="h-3 w-3" />
                                    <span className="hidden sm:inline">Comment</span>
                                    {commentsForStep.length > 0 && (
                                      <span className="ml-0.5 font-bold font-mono text-[10px] bg-primary/20 text-primary px-1 rounded-full">
                                        {commentsForStep.length}
                                      </span>
                                    )}
                                  </button>
                                )}
                                {!isFirstReview && (
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                    + Added
                                  </span>
                                )}
                              </div>
                            </div>
                            {renderStepCommentsBlock(d.displayOrder)}
                          </div>
                        );
                      }

                      if (d.type === 'modified') {
                        const stepDiff = d.before!.step !== d.after!.step;
                        const expDiff = bExp !== aExp;
                        const dataDiff = bData !== aData;

                        return (
                          <div
                            key={i}
                            className="p-3.5 rounded-xl border border-border/70 border-l-[3px] border-l-amber-500 bg-card dark:bg-zinc-900/60 shadow-2xs space-y-2 group relative"
                          >
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground font-semibold px-1">
                              <span>Step {d.displayOrder}</span>
                              <div className="flex items-center gap-1.5">
                                {onAddStepComment && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveStepComposer(activeStepComposer === d.displayOrder ? null : d.displayOrder);
                                      setCommentInput('');
                                    }}
                                    className={cn(
                                      "flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-all cursor-pointer",
                                      commentsForStep.length > 0
                                        ? "text-primary bg-primary/10 hover:bg-primary/15"
                                        : "text-muted-foreground hover:text-foreground hover:bg-muted opacity-80 group-hover:opacity-100"
                                    )}
                                  >
                                    <MessageSquarePlus className="h-3 w-3" />
                                    <span>Comment</span>
                                    {commentsForStep.length > 0 && (
                                      <span className="ml-0.5 font-bold font-mono text-[10px] bg-primary/20 text-primary px-1 rounded-full">
                                        {commentsForStep.length}
                                      </span>
                                    )}
                                  </button>
                                )}
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                  ~ Modified
                                </span>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4 text-xs items-stretch">
                              {/* Left: Previous Baseline */}
                              <div className="p-3 rounded-lg border border-border/50 bg-muted/20 text-foreground flex flex-col justify-between h-full">
                                <div className="flex gap-2">
                                  <span className="font-mono font-semibold w-5 shrink-0 text-muted-foreground mt-0.5">
                                    {d.before!.order}.
                                  </span>
                                  <div className="flex-1 min-w-0 space-y-1.5">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                                      Before:
                                    </span>
                                    <p className="text-foreground/90 leading-relaxed">
                                      {renderWordDiff(d.before!.step, d.after!.step, 'before')}
                                    </p>
                                    {bExp && (
                                      <div className="text-[11px] pl-2 border-l border-border/60">
                                        <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                                          Expected:
                                        </span>
                                        <p className="text-muted-foreground">
                                          {renderWordDiff(bExp, aExp || '', 'before')}
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {bData && (
                                  <div className="text-[11px] pl-7 pt-1.5 border-t border-border/30 mt-2">
                                    <span className="text-[10px] uppercase font-semibold text-muted-foreground mr-1.5">
                                      Data:
                                    </span>
                                    <span className={cn(dataDiff ? "line-through text-rose-500/80" : "text-muted-foreground")}>
                                      {bData}
                                    </span>
                                  </div>
                                )}
                              </div>

                              {/* Right: New Revision */}
                              <div className="p-3 rounded-lg border border-border/50 bg-card text-foreground flex flex-col justify-between h-full">
                                <div className="flex gap-2">
                                  <span className="font-mono font-bold w-5 shrink-0 text-foreground mt-0.5">
                                    {d.displayOrder}.
                                  </span>
                                  <div className="flex-1 min-w-0 space-y-1.5">
                                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                                      After:
                                    </span>
                                    <p className="text-foreground leading-relaxed">
                                      {renderWordDiff(d.before!.step, d.after!.step, 'after')}
                                    </p>
                                    {aExp && (
                                      <div className="text-[11px] pl-2 border-l border-border/60">
                                        <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
                                          Expected:
                                        </span>
                                        <p className="text-muted-foreground">
                                          {renderWordDiff(bExp || '', aExp, 'after')}
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {aData && (
                                  <div className="text-[11px] pl-7 pt-1.5 border-t border-border/30 mt-2">
                                    <span className="text-[10px] uppercase font-semibold text-muted-foreground mr-1.5">
                                      Data:
                                    </span>
                                    <span className={cn(dataDiff ? "font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/20" : "text-foreground")}>
                                      {aData}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {renderStepCommentsBlock(d.displayOrder)}
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ========================================================================= */}
          {/* UNIFIED INLINE VIEW MODE */}
          {/* ========================================================================= */}
          {activeViewMode === 'unified' && (
            <div className="space-y-5">
              {(preChanged || postChanged) && (
                <div className="space-y-3 pb-3 border-b border-border/30">
                  {preChanged && (
                    <div className="space-y-1.5">
                      <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Pre-conditions
                      </h5>
                      <div className="text-xs space-y-1">
                        {before?.preConditions && (
                          <div className="p-2.5 rounded-lg bg-card/60 border border-border/60 border-l-[3px] border-l-rose-500/70 text-muted-foreground line-through opacity-80">
                            {before.preConditions}
                          </div>
                        )}
                        {after?.preConditions && (
                          <div className="p-2.5 rounded-lg bg-card border border-border/60 border-l-[3px] border-l-emerald-500/80 text-foreground font-normal">
                            {after.preConditions}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {postChanged && (
                    <div className="space-y-1.5">
                      <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Post-conditions
                      </h5>
                      <div className="text-xs space-y-1">
                        {before?.postConditions && (
                          <div className="p-2.5 rounded-lg bg-card/60 border border-border/60 border-l-[3px] border-l-rose-500/70 text-muted-foreground line-through opacity-80">
                            {before.postConditions}
                          </div>
                        )}
                        {after?.postConditions && (
                          <div className="p-2.5 rounded-lg bg-card border border-border/60 border-l-[3px] border-l-emerald-500/80 text-foreground font-normal">
                            {after.postConditions}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {diffs.length > 0 && (
                <div className="space-y-2.5">
                  <h5 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Steps Diff
                  </h5>
                  <div className="space-y-2">
                    {diffs.map((d, i) => {
                      const bExp = d.before?.expectedResult ?? d.before?.expected_result;
                      const aExp = d.after?.expectedResult ?? d.after?.expected_result;
                      const bData = d.before?.data;
                      const aData = d.after?.data;
                      const commentsForStep = stepComments.filter((c) => c.stepOrder === d.displayOrder);

                      if (d.type === 'unchanged') {
                        return (
                          <div
                            key={i}
                            className="p-2.5 rounded-lg border border-border/30 bg-muted/10 space-y-2 text-xs opacity-70 hover:opacity-100 transition-all group"
                          >
                            <div className="flex items-start justify-between gap-2.5">
                              <div className="flex gap-2.5 flex-1 min-w-0">
                                <span className="w-5 font-mono text-xs font-medium text-muted-foreground shrink-0">{d.displayOrder}.</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-foreground/90">{d.after!.step}</p>
                                  {aExp && <p className="text-[11px] text-muted-foreground mt-0.5">Exp: {aExp}</p>}
                                </div>
                              </div>
                              {onAddStepComment && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveStepComposer(activeStepComposer === d.displayOrder ? null : d.displayOrder);
                                    setCommentInput('');
                                  }}
                                  className="opacity-0 group-hover:opacity-100 text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-all cursor-pointer shrink-0"
                                >
                                  <MessageSquarePlus className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                            {renderStepCommentsBlock(d.displayOrder)}
                          </div>
                        );
                      }

                      if (d.type === 'removed') {
                        return (
                          <div
                            key={i}
                            className="p-3 rounded-xl border border-border/60 border-l-[3px] border-l-rose-500 bg-card/60 text-xs shadow-2xs space-y-2 group"
                          >
                            <div className="flex items-start justify-between gap-2.5">
                              <div className="flex gap-2.5 flex-1 min-w-0 line-through opacity-75">
                                <MinusCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
                                <span className="w-5 font-mono text-xs">{d.before!.order}.</span>
                                <div className="flex-1">
                                  <p>{d.before!.step}</p>
                                  {bExp && <p className="text-[11px] opacity-80 mt-0.5">Expected: {bExp}</p>}
                                  {bData && <p className="text-[11px] opacity-80">Data: {bData}</p>}
                                </div>
                              </div>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 shrink-0">
                                − Removed
                              </span>
                            </div>
                            {renderStepCommentsBlock(d.displayOrder)}
                          </div>
                        );
                      }

                      if (d.type === 'added') {
                        return (
                          <div
                            key={i}
                            className={cn(
                              "p-3 rounded-xl border border-border/60 bg-card text-xs shadow-2xs space-y-2 group",
                              !isFirstReview && "border-l-[3px] border-l-emerald-500"
                            )}
                          >
                            <div className="flex items-start justify-between gap-2.5">
                              <div className="flex gap-2.5 flex-1 min-w-0">
                                <span className={cn(
                                  "w-5 font-mono text-xs font-bold",
                                  isFirstReview ? "text-foreground" : "text-emerald-600 dark:text-emerald-400"
                                )}>
                                  {d.displayOrder}.
                                </span>
                                <div className="flex-1">
                                  <p className="font-medium text-foreground text-xs sm:text-sm">{d.after!.step}</p>
                                  {aExp && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      <span className="font-semibold text-foreground/80 uppercase text-[10px] mr-1">Expected:</span>
                                      {aExp}
                                    </p>
                                  )}
                                  {aData && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      <span className="font-semibold text-foreground/80 uppercase text-[10px] mr-1">Data:</span>
                                      {aData}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {onAddStepComment && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveStepComposer(activeStepComposer === d.displayOrder ? null : d.displayOrder);
                                      setCommentInput('');
                                    }}
                                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-all cursor-pointer"
                                  >
                                    <MessageSquarePlus className="h-3 w-3" />
                                    <span className="hidden sm:inline">Comment</span>
                                  </button>
                                )}
                                {!isFirstReview && (
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                                    + Added
                                  </span>
                                )}
                              </div>
                            </div>
                            {renderStepCommentsBlock(d.displayOrder)}
                          </div>
                        );
                      }

                      if (d.type === 'modified') {
                        return (
                          <div
                            key={i}
                            className="p-3 rounded-xl border border-border/60 border-l-[3px] border-l-amber-500 bg-card text-xs shadow-2xs space-y-2 group"
                          >
                            <div className="flex items-start justify-between gap-2.5">
                              <div className="flex gap-2.5 flex-1 min-w-0">
                                <Edit3 className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                                <span className="w-5 font-mono text-xs font-bold text-foreground">{d.displayOrder}.</span>
                                <div className="flex-1 space-y-1.5">
                                  {d.before!.step !== d.after!.step ? (
                                    <div className="space-y-0.5">
                                      <p className="text-muted-foreground text-xs leading-relaxed">
                                        {renderWordDiff(d.before!.step, d.after!.step, 'before')}
                                      </p>
                                      <p className="text-foreground font-medium text-xs sm:text-sm leading-relaxed">
                                        {renderWordDiff(d.before!.step, d.after!.step, 'after')}
                                      </p>
                                    </div>
                                  ) : (
                                    <p className="text-foreground font-medium">{d.after!.step}</p>
                                  )}

                                  {bExp !== aExp && (
                                    <div className="pl-2 border-l border-border/60 text-[11px] space-y-0.5">
                                      <span className="text-[10px] uppercase font-semibold text-muted-foreground block">Expected:</span>
                                      <p className="text-muted-foreground">
                                        {renderWordDiff(bExp || '', aExp || '', 'before')}
                                      </p>
                                      <p className="text-foreground">
                                        {renderWordDiff(bExp || '', aExp || '', 'after')}
                                      </p>
                                    </div>
                                  )}

                                  {bData !== aData && (
                                    <div className="pl-2 border-l border-border/60 text-[11px] flex items-center gap-2">
                                      <span className="text-[10px] uppercase font-semibold text-muted-foreground">Data:</span>
                                      {bData && <span className="line-through text-rose-500/80">{bData}</span>}
                                      {bData && aData && <span className="text-muted-foreground">&rarr;</span>}
                                      {aData && <span className="font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded border border-emerald-500/20">{aData}</span>}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {onAddStepComment && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveStepComposer(activeStepComposer === d.displayOrder ? null : d.displayOrder);
                                      setCommentInput('');
                                    }}
                                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-all cursor-pointer"
                                  >
                                    <MessageSquarePlus className="h-3 w-3" />
                                    <span className="hidden sm:inline">Comment</span>
                                  </button>
                                )}
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                  ~ Modified
                                </span>
                              </div>
                            </div>
                            {renderStepCommentsBlock(d.displayOrder)}
                          </div>
                        );
                      }

                      return null;
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
