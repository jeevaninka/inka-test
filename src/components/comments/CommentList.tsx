"use client";

import { useState } from 'react';
import { CommentItem } from './CommentItem';
import { CommentBox } from './CommentBox';
import { Button } from '@/components/ui/button';
import { MessageSquare, Plus } from 'lucide-react';
import { createCommentAction, resolveCommentAction, deleteCommentAction } from '@/app/actions/comments';
import { toast } from 'sonner';
import { logger } from '@/lib/logger.client';
import { cn } from '@/lib/utils';

interface CommentListProps {
  entityId: string;
  entityType: string;
  projectId: string;
  comments: any[];
  onCommentAdded?: () => void;
  members?: Array<{ userId: number; user: { id: number; name: string; email: string } }>;
  currentUserId?: number;
  onStepClick?: (stepOrder: number) => void;
  projectSlug?: string;
  caseDisplayId?: string;
}

export function CommentList({
  entityId,
  entityType,
  projectId,
  comments,
  onCommentAdded,
  members = [],
  currentUserId,
  onStepClick,
  projectSlug,
  caseDisplayId,
}: CommentListProps) {
  const [showReplyBox, setShowReplyBox] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [collapsedReplies, setCollapsedReplies] = useState<Set<string>>(new Set());

  const handleSubmitComment = async (data: { body: string; attachmentIds: string[]; assigned_to_id?: number }) => {
    try {
      await createCommentAction({
        project_id: projectId,
        entity_type: entityType,
        entity_id: entityId,
        parent_id: replyingTo || undefined,
        body: data.body,
        attachment_ids: data.attachmentIds,
        assigned_to_id: data.assigned_to_id,
      });
      toast.success(replyingTo ? 'Reply posted' : 'Comment posted');
      onCommentAdded?.();
      setShowReplyBox(false);
      setReplyingTo(null);
    } catch (e: any) {
      toast.error(e.message || 'Failed to post comment');
      throw e;
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await deleteCommentAction(commentId);
      toast.success('Comment deleted');
      onCommentAdded?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete comment');
      throw e;
    }
  };

  const handleResolveComment = async (commentId: string, replyText?: string) => {
    try {
      await resolveCommentAction(commentId, replyText);
      toast.success('Comment resolved');
      onCommentAdded?.();
    } catch (e: any) {
      toast.error(e.message || 'Failed to resolve comment');
      throw e;
    }
  };

  const toggleReplies = (commentId: string) => {
    setCollapsedReplies((prev) => {
      const next = new Set(prev);
      if (next.has(commentId)) {
        next.delete(commentId);
      } else {
        next.add(commentId);
      }
      return next;
    });
  };

  const startReply = (parentId: string, parentComment?: any) => {
    setReplyingTo(parentId);
    setShowReplyBox(true);
  };

  const cancelReply = () => {
    setReplyingTo(null);
    setShowReplyBox(false);
  };

  const [filterMode, setFilterMode] = useState<'all' | 'review'>('all');
  const activeComments = comments.filter((c) => !c.deleted_at);
  const topLevel = activeComments.filter((c) => !c.parent_id);
  const reviewCommentsCount = topLevel.filter(c => /^\[Step\s+\d+\]/i.test(c.body || '')).length;

  const displayedTopLevel = topLevel.filter((c) => {
    if (filterMode === 'review') {
      return /^\[Step\s+\d+\]/i.test(c.body || '');
    }
    return true;
  });

  return (
    <div className="space-y-5">
      {/* Primary Comment Box - Always visible so user can comment at any time */}
      <div className="p-3.5 rounded-xl bg-card border border-border/60 shadow-xs">
        <CommentBox
          entityId={entityId}
          entityType={entityType}
          projectId={projectId}
          onSubmit={handleSubmitComment}
          placeholder="Leave a comment or reviewer feedback..."
          submitLabel="Post Comment"
          members={members}
          currentUserId={currentUserId}
        />
      </div>

      {/* Reply box if replying to a specific comment */}
      {showReplyBox && replyingTo && (
        <div className="p-3.5 rounded-xl bg-muted/30 border border-border/40 space-y-2">
          <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>Replying to comment</span>
            <button
              type="button"
              onClick={cancelReply}
              className="text-xs hover:text-foreground cursor-pointer"
            >
              Cancel
            </button>
          </div>
          <CommentBox
            entityId={entityId}
            entityType={entityType}
            projectId={projectId}
            parentId={replyingTo}
            onSubmit={handleSubmitComment}
            placeholder="Write your reply..."
            submitLabel="Post Reply"
            onCancel={cancelReply}
            members={members}
            currentUserId={currentUserId}
          />
        </div>
      )}

      {/* Comments list or Empty state */}
      {topLevel.length === 0 ? (
        <div className="text-center py-6 border border-dashed border-border/40 rounded-xl bg-muted/[0.02]">
          <MessageSquare className="h-5 w-5 text-muted-foreground/40 mx-auto mb-1.5" />
          <p className="text-xs font-semibold text-foreground">No comments yet</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Use the box above to start the discussion or leave feedback.</p>
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between border-b border-border/40 pb-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilterMode('all')}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer",
                  filterMode === 'all'
                    ? "bg-primary/10 text-primary font-semibold border border-primary/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                All ({topLevel.length})
              </button>
              {reviewCommentsCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilterMode('review')}
                  className={cn(
                    "px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1",
                    filterMode === 'review'
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold border border-amber-500/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <span>Review ({reviewCommentsCount})</span>
                </button>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground font-mono">
              {displayedTopLevel.length} thread{displayedTopLevel.length === 1 ? '' : 's'}
            </span>
          </div>

          <div className="space-y-4">
            {displayedTopLevel.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                onReply={startReply}
                onDelete={handleDeleteComment}
                onResolve={handleResolveComment}
                showReplies={!collapsedReplies.has(comment.id)}
                onToggleReplies={() => toggleReplies(comment.id)}
                isReplying={replyingTo === comment.id}
                currentUserId={currentUserId}
                onStepClick={onStepClick}
                projectSlug={projectSlug}
                caseDisplayId={caseDisplayId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
