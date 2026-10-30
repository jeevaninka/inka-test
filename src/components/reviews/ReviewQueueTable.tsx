'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Tooltip } from '@/components/ui/tooltip';
import { DataTable } from '@/components/common/DataTable';
import { PageHeader } from '@/components/common/PageHeader';
import { UserAvatar } from '@/components/common/UserAvatar';
import { apiClient } from '@/lib/apiClient';
import { logger } from '@/lib/logger.client';
import {
  approveReviewAction,
  requestChangesOnReviewAction,
  assignReviewAction,
  unassignReviewAction,
  getReviewDiffAction,
  cancelReviewAction,
  getReviewQueueAction,
  adminForceApproveAction,
  bulkAdminForceApproveAction,
} from '@/app/actions/reviews';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import {
  getCommentsAction,
} from '@/app/actions/comments';
import { ReviewDiff, type StepCommentItem } from '@/components/reviews/ReviewDiff';
import { motion } from 'framer-motion';
import { MOTION } from '@/lib/motion';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  HoverDropdownMenu,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  AlertCircle,
  Clock,
  UserCheck,
  RotateCcw,
  User,
  Search,
  X,
  ExternalLink,
  ChevronDown,
  MessageSquare,
  Check,
  MoreVertical,
  ClipboardCheck,
  RefreshCw,
  Inbox,
  FileCheck,
  ShieldCheck,
} from 'lucide-react';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { navigateTo } from '@/lib/navigation';
import { format } from 'date-fns';

interface ReviewQueueTableProps {
  projectId: string;
  slug: string;
}

type QueueFilter = 'needs_review' | 'assigned_to_me' | 'changes_requested' | 'my_requests';

function AssigneeDropdownMenu({
  row,
  currentUserId,
  members,
  onAssign,
  onUnassign,
}: {
  row: any;
  currentUserId: number | null;
  members: any[];
  onAssign: (reviewId: string, userId: number) => Promise<void>;
  onUnassign: (reviewId: string) => Promise<void>;
}) {
  const isSelfRequester = row.requestedById === currentUserId;
  const isAssignedToMe = row.assigneeId === currentUserId;

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <HoverDropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 py-0.5 text-xs text-foreground hover:text-primary transition-colors cursor-pointer group select-none outline-none"
            title={
              row.assigneeName
                ? `Reviewer: ${row.assigneeName} (Click to reassign/unassign)`
                : 'Unassigned — Click to assign reviewer'
            }
          >
            {row.assigneeName ? (
              <UserAvatar
                name={row.assigneeName}
                imageUrl={row.assigneeImage}
                color={row.assigneeColor}
                initials={row.assigneeInitials}
                size="sm"
                className="shrink-0"
              />
            ) : (
              <div className="h-5 w-5 rounded-full border border-dashed border-muted-foreground/60 flex items-center justify-center text-muted-foreground shrink-0">
                <User className="h-2.5 w-2.5" />
              </div>
            )}
            <span className={cn("truncate max-w-[100px] font-medium text-xs", !row.assigneeName && "text-muted-foreground")}>
              {row.assigneeName || 'Unassigned'}
            </span>
            <ChevronDown className="h-3 w-3 text-muted-foreground/60 group-hover:text-foreground transition-transform shrink-0" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-56 p-1 rounded-xl">
          <div className="px-2.5 py-1.5 border-b border-border/40 text-[11px] text-muted-foreground font-medium truncate">
            {row.assigneeName ? `Reviewer: ${row.assigneeName}` : 'Status: Unassigned'}
          </div>

          {!isAssignedToMe && !isSelfRequester && currentUserId && (
            <DropdownMenuItem
              onClick={() => onAssign(row.id, currentUserId)}
              className="gap-2 px-2.5 py-2 font-medium text-primary hover:bg-primary/10 cursor-pointer"
            >
              <UserCheck className="h-3.5 w-3.5" />
              <span>Assign to Me</span>
            </DropdownMenuItem>
          )}

          {row.assigneeId && (
            <DropdownMenuItem
              onClick={() => onUnassign(row.id)}
              className="gap-2 px-2.5 py-2 text-rose-500 hover:bg-rose-500/10 focus:text-rose-500 cursor-pointer"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Unassign Reviewer</span>
            </DropdownMenuItem>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuLabel className="px-2.5 py-1 text-[10px] uppercase font-bold text-muted-foreground tracking-wider">
            Assign Team Member
          </DropdownMenuLabel>
          <div className="max-h-48 overflow-y-auto">
            {members
              .filter((m: any) => m.userId !== row.requestedById)
              .map((m: any) => {
                const u = m.user || m;
                const isSelected = row.assigneeId === m.userId;
                return (
                  <DropdownMenuItem
                    key={m.userId}
                    onClick={() => {
                      if (!isSelected) onAssign(row.id, m.userId);
                    }}
                    className={cn(
                      "gap-2 px-2.5 py-1.5 text-xs cursor-pointer",
                      isSelected && "bg-primary/10 text-primary font-semibold"
                    )}
                  >
                    <UserAvatar name={u?.name || u?.email || 'User'} imageUrl={u?.avatarUrl || u?.image} size="sm" className="h-4 w-4 text-[8px]" />
                    <span className="truncate flex-1">{u?.name || u?.email}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  </DropdownMenuItem>
                );
              })}
          </div>
        </DropdownMenuContent>
      </HoverDropdownMenu>
    </div>
  );
}

export function ReviewQueueTable({ projectId, slug }: ReviewQueueTableProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { members, project, currentUser } = useProjectData();
  const currentUserId = session?.user ? (session.user as any).id : null;

  const currentMember = members?.find((m: any) => m.userId === currentUserId || m.user?.id === currentUserId);
  const currentUserRole = (currentMember?.role || (currentUser as any)?.role || '').toUpperCase();
  const isAdmin = currentUserRole === 'ADMIN' || currentUserRole === 'OWNER';
  const reviewRequired = Boolean((project as any)?.reviewRequired);
  const canSkipReview = Boolean(isAdmin || !reviewRequired);

  const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set());
  const [isBulkOperating, setIsBulkOperating] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    open: boolean;
    title: string;
    description: React.ReactNode;
    confirmLabel: string;
    onConfirm: () => void;
    variant?: 'default' | 'destructive';
  } | null>(null);

  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [currentFilter, setCurrentFilter] = useState<'needs_review' | 'my_requests'>('needs_review');
  const [typeFilter, setTypeFilter] = useState<'all' | 'new' | 'updated'>('all');
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'assigned_to_me'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionTarget, setActionTarget] = useState<string | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'changes' | null>(null);
  const [changeComment, setChangeComment] = useState('');
  const [diffModalData, setDiffModalData] = useState<{
    open: boolean;
    title: string;
    displayId: string;
    diff: any;
    reviewId: string;
    testCaseId: string;
    isSelf: boolean;
    status: string;
  } | null>(null);
  const [diffComments, setDiffComments] = useState<any[]>([]);

  const handleClaimAndReview = async (row: any) => {
    if (currentUserId && !row.assigneeId) {
      try {
        await assignReviewAction(row.id, currentUserId);
        window.dispatchEvent(new CustomEvent('review-updated'));
      } catch {}
    }
    router.push(`/p/${slug}/reviews/${row.displayId}`);
  };

  const handleQuickApprove = async (row: any) => {
    try {
      await approveReviewAction(row.id);
      toast.success(`${row.displayId} review approved and published as Active`);
      window.dispatchEvent(new CustomEvent('review-updated'));
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to approve review');
    }
  };

  const handleDirectSkipAndPublish = (row: any) => {
    setConfirmConfig({
      open: true,
      title: 'Skip Review & Publish',
      description: `Bypass peer review and immediately publish ${row.displayId} (${row.title}) as Active in the repository?`,
      confirmLabel: 'Skip Review & Publish',
      variant: 'default',
      onConfirm: async () => {
        try {
          await adminForceApproveAction(row.testCaseId);
          toast.success(`${row.displayId} published as Active`);
          window.dispatchEvent(new CustomEvent('review-updated'));
          await load();
        } catch (e: any) {
          toast.error(e.message || 'Failed to publish test case');
        }
      },
    });
  };

  const handleBulkSkipAndPublish = () => {
    if (selectedReviewIds.size === 0) return;
    const selectedCases = filteredReviews.filter((r) => selectedReviewIds.has(r.id));
    const caseIds = selectedCases.map((r) => r.testCaseId);

    setConfirmConfig({
      open: true,
      title: `Bulk Skip Review & Publish (${selectedReviewIds.size} cases)`,
      description: `This will bypass peer review and publish ${selectedReviewIds.size} test case(s) directly as Active in the repository.`,
      confirmLabel: `Publish ${selectedReviewIds.size} Cases`,
      variant: 'default',
      onConfirm: async () => {
        setIsBulkOperating(true);
        try {
          await bulkAdminForceApproveAction(caseIds);
          toast.success(`Published ${caseIds.length} test case(s) as Active`);
          setSelectedReviewIds(new Set());
          window.dispatchEvent(new CustomEvent('review-updated'));
          await load();
        } catch (e: any) {
          toast.error(e.message || 'Failed to bulk publish cases');
        } finally {
          setIsBulkOperating(false);
        }
      },
    });
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await getReviewQueueAction(projectId, 'all');
      setReviews(data || []);
    } catch {
      try {
        const data = await apiClient.get<any[]>(
          `/api/v1/projects/${encodeURIComponent(projectId)}/reviews`,
          { filter: 'all' }
        );
        setReviews(data || []);
      } catch (err) {
        logger.error('Failed to load review queue', {
          component: 'ReviewQueueTable',
          action: 'load',
          projectId,
          error: err,
        });
      }
    }
    setLoading(false);
    setIsRefreshing(false);
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await load();
  };

  useEffect(() => {
    load();
    const handleReviewUpdate = () => load();
    window.addEventListener('review-updated', handleReviewUpdate);
    return () => window.removeEventListener('review-updated', handleReviewUpdate);
  }, [projectId]);

  const handleApprove = async (id: string) => {
    try {
      await approveReviewAction(id);
      toast.success('Review approved and test case published as Active');
      window.dispatchEvent(new CustomEvent('review-updated'));
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleRequestChanges = async (id: string) => {
    const unresolvedStepNotes = stepComments.filter((c) => !c.resolved);
    let finalFeedback = changeComment.trim();

    if (!finalFeedback && unresolvedStepNotes.length > 0) {
      const stepSummary = unresolvedStepNotes
        .map((s) => `Step ${s.stepOrder}: ${s.body}`)
        .join('; ');
      finalFeedback = `Please address feedback on ${unresolvedStepNotes.length} step(s): ${stepSummary}`;
    }

    if (!finalFeedback) {
      toast.error('Please enter feedback or leave step comments explaining the changes needed');
      return;
    }
    try {
      await requestChangesOnReviewAction(id, finalFeedback);
      toast.success('Changes requested');
      setShowDialog(null);
      setChangeComment('');
      window.dispatchEvent(new CustomEvent('review-updated'));
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleCancelReview = async (testCaseId: string) => {
    try {
      await cancelReviewAction(testCaseId);
      toast.success('Review request cancelled');
      window.dispatchEvent(new CustomEvent('review-updated'));
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleAssign = async (reviewId: string, userId: number) => {
    try {
      await assignReviewAction(reviewId, userId);
      toast.success('Review assigned');
      window.dispatchEvent(new CustomEvent('review-updated'));
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleUnassign = async (reviewId: string) => {
    try {
      await unassignReviewAction(reviewId);
      toast.success('Review unassigned');
      window.dispatchEvent(new CustomEvent('review-updated'));
      await load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleOpenDiff = async (
    testCaseId: string,
    caseTitle: string,
    displayId: string,
    reviewId: string,
    isSelf: boolean,
    status: string
  ) => {
    try {
      const [diff, caseComments] = await Promise.all([
        getReviewDiffAction(testCaseId),
        getCommentsAction(testCaseId, 'case'),
      ]);
      setDiffComments(caseComments || []);
      setDiffModalData({
        open: true,
        title: caseTitle,
        displayId,
        diff,
        reviewId,
        testCaseId,
        isSelf,
        status,
      });
    } catch (e: any) {
      toast.error('Failed to load changes diff');
    }
  };

  const stepComments: StepCommentItem[] = useMemo(() => {
    return diffComments
      .filter((c: any) => !c.deleted_at)
      .map((c: any) => {
        const match = (c.body || '').match(/^\[Step\s+(\d+)\]\s*([\s\S]*)/i);
        if (!match) return null;
        return {
          id: c.id,
          stepOrder: parseInt(match[1], 10),
          authorId: c.author?.id ?? c.author_id,
          authorName: c.author?.name || c.author?.email || 'User',
          authorImage: c.author?.image,
          body: match[2].trim(),
          createdAt: c.created_at || c.createdAt,
          resolved: c.resolved,
        };
      })
      .filter(Boolean) as StepCommentItem[];
  }, [diffComments]);

  const setShowDialog = (id: string | null) => {
    setActionTarget(id);
    setActionType(id ? 'changes' : null);
  };

  // Pre-calculate count badges for the 4 metrics and tabs
  const counts = useMemo(() => {
    let pendingAll = 0;
    let assignedToMe = 0;
    let myRequests = 0;
    let changesRequested = 0;

    for (const r of reviews) {
      const isSelf = r.requestedById === currentUserId;
      const isAssignedToMe = r.assigneeId === currentUserId;
      const isPending = r.requestStatus === 'pending';
      const isChanges = r.requestStatus === 'changes_requested';

      if (isPending) {
        pendingAll++;
        if (isAssignedToMe) assignedToMe++;
      }
      if (isSelf) {
        myRequests++;
      }
      if (isChanges) {
        changesRequested++;
      }
    }

    return {
      needs_review: pendingAll,
      assigned_to_me: assignedToMe,
      my_requests: myRequests,
      changes_requested: changesRequested,
      all: reviews.length,
    };
  }, [reviews, currentUserId]);

  // Filter reviews by tab, type filter, assignee filter, and search query
  const filteredReviews = useMemo(() => {
    return reviews.filter((r) => {
      const isSelf = r.requestedById === currentUserId;
      const isAssignedToMe = r.assigneeId === currentUserId;
      const isPending = r.requestStatus === 'pending';

      if (currentFilter === 'needs_review') {
        if (!isPending) return false;
      } else if (currentFilter === 'my_requests') {
        if (!isSelf) return false;
      }

      if (assigneeFilter === 'assigned_to_me' && !isAssignedToMe) {
        return false;
      }

      if (typeFilter === 'new' && r.hasBaseline) return false;
      if (typeFilter === 'updated' && !r.hasBaseline) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchId = (r.displayId || '').toLowerCase().includes(q);
        const matchTitle = (r.title || '').toLowerCase().includes(q);
        const matchReq = (r.requesterName || '').toLowerCase().includes(q);
        if (!matchId && !matchTitle && !matchReq) return false;
      }

      return true;
    });
  }, [reviews, currentFilter, typeFilter, assigneeFilter, searchQuery, currentUserId]);

  const sortedReviews = useMemo(() => {
    const out = [...filteredReviews].sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return bTime - aTime;
    });
    return out;
  }, [filteredReviews]);

  const columns = [
    {
      id: 'testCase',
      header: 'Test Case',
      className: 'w-full max-w-0 text-left pr-4 pl-2',
      sortable: true,
      sortValue: (row: any) => {
        const match = String(row.displayId || '').match(/\d+/);
        return match ? Number(match[0]) : 0;
      },
      accessor: (row: any) => {
        return (
          <div className="flex items-center gap-2 py-1 min-w-0 w-full">
            {/* Case ID in Teal */}
            <span
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/p/${slug}/reviews/${row.displayId}`);
              }}
              className="font-mono text-xs font-semibold text-primary hover:underline transition-colors cursor-pointer select-all shrink-0"
              title={`Open review workspace: ${row.displayId}`}
            >
              {row.displayId}
            </span>

            {/* Test Case Title */}
            <Tooltip content={row.title} delay={300} side="bottom" onlyOnOverflow wrapperClassName="flex-1 min-w-0 flex items-center" align="start">
              <button
                type="button"
                onClick={() => router.push(`/p/${slug}/reviews/${row.displayId}`)}
                className="font-semibold text-left text-sm text-foreground group-hover:text-primary transition-colors truncate min-w-0 w-full cursor-pointer"
              >
                {row.title}
              </button>
            </Tooltip>

            {/* Optional Author Note snippet if present */}
            {row.comment && (
              <span
                className="truncate max-w-[200px] italic text-[11px] text-muted-foreground/80 hidden 2xl:inline shrink-0"
                title={row.comment}
              >
                &ldquo;{row.comment}&rdquo;
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'type',
      header: 'Type',
      className: 'w-[100px] text-left whitespace-nowrap px-4',
      sortable: true,
      accessor: (row: any) => {
        const isUpdated = Boolean(row.hasBaseline);
        return (
          <span className={cn(
            "text-[11px] font-semibold font-mono",
            isUpdated ? "text-amber-600 dark:text-amber-500" : "text-emerald-700 dark:text-emerald-500"
          )}>
            {isUpdated ? 'Updated' : 'New'}
          </span>
        );
      },
    },
    {
      id: 'requester',
      header: 'Author',
      className: 'hidden lg:table-cell w-[120px] text-left whitespace-nowrap px-4',
      sortable: true,
      accessor: (row: any) => {
        const name = row.requesterName || 'Author';
        const firstName = name.split(' ')[0];
        return (
          <div className="flex items-center gap-1.5 min-w-0" title={`Submitted by: ${name}`}>
            <UserAvatar
              name={name}
              imageUrl={row.requesterImage || row.requesterAvatar}
              color={row.requesterColor}
              initials={row.requesterInitials}
              size="sm"
              className="shrink-0"
            />
            <span className="text-xs font-medium text-foreground truncate">
              {firstName}
            </span>
          </div>
        );
      },
    },
    {
      id: 'assignee',
      header: 'Reviewer',
      className: 'w-[150px] text-left whitespace-nowrap px-4',
      sortable: true,
      accessor: (row: any) => (
        <AssigneeDropdownMenu
          row={row}
          currentUserId={currentUserId}
          members={members || []}
          onAssign={handleAssign}
          onUnassign={handleUnassign}
        />
      ),
    },
    {
      id: 'createdAt',
      header: 'Submitted',
      className: 'hidden xl:table-cell w-[110px] text-left whitespace-nowrap px-4',
      sortable: true,
      accessor: (row: any) => (
        <span className="text-[10.5px] xl:text-xs text-foreground font-semibold font-mono whitespace-nowrap">
          {format(new Date(row.createdAt), 'MMM d, yyyy')}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      className: 'w-[140px] text-right whitespace-nowrap px-4',
      accessor: (row: any) => {
        const isSelf = row.requestedById === currentUserId;
        const isAssignedToMe = row.assigneeId === currentUserId;
        const isUnassigned = !row.assigneeId;
        const isPending = row.requestStatus === 'pending';

        return (
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {/* Equal sized action buttons */}
            {isAssignedToMe ? (
              <Button
                size="sm"
                className="w-[84px] h-7 text-xs px-0 font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-2xs cursor-pointer flex items-center justify-center gap-1 rounded-lg shrink-0"
                onClick={() => handleQuickApprove(row)}
                title="Approve review and mark test case active"
              >
                <Check className="h-3 w-3" />
                <span>Approve</span>
              </Button>
            ) : isUnassigned && !isSelf ? (
              <Button
                size="sm"
                className="w-[84px] h-7 text-xs px-0 font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-2xs cursor-pointer flex items-center justify-center gap-1 rounded-lg shrink-0"
                onClick={() => router.push(`/p/${slug}/reviews/${row.displayId}`)}
                title="Open review workspace"
              >
                <span>Review</span>
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="w-[84px] h-7 text-xs px-0 font-medium border-border/80 hover:bg-muted text-foreground cursor-pointer flex items-center justify-center rounded-lg shrink-0"
                onClick={() => router.push(`/p/${slug}/reviews/${row.displayId}`)}
                title="Open review workspace"
              >
                <span>{isSelf ? 'View' : 'Review'}</span>
              </Button>
            )}

            {/* Radix Dropdown for secondary overflow actions */}
            <HoverDropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer outline-none"
                  title="More actions"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52 p-1 rounded-xl">
                {canSkipReview && (
                  <DropdownMenuItem
                    onClick={() => handleDirectSkipAndPublish(row)}
                    className="gap-2 text-emerald-600 dark:text-emerald-400 font-medium cursor-pointer"
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span>Skip Review &amp; Publish</span>
                  </DropdownMenuItem>
                )}
                {isSelf && isPending && (
                  <DropdownMenuItem
                    onClick={() => handleCancelReview(row.testCaseId)}
                    className="gap-2 text-rose-500 font-medium cursor-pointer"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>Withdraw Review</span>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => router.push(`/p/${slug}/repository/${row.displayId}`)}
                  className="gap-2 text-foreground cursor-pointer"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Open in Repository</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleOpenDiff(row.testCaseId, row.title, row.displayId, row.id, isSelf, row.requestStatus)}
                  className="gap-2 text-foreground cursor-pointer"
                >
                  <FileCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Quick Diff Preview</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </HoverDropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col h-full min-h-0 space-y-3.5">
      {/* ── Row 1: Title & Refresh ── */}
      <PageHeader
        title="Review Queue"
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualRefresh}
            disabled={loading || isRefreshing}
            aria-label="Refresh review items"
            className="h-9 px-3.5 text-xs gap-1.5 rounded-xl border-border/70 hover:bg-muted cursor-pointer shrink-0"
            title="Refresh review items"
          >
            <RefreshCw className={cn('h-3.5 w-3.5 text-muted-foreground', (loading || isRefreshing) && 'animate-spin text-primary')} />
            <span>Refresh</span>
          </Button>
        }
      />

      {/* Tabs below title */}
      <div className="inline-flex max-w-full items-center overflow-x-auto rounded-xl border border-border/60 bg-muted/20 p-1 text-xs font-medium scrollbar-none">
        <button
          type="button"
          onClick={() => {
            setCurrentFilter('needs_review');
            setSelectedReviewIds(new Set());
          }}
          className={cn(
            'shrink-0 px-3 py-1 rounded-lg transition-colors cursor-pointer',
            currentFilter === 'needs_review'
              ? 'bg-primary/15 text-primary font-semibold shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Needs Review ({counts.needs_review})
        </button>
        <button
          type="button"
          onClick={() => {
            setCurrentFilter('my_requests');
            setSelectedReviewIds(new Set());
          }}
          className={cn(
            'shrink-0 px-3 py-1 rounded-lg transition-colors cursor-pointer',
            currentFilter === 'my_requests'
              ? 'bg-primary/15 text-primary font-semibold shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          My Submissions ({counts.my_requests})
        </button>
      </div>

      {/* ── Row 2: Search, Filters & Bulk Actions ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-2xl flex-wrap sm:flex-nowrap">
          <div className="relative min-w-0 flex-1 basis-[180px] sm:basis-auto">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search by ID, title, or author..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-7 text-xs bg-background"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select
            value={typeFilter}
            onValueChange={(val) => setTypeFilter(val as 'all' | 'new' | 'updated')}
            options={[
              { value: 'all', label: 'All Types' },
              { value: 'new', label: 'New' },
              { value: 'updated', label: 'Updated' },
            ]}
            className="w-32 h-8 text-xs shrink-0"
          />

          {currentFilter === 'needs_review' && (
            <button
              type="button"
              onClick={() => setAssigneeFilter(assigneeFilter === 'assigned_to_me' ? 'all' : 'assigned_to_me')}
              className={cn(
                'h-8 px-3 rounded-xl border text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 shrink-0',
                assigneeFilter === 'assigned_to_me'
                  ? 'bg-primary/15 border-primary/40 text-primary font-semibold'
                  : 'border-input bg-background/80 text-muted-foreground hover:text-foreground hover:bg-muted/30'
              )}
            >
              <UserCheck className="h-3.5 w-3.5" />
              <span>Assigned to Me ({counts.assigned_to_me})</span>
            </button>
          )}
        </div>

        {/* Bulk Actions Bar */}
        {selectedReviewIds.size > 0 && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg border bg-muted/40 animate-in fade-in-0 duration-150">
            <span className="text-xs font-medium">{selectedReviewIds.size} selected</span>
            <div className="h-3.5 w-px bg-border" />
            {canSkipReview && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkSkipAndPublish}
                disabled={isBulkOperating}
                className="h-7 text-xs px-2.5 text-primary border-primary/30 hover:bg-primary/10 cursor-pointer flex items-center gap-1"
              >
                <Check className="h-3 w-3" />
                <span>Skip &amp; Publish</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedReviewIds(new Set())}
              className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* ── Table Surface ── */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-xl border border-border/50 bg-card/20 shadow-xs">
        <DataTable
          columns={columns}
          data={sortedReviews}
          loading={loading}
          selectable={true}
          selectedIds={selectedReviewIds}
          onSelectionChange={setSelectedReviewIds}
          tableClassName="w-full"
          checkboxCellClassName="w-6 pl-4 pr-1"
          onRowClick={(row: any, event: any) => navigateTo(event, `/p/${slug}/reviews/${row.displayId}`, router.push)}
          getId={(row: any) => row.id}
          emptyComponent={
            <div className="text-sm text-muted-foreground text-center py-20 flex flex-col items-center justify-center">
              <div className="h-12 w-12 rounded-2xl bg-muted/30 border border-border/40 flex items-center justify-center text-muted-foreground mb-3 shadow-2xs">
                <Inbox className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <p className="font-semibold text-foreground text-base">All caught up!</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm text-center">
                {currentFilter === 'needs_review'
                  ? assigneeFilter === 'assigned_to_me'
                    ? 'No pending reviews assigned directly to you.'
                    : 'No pending test case reviews in the queue.'
                  : 'You have no open review requests submitted.'}
              </p>
            </div>
          }
        />
      </div>

      {/* ── Request Changes Dialog ── */}
      <Dialog
        open={actionType === 'changes'}
        onOpenChange={(open) => {
          if (!open) {
            setShowDialog(null);
            setChangeComment('');
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>
              Explain the required improvements, test data adjustments, or clarifications for the author.
            </DialogDescription>
          </DialogHeader>

          {stepComments.filter((c) => !c.resolved).length > 0 && (
            <div className="p-3 rounded-xl border border-amber-500/25 bg-amber-500/10 text-xs space-y-1">
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
              className="w-full min-h-[110px] rounded-lg border border-border/60 bg-background p-3 text-sm focus:outline-none focus:border-primary/70 focus:ring-1 focus:ring-inset focus:ring-primary/40 resize-none transition-colors"
              value={changeComment}
              onChange={(e) => setChangeComment(e.target.value)}
              placeholder={
                stepComments.filter((c) => !c.resolved).length > 0
                  ? "Optional summary note (or leave blank to use your step notes)..."
                  : "e.g. Please add expected results for steps 2 and 3, and confirm prerequisites..."
              }
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowDialog(null);
                setChangeComment('');
              }}
            >
              Cancel
            </Button>
            <Button
              className="bg-amber-600 hover:bg-amber-700 text-white font-medium"
              onClick={() => actionTarget && handleRequestChanges(actionTarget)}
              disabled={!changeComment.trim() && stepComments.filter((c) => !c.resolved).length === 0}
            >
              Submit Feedback
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Diff Preview Dialog ── */}
      {diffModalData && (
        <Dialog
          open={diffModalData.open}
          onOpenChange={(open) => !open && setDiffModalData(null)}
        >
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <div className="flex items-center justify-between gap-3 mr-6">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-muted-foreground">
                      {diffModalData.displayId}
                    </span>
                    <DialogTitle className="text-lg font-bold">{diffModalData.title}</DialogTitle>
                  </div>
                  <DialogDescription className="mt-1">
                    {diffModalData.diff?.baselineVersion
                      ? `Comparing Baseline Version ${diffModalData.diff.baselineVersion} (Approved) to Proposed Revision (Right)`
                      : 'New test case draft'}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="py-2">
              {diffModalData.diff?.before && diffModalData.diff?.after ? (
                <ReviewDiff
                  before={diffModalData.diff.before}
                  after={diffModalData.diff.after}
                  stepComments={stepComments}
                />
              ) : (
                <div className="py-8 text-center text-xs text-muted-foreground">
                  No previous baseline to compare against.
                </div>
              )}
            </div>

            <DialogFooter className="gap-2 border-t pt-3">
              <Button variant="outline" onClick={() => setDiffModalData(null)}>
                Close
              </Button>
              {canSkipReview && (
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1.5"
                  onClick={async () => {
                    await handleApprove(diffModalData.reviewId);
                    setDiffModalData(null);
                  }}
                >
                  <Check className="h-4 w-4" />
                  <span>Approve &amp; Publish</span>
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Confirmation Modal ── */}
      {confirmConfig && (
        <ConfirmModal
          open={confirmConfig.open}
          onOpenChange={(open) => !open && setConfirmConfig(null)}
          title={confirmConfig.title}
          description={confirmConfig.description}
          confirmLabel={confirmConfig.confirmLabel}
          onConfirm={confirmConfig.onConfirm}
          variant={confirmConfig.variant || 'default'}
        />
      )}
    </div>
  );
}
