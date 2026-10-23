"use client";

import { useState, useEffect } from 'react';
import { AttachmentUploader } from './AttachmentUploader';
import { AttachmentCard } from './AttachmentCard';
import { EmptyState } from '@/components/common/EmptyState';
import { Paperclip } from 'lucide-react';
import { logger } from '@/lib/logger.client';

interface AttachmentListProps {
  entityId: string;
  entityType: string;
  projectId: string;
  attachments: any[];
  onUploadComplete?: () => void;
  showUploader?: boolean;
  onDelete?: (attachmentId: string) => Promise<void>;
}

export function AttachmentList({
  entityId,
  entityType,
  projectId,
  attachments,
  onUploadComplete,
  showUploader = true,
  onDelete,
}: AttachmentListProps) {
  const [localAttachments, setLocalAttachments] = useState(attachments);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setLocalAttachments(attachments);
  }, [attachments]);

  const handleUploadComplete = async () => {
    setIsLoading(true);
    try {
      await onUploadComplete?.();
      logger.info('Attachments refreshed', {
        component: 'AttachmentList',
        entityId,
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (attachmentId: string) => {
    if (!onDelete) return;
    
    try {
      await onDelete(attachmentId);
      setLocalAttachments(prev => prev.filter(a => a.id !== attachmentId));
    } catch (e: any) {
      logger.error('Delete failed', {
        component: 'AttachmentList',
        attachmentId,
        error: e.message,
      });
      throw e;
    }
  };

  if (localAttachments.length === 0 && !showUploader) {
    return null;
  }

  return (
    <div className="space-y-4">
      {showUploader && (
        <AttachmentUploader
          entityId={entityId}
          entityType={entityType}
          projectId={projectId}
          onUploadComplete={handleUploadComplete}
        />
      )}

      {localAttachments.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Paperclip className="h-4 w-4" />
            Attachments ({localAttachments.length})
          </h4>
          <div className="grid gap-3 sm:grid-cols-2">
            {localAttachments.map((attachment) => (
              <AttachmentCard
                key={attachment.id}
                attachment={attachment}
                showDelete={!!onDelete}
                onDelete={onDelete ? handleDelete : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {localAttachments.length === 0 && showUploader && (
        <EmptyState
          icon={Paperclip}
          heading="No attachments yet"
          subtext="Upload files or add links to this item"
        />
      )}

      {isLoading && (
        <div className="text-center py-4 text-sm text-muted-foreground">
          Loading attachments...
        </div>
      )}
    </div>
  );
}