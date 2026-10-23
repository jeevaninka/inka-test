'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import {
  approveReviewAction,
  requestChangesOnReviewAction,
  getActiveReviewRequestAction,
  getReviewDiffAction,
  cancelReviewAction,
  assignReviewAction,
  adminForceApproveAction,
  updateReviewSnapshotAction,
  discardWorkingChangesAction,
} from '@/app/actions/reviews';
import {
  createCommentAction,
  getCommentsAction,
  resolveCommentAction,
  deleteCommentAction,
  updateCommentAction,
} from '@/app/actions/comments';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import DOMPurify from 'isomorphic-dompurify';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Clock,
  RotateCcw,
  ExternalLink,
  MessageSquare,
  MessageSquarePlus,
  Send,
  X,
  ChevronDown,
  ChevronRight,
  Columns,
  AlignJustify,
  UserCheck,
  Check,
  CornerDownRight,
  Sparkles,
  Trash2,
  ArrowRight,
  FastForward,
  AlertTriangle,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, maskSensitiveData } from '@/lib/utils';
import { formatDistanceToNow, format } from 'date-fns';
import { runReviewPreflightChecks, type PreflightIssue } from '@/lib/reviews/preflight';

interface Step {
  order: number;
  step: string;
  expectedResult?: string | null;
  expected_result?: string | null;
  data?: string | null;
  imageUrl?: string | null;
  image_url?: string | null;
}

interface AlignedDiff {
  type: 'added' | 'removed' | 'modified' | 'unchanged';
  displayOrder: number;
  before?: Step;
  after?: Step;
}

interface StepCommentItem {
  id: string;
  stepOrder: number;
  authorId: number;
  authorName: string;
  authorImage?: string | null;
  authorColor?: string | null;
  authorInitials?: string | null;
  body: string;
  createdAt: string;
  resolved?: boolean;
  parentId?: string | null;
  replies?: StepCommentItem[];
}

function computeStringSimilarity(strA: string, strB: string): number {
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

function alignSteps(beforeSteps: Step[], afterSteps: Step[]): AlignedDiff[] {
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
        dp[i + 1][j + 1] = Math.max(dp[i][j] + matchScore, dp[i + 1][j], dp[i][j + 1]);
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

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

function renderTrackChanges(
  oldText?: string | null,
  newText?: string | null,
  highlightColor: 'amber' | 'emerald' = 'amber'
) {
  if (!oldText && !newText) return null;
  if (!oldText) {
    return (
      <span className={highlightColor === 'amber' ? 'text-amber-500 font-semibold' : 'text-emerald-500 font-semibold'}>
        {newText}
      </span>
    );
  }
  if (!newText) {
    return <span className="line-through text-muted-foreground/60">{oldText}</span>;
  }
  if (oldText === newText) {
    return <span>{newText}</span>;
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

  let i = n;
  let j = m;
  const matchedOld = new Set<number>();
  const matchedNew = new Set<number>();
  while (i > 0 && j > 0) {
    if (oldTokens[i - 1].toLowerCase() === newTokens[j - 1].toLowerCase()) {
      matchedOld.add(i - 1);
      matchedNew.add(j - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const removedTokens: string[] = [];
  oldTokens.forEach((tok, idx) => {
    if (!matchedOld.has(idx) && !/^\s+$/.test(tok)) {
      removedTokens.push(tok);
    }
  });

  return (
    <>
      {removedTokens.length > 0 && (
        <span className="line-through text-zinc-500 dark:text-zinc-400 mr-1.5 select-none font-normal">
          {removedTokens.join(' ')}
        </span>
      )}
      {newTokens.map((tok, idx) => {
        if (matchedNew.has(idx) || /^\s+$/.test(tok)) {
          return <span key={idx}>{tok}</span>;
        }
        return (
          <span
            key={idx}
            className={cn(
              "font-bold px-0.5 rounded",
              highlightColor === 'amber'
                ? "text-amber-800 dark:text-amber-300 bg-amber-500/15"
                : "text-emerald-800 dark:text-emerald-300 bg-emerald-500/15"
            )}
          >
            {tok}
          </span>
        );
      })}
    </>
  );
}

export function CaseReviewPageView({
  slug,
  caseIdParam,
}: {
  slug: string;
  caseIdParam: string;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const { project, cases: allCases, members, currentUser } = useProjectData();
  const currentUserId = session?.user ? (session.user as any).id : null;

  // Resolve case from allCases by id or displayId
  const testCase = useMemo(() => {
    return allCases.find((c) => c.id === caseIdParam || c.displayId === caseIdParam);
  }, [allCases, caseIdParam]);

  const targetCaseId = testCase?.id || caseIdParam;

  const searchParams = useSearchParams();
  const stepParam = searchParams.get('step');

  const [loading, setLoading] = useState(true);
  const [diffData, setDiffData] = useState<any>(null);
  const [activeReviewRequest, setActiveReviewRequest] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [reviewNotesFilter, setReviewNotesFilter] = useState<'current' | 'all'>('current');
  const [decisionComment, setDecisionComment] = useState('');

  // View preferences
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [showAllUnchanged, setShowAllUnchanged] = useState(false);
  const [unmaskedDataKeys, setUnmaskedDataKeys] = useState<Set<string>>(new Set());
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchorIndex, setMentionAnchorIndex] = useState<number>(-1);

  // Action states
  const [showRequestChangesDialog, setShowRequestChangesDialog] = useState(false);
  const [requestChangesFeedback, setRequestChangesFeedback] = useState('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    open: boolean;
    title: string;
    description: React.ReactNode;
    confirmLabel: string;
    onConfirm: () => void;
    variant?: 'default' | 'destructive';
  } | null>(null);

  // Reply inputs
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null);

  // Split view side-by-side comments panel state (unified, collapsible, default open)
  const [isCommentsPanelOpen, setIsCommentsPanelOpen] = useState<boolean>(true);
  const [activeCommentStepOrder, setActiveCommentStepOrder] = useState<number | null>(null);
  const [expandedResolvedIds, setExpandedResolvedIds] = useState<Set<string>>(new Set());
  const [showApproveDropdown, setShowApproveDropdown] = useState(false);
  const approveDropdownRef = useRef<HTMLDivElement>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [sidePanelInput, setSidePanelInput] = useState('');
  const [isPostingSidePanel, setIsPostingSidePanel] = useState(false);
  const didAutoOpenStepRef = useRef(false);

  useEffect(() => {
    if (!showApproveDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (approveDropdownRef.current && !approveDropdownRef.current.contains(e.target as Node)) {
        setShowApproveDropdown(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowApproveDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showApproveDropdown]);

  // Load review diff, active review request, and comments
  const loadData = async () => {
    if (!targetCaseId) return;
    setLoading(true);
    try {
      const [diff, req, caseComments] = await Promise.all([
        getReviewDiffAction(targetCaseId),
        getActiveReviewRequestAction(targetCaseId),
        getCommentsAction(targetCaseId, 'case'),
      ]);
      setDiffData(diff);
      setActiveReviewRequest(req);
      setComments(caseComments || []);
    } catch (err: any) {
      toast.error('Failed to load review workspace: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const handleUpdate = () => loadData();
    window.addEventListener('review-updated', handleUpdate);
    return () => window.removeEventListener('review-updated', handleUpdate);
  }, [targetCaseId]);

  // Derived authorship & role state
  const reqAuthorId = activeReviewRequest
    ? String(activeReviewRequest.requestedById ?? activeReviewRequest.requested_by ?? activeReviewRequest.requester?.id ?? '')
    : '';
  const reqAssigneeId = activeReviewRequest
    ? String(activeReviewRequest.assignedToId ?? activeReviewRequest.assigned_to ?? activeReviewRequest.assignee?.id ?? '')
    : '';

  const isReviewRequester = Boolean(
    currentUserId && reqAuthorId && String(currentUserId) === reqAuthorId
  );

  const isAuthor = activeReviewRequest
    ? isReviewRequester
    : Boolean(currentUserId && testCase?.createdBy && String(testCase.createdBy) === String(currentUserId));

  const isReviewer = Boolean(
    currentUserId && reqAssigneeId && String(currentUserId) === reqAssigneeId && !isReviewRequester
  );

  const isUnassigned = Boolean(
    activeReviewRequest && !reqAssigneeId && !isAuthor
  );

  const isAssignedToOther = Boolean(
    activeReviewRequest && reqAssigneeId && !isReviewer && !isAuthor
  );
  const isAdmin = Boolean(
    String((currentUser as any)?.role || '').toLowerCase() === 'admin' ||
    String((currentUser as any)?.role || '').toLowerCase() === 'owner' ||
    members.some((m) => m.userId === currentUserId && (String(m.role || '').toLowerCase() === 'admin' || String(m.role || '').toLowerCase() === 'owner'))
  );
  const reviewRequired = Boolean((project as any)?.reviewRequired);
  const canSkipReview = Boolean(isAdmin || !reviewRequired);

  const handleSkipReviewAndPublish = async () => {
    setIsSubmittingAction(true);
    try {
      await adminForceApproveAction(targetCaseId);
      toast.success('Review bypassed and test case published as Active');
      window.dispatchEvent(new CustomEvent('review-updated'));
      router.push(`/p/${slug}/repository/${testCase?.displayId || targetCaseId}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to publish test case');
      setIsSubmittingAction(false);
    }
  };

  const confirmPublishNow = () => {
    setConfirmConfig({
      open: true,
      title: 'Publish Now (Bypass Review)',
      description: 'This will bypass peer review and immediately publish this test case as Active in the repository.',
      confirmLabel: 'Publish Now',
      variant: 'default',
      onConfirm: handleSkipReviewAndPublish,
    });
  };

  const handleSaveEditComment = async (commentId: string, stepOrder?: number) => {
    if (!editingCommentBody.trim()) {
      toast.error('Comment cannot be empty');
      return;
    }
    try {
      const targetStep = stepOrder ?? activeCommentStepOrder;
      const cleaned = editingCommentBody.trim().replace(/^\[Step\s+\d+\]\s*/i, '');
      const updatedBody = targetStep ? `[Step ${targetStep}] ${cleaned}` : cleaned;
      await updateCommentAction(commentId, updatedBody);
      toast.success('Comment updated');
      setEditingCommentId(null);
      setEditingCommentBody('');
      const updated = await getCommentsAction(targetCaseId, 'case');
      setComments(updated || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to update comment');
    }
  };

  const handlePostSidePanelNote = async (targetStepOrder?: number) => {
    const stepOrderToUse = targetStepOrder ?? activeCommentStepOrder;
    if (!sidePanelInput.trim() || !currentUserId || stepOrderToUse === null) return;
    setIsPostingSidePanel(true);
    try {
      const existingRootForStep = stepComments.find((c) => c.stepOrder === stepOrderToUse);
      const body = `[Step ${stepOrderToUse}] ${sidePanelInput.trim()}`;

      await createCommentAction({
        project_id: project?.id || '',
        entity_type: 'case',
        entity_id: targetCaseId,
        parent_id: existingRootForStep ? existingRootForStep.id : undefined,
        body,
      });
      setSidePanelInput('');
      setActiveCommentStepOrder(null);
      toast.success(existingRootForStep ? `Reply added to Step ${stepOrderToUse}` : `Note added for Step ${stepOrderToUse}`);
      const updated = await getCommentsAction(targetCaseId, 'case');
      setComments(updated || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to post note');
    } finally {
      setIsPostingSidePanel(false);
    }
  };

  const handleAssignToMe = async () => {
    if (!activeReviewRequest?.id || !currentUserId) return;
    setIsSubmittingAction(true);
    try {
      await assignReviewAction(activeReviewRequest.id, currentUserId);
      toast.success('Assigned review to yourself');
      window.dispatchEvent(new CustomEvent('review-updated'));
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to claim review');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handlePushWorkingEditsToReview = async () => {
    setIsSubmittingAction(true);
    try {
      await updateReviewSnapshotAction(targetCaseId);
      toast.success('Review updated with latest working edits');
      window.dispatchEvent(new CustomEvent('review-updated'));
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update review');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleDiscardWorkingEdits = async () => {
    setIsSubmittingAction(true);
    try {
      await discardWorkingChangesAction(targetCaseId);
      toast.success('Working edits discarded, restored review snapshot');
      window.dispatchEvent(new CustomEvent('review-updated'));
      await loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to discard changes');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Map step comments hierarchy with review cycle scoping
  const { currentCycleStepComments, pastCycleStepComments, allStepComments } = useMemo(() => {
    const parentComments = comments.filter((c: any) => !c.parent_id && !c.deleted_at);
    const reviewStartTime = activeReviewRequest?.createdAt
      ? new Date(activeReviewRequest.createdAt).getTime() - 60000
      : 0;

    const mapped = parentComments
      .map((c: any) => {
        const match = (c.body || '').match(/^\[Step\s+(\d+)\]\s*([\s\S]*)/i);
        if (!match) return null;
        const stepNum = parseInt(match[1], 10);
        const childReplies: StepCommentItem[] = (c.replies || [])
          .filter((r: any) => !r.deleted_at)
          .map((r: any) => ({
            id: r.id,
            stepOrder: stepNum,
            authorId: r.author?.id ?? r.author_id,
            authorName: r.author?.name || r.author?.email || 'User',
            authorImage: r.author?.image,
            authorColor: r.author?.avatar_color ?? null,
            authorInitials: r.author?.avatar_initials ?? null,
            body: r.body.replace(/^\[Step\s+\d+\]\s*/i, '').trim(),
            createdAt: r.created_at || r.createdAt,
            parentId: c.id,
          }));

        const isCurrentCycle = reviewStartTime === 0 || (new Date(c.created_at || c.createdAt).getTime() >= reviewStartTime);

        return {
          id: c.id,
          stepOrder: stepNum,
          authorId: c.author?.id ?? c.author_id,
          authorName: c.author?.name || c.author?.email || 'User',
          authorImage: c.author?.image,
          authorColor: c.author?.avatar_color ?? null,
          authorInitials: c.author?.avatar_initials ?? null,
          body: match[2].trim(),
          createdAt: c.created_at || c.createdAt,
          resolved: c.resolved,
          replies: childReplies,
          isCurrentCycle,
        };
      })
      .filter(Boolean) as (StepCommentItem & { isCurrentCycle: boolean })[];

    return {
      currentCycleStepComments: mapped.filter((c) => c.isCurrentCycle),
      pastCycleStepComments: mapped.filter((c) => !c.isCurrentCycle),
      allStepComments: mapped,
    };
  }, [comments, activeReviewRequest?.createdAt]);

  const stepComments = useMemo(() => {
    if (reviewNotesFilter === 'all') return allStepComments;
    return currentCycleStepComments;
  }, [reviewNotesFilter, allStepComments, currentCycleStepComments]);

  const totalOpenComments = useMemo(() => {
    return currentCycleStepComments.filter((c) => !c.resolved).length;
  }, [currentCycleStepComments]);

  // Step diff alignment & runs
  const beforeSteps = diffData?.before?.steps || [];
  const afterSteps = diffData?.after?.steps || [];
  const diffs = useMemo(() => alignSteps(beforeSteps, afterSteps), [beforeSteps, afterSteps]);

  const preflightIssues: PreflightIssue[] = useMemo(() => {
    if (Array.isArray(diffData?.preflightIssues)) {
      return diffData.preflightIssues;
    }
    if (!afterSteps || afterSteps.length === 0) return [];
    return runReviewPreflightChecks({
      steps: afterSteps,
      preConditions: diffData?.after?.preConditions,
    });
  }, [diffData?.preflightIssues, afterSteps, diffData?.after?.preConditions]);

  const [showPreflightDetails, setShowPreflightDetails] = useState(true);
  const [postingPreflightId, setPostingPreflightId] = useState<string | null>(null);

  // Count changes
  let addedCount = 0;
  let removedCount = 0;
  let modifiedCount = 0;
  let unchangedCount = 0;

  diffs.forEach((d) => {
    if (d.type === 'added') addedCount++;
    if (d.type === 'removed') removedCount++;
    if (d.type === 'modified') modifiedCount++;
    if (d.type === 'unchanged') unchangedCount++;
  });

  const preChanged =
    (diffData?.before?.preConditions || '').trim() !== (diffData?.after?.preConditions || '').trim();
  const postChanged =
    (diffData?.before?.postConditions || '').trim() !== (diffData?.after?.postConditions || '').trim();
  const titleChanged = Boolean(
    diffData?.before?.title &&
    diffData?.after?.title &&
    diffData.before.title.trim() !== diffData.after.title.trim()
  );
  const priorityChanged = Boolean(
    diffData?.before?.priority &&
    diffData?.after?.priority &&
    diffData.before.priority !== diffData.after.priority
  );
  const typeChanged = Boolean(
    diffData?.before?.type &&
    diffData?.after?.type &&
    diffData.before.type !== diffData.after.type
  );
  const descChanged = Boolean(
    diffData?.before?.description !== undefined &&
    diffData?.after?.description !== undefined &&
    (diffData.before.description || '').trim() !== (diffData.after.description || '').trim()
  );

  const metadataChangesCount =
    (preChanged ? 1 : 0) +
    (postChanged ? 1 : 0) +
    (titleChanged ? 1 : 0) +
    (priorityChanged ? 1 : 0) +
    (typeChanged ? 1 : 0) +
    (descChanged ? 1 : 0);

  const totalChanges = addedCount + removedCount + modifiedCount + metadataChangesCount;

  const changesSummary = useMemo(() => {
    const parts: string[] = [];
    if (addedCount > 0) parts.push(`+${addedCount} step${addedCount > 1 ? 's' : ''} added`);
    if (modifiedCount > 0) parts.push(`${modifiedCount} step${modifiedCount > 1 ? 's' : ''} modified`);
    if (removedCount > 0) parts.push(`-${removedCount} step${removedCount > 1 ? 's' : ''} removed`);
    if (descChanged) parts.push('Description updated');
    if (preChanged) parts.push('Pre-conditions updated');
    if (postChanged) parts.push('Post-conditions updated');

    return parts.length > 0 ? parts.join(' · ') : 'No changes detected';
  }, [addedCount, modifiedCount, removedCount, descChanged, preChanged, postChanged]);

  // Track expanded unchanged steps (individual collapse)
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [overallCommentInput, setOverallCommentInput] = useState('');
  const [isSubmittingOverall, setIsSubmittingOverall] = useState(false);

  const totalReviewCommentsCount = stepComments.length;
  const unresolvedReviewCommentsCount = stepComments.filter((c) => !c.resolved).length;

  const visibleCommentStepOrders = useMemo(() => {
    return Array.from(
      new Set([
        ...stepComments.map((c) => c.stepOrder),
        ...(activeCommentStepOrder !== null ? [activeCommentStepOrder] : []),
      ])
    ).sort((a, b) => a - b);
  }, [stepComments, activeCommentStepOrder]);

  const isPanelVisible = isCommentsPanelOpen && visibleCommentStepOrders.length > 0;

  const changedDiffs = useMemo(() => diffs.filter((d) => d.type !== 'unchanged'), [diffs]);
  const unchangedDiffs = useMemo(() => diffs.filter((d) => d.type === 'unchanged'), [diffs]);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-foreground/30', 'ring-offset-2');
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-foreground/30', 'ring-offset-2');
      }, 2000);
    }
  };

  const toggleStepExpand = (stepOrder: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepOrder)) next.delete(stepOrder);
      else next.add(stepOrder);
      return next;
    });
  };

  useEffect(() => {
    if (loading || didAutoOpenStepRef.current) return;
    if (stepParam) {
      const stepNum = parseInt(stepParam, 10);
      if (!isNaN(stepNum)) {
        didAutoOpenStepRef.current = true;
        setIsCommentsPanelOpen(true);
        setActiveCommentStepOrder(stepNum);
        setExpandedSteps((prev) => new Set(prev).add(stepNum));
        setTimeout(() => {
          const el = document.getElementById(`review-change-step-${stepNum}`);
          if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 350);
        return;
      }
    }
    if (stepComments.length > 0) {
      didAutoOpenStepRef.current = true;
      setIsCommentsPanelOpen(true);
    }
  }, [stepParam, loading, stepComments]);

  const handlePostOverallComment = async () => {
    if (!overallCommentInput.trim() || !targetCaseId) return;
    setIsSubmittingOverall(true);
    try {
      await createCommentAction({
        project_id: project?.id || '',
        entity_type: 'case',
        entity_id: targetCaseId,
        body: overallCommentInput.trim(),
      });
      toast.success('Discussion comment posted');
      setOverallCommentInput('');
      const refreshed = await getCommentsAction(targetCaseId, 'case');
      setComments(refreshed || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to post comment');
    } finally {
      setIsSubmittingOverall(false);
    }
  };

  const handlePostOverallDecisionComment = async () => {
    if (!decisionComment.trim() || !targetCaseId) return;
    setIsSubmittingOverall(true);
    try {
      await createCommentAction({
        project_id: project?.id || '',
        entity_type: 'case',
        entity_id: targetCaseId,
        body: decisionComment.trim(),
      });
      toast.success('Comment posted');
      setDecisionComment('');
      const refreshed = await getCommentsAction(targetCaseId, 'case');
      setComments(refreshed || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to post comment');
    } finally {
      setIsSubmittingOverall(false);
    }
  };

  const handleApproveWithComment = async () => {
    if (!activeReviewRequest?.id) return;
    setIsSubmittingAction(true);
    try {
      if (isUnassigned && currentUserId) {
        await assignReviewAction(activeReviewRequest.id, currentUserId).catch(() => {});
      }
      if (decisionComment.trim()) {
        await createCommentAction({
          project_id: project?.id || '',
          entity_type: 'case',
          entity_id: targetCaseId,
          body: decisionComment.trim(),
        });
      }
      await approveReviewAction(activeReviewRequest.id);
      toast.success('Review approved and test case published as Active');
      window.dispatchEvent(new CustomEvent('review-updated'));
      router.push(`/p/${slug}/reviews`);
    } catch (e: any) {
      if (e.message?.includes('cannot approve your own review')) {
        try {
          await adminForceApproveAction(targetCaseId);
          toast.success('Review approved as Project Admin');
          window.dispatchEvent(new CustomEvent('review-updated'));
          router.push(`/p/${slug}/reviews`);
          return;
        } catch (inner: any) {
          toast.error(inner.message || e.message);
        }
      } else {
        toast.error(e.message || 'Failed to approve review');
      }
      setIsSubmittingAction(false);
    }
  };

  const handleRequestChangesWithComment = async () => {
    if (!activeReviewRequest?.id) return;
    const unresolvedNotes = stepComments.filter((c) => !c.resolved);
    let finalFeedback = decisionComment.trim() || requestChangesFeedback.trim();

    if (!finalFeedback && unresolvedNotes.length > 0) {
      const summary = unresolvedNotes.map((s) => `Step ${s.stepOrder}: ${s.body}`).join('; ');
      finalFeedback = `Please address feedback on ${unresolvedNotes.length} step(s): ${summary}`;
    }

    if (!finalFeedback) {
      setShowRequestChangesDialog(true);
      return;
    }

    setIsSubmittingAction(true);
    try {
      await requestChangesOnReviewAction(activeReviewRequest.id, finalFeedback);
      toast.success('Changes requested');
      window.dispatchEvent(new CustomEvent('review-updated'));
      router.push(`/p/${slug}/reviews`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to request changes');
      setIsSubmittingAction(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!activeReviewRequest?.id) return;
    const unresolvedNotes = stepComments.filter((c) => !c.resolved);
    let finalFeedback = requestChangesFeedback.trim();

    if (!finalFeedback && unresolvedNotes.length > 0) {
      const summary = unresolvedNotes.map((s) => `Step ${s.stepOrder}: ${s.body}`).join('; ');
      finalFeedback = `Please address feedback on ${unresolvedNotes.length} step(s): ${summary}`;
    }

    if (!finalFeedback) {
      toast.error('Please enter feedback or leave step comments explaining the changes needed');
      return;
    }

    setIsSubmittingAction(true);
    try {
      await requestChangesOnReviewAction(activeReviewRequest.id, finalFeedback);
      toast.success('Changes requested');
      setShowRequestChangesDialog(false);
      setRequestChangesFeedback('');
      window.dispatchEvent(new CustomEvent('review-updated'));
      router.push(`/p/${slug}/reviews`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to request changes');
      setIsSubmittingAction(false);
    }
  };

  const handleWithdrawReview = async () => {
    if (!targetCaseId) return;
    setIsSubmittingAction(true);
    try {
      await cancelReviewAction(targetCaseId);
      toast.success('Review request withdrawn and returned to draft');
      window.dispatchEvent(new CustomEvent('review-updated'));
      router.push(`/p/${slug}/repository/${testCase?.displayId || targetCaseId}`);
    } catch (e: any) {
      toast.error(e.message || 'Failed to withdraw review');
      setIsSubmittingAction(false);
    }
  };

  // Step comment operations
  const handlePostReply = async (commentId: string, stepOrder: number) => {
    const text = (replyInputs[commentId] || '').trim();
    if (!text || !targetCaseId) return;
    try {
      await createCommentAction({
        project_id: project?.id || '',
        entity_type: 'case',
        entity_id: targetCaseId,
        parent_id: commentId,
        body: `[Step ${stepOrder}] ${text}`,
      });
      toast.success('Reply posted');
      setReplyInputs((prev) => ({ ...prev, [commentId]: '' }));
      setActiveReplyId(null);
      const refreshed = await getCommentsAction(targetCaseId, 'case');
      setComments(refreshed || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to post reply');
    }
  };

  const handleResolveComment = async (commentId: string) => {
    try {
      await resolveCommentAction(commentId);
      toast.success('Note updated');
      const refreshed = await getCommentsAction(targetCaseId, 'case');
      setComments(refreshed || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update note');
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await deleteCommentAction(commentId);
      toast.success('Note deleted');
      const refreshed = await getCommentsAction(targetCaseId, 'case');
      setComments(refreshed || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete note');
    }
  };

  // Helper to safely format comment body without leaking raw HTML tags (<p>...</p>) and with @mentions and URL highlighting
  const renderCommentContent = (bodyText: string) => {
    if (!bodyText) return null;
    const trimmed = bodyText.trim();
    if (/<[a-z][\s\S]*>/i.test(trimmed)) {
      const linkifiedHtml = trimmed.replace(
        /(?<!href=["'])(https?:\/\/[^\s<>"']+)/gi,
        '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline break-all">$1</a>'
      );
      return (
        <div
          className="text-xs text-foreground/90 leading-relaxed prose prose-xs dark:prose-invert max-w-none [&>p]:mb-1 [&>p:last-child]:mb-0 font-sans"
          dangerouslySetInnerHTML={{
            __html: DOMPurify.sanitize(linkifiedHtml, {
              ALLOWED_TAGS: ['p', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'code', 'pre', 'span', 'br', 'blockquote'],
              ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
              ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
            }),
          }}
        />
      );
    }
    const tokenRegex = /((?:https?:\/\/[^\s]+)|(?:@[a-zA-Z0-9_\s]+?(?=\s|$|[.,!?])))/g;
    const parts = trimmed.split(tokenRegex);

    return (
      <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap font-sans">
        {parts.map((part, i) => {
          if (/^https?:\/\//i.test(part)) {
            return (
              <a
                key={i}
                href={part}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline break-all"
              >
                {part}
              </a>
            );
          }
          if (part.startsWith('@')) {
            return (
              <span
                key={i}
                className="px-1.5 py-0.2 rounded bg-muted text-foreground border border-border/60 font-semibold font-mono text-[11px] inline-block mr-0.5"
              >
                {part}
              </span>
            );
          }
          return part;
        })}
      </p>
    );
  };

  // Render Data badge pill with sensitive credential masking
  const renderDataPill = (dataValue?: string | null, pillKey?: string) => {
    if (!dataValue) return null;
    const key = pillKey || dataValue;
    const isUnmasked = unmaskedDataKeys.has(key);
    const masked = maskSensitiveData(dataValue);
    const hasSensitive = masked !== dataValue;
    const displayText = isUnmasked ? dataValue : masked;

    return (
      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-muted/70 text-foreground font-semibold border border-border/50 inline-flex items-center gap-1.5 select-all">
        <span className="text-muted-foreground uppercase text-[9px] font-bold">DATA:</span>
        <span>{displayText}</span>
        {hasSensitive && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setUnmaskedDataKeys((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
            className="text-muted-foreground hover:text-foreground cursor-pointer p-0.5 rounded hover:bg-muted transition-colors ml-0.5"
            title={isUnmasked ? "Mask sensitive data" : "Reveal sensitive data"}
          >
            {isUnmasked ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </button>
        )}
      </span>
    );
  };

  const renderStepNoteTrigger = (
    stepOrder: number,
    stepCommentsForOrder: StepCommentItem[],
    unresolvedCount: number
  ) => {
    const hasComments = stepCommentsForOrder.length > 0;
    const isAllResolved = hasComments && unresolvedCount === 0;
    const isOpen = isCommentsPanelOpen && activeCommentStepOrder === stepOrder;
    const totalReplies = stepCommentsForOrder.reduce((sum, c) => sum + (c.replies?.length || 0), 0);
    const totalCount = stepCommentsForOrder.length + totalReplies;

    return (
      <button
        type="button"
        onClick={() => {
          if (!isCommentsPanelOpen) {
            setIsCommentsPanelOpen(true);
            setActiveCommentStepOrder(stepOrder);
          } else if (activeCommentStepOrder === stepOrder) {
            setActiveCommentStepOrder(null);
          } else {
            setActiveCommentStepOrder(stepOrder);
          }
          setTimeout(() => {
            const el = document.getElementById(`side-panel-step-${stepOrder}`);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
          }, 80);
        }}
        className={cn(
          "text-xs px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 select-none",
          hasComments
            ? isOpen
              ? "bg-muted/80 text-foreground border-foreground/30 font-semibold shadow-2xs"
              : isAllResolved
                ? "bg-muted/25 text-muted-foreground border-border/50 hover:text-foreground hover:bg-muted/50 font-medium opacity-80"
                : "bg-muted/40 text-foreground/90 border-border/70 hover:bg-muted/70 font-medium"
            : isOpen
              ? "bg-muted/70 text-foreground border-foreground/30 font-semibold"
              : "text-muted-foreground hover:text-foreground border-transparent hover:border-border/60 hover:bg-muted/30"
        )}
      >
        {isAllResolved ? (
          <Check className="h-3 w-3 text-muted-foreground" />
        ) : (
          <MessageSquare className="h-3 w-3" />
        )}
        <span>
          {hasComments
            ? isAllResolved
              ? `Resolved (${totalCount})`
              : `${totalCount} note${totalCount > 1 ? 's' : ''}`
            : 'Comment'}
        </span>
        {unresolvedCount > 0 && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
      </button>
    );
  };

  const renderResolvedInlineSummary = (
    stepOrder: number,
    stepCommentsForOrder: StepCommentItem[],
    unresolvedCount: number
  ) => {
    if (stepCommentsForOrder.length === 0 || unresolvedCount > 0) return null;
    const primary = stepCommentsForOrder[0];
    const replyCount = stepCommentsForOrder.reduce((sum, c) => sum + (c.replies?.length || 0), 0);

    return (
      <div
        onClick={() => {
          setIsCommentsPanelOpen(true);
          setActiveCommentStepOrder(stepOrder);
        }}
        className="mt-2 pt-2 border-t border-border/30 flex items-center justify-between gap-2 text-[11px] text-muted-foreground/80 bg-muted/15 px-2.5 py-1.5 rounded-lg border border-border/30 opacity-80 hover:opacity-100 cursor-pointer transition-all"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded bg-muted/60 text-muted-foreground border border-border/50 text-[10px] font-semibold shrink-0">
            <Check className="h-2.5 w-2.5" />
            Thread resolved
          </span>
          <span className="font-medium text-foreground/70 shrink-0">{primary.authorName}:</span>
          <span className="truncate text-muted-foreground italic">{primary.body}</span>
          {replyCount > 0 && (
            <span className="text-[10px] font-mono text-muted-foreground/70 shrink-0">
              ({replyCount} {replyCount === 1 ? 'reply' : 'replies'})
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleResolveComment(primary.id);
          }}
          className="text-[10px] font-medium text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted shrink-0 cursor-pointer"
        >
          Reopen
        </button>
      </div>
    );
  };

  const renderCommentsSidePanel = () => {
    if (!isPanelVisible) return null;

    return (
      <div className="w-full lg:w-[390px] shrink-0 border border-border/70 rounded-2xl bg-card/95 backdrop-blur-xl p-4 shadow-xl sticky top-20 self-start max-h-[calc(100vh-6rem)] flex flex-col space-y-3">
        {/* Unified Panel Header with Collapse Toggle */}
        <div className="border-b border-border/50 pb-2.5 shrink-0 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-semibold text-xs text-foreground truncate">Comments</span>
            {totalReviewCommentsCount > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-muted text-muted-foreground font-semibold shrink-0">
                {totalReviewCommentsCount}
              </span>
            )}
            {unresolvedReviewCommentsCount > 0 && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0"
                title={`${unresolvedReviewCommentsCount} unresolved`}
              />
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setIsCommentsPanelOpen(false);
              setActiveCommentStepOrder(null);
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] font-medium transition-colors cursor-pointer"
            title="Collapse comments panel"
          >
            <span>Collapse</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Unified Scrollable Step Groups */}
        <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-1 max-h-[calc(100vh-11rem)]">
          {visibleCommentStepOrders.map((stepNum) => {
            const stepNotes = stepComments.filter((c) => c.stepOrder === stepNum);
            const stepDiff = diffs.find((d) => d.displayOrder === stepNum);
            const stepTextPreview = stepDiff?.after?.step || stepDiff?.before?.step || '';
            const isComposerOpenForStep = activeCommentStepOrder === stepNum;

            return (
              <div
                key={stepNum}
                id={`side-panel-step-${stepNum}`}
                className="border-b border-border/40 pb-3.5 last:border-b-0 last:pb-0 space-y-2.5"
              >
                {/* Step Group Header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => scrollToSection(`review-change-step-${stepNum}`)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-foreground/90 border border-border/60 font-mono font-semibold text-[11px] hover:bg-muted/80 transition-colors cursor-pointer shrink-0"
                      title={`Scroll to Step ${stepNum}`}
                    >
                      <span>Step {stepNum}</span>
                    </button>
                    {stepTextPreview && (
                      <span
                        className="text-[11px] text-muted-foreground truncate"
                        title={stepTextPreview}
                      >
                        {stepTextPreview}
                      </span>
                    )}
                  </div>

                  {stepNotes.length === 0 && isComposerOpenForStep ? (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCommentStepOrder(null);
                        setSidePanelInput('');
                      }}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
                      title="Cancel note"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : !isComposerOpenForStep ? (
                    <button
                      type="button"
                      onClick={() => setActiveCommentStepOrder(stepNum)}
                      className="text-[10px] font-medium text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer shrink-0"
                    >
                      + Note
                    </button>
                  ) : null}
                </div>

                {/* Existing Comments for Step */}
                {stepNotes.length > 0 && (
                  <div className="space-y-2">
                    {stepNotes.map((c: any) => {
                      const isResolved = Boolean(c.resolved);
                      const isExpandedResolved = expandedResolvedIds.has(c.id);
                      const authorUser = members.find(
                        (m: any) => Number(m.userId || m.user?.id) === Number(c.authorId || c.author_id || c.user_id)
                      )?.user;
                      const authorName = c.authorName || c.author_name || c.user?.name || authorUser?.name || 'User';
                      const authorImage = authorUser?.avatarUrl || c.authorImage || c.author_image || c.user?.image || null;
                      const authorColor = c.authorColor || authorUser?.avatarColor || null;
                      const authorInitials = c.authorInitials || authorUser?.avatarInitials || null;
                      const isOwner = Number(c.authorId || c.author_id) === Number(currentUserId);
                      const replyCount = c.replies?.length || 0;

                      if (isResolved && !isExpandedResolved) {
                        return (
                          <div
                            key={c.id}
                            className="p-2.5 rounded-xl border border-border/40 bg-muted/20 opacity-75 hover:opacity-100 transition-all text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedResolvedIds((prev) => {
                                    const next = new Set(prev);
                                    next.add(c.id);
                                    return next;
                                  });
                                }}
                                className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
                              >
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border/60 font-semibold inline-flex items-center gap-1 shrink-0">
                                  <Check className="h-2.5 w-2.5" /> Resolved
                                </span>
                                <span className="font-medium text-foreground/75 truncate">{authorName}</span>
                                {replyCount > 0 && (
                                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                                    · {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
                                  </span>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleResolveComment(c.id)}
                                className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer shrink-0"
                              >
                                Reopen
                              </button>
                            </div>
                            <p
                              onClick={() => {
                                setExpandedResolvedIds((prev) => {
                                  const next = new Set(prev);
                                  next.add(c.id);
                                  return next;
                                });
                              }}
                              className="text-[11px] text-muted-foreground truncate pl-5 italic cursor-pointer"
                            >
                              {c.body}
                            </p>
                          </div>
                        );
                      }

                      return (
                        <div
                          key={c.id}
                          className={cn(
                            "p-3 rounded-xl border text-xs space-y-2 transition-all",
                            isResolved ? "bg-muted/20 border-border/40 opacity-80" : "bg-card border-border/70 shadow-2xs"
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {isResolved && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedResolvedIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(c.id);
                                      return next;
                                    });
                                  }}
                                  className="text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
                                  title="Collapse resolved thread"
                                >
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <UserAvatar
                                name={authorName}
                                imageUrl={authorImage}
                                color={authorColor}
                                initials={authorInitials}
                                size="sm"
                                className="shrink-0"
                              />
                              <div className="flex items-baseline gap-1.5 min-w-0 truncate">
                                <span className="font-semibold text-foreground text-xs truncate">{authorName}</span>
                                <span className="text-[10px] text-muted-foreground shrink-0">
                                  {c.created_at || c.createdAt
                                    ? formatDistanceToNow(new Date(c.created_at || c.createdAt), { addSuffix: true })
                                    : ''}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleResolveComment(c.id)}
                                className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
                              >
                                {isResolved ? 'Reopen' : '✓ Resolve'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setActiveReplyId(activeReplyId === c.id ? null : c.id)}
                                className="text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
                              >
                                Reply
                              </button>
                              {isOwner && editingCommentId !== c.id && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCommentId(c.id);
                                    setEditingCommentBody(c.body);
                                  }}
                                  className="text-[11px] text-muted-foreground hover:text-foreground px-1 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
                                >
                                  Edit
                                </button>
                              )}
                              {isOwner && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteComment(c.id)}
                                  className="text-[11px] text-muted-foreground hover:text-rose-500 p-0.5 rounded hover:bg-muted transition-colors cursor-pointer"
                                  title="Delete note"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Comment Body / Inline Edit Mode */}
                          {editingCommentId === c.id ? (
                            <div className="space-y-1.5 pt-1">
                              <textarea
                                rows={2}
                                value={editingCommentBody}
                                onChange={(e) => setEditingCommentBody(e.target.value)}
                                className="w-full p-2 bg-background border border-border/80 rounded-lg text-xs text-foreground focus:outline-none focus:border-foreground/50 resize-none transition-colors"
                              />
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCommentId(null);
                                    setEditingCommentBody('');
                                  }}
                                  className="px-2 py-0.5 text-[11px] rounded text-muted-foreground hover:text-foreground cursor-pointer"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleSaveEditComment(c.id, stepNum)}
                                  className="px-2.5 py-0.5 text-[11px] font-semibold rounded bg-foreground text-background hover:opacity-90 cursor-pointer"
                                >
                                  Save
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="pl-8">
                              {renderCommentContent(c.body)}
                            </div>
                          )}

                          {/* Threaded Replies (only rendered when replies exist) */}
                          {c.replies && c.replies.length > 0 && (
                            <div className="pl-4 space-y-2 pt-1 border-l-2 border-border/40 ml-4">
                              {c.replies.map((r: any) => {
                                const replyMember = members.find(
                                  (m: any) => Number(m.userId || m.user?.id) === Number(r.authorId || r.author_id)
                                )?.user;
                                const isReplyOwner = Number(r.authorId || r.author_id) === Number(currentUserId);
                                return (
                                  <div key={r.id} className="p-2 rounded-lg bg-card/70 border border-border/40 space-y-1">
                                    <div className="flex items-center justify-between gap-1">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <UserAvatar
                                          name={r.authorName}
                                          imageUrl={replyMember?.avatarUrl || r.authorImage}
                                          color={r.authorColor || replyMember?.avatarColor}
                                          initials={r.authorInitials || replyMember?.avatarInitials}
                                          size="sm"
                                          className="h-5 w-5 text-[9px] shrink-0"
                                        />
                                        <span className="font-semibold text-[11px] text-foreground truncate">{r.authorName}</span>
                                        <span className="text-[10px] text-muted-foreground shrink-0">
                                          {r.createdAt
                                            ? formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })
                                            : ''}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-1">
                                        {isReplyOwner && editingCommentId !== r.id && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setEditingCommentId(r.id);
                                              setEditingCommentBody(r.body);
                                            }}
                                            className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                                          >
                                            Edit
                                          </button>
                                        )}
                                        {isReplyOwner && (
                                          <button
                                            type="button"
                                            onClick={() => handleDeleteComment(r.id)}
                                            className="text-muted-foreground hover:text-rose-500 p-0.5 cursor-pointer"
                                            title="Delete reply"
                                          >
                                            <X className="h-2.5 w-2.5" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    {editingCommentId === r.id ? (
                                      <div className="space-y-1 pt-1">
                                        <textarea
                                          rows={2}
                                          value={editingCommentBody}
                                          onChange={(e) => setEditingCommentBody(e.target.value)}
                                          className="w-full p-1.5 bg-background border border-border/80 rounded text-xs text-foreground focus:outline-none focus:border-foreground/50 resize-none transition-colors"
                                        />
                                        <div className="flex items-center justify-end gap-1">
                                          <button
                                            type="button"
                                            onClick={() => setEditingCommentId(null)}
                                            className="px-2 py-0.5 text-[10px] text-muted-foreground"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => handleSaveEditComment(r.id, stepNum)}
                                            className="px-2.5 py-0.5 text-[10px] font-semibold bg-foreground text-background rounded"
                                          >
                                            Save
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="pl-5 text-xs">
                                        {renderCommentContent(r.body)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Reply Input Box */}
                          {activeReplyId === c.id && (
                            <div className="pl-6 pt-1 flex gap-2">
                              <input
                                type="text"
                                value={replyInputs[c.id] || ''}
                                onChange={(e) =>
                                  setReplyInputs((prev) => ({ ...prev, [c.id]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handlePostReply(c.id, stepNum);
                                }}
                                placeholder="Write a reply..."
                                className="flex-1 h-7 px-2.5 text-xs rounded-lg border border-border/60 bg-background text-foreground focus:outline-none focus:border-foreground/40"
                                autoFocus
                              />
                              <Button
                                size="sm"
                                onClick={() => handlePostReply(c.id, stepNum)}
                                disabled={!replyInputs[c.id]?.trim()}
                                className="h-7 px-2.5 text-xs bg-foreground text-background hover:opacity-90 font-semibold cursor-pointer"
                              >
                                Reply
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Active Step Composer (only rendered when actively adding/replying to this step) */}
                {isComposerOpenForStep && (
                  <div className="pt-1 space-y-2">
                    <textarea
                      rows={2}
                      value={sidePanelInput}
                      onChange={(e) => setSidePanelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && sidePanelInput.trim()) {
                          e.preventDefault();
                          handlePostSidePanelNote(stepNum);
                        }
                      }}
                      placeholder={
                        stepNotes.length > 0
                          ? `Reply to Step ${stepNum}...`
                          : `Add a comment on Step ${stepNum}...`
                      }
                      className="w-full p-2.5 bg-background border border-border/70 rounded-xl text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground/40 resize-none transition-colors"
                      autoFocus
                    />
                    <div className="flex justify-end gap-1.5">
                      {stepNotes.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setActiveCommentStepOrder(null);
                            setSidePanelInput('');
                          }}
                          className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                        >
                          Cancel
                        </Button>
                      )}
            <Button
              size="sm"
              disabled={!sidePanelInput.trim() || isPostingSidePanel}
              onClick={() => handlePostSidePanelNote()}
              className="h-7 px-3 text-xs gradient-btn text-white font-semibold cursor-pointer shadow-xs flex items-center gap-1.5"
            >
                        <Send className="h-3 w-3" />
                        <span>
                          {isPostingSidePanel
                            ? 'Posting...'
                            : stepNotes.length > 0
                              ? 'Reply'
                              : 'Post Note'}
                        </span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen pb-28 pt-4 px-4 sm:px-6 lg:px-8 w-full max-w-7xl mx-auto space-y-6">
      {/* 1. Header Navigation & Top Decision Actions */}
      <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-3.5 flex-wrap">
        <button
          onClick={() => router.push(`/p/${slug}/reviews`)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
          <span>Back to Review Queue</span>
        </button>

        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Role-Based Decision Actions */}
          {(activeReviewRequest?.status === 'pending' || activeReviewRequest?.status === 'in_review') && (
            <>
              {/* Author (Admin): "Publish Now" button */}
              {isAuthor && isAdmin && (
                <Button
                  size="sm"
                  onClick={confirmPublishNow}
                  disabled={isSubmittingAction}
                  className="gradient-btn text-white font-semibold px-4 h-8 text-xs rounded-xl shadow-sm flex items-center gap-1.5 cursor-pointer"
                  title="Bypass peer review and immediately publish as Active"
                >
                  <FastForward className="h-3.5 w-3.5" />
                  <span>Publish Now</span>
                </Button>
              )}

              {/* Reviewer / Unassigned (or Admin not Author) */}
              {!isAuthor && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRequestChangesWithComment}
                    disabled={isSubmittingAction}
                    className="border-border/70 text-foreground/85 hover:bg-muted/60 hover:text-foreground font-semibold px-3.5 h-8 rounded-xl text-xs cursor-pointer transition-all"
                  >
                    Request changes
                  </Button>

                  {/* Approve button / dropdown */}
                  <div className="relative" ref={approveDropdownRef}>
                    <div className="inline-flex rounded-xl shadow-lg shadow-black/15 dark:shadow-black/50 overflow-hidden bg-emerald-600 text-white">
                      <button
                        type="button"
                        onClick={handleApproveWithComment}
                        disabled={isSubmittingAction}
                        className={cn(
                          "bg-emerald-600 hover:bg-emerald-700 text-white font-semibold pl-3.5 h-8 text-xs cursor-pointer flex items-center gap-1.5 transition-colors select-none",
                          canSkipReview ? "pr-1.5" : "pr-3.5"
                        )}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Approve</span>
                      </button>
                      {canSkipReview && (
                        <button
                          type="button"
                          onClick={() => setShowApproveDropdown(!showApproveDropdown)}
                          className="pl-1 pr-2.5 h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs flex items-center justify-center cursor-pointer transition-colors"
                          title="More options"
                        >
                          <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", showApproveDropdown && "rotate-180")} />
                        </button>
                      )}
                    </div>

                    {showApproveDropdown && canSkipReview && (
                      <div className="absolute right-0 top-full mt-[6px] z-50 w-44 rounded-xl border border-emerald-700/20 dark:border-emerald-500/25 bg-popover/95 backdrop-blur-xl p-1 shadow-xl shadow-black/15 dark:shadow-black/50 text-xs space-y-0.5 animate-in fade-in-0 duration-100">
                        <button
                          type="button"
                          onClick={() => {
                            setShowApproveDropdown(false);
                            confirmPublishNow();
                          }}
                          className="w-full text-left px-2.5 py-1.5 flex items-center gap-2 rounded-lg hover:bg-muted text-foreground transition-colors cursor-pointer"
                        >
                          <FastForward className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>Publish Now</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 2. Main Title & Status Row */}
      <div className="space-y-2 border-b border-border/40 pb-4">
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Clickable Test Case Key */}
          <Link
            href={`/p/${slug}/repository/${testCase?.displayId || targetCaseId}`}
            className="font-mono text-sm font-bold px-2.5 py-1 rounded-lg bg-card border border-border/80 text-foreground hover:text-primary transition-colors inline-flex items-center gap-1.5 group shadow-2xs"
            title="Open test case in repository"
          >
            <span>{testCase?.displayId || caseIdParam}</span>
            <ExternalLink className="h-3 w-3 opacity-50 group-hover:opacity-100" />
          </Link>

          {/* Non-CTA Review Status Label */}
          {activeReviewRequest ? (
            activeReviewRequest.status === 'changes_requested' ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-500 select-none">
                <AlertCircle className="h-3.5 w-3.5" />
                <span>Changes Requested</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground select-none">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/70" />
                <span>In Review</span>
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 select-none">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Approved</span>
            </span>
          )}
        </div>

        <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-tight tracking-tight">
          {testCase?.title || diffData?.after?.title || 'Test Case Review'}
        </h1>

        {/* Authorship & Timing Metadata Line */}
        <div className="flex items-center gap-2.5 text-xs text-muted-foreground flex-wrap font-sans pt-0.5">
          {(() => {
            const authorUserId = activeReviewRequest?.requestedById ?? testCase?.createdBy;
            const authorMember = members.find(
              (m: any) =>
                (authorUserId && Number(m.userId || m.user?.id) === Number(authorUserId)) ||
                (activeReviewRequest?.requestedByName && m.user?.name === activeReviewRequest.requestedByName)
            )?.user;
            const authorDisplayName =
              activeReviewRequest?.requestedByName || authorMember?.name || testCase?.createdByName || 'Author';
            const authorAvatarUrl =
              authorMember?.avatarUrl || activeReviewRequest?.requestedByImage || null;
            const authorColor =
              activeReviewRequest?.requestedByColor || authorMember?.avatarColor || null;
            const authorInitials =
              activeReviewRequest?.requestedByInitials || authorMember?.avatarInitials || null;

            return (
              <div className="inline-flex items-center gap-2">
                <span>Author:</span>
                <UserAvatar
                  name={authorDisplayName}
                  imageUrl={authorAvatarUrl}
                  color={authorColor}
                  initials={authorInitials}
                  size="sm"
                  className="shrink-0"
                />
                <strong className="text-foreground font-semibold">{authorDisplayName}</strong>
              </div>
            );
          })()}

          {activeReviewRequest?.createdAt && (
            <>
              <span>&middot;</span>
              <span className="text-[11px] text-muted-foreground">
                {format(new Date(activeReviewRequest.createdAt), 'MMM d, yyyy · h:mm a')}
              </span>
            </>
          )}

          {activeReviewRequest?.assignedToName && (() => {
            const reviewerMember = members.find(
              (m: any) =>
                (activeReviewRequest.assignedToId &&
                  Number(m.userId || m.user?.id) === Number(activeReviewRequest.assignedToId)) ||
                m.user?.name === activeReviewRequest.assignedToName
            )?.user;
            const reviewerAvatarUrl =
              reviewerMember?.avatarUrl || activeReviewRequest.assignedToImage || null;
            const reviewerColor =
              activeReviewRequest.assignedToColor || reviewerMember?.avatarColor || null;
            const reviewerInitials =
              activeReviewRequest.assignedToInitials || reviewerMember?.avatarInitials || null;

            return (
              <>
                <span>&middot;</span>
                <div className="inline-flex items-center gap-2">
                  <span>Reviewer:</span>
                  <UserAvatar
                    name={activeReviewRequest.assignedToName}
                    imageUrl={reviewerAvatarUrl}
                    color={reviewerColor}
                    initials={reviewerInitials}
                    size="sm"
                    className="shrink-0"
                  />
                  <strong className="text-foreground font-semibold">{activeReviewRequest.assignedToName}</strong>
                </div>
              </>
            );
          })()}

          {/* Expand unchanged button (ONLY if unchanged steps exist) */}
          {unchangedDiffs.length > 0 && (
            <>
              <span>&middot;</span>
              <button
                type="button"
                onClick={() => setShowAllUnchanged(!showAllUnchanged)}
                className="text-xs text-muted-foreground hover:text-foreground font-medium underline cursor-pointer"
              >
                {showAllUnchanged ? 'Collapse Unchanged' : `Show ${unchangedDiffs.length} Unchanged Steps`}
              </button>
            </>
          )}

          {/* Comments side-panel trigger (only shown when panel is collapsed) */}
          {!isPanelVisible && (
            <div className="ml-auto">
              <button
                type="button"
                onClick={() => {
                  setIsCommentsPanelOpen(true);
                  if (stepComments.length === 0 && activeCommentStepOrder === null) {
                    setActiveCommentStepOrder(diffs[0]?.displayOrder || 1);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border text-xs font-medium bg-muted/30 text-muted-foreground hover:text-foreground border-border/50 transition-colors cursor-pointer"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Comments {totalReviewCommentsCount > 0 && `(${totalReviewCommentsCount})`}</span>
                {unresolvedReviewCommentsCount > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2b. Deterministic Review Pre-Flight Check Banner */}
      {preflightIssues.length > 0 && (() => {
        const errorCount = preflightIssues.filter((i) => i.severity === 'error').length;
        const warnCount = preflightIssues.filter((i) => i.severity === 'warning').length;
        const infoCount = preflightIssues.filter((i) => i.severity === 'info').length;

        return (
          <div
            className={cn(
              "rounded-2xl border p-3.5 space-y-2.5 transition-all",
              errorCount > 0
                ? "border-rose-500/35 bg-rose-500/5"
                : warnCount > 0
                ? "border-amber-500/35 bg-amber-500/5"
                : "border-border/60 bg-muted/20"
            )}
          >
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border",
                    errorCount > 0
                      ? "bg-rose-500/15 text-rose-400 border-rose-500/30"
                      : "bg-amber-500/15 text-amber-400 border-amber-500/30"
                  )}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-foreground">
                    Review Pre-flight Check
                  </span>
                  {errorCount > 0 && (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/30">
                      {errorCount} {errorCount === 1 ? 'error' : 'errors'}
                    </span>
                  )}
                  {warnCount > 0 && (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                      {warnCount} {warnCount === 1 ? 'warning' : 'warnings'}
                    </span>
                  )}
                  {infoCount > 0 && (
                    <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/50">
                      {infoCount} {infoCount === 1 ? 'note' : 'notes'}
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowPreflightDetails(!showPreflightDetails)}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 font-medium cursor-pointer"
              >
                <span>{showPreflightDetails ? 'Hide details' : 'Show details'}</span>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-150",
                    showPreflightDetails && "rotate-180"
                  )}
                />
              </button>
            </div>

            {showPreflightDetails && (
              <div className="divide-y divide-border/30 border-t border-border/30 pt-2 space-y-1.5">
                {preflightIssues.map((issue) => (
                  <div
                    key={issue.id}
                    className="pt-1.5 first:pt-0 flex items-start justify-between gap-3 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (issue.stepOrder !== undefined) {
                          setShowAllUnchanged(true);
                          setExpandedSteps((prev) => new Set(prev).add(issue.stepOrder!));
                          setTimeout(() => {
                            scrollToSection(`review-change-step-${issue.stepOrder}`);
                          }, 80);
                        }
                      }}
                      className={cn(
                        "flex items-start gap-2 text-left min-w-0 flex-1 group",
                        issue.stepOrder !== undefined && "cursor-pointer"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 h-2 w-2 rounded-full shrink-0",
                          issue.severity === 'error'
                            ? "bg-rose-500"
                            : issue.severity === 'warning'
                            ? "bg-amber-500"
                            : "bg-blue-400"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <span className="font-semibold text-foreground group-hover:text-primary transition-colors">
                          {issue.title}
                        </span>
                        <span className="text-muted-foreground ml-1.5">
                          — {issue.suggestion}
                        </span>
                      </div>
                    </button>

                    {issue.stepOrder !== undefined && !isAuthor && (
                      <button
                        type="button"
                        disabled={postingPreflightId === issue.id}
                        onClick={async () => {
                          if (!targetCaseId) return;
                          setPostingPreflightId(issue.id);
                          try {
                            await createCommentAction({
                              project_id: project?.id || '',
                              entity_type: 'case',
                              entity_id: targetCaseId,
                              body: `[Step ${issue.stepOrder}] ${issue.title} — ${issue.suggestion}`,
                            });
                            const refreshed = await getCommentsAction(targetCaseId, 'case');
                            setComments(refreshed || []);
                            setIsCommentsPanelOpen(true);
                            setActiveCommentStepOrder(issue.stepOrder ?? null);
                            toast.success(`Added pre-flight note to Step ${issue.stepOrder}`);
                          } catch (err: any) {
                            toast.error(err.message || 'Failed to add note');
                          } finally {
                            setPostingPreflightId(null);
                          }
                        }}
                        className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md border border-border/60 bg-background/70 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title="Post as a review comment on this step"
                      >
                        {postingPreflightId === issue.id ? 'Adding...' : '+ Add as Note'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* 3. Steps & Side-by-Side Comments Split View */}
      <div className="flex flex-col lg:flex-row items-start gap-6 w-full pt-1">
        {/* Left: Test Case Steps */}
        <div className={cn("w-full transition-all duration-300 min-w-0 space-y-5", isPanelVisible ? "lg:w-[62%]" : "w-full")}>
        {/* Description Diff if changed */}
        {descChanged && (
          <div id="review-change-description" className="space-y-1.5 scroll-mt-24">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold text-muted-foreground tracking-wider uppercase">
                Description
              </span>
              <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/25 text-[10px] font-bold font-mono">
                {!diffData?.before?.description ? 'Added' : !diffData?.after?.description ? 'Deleted' : 'Modified'}
              </span>
            </div>
            <div className="p-3 rounded-xl border border-border/70 bg-card/60 text-xs font-normal text-foreground/90 flex items-start gap-2 shadow-2xs">
              <div className="flex-1 leading-relaxed">
                {diffData?.after?.description
                  ? renderCommentContent(diffData.after.description)
                  : '— None —'}
              </div>
            </div>
          </div>
        )}

        {/* Pre-conditions Diff if changed */}
        {preChanged && (
          <div id="review-change-pre" className="space-y-1.5 scroll-mt-24">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold text-muted-foreground tracking-wider uppercase">
                Pre-conditions
              </span>
              <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/25 text-[10px] font-bold font-mono">
                {!diffData?.before?.preConditions ? 'Added' : !diffData?.after?.preConditions ? 'Deleted' : 'Modified'}
              </span>
            </div>
            <div className="p-3 rounded-xl border border-border/70 bg-card/60 text-xs font-normal text-foreground/90 flex items-start gap-2 shadow-2xs">
              <div className="flex-1 leading-relaxed">
                {diffData?.after?.preConditions ? diffData.after.preConditions : '— None —'}
              </div>
            </div>
          </div>
        )}

        {/* Column Headers for 2-Column Sequence (Only rendered when there is an approved baseline) */}
        {diffData?.hasBaseline && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-2 border-b border-border/40 font-semibold text-xs text-muted-foreground uppercase tracking-wider px-2 select-none">
            <div className="flex items-center gap-2 text-foreground/80">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/60 inline-block" />
              <span>Current Version (v{diffData?.baselineVersion || 1})</span>
            </div>
            <div className="flex items-center gap-2 text-foreground/80">
              <span className="h-2 w-2 rounded-full bg-foreground/60 inline-block" />
              <span>Proposed Changes (v{diffData?.targetVersion || 2})</span>
            </div>
          </div>
        )}

        {/* Continuous Step List with Clear Visual Step Separation */}
        <div className="space-y-3.5">
          {diffs.map((d) => {
            const bExp = d.before?.expectedResult ?? d.before?.expected_result;
            const aExp = d.after?.expectedResult ?? d.after?.expected_result;
            const bData = d.before?.data;
            const aData = d.after?.data;
            const stepCommentsForOrder = stepComments.filter((c) => c.stepOrder === d.displayOrder);
            const unresolvedCount = stepCommentsForOrder.filter((c) => !c.resolved).length;

            // FIRST-TIME REVIEW: Single-column proposed content view
            if (!diffData?.hasBaseline) {
              return (
                <div
                  id={`review-change-step-${d.displayOrder}`}
                  key={d.displayOrder}
                  className={cn(
                    "rounded-xl border p-3.5 space-y-2 shadow-2xs transition-all",
                    activeCommentStepOrder === d.displayOrder && isPanelVisible
                      ? "border-foreground/30 ring-1 ring-foreground/15 bg-muted/15"
                      : "border-border/70 bg-card/60"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <span className="font-mono text-xs font-bold text-foreground shrink-0 select-none mt-0.5">
                        {d.displayOrder}.
                      </span>
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <span className="text-foreground font-semibold text-xs leading-relaxed block">
                          {d.after?.step}
                        </span>
                        {aExp && (
                          <div className="text-xs pl-3 border-l-2 border-border/60 flex items-baseline gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 select-none">
                              EXPECTED:
                            </span>
                            <span className="text-foreground/80 leading-relaxed font-normal">{aExp}</span>
                          </div>
                        )}
                        {aData && (
                          <div className="pl-3 pt-0.5">
                            {renderDataPill(aData, `step-${d.displayOrder}-data`)}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {renderStepNoteTrigger(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                    </div>
                  </div>
                  {renderResolvedInlineSummary(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                </div>
              );
            }

            // UNCHANGED STEP — Compact 2-Column Split unless showAllUnchanged is true
            if (d.type === 'unchanged') {
              if (!showAllUnchanged) {
                return (
                  <div
                    id={`review-change-step-${d.displayOrder}`}
                    key={d.displayOrder}
                    className={cn(
                      "group rounded-xl border px-3.5 py-2.5 text-xs transition-all shadow-2xs",
                      activeCommentStepOrder === d.displayOrder && isPanelVisible
                        ? "border-foreground/30 ring-1 ring-foreground/15 bg-muted/15"
                        : "border-border/60 bg-card/50 hover:bg-card/80"
                    )}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                      {/* Left: Current Version */}
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs font-bold text-foreground/80 shrink-0 select-none">
                          #{d.displayOrder}.
                        </span>
                        <p className="truncate text-foreground/95 font-medium text-xs leading-normal" title={d.after?.step}>
                          {d.after?.step}
                        </p>
                      </div>

                      {/* Right: Proposed Changes */}
                      <div className="flex items-center justify-end gap-1.5 min-w-0 md:border-l md:border-border/40 md:pl-4">
                        <span className="px-2 py-0.5 rounded-md bg-muted/80 text-muted-foreground font-mono text-[10px] font-bold border border-border/50 uppercase tracking-wider select-none">
                          Unchanged
                        </span>
                        {renderStepNoteTrigger(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                      </div>
                    </div>
                    {renderResolvedInlineSummary(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                  </div>
                );
              }

              // When showAllUnchanged is true: render full details for unchanged step
              return (
                <div
                  id={`review-change-step-${d.displayOrder}`}
                  key={d.displayOrder}
                  className={cn(
                    "rounded-xl border p-4 space-y-2.5 transition-all text-xs",
                    activeCommentStepOrder === d.displayOrder && isPanelVisible
                      ? "border-foreground/30 ring-1 ring-foreground/15 bg-muted/15"
                      : "border-border/40 bg-card/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-muted text-foreground border border-border/50 select-none">
                        #{d.displayOrder}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="px-2 py-0.5 rounded-md bg-muted/80 text-muted-foreground font-mono text-[10px] font-bold border border-border/50 uppercase tracking-wider select-none">
                        Unchanged
                      </span>
                      {renderStepNoteTrigger(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                    </div>
                  </div>

                  <p className="text-sm font-medium text-foreground leading-relaxed">
                    {d.after?.step}
                  </p>

                  {aExp && (
                    <div className="text-xs text-muted-foreground flex items-baseline gap-2 pt-1 border-t border-border/30">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-foreground/75 shrink-0 select-none">
                        EXPECTED:
                      </span>
                      <span className="leading-relaxed">{aExp}</span>
                    </div>
                  )}

                  {aData && (
                    <div className="pt-1">
                      {renderDataPill(aData, `step-${d.displayOrder}-data`)}
                    </div>
                  )}
                  {renderResolvedInlineSummary(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                </div>
              );
            }

            // MODIFIED ROW — Note trigger pinned directly next to "Modified" diff badge
            if (d.type === 'modified') {
              return (
                <div
                  id={`review-change-step-${d.displayOrder}`}
                  key={d.displayOrder}
                  className={cn(
                    "rounded-xl border p-3 space-y-2 scroll-mt-24 shadow-2xs transition-all",
                    activeCommentStepOrder === d.displayOrder && isPanelVisible
                      ? "border-foreground/30 ring-1 ring-foreground/15 bg-muted/15"
                      : "border-border/70 bg-card/60"
                  )}
                >
                  {/* Two Columns: Current Version vs Proposed Changes */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans items-start">
                    {/* Left: Current Version */}
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs font-bold text-muted-foreground shrink-0 select-none">
                          {d.before?.order}.
                        </span>
                        <p className="text-foreground/80 leading-relaxed font-sans font-medium text-xs">
                          {d.before?.step}
                        </p>
                      </div>
                      {bExp && (
                        <div className="text-xs text-muted-foreground pl-3 border-l-2 border-border/40 flex items-baseline gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 select-none">
                            Expected:
                          </span>
                          <span className="leading-relaxed">{bExp}</span>
                        </div>
                      )}
                      {bData && (
                        <div className="pl-3 pt-0.5">
                          {renderDataPill(bData, `step-${d.displayOrder}-data-before`)}
                        </div>
                      )}
                    </div>

                    {/* Right: Proposed Changes */}
                    <div className="space-y-1.5 min-w-0 md:border-l md:border-border/40 md:pl-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-baseline gap-2 min-w-0 flex-1">
                          <span className="font-mono text-xs font-bold text-foreground shrink-0 select-none">
                            {d.displayOrder}.
                          </span>
                          <div className="text-foreground font-semibold leading-relaxed font-sans text-xs">
                            {renderTrackChanges(d.before?.step, d.after?.step, 'amber')}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/25 text-[10px] font-bold font-mono shrink-0">
                            Modified
                          </span>
                          {renderStepNoteTrigger(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                        </div>
                      </div>

                      {aExp && (
                        <div className="text-xs pl-3 border-l-2 border-border/60 flex items-baseline gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 select-none">
                            Expected:
                          </span>
                          <div className="leading-relaxed text-foreground/90 font-medium">
                            {renderTrackChanges(bExp, aExp, 'amber')}
                          </div>
                        </div>
                      )}
                      {aData && (
                        <div className="pl-3 pt-0.5">
                          {renderDataPill(aData, `step-${d.displayOrder}-data-after`)}
                        </div>
                      )}
                    </div>
                  </div>
                  {renderResolvedInlineSummary(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                </div>
              );
            }

            // ADDED ROW — Note trigger pinned directly next to "+ New" diff badge
            if (d.type === 'added') {
              return (
                <div
                  id={`review-change-step-${d.displayOrder}`}
                  key={d.displayOrder}
                  className={cn(
                    "rounded-xl border p-3 space-y-2 scroll-mt-24 shadow-2xs transition-all",
                    activeCommentStepOrder === d.displayOrder && isPanelVisible
                      ? "border-foreground/30 ring-1 ring-foreground/15 bg-muted/15"
                      : "border-border/70 bg-card/60"
                  )}
                >
                  {/* Two Columns: Current Version vs. Proposed Changes */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans items-start">
                    {/* Left: Current Version */}
                    <div className="flex items-center text-muted-foreground/50 text-xs py-0.5 select-none">
                      <span>Not in v{diffData?.baselineVersion || 1}</span>
                    </div>

                    {/* Right: Proposed Changes */}
                    <div className="space-y-1.5 min-w-0 md:border-l md:border-border/40 md:pl-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-baseline gap-2 min-w-0 flex-1">
                          <span className="font-mono text-xs font-bold text-foreground shrink-0 select-none">
                            {d.displayOrder}.
                          </span>
                          <span className="text-foreground font-semibold text-xs leading-relaxed">
                            {d.after?.step}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-1.5 py-0.5 rounded bg-muted/40 text-muted-foreground border border-border/60 text-[10px] font-semibold font-mono shrink-0">
                            + New
                          </span>
                          {renderStepNoteTrigger(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                        </div>
                      </div>

                      {aExp && (
                        <div className="text-xs pl-3 border-l-2 border-border/60 flex items-baseline gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0 select-none">
                            EXPECTED:
                          </span>
                          <span className="text-foreground/80 leading-relaxed font-normal">{aExp}</span>
                        </div>
                      )}
                      {aData && (
                        <div className="pl-3 pt-0.5">
                          {renderDataPill(aData, `step-${d.displayOrder}-data`)}
                        </div>
                      )}
                    </div>
                  </div>
                  {renderResolvedInlineSummary(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                </div>
              );
            }

            // REMOVED ROW — Note trigger pinned directly next to "Deleted" diff badge
            if (d.type === 'removed') {
              return (
                <div
                  id={`review-change-step-${d.displayOrder}`}
                  key={d.displayOrder}
                  className={cn(
                    "rounded-xl border p-3 space-y-2 scroll-mt-24 shadow-2xs transition-all",
                    activeCommentStepOrder === d.displayOrder && isPanelVisible
                      ? "border-foreground/30 ring-1 ring-foreground/15 bg-muted/15"
                      : "border-border/70 bg-card/60"
                  )}
                >
                  {/* Two Columns: Baseline (Struck through) vs. Proposed */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans items-start">
                    {/* Baseline Column */}
                    <div className="space-y-1.5 min-w-0 line-through opacity-75">
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs font-semibold text-rose-500 shrink-0 select-none">
                          {d.before?.order ?? d.displayOrder}.
                        </span>
                        <p className="text-muted-foreground leading-relaxed font-sans text-xs">
                          {d.before?.step}
                        </p>
                      </div>
                      {bExp && (
                        <div className="text-xs text-muted-foreground pl-3 border-l-2 border-rose-500/40 flex items-baseline gap-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-rose-500 shrink-0 select-none">
                            EXPECTED:
                          </span>
                          <span className="leading-relaxed">{bExp}</span>
                        </div>
                      )}
                    </div>

                    {/* Proposed Column */}
                    <div className="space-y-1.5 min-w-0 md:border-l md:border-border/40 md:pl-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground/50 text-xs py-0.5 select-none">
                            Removed in v{diffData?.targetVersion || 2}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] font-bold font-mono shrink-0">
                            Deleted
                          </span>
                          {renderStepNoteTrigger(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                        </div>
                      </div>
                    </div>
                  </div>
                  {renderResolvedInlineSummary(d.displayOrder, stepCommentsForOrder, unresolvedCount)}
                </div>
              );
            }

            return null;
          })}
        </div>

        {/* Post-conditions Diff if changed */}
        {postChanged && (
          <div id="review-change-postconditions" className="space-y-1.5 scroll-mt-24 pt-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono font-bold text-muted-foreground tracking-wider uppercase">
                Post-conditions
              </span>
              <span className="px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/25 text-[10px] font-bold font-mono">
                {!diffData?.before?.postConditions ? 'Added' : !diffData?.after?.postConditions ? 'Deleted' : 'Modified'}
              </span>
            </div>
            <div className="p-3 rounded-xl border border-border/70 bg-card/60 text-xs font-normal text-foreground/90 flex items-start gap-2 shadow-2xs">
              <div className="flex-1 leading-relaxed">
                {diffData?.after?.postConditions ? diffData.after.postConditions : '— None —'}
              </div>
            </div>
          </div>
        )}
        </div>

        {/* Right: Side-by-Side Comments Panel */}
        {renderCommentsSidePanel()}
      </div>

      {/* 4. Bottom Navigation & Status */}
      <div className="pt-6 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-3">
        <div className="flex items-center gap-2">
          {activeReviewRequest ? (
            activeReviewRequest.status === 'changes_requested' ? (
              <span className="text-amber-500 font-medium">Changes have been requested on this review.</span>
            ) : null
          ) : (
            <span className="text-emerald-500 font-medium">Review complete and published to repository.</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => router.push(`/p/${slug}/reviews`)}
          className="text-primary hover:underline font-medium cursor-pointer"
        >
          ← Back to Review Queue
        </button>
      </div>

      {/* Request Changes Dialog */}
      <Dialog open={showRequestChangesDialog} onOpenChange={setShowRequestChangesDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>
              Provide actionable feedback for the author before this test case can be published.
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

          <div className="space-y-2 py-2">
            <label
              htmlFor="change-reason"
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block"
            >
              Overall Summary Feedback {stepComments.filter((c) => !c.resolved).length === 0 && <span className="text-red-500">*</span>}
            </label>
            <textarea
              id="change-reason"
              className="w-full min-h-[110px] rounded-lg border border-border/60 bg-background p-3 text-sm focus:outline-none focus:border-primary/70 focus:ring-1 focus:ring-inset focus:ring-primary/40 resize-none leading-relaxed transition-colors"
              value={requestChangesFeedback}
              onChange={(e) => setRequestChangesFeedback(e.target.value)}
              placeholder={
                stepComments.filter((c) => !c.resolved).length > 0
                  ? 'Optional summary note (or leave blank to send your step notes)...'
                  : 'e.g. Please add expected results for steps 2 and 3, and confirm prerequisites...'
              }
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowRequestChangesDialog(false);
                setRequestChangesFeedback('');
              }}
            >
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white font-medium"
              onClick={handleRequestChanges}
              disabled={isSubmittingAction || (!requestChangesFeedback.trim() && stepComments.filter((c) => !c.resolved).length === 0)}
            >
              Submit Feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Modal */}
      {confirmConfig && (
        <ConfirmModal
          open={confirmConfig.open}
          onOpenChange={(open) => !open && setConfirmConfig(null)}
          title={confirmConfig.title}
          description={confirmConfig.description}
          confirmLabel={confirmConfig.confirmLabel}
          variant={confirmConfig.variant}
          onConfirm={confirmConfig.onConfirm}
        />
      )}
    </div>
  );
}
