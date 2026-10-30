"use client";

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { CommentList } from '@/components/comments/CommentList';
import { getCommentsAction } from '@/app/actions/comments';
import { toast } from 'sonner';

interface RunCommentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityId: string;
  /** `run` for the whole run, `run_result` for one case in the deck. */
  entityType: 'run' | 'run_result';
  projectId: string;
  title: string;
  description?: string;
  members?: Array<{ userId: number; user: { id: number; name: string; email: string } }>;
  currentUserId?: number;
}

/**
 * Threaded discussion for a run or one of its cases (C2).
 *
 * Comments already live on the server (`Comment` is polymorphic over `run` and
 * `run_result`); this is the run-deck surface for them.
 */
export function RunCommentsDialog({
  open,
  onOpenChange,
  entityId,
  entityType,
  projectId,
  title,
  description,
  members = [],
  currentUserId,
}: RunCommentsDialogProps) {
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    try {
      const rows = await getCommentsAction(entityId, entityType);
      setComments(rows || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load comments');
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-[640px] p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-3 border-b border-border/60">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <MessageSquare className="h-4 w-4 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {description || 'Discuss this with your team. Use @ to mention someone.'}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading comments…
            </div>
          ) : (
            <CommentList
              entityId={entityId}
              entityType={entityType}
              projectId={projectId}
              comments={comments}
              onCommentAdded={() => void load()}
              members={members}
              currentUserId={currentUserId}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
