"use client";

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { ExternalLink, Copy, Check, Pencil, Trash2, Link as LinkIcon, Database, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatVariableName } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface LinkifiedTextProps {
  text: string;
  className?: string;
  onTextChange?: (newText: string) => void;
  editable?: boolean;
  variables?: Array<{
    key: string;
    scope?: 'GLOBAL' | 'LOCAL';
    description?: string;
    default_value?: string;
    defaultValue?: string;
    is_secret?: boolean;
    isSecret?: boolean;
    values?: Array<{ environment?: { name: string; color?: string }; environment_id?: string; value: string }>;
  }>;
  parameters?: Array<{
    key: string;
    datasetName?: string;
    sampleValue?: string;
  }>;
}

interface ParsedSegment {
  type: 'text' | 'link' | 'variable' | 'parameter';
  raw: string;
  url?: string;
  title?: string;
  varKey?: string;
  paramKey?: string;
  startIndex: number;
  endIndex: number;
}

export function parseLinks(input: string): ParsedSegment[] {
  if (!input) return [];

  const segments: ParsedSegment[] = [];
  // Regex to match:
  // 1. Double curly variables: {{KEY}}
  // 2. Single curly parameters: {param_name} (must not be surrounded by curly)
  // 3. Markdown links: [title](url)
  // 4. Standalone URLs: http(s)://... or www....
  const masterRegex = /\{\{([A-Z0-9_]+)\}\}|(?<!\{)\{([a-zA-Z0-9_]+)\}(?!\})|\[([^\]]+)\]\(((?:https?:\/\/|www\.)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<>"|\\^`]+)/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = masterRegex.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        raw: input.slice(lastIndex, match.index),
        startIndex: lastIndex,
        endIndex: match.index,
      });
    }

    if (match[1]) {
      // {{VARIABLE_KEY}}
      const varKey = match[1];
      segments.push({
        type: 'variable',
        raw: match[0],
        varKey,
        startIndex: match.index,
        endIndex: masterRegex.lastIndex,
      });
      lastIndex = masterRegex.lastIndex;
    } else if (match[2]) {
      // {param_name}
      const paramKey = match[2];
      segments.push({
        type: 'parameter',
        raw: match[0],
        paramKey,
        startIndex: match.index,
        endIndex: masterRegex.lastIndex,
      });
      lastIndex = masterRegex.lastIndex;
    } else if (match[3] && match[4]) {
      // Markdown link [title](url)
      const title = match[3];
      let url = match[4];
      if (url.startsWith('www.')) url = 'https://' + url;
      segments.push({
        type: 'link',
        raw: match[0],
        title,
        url,
        startIndex: match.index,
        endIndex: masterRegex.lastIndex,
      });
      lastIndex = masterRegex.lastIndex;
    } else if (match[5]) {
      // Standalone URL
      let raw = match[5];
      let url = raw;

      // Trim trailing punctuation if not part of a query/template
      const trailingPunctuation = /[.,!?:;'"\)>]+$/;
      const punctMatch = raw.match(trailingPunctuation);
      if (punctMatch) {
        raw = raw.slice(0, -punctMatch[0].length);
        url = raw;
      }

      if (url.startsWith('www.')) url = 'https://' + url;
      const matchedEnd = match.index + raw.length;

      segments.push({
        type: 'link',
        raw,
        url,
        startIndex: match.index,
        endIndex: matchedEnd,
      });

      lastIndex = matchedEnd;
      masterRegex.lastIndex = matchedEnd;
    }
  }

  if (lastIndex < input.length) {
    segments.push({
      type: 'text',
      raw: input.slice(lastIndex),
      startIndex: lastIndex,
      endIndex: input.length,
    });
  }

  return segments;
}

function getShortUrlDisplay(url: string, title?: string): string {
  if (title && title.trim()) return title.trim();
  try {
    const clean = url.replace(/^https?:\/\/(www\.)?/, '');
    return clean.length > 36 ? clean.slice(0, 34) + '…' : clean;
  } catch {
    return url.length > 36 ? url.slice(0, 30) + '…' : url;
  }
}

/**
 * Sky Blue Chip for Environment Variables: {{VARIABLE_KEY}}
 */
function VariableTokenBadge({
  varKey,
  varObj,
  projectSlug,
}: {
  varKey: string;
  varObj: any;
  projectSlug?: string;
}) {
  const [showPopover, setShowPopover] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [unmasked, setUnmasked] = useState(false);

  const envValues = varObj?.values && Array.isArray(varObj.values) ? varObj.values : [];
  const isSecret = Boolean(varObj?.is_secret || varObj?.isSecret);

  let primaryVal = varObj?.defaultValue || varObj?.default_value || '';
  if (!primaryVal && envValues.length > 0) {
    const firstVal = envValues.find((v: any) => v.value);
    if (firstVal) primaryVal = firstVal.value;
  }

  const isUrl = primaryVal && (primaryVal.startsWith('http://') || primaryVal.startsWith('https://') || primaryVal.startsWith('www.'));
  const targetUrl = isUrl ? (primaryVal.startsWith('www.') ? `https://${primaryVal}` : primaryVal) : null;

  const handleCopyValue = (val: string, key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const settingsUrl = projectSlug ? `/p/${projectSlug}/configuration/variables` : '/configuration/variables';

  const displayVal = isSecret && !unmasked ? '••••••••' : primaryVal;

  return (
    <span
      className="relative inline-flex items-baseline mx-0.5 align-baseline"
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-500/10 dark:bg-sky-950/40 border border-sky-500/30 text-sky-700 dark:text-sky-300 font-mono text-xs cursor-pointer select-text transition-colors hover:bg-sky-500/20">
        <span className="font-semibold">{formatVariableName(varKey)}</span>
        {primaryVal && (
          <>
            <span className="text-muted-foreground/50 select-none">:</span>
            {targetUrl && !isSecret ? (
              <a
                href={targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-sky-600 font-sans font-medium inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400"
                onClick={(e) => e.stopPropagation()}
                title={targetUrl}
              >
                <span className="truncate max-w-[150px]">{getShortUrlDisplay(targetUrl)}</span>
                <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-75" />
              </a>
            ) : (
              <span className="font-sans font-medium text-foreground truncate max-w-[130px]">{displayVal}</span>
            )}
          </>
        )}
      </span>

      {/* Rich Popover Card */}
      {showPopover && (
        <div className="absolute left-0 bottom-full mb-1.5 z-50 w-72 rounded-xl bg-popover border border-border/80 p-3 shadow-xl text-left text-xs space-y-2.5 animate-in fade-in-0 zoom-in-95 pointer-events-auto">
          <div className="flex items-start justify-between gap-2 pb-2 border-b border-border/40">
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-mono font-bold text-foreground">{formatVariableName(varKey)}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-700 dark:text-sky-300 font-medium font-mono">
                  {varObj?.scope || 'GLOBAL'}
                </span>
                {isSecret && (
                  <span className="text-[9px] px-1 rounded bg-amber-500/15 text-amber-600 font-mono">
                    SECRET
                  </span>
                )}
              </div>
              {varObj?.description && (
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{varObj.description}</p>
              )}
            </div>
            <a
              href={settingsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5 shrink-0 font-medium"
              title="Open Variables Settings"
            >
              Settings <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>

          {/* Project Default fallback */}
          {(varObj?.defaultValue || varObj?.default_value) && (
            <div className="text-[11px] flex items-center justify-between bg-muted/30 px-2 py-1 rounded">
              <span className="text-muted-foreground font-medium text-[10px] uppercase">Default Fallback:</span>
              <span className="font-mono text-foreground">{isSecret && !unmasked ? '••••••••' : (varObj.defaultValue || varObj.default_value)}</span>
            </div>
          )}

          {/* Environment Values Breakdown */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                Values by Environment
              </span>
              {isSecret && (
                <button
                  type="button"
                  onClick={() => setUnmasked(!unmasked)}
                  className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 cursor-pointer"
                >
                  {unmasked ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  {unmasked ? 'Mask' : 'Reveal'}
                </button>
              )}
            </div>

            {envValues.length > 0 ? (
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border/40 bg-muted/20">
                <table className="w-full text-[11px] text-left">
                  <thead className="bg-muted/40 border-b border-border/40 text-[10px] text-muted-foreground uppercase font-mono">
                    <tr>
                      <th className="py-1 px-2 font-semibold">Environment</th>
                      <th className="py-1 px-2 font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20 font-mono">
                    {envValues.map((v: any, idx: number) => {
                      const envName = v.environment?.name || v.environment_id || 'Env';
                      const cellDisplay = isSecret && !unmasked && v.value ? '••••••••' : (v.value || '—');
                      return (
                        <tr key={idx} className="hover:bg-muted/30 transition-colors">
                          <td className="py-1 px-2 text-muted-foreground font-sans text-[11px]">{envName}</td>
                          <td className="py-1 px-2 text-foreground font-semibold truncate max-w-[150px]">{cellDisplay}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground italic bg-muted/20 p-2 rounded-lg text-center">
                No environment values configured yet.
              </p>
            )}
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * Neutral Slate Chip for Dataset Parameters: {param_name}
 */
function ParameterTokenBadge({
  paramKey,
  paramObj,
}: {
  paramKey: string;
  paramObj?: { key: string; datasetName?: string; sampleValue?: string; values?: string[]; rows?: any[] };
}) {
  const [showPopover, setShowPopover] = useState(false);

  const rawValues = paramObj?.values && Array.isArray(paramObj.values) && paramObj.values.length > 0
    ? paramObj.values
    : (paramObj?.sampleValue ? [paramObj.sampleValue] : []);

  return (
    <span
      className="relative inline-flex items-baseline mx-0.5 align-baseline"
      onMouseEnter={() => setShowPopover(true)}
      onMouseLeave={() => setShowPopover(false)}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-slate-500/10 dark:bg-slate-800/50 border border-slate-300/80 dark:border-slate-700/70 text-slate-900 dark:text-slate-100 font-mono text-xs cursor-pointer select-text transition-colors hover:bg-slate-500/20">
        <Database className="h-2.5 w-2.5 opacity-70 text-slate-600 dark:text-slate-300" />
        <span className="font-semibold">&#123;{paramKey}&#125;</span>
        {paramObj?.sampleValue && (
          <>
            <span className="text-muted-foreground/50 select-none">:</span>
            <span className="font-sans font-medium text-foreground truncate max-w-[120px]">
              {paramObj.sampleValue}
            </span>
          </>
        )}
      </span>

      {showPopover && (
        <div className="absolute left-0 bottom-full mb-1.5 z-50 w-72 rounded-xl bg-popover border border-border/80 p-3 shadow-xl text-left text-xs space-y-2.5 animate-in fade-in-0 zoom-in-95 pointer-events-auto">
          <div className="flex items-center justify-between pb-1.5 border-b border-border/40">
            <div className="flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300" />
              <span className="font-mono font-bold text-foreground">&#123;{paramKey}&#125;</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 text-slate-800 dark:text-slate-200 font-medium font-mono">
              PARAMETER
            </span>
          </div>

          {/* Dataset Values Table */}
          {rawValues.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                <span>Dataset Iterations ({rawValues.length})</span>
                {paramObj?.datasetName && (
                  <span className="font-normal font-sans normal-case text-foreground">{paramObj.datasetName}</span>
                )}
              </div>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border/40 bg-muted/20">
                <table className="w-full text-[11px] text-left">
                  <thead className="bg-muted/40 border-b border-border/40 text-[10px] text-muted-foreground uppercase font-mono">
                    <tr>
                      <th className="py-1 px-2 font-semibold w-14">Row</th>
                      <th className="py-1 px-2 font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/20 font-mono">
                    {rawValues.map((val, idx) => (
                      <tr key={idx} className="hover:bg-muted/30 transition-colors">
                        <td className="py-1 px-2 text-muted-foreground">#{idx + 1}</td>
                        <td className="py-1 px-2 text-foreground font-semibold truncate max-w-[170px]">
                          {val || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Data-driven test parameter. Resolves from the active dataset row during test execution.
            </p>
          )}

          {paramObj?.datasetName && rawValues.length === 0 && (
            <div className="text-[11px] bg-muted/30 px-2 py-1 rounded flex items-center justify-between">
              <span className="text-muted-foreground">Dataset:</span>
              <span className="font-medium text-foreground">{paramObj.datasetName}</span>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

export function LinkifiedText({
  text,
  className,
  onTextChange,
  editable = false,
  variables = [],
  parameters = [],
}: LinkifiedTextProps) {
  const params = useParams();
  const projectSlug = params?.slug as string | undefined;
  const [activeLink, setActiveLink] = useState<{ raw: string; url: string; title?: string } | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  if (!text) return null;

  const segments = parseLinks(text);

  // If no links or variables found, render plain text with preserved linebreaks
  if (segments.length === 1 && segments[0].type === 'text') {
    return <span className={cn('whitespace-pre-wrap', className)}>{text}</span>;
  }

  const handleCopy = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    toast.success('Link copied to clipboard');
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const handleOpenEdit = (seg: ParsedSegment, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!seg.url) return;
    setActiveLink({ raw: seg.raw, url: seg.url, title: seg.title });
    setEditTitle(seg.title || '');
    setShowEditModal(true);
  };

  const handleSaveEdit = () => {
    if (!activeLink || !onTextChange) return;
    const newMarkdown = editTitle.trim()
      ? `[${editTitle.trim()}](${activeLink.url})`
      : activeLink.url;
    const updated = text.replace(activeLink.raw, newMarkdown);
    onTextChange(updated);
    setShowEditModal(false);
    setActiveLink(null);
    toast.success('Link updated');
  };

  const handleDeleteLink = (seg: ParsedSegment, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!onTextChange) return;
    const updated = text.replace(seg.raw, '').replace(/\s{2,}/g, ' ').trim();
    onTextChange(updated);
    toast.success('Link removed');
  };

  return (
    <span className={cn('break-words inline whitespace-pre-wrap', className)}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return <React.Fragment key={i}>{seg.raw}</React.Fragment>;
        }

        if (seg.type === 'variable') {
          const varKey = seg.varKey || '';
          const varObj = (variables || []).find((v: any) => v.key?.toUpperCase() === varKey.toUpperCase());
          return (
            <VariableTokenBadge
              key={i}
              varKey={varKey}
              varObj={varObj}
              projectSlug={projectSlug}
            />
          );
        }

        if (seg.type === 'parameter') {
          const paramKey = seg.paramKey || '';
          const paramObj = (parameters || []).find((p: any) => p.key?.toLowerCase() === paramKey.toLowerCase());
          return (
            <ParameterTokenBadge
              key={i}
              paramKey={paramKey}
              paramObj={paramObj}
            />
          );
        }

        const displayLabel = getShortUrlDisplay(seg.url!, seg.title);
        const isCopied = copiedUrl === seg.url;

        return (
          <span
            key={i}
            className="group/link inline-flex items-center gap-1 mx-0.5 align-baseline relative font-normal"
            onClick={(e) => e.stopPropagation()}
          >
            <a
              href={seg.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-blue-500/10 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium underline underline-offset-2 decoration-blue-500/40 hover:decoration-blue-500 transition-all text-xs"
              title={seg.url}
            >
              <LinkIcon className="h-3 w-3 shrink-0 text-blue-500" />
              <span className="truncate max-w-[200px]">{displayLabel}</span>
              <ExternalLink className="h-2.5 w-2.5 opacity-60 shrink-0" />
            </a>

            <span className="opacity-0 group-hover/link:opacity-100 transition-opacity inline-flex items-center gap-0.5 ml-0.5 bg-background border border-border/60 rounded-md shadow-xs p-0.5 z-20">
              <button
                type="button"
                onClick={(e) => handleCopy(seg.url!, e)}
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Copy link"
              >
                {isCopied ? <Check className="h-2.5 w-2.5 text-green-500" /> : <Copy className="h-2.5 w-2.5" />}
              </button>

              {editable && onTextChange && (
                <>
                  <button
                    type="button"
                    onClick={(e) => handleOpenEdit(seg, e)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title="Edit link title"
                  >
                    <Pencil className="h-2.5 w-2.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteLink(seg, e)}
                    className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    title="Remove link"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </>
              )}
            </span>
          </span>
        );
      })}

      {showEditModal && activeLink && (
        <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold">Edit Link</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Display Title (optional)</label>
                <Input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="e.g. Partner Portal Link"
                  className="mt-1 h-9 text-xs"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Target URL</label>
                <div className="mt-1 p-2 rounded-lg bg-muted/40 text-xs font-mono text-muted-foreground break-all border border-border/40">
                  {activeLink.url}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setShowEditModal(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSaveEdit}>
                Save Link
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </span>
  );
}
