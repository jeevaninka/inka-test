"use client";

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Copy,
  Eye,
  EyeOff,
  Check,
  Loader2,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface ConfigFieldSchema {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
  type?: 'text' | 'password' | 'url';
  masked?: boolean;
  copyable?: boolean;
  readOnly?: boolean;
  helperText?: string;
  onChange?: (val: string) => void;
}

export interface IntegrationConfigSchema {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  topContent?: React.ReactNode;
  fields: ConfigFieldSchema[];
  extraContent?: React.ReactNode;
  onTest?: () => Promise<void>;
  isTesting?: boolean;
  testResult?: { success: boolean; message: string; latencyMs?: number } | null;
  onSave?: () => Promise<void>;
  isSaving?: boolean;
  saveButtonText?: string;
}

interface IntegrationConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: IntegrationConfigSchema | null;
}

export function IntegrationConfigModal({
  open,
  onOpenChange,
  config,
}: IntegrationConfigModalProps) {
  const [unmaskedKeys, setUnmaskedKeys] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!config) return null;

  const toggleMask = (key: string) => {
    setUnmaskedKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleCopy = (key: string, text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast.success(`${label} copied to clipboard`);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onClose={() => onOpenChange(false)}
        className="flex flex-col max-w-xl w-[95vw] p-0 gap-0 overflow-hidden border border-border/80 bg-card text-card-foreground shadow-2xl rounded-2xl max-h-[85vh]"
      >
        {/* Flush Header */}
        <DialogHeader className="px-5 py-3.5 border-b border-border/50 bg-muted/10 space-y-1 text-left shrink-0">
          <div className="flex items-center gap-2.5 pr-8">
            <div className="w-8 h-8 rounded-lg bg-muted/60 border border-border/60 flex items-center justify-center text-foreground shrink-0 shadow-xs">
              {config.icon}
            </div>
            <DialogTitle className="text-base font-bold text-foreground">
              {config.title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
            {config.description}
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 min-w-0 w-full">
          {config.topContent}

          {config.fields.map((field) => {
            const isMasked = field.masked && !unmaskedKeys[field.key];
            const isCopied = copiedKey === field.key;

            return (
              <div key={field.key} className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/90 block">
                  {field.label}
                </label>

                <div className="relative flex items-center">
                  <Input
                    type={isMasked ? 'password' : field.type || 'text'}
                    value={field.value || ''}
                    readOnly={field.readOnly}
                    placeholder={field.placeholder}
                    onChange={(e) => field.onChange?.(e.target.value)}
                    className={cn(
                      'h-9 bg-background/80 border-input text-xs text-foreground font-mono transition-colors select-all',
                      field.masked && field.copyable
                        ? 'pr-16'
                        : field.masked || field.copyable
                        ? 'pr-9'
                        : '',
                      field.readOnly && 'bg-muted/40 text-muted-foreground cursor-default'
                    )}
                  />

                  <div className="absolute right-1.5 flex items-center gap-0.5">
                    {field.masked && (
                      <button
                        type="button"
                        onClick={() => toggleMask(field.key)}
                        className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                        title={isMasked ? 'Reveal secret' : 'Mask secret'}
                      >
                        {isMasked ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      </button>
                    )}

                    {field.copyable && (
                      <button
                        type="button"
                        onClick={() => handleCopy(field.key, field.value, field.label)}
                        className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                        title="Copy to clipboard"
                      >
                        {isCopied ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {field.helperText && (
                  <p className="text-[11px] text-muted-foreground leading-normal">
                    {field.helperText}
                  </p>
                )}
              </div>
            );
          })}

          {config.extraContent}

          {config.testResult && (
            <div
              className={cn(
                'p-3 rounded-xl border text-xs flex items-start gap-2 animate-in fade-in-0 duration-200',
                config.testResult.success
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
              )}
            >
              {config.testResult.success ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
              )}
              <div className="flex-1 min-w-0">
                <span className="font-semibold block">
                  {config.testResult.success ? 'Connection Verified' : 'Connection Error'}
                </span>
                <span className="text-[11px] opacity-90 leading-relaxed block mt-0.5">
                  {config.testResult.message}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Flush Footer */}
        <div className="border-t border-border/50 bg-muted/15 px-5 py-3 flex items-center justify-between gap-3 shrink-0">
          {config.onTest ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={config.onTest}
              disabled={config.isTesting || config.isSaving}
              className="h-8 px-3.5 text-xs gap-1.5 cursor-pointer"
            >
              {config.isTesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span>{config.isTesting ? 'Testing...' : 'Test connection'}</span>
            </Button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="h-8 px-3.5 text-xs cursor-pointer"
            >
              Cancel
            </Button>
            {config.onSave && (
              <Button
                type="button"
                size="sm"
                onClick={config.onSave}
                disabled={config.isSaving || config.isTesting}
                className="gradient-btn text-white h-8 px-4 text-xs font-semibold cursor-pointer gap-1.5"
              >
                {config.isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{config.saveButtonText || 'Save changes'}</span>
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
