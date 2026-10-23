"use client";

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Bug,
  ExternalLink,
  Clock,
  Layers,
  CheckCircle2,
  AlertCircle,
  X,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DefectItemData {
  id: string;
  title: string;
  description?: string | null;
  severity: string;
  localStatus?: string;
  ticketUrl?: string | null;
  externalTicketId?: string | null;
  ticketStatus?: string | null;
  raisedBy?: number | string;
  raisedByName?: string | null;
  raisedAt?: string;
}

interface DefectDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defect: DefectItemData | null;
}

export function DefectDetailModal({
  open,
  onOpenChange,
  defect,
}: DefectDetailModalProps) {
  if (!defect) return null;

  const sevKey = (defect.severity || '').toUpperCase();
  const severityBadgeConfig: Record<string, { label: string; className: string }> = {
    BLOCKER: { label: 'BLOCKER', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
    CRITICAL: { label: 'CRITICAL', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
    URGENT: { label: 'URGENT', className: 'bg-red-500/15 text-red-400 border-red-500/30' },
    HIGH: { label: 'HIGH', className: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
    MAJOR: { label: 'MAJOR', className: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
    MEDIUM: { label: 'MEDIUM', className: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
    LOW: { label: 'LOW', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    MINOR: { label: 'MINOR', className: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  };

  const sevConfig = severityBadgeConfig[sevKey] || {
    label: sevKey || 'MEDIUM',
    className: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl bg-popover text-popover-foreground border border-border p-6 sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <DialogHeader className="p-0 pb-3 border-b border-border/50 space-y-1.5 text-left shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/25 flex items-center justify-center text-red-500 shrink-0">
                <Bug className="h-4.5 w-4.5" />
              </div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base font-bold text-foreground font-mono">
                  {defect.id}
                </DialogTitle>
                <span
                  className={cn(
                    'px-2 py-0.2 rounded-full text-[10px] font-bold border font-mono',
                    sevConfig.className
                  )}
                >
                  {sevConfig.label}
                </span>
                <span className="px-2 py-0.2 rounded-full text-[10px] font-bold border font-mono bg-muted text-muted-foreground border-border">
                  {defect.localStatus || 'OPEN'}
                </span>
              </div>
            </div>

            {defect.raisedAt && (
              <span className="text-xs text-muted-foreground font-mono hidden sm:inline">
                {new Date(defect.raisedAt).toLocaleDateString()}
              </span>
            )}
          </div>

          <DialogDescription className="text-sm font-semibold text-foreground pt-1 leading-snug">
            {defect.title}
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto py-3 space-y-4 pr-1 text-xs">
          {/* Synchronized PM Tool Ticket Card */}
          {defect.externalTicketId ? (
            <div className="p-3.5 rounded-xl border border-border/60 bg-muted/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  <span>Synchronized Issue Tracker Ticket</span>
                </span>
                {defect.ticketStatus && (
                  <span className="px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold bg-primary/10 text-primary border-primary/25">
                    {defect.ticketStatus}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-foreground bg-white/5 px-2 py-0.5 rounded border border-white/10">
                    #{defect.externalTicketId}
                  </span>
                  <span className="text-muted-foreground text-xs">InkaBoard / Jira Ticket</span>
                </div>

                {defect.ticketUrl && (
                  <a
                    href={defect.ticketUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 h-7.5 px-3 rounded-lg text-xs font-semibold bg-white text-black hover:bg-white/90 shadow-xs cursor-pointer transition-all active:scale-[0.98]"
                  >
                    <span>Open in PM Tool</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl border border-border/60 bg-muted/30 text-muted-foreground text-xs flex items-center gap-2">
              <span className="font-mono font-bold text-foreground">Local Defect</span>
              <span>• Not synced to an external issue tracker</span>
            </div>
          )}

          {/* Description & Steps to Reproduce */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider block flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" />
              <span>Description & Observations</span>
            </span>
            <div className="p-3.5 rounded-xl border border-border/60 bg-muted/40 text-xs text-foreground font-mono leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
              {defect.description || 'No detailed reproduction steps provided.'}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
