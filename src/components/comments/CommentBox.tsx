"use client";

import { useState } from 'react';
import { Paperclip, X, Loader2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RichTextEditor } from '@/components/common/RichTextEditor';
import { AttachmentUploader } from '@/components/attachments/AttachmentUploader';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger.client';

interface CommentBoxProps {
  entityId: string;
  entityType: string;
  projectId: string;
  parentId?: string;
  onSubmit: (data: { body: string; attachmentIds: string[]; assigned_to_id?: number }) => Promise<void>;
  placeholder?: string;
  cancelLabel?: string;
  submitLabel?: string;
  onCancel?: () => void;
  parentComment?: {
    author: { name: string };
    body: string;
  };
  members?: Array<{ userId: number; user: { id: number; name: string; email: string } }>;
  currentUserId?: number;
}

export function CommentBox({
  entityId,
  entityType,
  projectId,
  parentId,
  onSubmit,
  placeholder = "Write a comment...",
  cancelLabel = "Cancel",
  submitLabel = "Post Comment",
  onCancel,
  parentComment,
  members = [],
  currentUserId,
}: CommentBoxProps) {
  const [body, setBody] = useState('');
  const [attachmentIds, setAttachmentIds] = useState<string[]>([]);
  const [showUploader, setShowUploader] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignedToId, setAssignedToId] = useState<number | null>(null);
  const [showAssignMenu, setShowAssignMenu] = useState(false);

  const handleAttachmentUpload = (attachmentId: string) => {
    setAttachmentIds(prev => [...prev, attachmentId]);
  };

  const handleSubmit = async () => {
    if (!body.trim() && attachmentIds.length === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        body: body.trim(),
        attachmentIds,
        assigned_to_id: assignedToId || undefined,
      });
      setBody('');
      setAttachmentIds([]);
      setShowUploader(false);
      setAssignedToId(null);
      onCancel?.();
      logger.info('Comment submitted', {
        component: 'CommentBox',
        entityId,
        hasAttachments: attachmentIds.length > 0,
        hasAssignee: !!assignedToId,
      });
    } catch (e: any) {
      setError(e.message);
      logger.error('Comment submission failed', {
        component: 'CommentBox',
        entityId,
        error: e.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-3">
      {parentComment && (
        <div className="p-3 rounded-lg bg-muted/50 border-l-4 border-primary/30">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            Replying to {parentComment.author.name}
          </p>
          <p className="text-sm text-muted-foreground italic line-clamp-2">
            {parentComment.body}
          </p>
        </div>
      )}

      <div className="comment-rich-text-container">
        <RichTextEditor
          value={body}
          onChange={setBody}
          placeholder={placeholder}
          className="border-border/70 bg-background"
          disabled={isSubmitting}
        />
      </div>

      {showUploader && (
        <div className="p-3 rounded-lg bg-muted/30">
          <AttachmentUploader
            entityId={entityId}
            entityType={entityType}
            projectId={projectId}
            onUploadComplete={(attachmentId) => {
              if (attachmentId) {
                setAttachmentIds(prev => [...prev, attachmentId]);
              }
            }}
          />
        </div>
      )}

      {attachmentIds.length > 0 && (
        <div className="text-xs text-muted-foreground">
          {attachmentIds.length} attachment(s) ready to upload
        </div>
      )}

      {error && (
        <div className="p-2 rounded-lg bg-red-500/10 text-red-500 text-sm">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          onClick={() => setShowUploader(!showUploader)}
          variant="outline"
          size="sm"
          className="rounded-xl"
        >
          <Paperclip className="h-4 w-4 mr-2" />
          Attach
        </Button>

        {onCancel && (
          <Button
            onClick={onCancel}
            variant="outline"
            size="sm"
            className="rounded-xl"
            disabled={isSubmitting}
          >
            {cancelLabel}
          </Button>
        )}

        {(members.length > 0 || currentUserId) && !parentId && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowAssignMenu(!showAssignMenu)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs border transition-colors cursor-pointer",
                assignedToId
                  ? "border-primary/50 bg-primary/10 text-primary font-medium"
                  : "border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40"
              )}
            >
              <UserPlus className="h-3.5 w-3.5" />
              <span>
                {assignedToId
                  ? (assignedToId === currentUserId ? 'Assigned to You' : (members.find(m => m.userId === assignedToId)?.user.name || 'Assigned'))
                  : 'Assign'}
              </span>
            </button>

            {showAssignMenu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowAssignMenu(false)}
                />
                <div className="absolute bottom-full left-0 mb-1.5 z-[80] bg-popover border border-border/80 rounded-xl shadow-2xl p-1.5 min-w-[180px] text-xs divide-y divide-border/20">
                  <div className="py-0.5 space-y-0.5">
                    {currentUserId && (
                      <button
                        type="button"
                        onClick={() => {
                          setAssignedToId(currentUserId);
                          setShowAssignMenu(false);
                        }}
                        className={cn(
                          "w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted transition-colors flex items-center justify-between font-medium cursor-pointer",
                          assignedToId === currentUserId ? "bg-primary/10 text-primary" : "text-primary"
                        )}
                      >
                        <span>Assign to me (You)</span>
                        <span className="text-[10px] px-1 py-0.2 rounded bg-primary/10">You</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setAssignedToId(null);
                        setShowAssignMenu(false);
                      }}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground cursor-pointer",
                        !assignedToId && "bg-muted font-medium text-foreground"
                      )}
                    >
                      Unassigned (None)
                    </button>
                  </div>
                  {members.length > 0 && (
                    <div className="py-0.5 space-y-0.5 max-h-48 overflow-y-auto">
                      {members.map((m) => {
                        const isMe = m.userId === currentUserId;
                        return (
                          <button
                            key={m.userId}
                            type="button"
                            onClick={() => {
                              setAssignedToId(m.userId);
                              setShowAssignMenu(false);
                            }}
                            className={cn(
                              "w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-muted transition-colors flex items-center justify-between cursor-pointer",
                              assignedToId === m.userId && "bg-primary/10 text-primary font-medium"
                            )}
                          >
                            <span className="truncate">{m.user.name}</span>
                            {isMe && <span className="text-[10px] text-muted-foreground">(You)</span>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <Button
          onClick={handleSubmit}
          disabled={(!body.trim() && attachmentIds.length === 0) || isSubmitting}
          className="ml-auto btn-glow rounded-xl"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Posting...
            </>
          ) : (
            submitLabel
          )}
        </Button>
      </div>
    </div>
  );
}


