"use client";

import { useState } from 'react';
import { Upload, Link as LinkIcon, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { uploadFileAction, addExternalLinkAction } from '@/app/actions/attachments';
import { logger } from '@/lib/logger.client';

interface AttachmentUploaderProps {
  entityId: string;
  entityType: string;
  projectId?: string;
  onUploadComplete?: (attachmentId?: string) => void;
}

export function AttachmentUploader({
  entityId,
  entityType,
  projectId,
  onUploadComplete,
}: AttachmentUploaderProps) {
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [externalUrl, setExternalUrl] = useState('');
  const [externalTitle, setExternalTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileUpload = async (file: File) => {
    setIsUploading(true);
    setError(null);

    try {
      // Validate file size
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('File size exceeds 10MB limit');
      }

      // Direct server-side upload (No CORS issues)
      const formData = new FormData();
      formData.append('file', file);
      formData.append('entityId', entityId);
      formData.append('entityType', entityType);
      if (projectId) formData.append('projectId', projectId);

      const result = await uploadFileAction(formData);

      logger.info('File uploaded successfully', {
        component: 'AttachmentUploader',
        attachmentId: result.attachmentId,
        fileName: file.name,
      });

      onUploadComplete?.(result.attachmentId);
    } catch (e: any) {
      setError(e.message);
      logger.error('File upload failed', {
        component: 'AttachmentUploader',
        entityId,
        error: e.message,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleExternalLink = async () => {
    if (!externalUrl.trim()) return;

    setIsUploading(true);
    setError(null);

    try {
      // Add link
      await addExternalLinkAction({
        url: externalUrl,
        title: externalTitle || undefined,
        description: undefined,
        previewUrl: undefined,
        entityId,
        entityType,
        projectId,
      });

      setExternalUrl('');
      setExternalTitle('');
      setShowLinkModal(false);
      onUploadComplete?.();
      logger.info('External link added', {
        component: 'AttachmentUploader',
        entityId,
        url: externalUrl,
      });
    } catch (e: any) {
      setError(e.message);
      logger.error('External link add failed', {
        component: 'AttachmentUploader',
        entityId,
        error: e.message,
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <label className="flex-1">
          <input
            type="file"
            onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
            className="hidden"
            disabled={isUploading}
          />
          <div className="flex items-center justify-center gap-2 p-3 glass rounded-xl border border-border/50 cursor-pointer hover:border-primary/30 transition-all hover-lift">
            <Upload className="h-4 w-4" />
            <span className="text-sm">Upload File (max 10MB)</span>
          </div>
        </label>

        <button
          onClick={() => setShowLinkModal(true)}
          disabled={isUploading}
          className="flex items-center justify-center gap-2 p-3 glass rounded-xl border border-border/50 hover:border-primary/30 transition-all hover-lift disabled:opacity-50"
        >
          <LinkIcon className="h-4 w-4" />
          <span className="text-sm">Add Link</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-500 text-sm">
          {error}
        </div>
      )}

      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowLinkModal(false)} />
          <div className="relative glass rounded-2xl p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-lg">Add External Link</h3>
              <button onClick={() => setShowLinkModal(false)} disabled={isUploading}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">URL</label>
                <Input
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="mt-1 h-10 rounded-xl bg-black/20 border-white/10"
                  disabled={isUploading}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Title (optional)</label>
                <Input
                  value={externalTitle}
                  onChange={(e) => setExternalTitle(e.target.value)}
                  placeholder="My Shared File"
                  className="mt-1 h-10 rounded-xl bg-black/20 border-white/10"
                  disabled={isUploading}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowLinkModal(false)}
                  disabled={isUploading}
                  className="flex-1 h-10 rounded-xl"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleExternalLink}
                  disabled={!externalUrl.trim() || isUploading}
                  className="flex-1 h-10 rounded-xl gradient-btn text-white"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add Link'
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}