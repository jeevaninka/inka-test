"use client";

import { useState } from 'react';
import { format } from 'date-fns';
import { MessageSquare, Trash2, Loader2, Reply, CheckCircle2, AlertCircle, Pencil, Smile, Check, X, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger.client';
import { updateCommentAction } from '@/app/actions/comments';
import { UserAvatar } from '@/components/common/UserAvatar';
import { toast } from 'sonner';
import DOMPurify from 'isomorphic-dompurify';

interface CommentItemProps {
  comment: {
    id: string;
    body: string;
    author: {
      id: number;
      name: string;
      email: string;
      image?: string | null;
      avatar_color?: string | null;
      avatar_initials?: string | null;
    };
    created_at: string;
    updated_at?: string | null;
    attachment_ids?: string[];
    replies: any[];
    resolved?: boolean;
    resolved_at?: string | null;
    resolvedBy?: {
      id: number;
      name: string;
    } | null;
    assignedTo?: {
      id: number;
      name: string;
    } | null;
  };
  parentId?: string;
  onReply: (parentId: string, parentComment?: any) => void;
  onDelete: (commentId: string) => Promise<void>;
  onResolve?: (commentId: string, replyText?: string) => Promise<void>;
  showReplies?: boolean;
  onToggleReplies: () => void;
  isReplying?: boolean;
  currentUserId?: number;
  onStepClick?: (stepOrder: number) => void;
  projectSlug?: string;
  caseDisplayId?: string;
}

export function CommentItem({
  comment,
  parentId,
  onReply,
  onDelete,
  onResolve,
  showReplies = false,
  onToggleReplies,
  isReplying = false,
  currentUserId,
  onStepClick,
  projectSlug,
  caseDisplayId,
}: CommentItemProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showResolveInput, setShowResolveInput] = useState(false);
  const [resolveReply, setResolveReply] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editBody, setEditBody] = useState(comment.body);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [reactions, setReactions] = useState<{ [emoji: string]: number }>({});
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());
  const [showReactionPicker, setShowReactionPicker] = useState(false);

  const toggleReaction = (emoji: string) => {
    setReactions((prev) => {
      const current = prev[emoji] || 0;
      const hasMine = myReactions.has(emoji);
      return {
        ...prev,
        [emoji]: hasMine ? Math.max(0, current - 1) : current + 1,
      };
    });
    setMyReactions((prev) => {
      const next = new Set(prev);
      if (next.has(emoji)) next.delete(emoji);
      else next.add(emoji);
      return next;
    });
    setShowReactionPicker(false);
  };

  const handleSaveEdit = async () => {
    if (!editBody.trim()) return;
    setIsSavingEdit(true);
    try {
      await updateCommentAction(comment.id, editBody.trim());
      comment.body = editBody.trim();
      setIsEditing(false);
      toast.success('Comment updated');
    } catch (e: any) {
      toast.error(e.message || 'Failed to update comment');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(comment.id);
      logger.info('Comment deleted', {
        component: 'CommentItem',
        commentId: comment.id,
      });
    } catch (e: any) {
      logger.error('Delete failed', {
        component: 'CommentItem',
        commentId: comment.id,
        error: e.message,
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleResolve = async () => {
    if (!onResolve) return;
    setIsResolving(true);
    try {
      await onResolve(comment.id, resolveReply || undefined);
      logger.info('Comment resolved', {
        component: 'CommentItem',
        commentId: comment.id,
      });
      setShowResolveInput(false);
      setResolveReply('');
    } catch (e: any) {
      logger.error('Resolve failed', {
        component: 'CommentItem',
        commentId: comment.id,
        error: e.message,
      });
    } finally {
      setIsResolving(false);
    }
  };

  const handleReply = () => {
    onReply(comment.id, {
      author: { name: comment.author.name },
      body: comment.body,
    });
  };

  const formatDate = (dateInput: string | Date | undefined) => {
    if (!dateInput) return 'Just now';
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return 'Just now';

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    // Minor future clock skew
    if (diffMs < 45 * 1000 && diffMs >= -30 * 1000) return 'Just now';
    if (diffMs < 0) return format(date, 'MMM d, yyyy · h:mm a');

    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHours = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return format(date, 'MMM d, yyyy · h:mm a');
  };

  const getFullTimestamp = (dateInput: string | Date | undefined) => {
    if (!dateInput) return '';
    const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
    if (isNaN(date.getTime())) return '';
    return format(date, 'MMMM d, yyyy · h:mm:ss a');
  };

  const getAvatarInitials = () => {
    if (comment.author.avatar_initials) return comment.author.avatar_initials;
    if (comment.author.name) {
      const parts = comment.author.name.split(' ');
      if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
      }
      return parts[0].slice(0, 2).toUpperCase();
    }
    return comment.author.email.slice(0, 2).toUpperCase();
  };

  const avatarColor = comment.author.avatar_color || '#6366f1';

  const isOwner = currentUserId === comment.author.id;

  return (
    <div className={cn(
      "space-y-3",
      parentId && "ml-0 md:ml-8 pl-4 border-l-2 border-border/50"
    )}>
      {/* Resolved badge */}
      {comment.resolved && (
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-200/20 mb-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
          <span className="text-xs text-green-700 dark:text-green-400 font-medium">
            Resolved by {comment.resolvedBy?.name || 'someone'}
            {comment.resolved_at && (
              <span title={getFullTimestamp(comment.resolved_at)}>
                {` · ${formatDate(comment.resolved_at)}`}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Quoted parent comment for replies */}
      {parentId && (
        <div className="p-3 rounded-lg bg-muted/30 border-l-2 border-primary/20 mb-3">
          <div className="flex items-center gap-2 mb-1">
            <Reply className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              Replying
            </span>
          </div>
        </div>
      )}

      <div className={cn("group", comment.resolved && "opacity-70")}>
        <div className="flex gap-3">
          {/* Avatar */}
          <div className="shrink-0">
            <UserAvatar
              userId={comment.author.id}
              name={comment.author.name}
              email={comment.author.email}
              imageUrl={comment.author.image}
              color={comment.author.avatar_color}
              initials={comment.author.avatar_initials}
              size="md"
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm">{comment.author.name}</span>
              {comment.assignedTo && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium">
                  Assigned to {comment.assignedTo.name}
                </span>
              )}
              <span className="text-xs text-muted-foreground" title={getFullTimestamp(comment.created_at)}>
                {formatDate(comment.created_at)}
              </span>
              {comment.updated_at &&
                comment.created_at &&
                new Date(comment.updated_at).getTime() - new Date(comment.created_at).getTime() > 10000 && (
                  <span className="text-xs text-muted-foreground/75" title={getFullTimestamp(comment.updated_at)}>
                    (edited)
                  </span>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-2 mt-2 p-2.5 rounded-xl border border-primary/40 bg-card/60">
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  className="w-full text-xs bg-transparent border-none outline-none resize-none min-h-[70px] text-foreground focus:ring-0 p-0 leading-relaxed"
                  placeholder="Edit comment..."
                  autoFocus
                />
                <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border/20">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsEditing(false);
                      setEditBody(comment.body);
                    }}
                    className="h-6 px-2 text-xs"
                    disabled={isSavingEdit}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveEdit}
                    disabled={isSavingEdit || !editBody.trim()}
                    className="h-6 px-2.5 text-xs font-semibold"
                  >
                    {isSavingEdit ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                {(() => {
                  const match = (comment.body || '').match(/^\[Step\s+(\d+)\]/i);
                  if (match) {
                    const stepNum = parseInt(match[1], 10);
                    return (
                      <div className="mb-1.5 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/25 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => onStepClick?.(stepNum)}
                          className={cn(
                            "hover:underline cursor-pointer flex items-center gap-1",
                            !onStepClick && "cursor-default hover:no-underline"
                          )}
                          title={onStepClick ? `Scroll to Step ${stepNum} in editor` : undefined}
                        >
                          <span>Step {stepNum}</span>
                        </button>
                        {projectSlug && caseDisplayId && (
                          <Link
                            href={`/p/${projectSlug}/reviews/${caseDisplayId}?step=${stepNum}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-amber-700/70 dark:text-amber-400/70 hover:text-amber-700 dark:hover:text-amber-300 p-0.5 rounded hover:bg-amber-500/20 transition-colors"
                            title="Open full review workspace for this step"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-2.5 w-2.5" />
                          </Link>
                        )}
                      </div>
                    );
                  }
                  return null;
                })()}
                <div 
                  className="text-sm text-foreground leading-relaxed prose prose-sm dark:prose-invert max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize((comment.body || '').replace(/^\[Step\s+\d+\]\s*/i, ''), {
                      ALLOWED_TAGS: ['p', 'b', 'i', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'code', 'pre', 'span', 'br', 'blockquote'],
                      ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
                      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
                    })
                  }}
                />
              </div>
            )}

            {/* Attachments indicator */}
            {comment.attachment_ids && comment.attachment_ids.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                {comment.attachment_ids.length} attachment(s)
              </div>
            )}

            {/* Reactions bar */}
            <div className="flex items-center gap-1.5 flex-wrap mt-2">
              {Object.entries(reactions).filter(([_, count]) => count > 0).map(([emoji, count]) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => toggleReaction(emoji)}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors cursor-pointer",
                    myReactions.has(emoji)
                      ? "bg-primary/15 border-primary/40 text-primary font-semibold"
                      : "bg-muted/40 border-border/40 text-muted-foreground hover:bg-muted/70"
                  )}
                >
                  <span>{emoji}</span>
                  <span className="font-mono text-[10px]">{count}</span>
                </button>
              ))}

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowReactionPicker(!showReactionPicker)}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors cursor-pointer text-xs"
                  title="Add emoji reaction"
                >
                  <Smile className="h-3.5 w-3.5" />
                </button>
                {showReactionPicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowReactionPicker(false)} />
                    <div className="absolute bottom-full left-0 mb-1.5 z-[80] bg-popover border border-border/80 rounded-xl shadow-2xl p-1 flex items-center gap-1 text-sm animate-in fade-in-0 duration-100">
                      {['👍', '❤️', '🎉', '🚀', '👀'].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => toggleReaction(emoji)}
                          className="p-1 hover:bg-muted rounded-lg text-base cursor-pointer hover:scale-125 transition-transform"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3.5 mt-2.5">
              <button
                type="button"
                onClick={handleReply}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Reply className="h-3 w-3" />
                Reply
              </button>

              {comment.replies && comment.replies.length > 0 && (
                <button
                  type="button"
                  onClick={onToggleReplies}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <MessageSquare className="h-3 w-3" />
                  <span>{comment.replies.length} {comment.replies.length === 1 ? 'reply' : 'replies'}</span>
                  <span className="text-[10px] text-muted-foreground/80 font-mono">
                    ({showReplies ? 'hide' : 'show'})
                  </span>
                </button>
              )}

              {isOwner && !isReplying && !isEditing && (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(true);
                    setEditBody(comment.body);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 cursor-pointer opacity-80 group-hover:opacity-100"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
              )}

              {onResolve && !comment.resolved && (
                <button
                  type="button"
                  onClick={() => setShowResolveInput(!showResolveInput)}
                  className="text-xs text-green-600 hover:text-green-700 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  Resolve
                </button>
              )}

              {isOwner && !isReplying && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-xs text-muted-foreground hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                >
                  <Trash2 className="h-3 w-3 mr-0.5" />
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Resolve inline form */}
      {showResolveInput && !comment.resolved && (
        <div className="ml-12 p-3 rounded-lg bg-green-500/5 border border-green-200/20 space-y-2">
          <textarea
            value={resolveReply}
            onChange={(e) => setResolveReply(e.target.value)}
            placeholder="Optional reply when resolving..."
            className="w-full min-h-[60px] rounded-lg border border-border/50 bg-transparent p-2 text-sm resize-none"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs bg-green-600 hover:bg-green-700"
              onClick={handleResolve}
              disabled={isResolving}
            >
              {isResolving ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <CheckCircle2 className="h-3 w-3 mr-1" />
              )}
              Resolve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => { setShowResolveInput(false); setResolveReply(''); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative glass rounded-xl p-6 max-w-sm mx-4">
            <h3 className="font-semibold mb-2">Delete Comment?</h3>
            <p className="text-sm text-muted-foreground mb-4">
              This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1"
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                className="flex-1"
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Delete'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Replies */}
      {showReplies && comment.replies && comment.replies.length > 0 && (
        <div className="mt-4 space-y-4">
          {comment.replies.map((reply: any) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              parentId={comment.id}
              onReply={onReply}
              onDelete={onDelete}
              onResolve={onResolve}
              showReplies={true}
              onToggleReplies={() => {}}
              currentUserId={currentUserId}
              onStepClick={onStepClick}
              projectSlug={projectSlug}
              caseDisplayId={caseDisplayId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
