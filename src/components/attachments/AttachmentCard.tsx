"use client";

import { File, Link as LinkIcon, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { logger } from '@/lib/logger.client';

interface AttachmentCardProps {
  attachment: {
    id: string;
    filename: string;
    storage_type: 'S3' | 'EXTERNAL_LINK';
    storage_key: string | null;
    external_url: string | null;
    preview_url: string | null;
    mime_type: string | null;
    size_bytes: number | null;
    title?: string | null;
  };
  onDelete?: (attachmentId: string) => void;
  showDelete?: boolean;
}

export function AttachmentCard({ 
  attachment, 
  onDelete,
  showDelete = false 
}: AttachmentCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!onDelete) return;
    
    setIsDeleting(true);
    try {
      await onDelete(attachment.id);
      logger.info('Attachment deleted', {
        component: 'AttachmentCard',
        attachmentId: attachment.id,
      });
    } catch (e: any) {
      logger.error('Delete failed', {
        component: 'AttachmentCard',
        attachmentId: attachment.id,
        error: e.message,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const formatSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (attachment.storage_type === 'EXTERNAL_LINK') {
    return (
      <div className="group relative glass rounded-xl border border-border/50 overflow-hidden hover:border-primary/30 transition-all hover-lift">
        <a
          href={attachment.external_url || '#'}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-3 p-4"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
            <LinkIcon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">
              {attachment.title || attachment.filename || 'External Link'}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {attachment.external_url}
            </p>
          </div>
        </a>
        
        {attachment.preview_url && (
          <div className="px-4 pb-4">
            <img
              src={attachment.preview_url}
              alt="Preview"
              className="w-full h-32 object-cover rounded-lg"
            />
          </div>
        )}
        
        {showDelete && onDelete && (
          <button
            onClick={handleDelete}
            disabled={isDeleting}
            className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
    );
  }

  // S3 File
  return (
    <div className="group relative glass rounded-xl border border-border/50 overflow-hidden hover:border-primary/30 transition-all hover-lift">
      <a
        href={`/api/v1/attachments/${attachment.id}/download`}
        className="flex items-center gap-3 p-4"
      >
        <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-500 shrink-0">
          {attachment.mime_type?.startsWith('image/') ? (
            <img
              src={`/api/v1/attachments/${attachment.id}/download`}
              alt={attachment.filename}
              className="w-10 h-10 rounded-lg object-cover"
            />
          ) : (
            <File className="h-5 w-5" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{attachment.filename}</p>
          <p className="text-xs text-muted-foreground">
            {attachment.mime_type || 'Unknown type'} • {formatSize(attachment.size_bytes)}
          </p>
        </div>
      </a>
      
      {showDelete && onDelete && (
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500/10 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20"
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      )}
    </div>
  );
}