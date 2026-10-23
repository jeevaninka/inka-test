"use client";

import React from 'react';
import { Paperclip, FileText, X } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';

export function isImageAttachment(filename?: string): boolean {
  if (!filename) return false;
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext);
}

export interface StepEvidenceControlProps {
  order: number;
  attachments?: Array<{ id: string; filename: string; key: string }>;
  disabled?: boolean;
  onAttach: (file: File) => void;
  onDelete?: (attachmentId: string) => void;
  onOpenAttachment?: (id: string) => void;
}

export function StepEvidenceControl({
  attachments,
  disabled = false,
  onAttach,
}: StepEvidenceControlProps) {
  if (disabled) return null;

  const count = attachments?.length || 0;

  if (count === 0) {
    return (
      <Tooltip content="Attach evidence to step" side="top" align="end">
        <label className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all cursor-pointer border border-white/10 shrink-0 opacity-0 group-hover:opacity-100">
          <Paperclip className="h-3.5 w-3.5" />
          <input
            type="file"
            hidden
            accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.log,.json,.zip,.tar,.gz,.7z"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onAttach(file);
              e.target.value = '';
            }}
          />
        </label>
      </Tooltip>
    );
  }

  return (
    <Tooltip content={`${count} file${count > 1 ? 's' : ''} attached. Click to add more.`} side="top" align="end">
      <label className="relative h-7 w-7 rounded-lg flex items-center justify-center text-blue-400 bg-blue-500/15 border border-blue-500/30 hover:bg-blue-500/25 transition-colors cursor-pointer shrink-0 shadow-xs">
        <Paperclip className="h-3.5 w-3.5" />
        <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white font-mono font-bold text-[8px] min-w-[13px] h-[13px] px-0.5 rounded-full flex items-center justify-center border border-background shadow-xs pointer-events-none leading-none">
          {count}
        </span>
        <input
          type="file"
          hidden
          accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.log,.json,.zip,.tar,.gz,.7z"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onAttach(file);
            e.target.value = '';
          }}
        />
      </label>
    </Tooltip>
  );
}

export interface StepEvidenceExpandedRowProps {
  order: number;
  attachments?: Array<{ id: string; filename: string; key: string }>;
  disabled?: boolean;
  onDelete: (attachmentId: string) => void;
  onOpenAttachment: (id: string, filename?: string) => void;
}

export function StepEvidenceExpandedRow({
  attachments,
  disabled = false,
  onDelete,
  onOpenAttachment,
}: StepEvidenceExpandedRowProps) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="mt-2 ml-[60px] pt-1.5 border-t border-white/5 flex items-center gap-2.5 flex-wrap">
      {attachments.map((att) => {
        const isImg = isImageAttachment(att.filename);
        return (
          <div
            key={att.id}
            className="relative group/thumb shrink-0"
          >
            <Tooltip content={`${att.filename} (Click to preview)`} side="top" align="center">
              <button
                type="button"
                onClick={() => onOpenAttachment(att.id, att.filename)}
                className="w-14 h-14 rounded-lg overflow-hidden bg-black/60 border border-white/15 hover:border-blue-400/60 transition-all cursor-pointer shadow-xs flex items-center justify-center hover:scale-[1.03]"
              >
                {isImg ? (
                  <img
                    src={`/api/v1/attachments/${att.id}/download`}
                    alt={att.filename}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-1 text-center">
                    <FileText className="h-5 w-5 text-muted-foreground mb-0.5" />
                    <span className="text-[8px] font-mono text-muted-foreground uppercase truncate max-w-[44px]">
                      {att.filename.split('.').pop() || 'FILE'}
                    </span>
                  </div>
                )}
              </button>
            </Tooltip>

            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(att.id);
                }}
                className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center justify-center shadow-md cursor-pointer transition-colors z-10 opacity-85 group-hover/thumb:opacity-100"
                title="Delete attachment"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
