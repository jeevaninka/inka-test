'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn, formatVariableName } from '@/lib/utils';
import { Globe, Database, Lock, Plus } from 'lucide-react';

export interface VariableOption {
  key: string;
  scope: 'GLOBAL' | 'LOCAL';
  isSecret?: boolean;
  is_secret?: boolean;
}

export interface ParameterOption {
  key: string;
  datasetName?: string;
  sampleValue?: string;
}

interface VariableAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  variables?: VariableOption[];
  parameters?: ParameterOption[];
  onCreateVariable?: (key: string) => Promise<void> | void;
  onCreateParameter?: (param: string) => Promise<void> | void;
  multiline?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
  ghostSuffix?: string;
  onAcceptGhost?: () => void;
}

interface AutocompleteItem {
  type: 'variable' | 'parameter' | 'create_variable' | 'create_parameter';
  key: string;
  scope?: 'GLOBAL' | 'LOCAL';
  isSecret?: boolean;
  datasetName?: string;
  sampleValue?: string;
}

export function VariableAutocomplete({
  value,
  onChange,
  placeholder,
  className,
  variables = [],
  parameters = [],
  onCreateVariable,
  onCreateParameter,
  multiline = false,
  autoFocus = false,
  disabled = false,
  ghostSuffix,
  onAcceptGhost,
}: VariableAutocompleteProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [, setSearch] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [, setBraceFormat] = useState<'single' | 'double' | null>(null);
  const [dismissedValue, setDismissedValue] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 288 });

  const isVariableMenuOpen = showDropdown;
  const isDismissed = dismissedValue !== null && dismissedValue === value;
  const activeGhostSuffix = !disabled && !isVariableMenuOpen && !isDismissed && ghostSuffix ? ghostSuffix : '';
  const canAcceptSuggestion = !disabled && !isVariableMenuOpen && !isDismissed && Boolean(onAcceptGhost);

  const updateCoords = useCallback(() => {
    const el = multiline ? textareaRef.current : inputRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setCoords({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: Math.max(288, rect.width),
      });
    }
  }, [multiline]);

  useEffect(() => {
    if (showDropdown) {
      updateCoords();
      window.addEventListener('resize', updateCoords);
      window.addEventListener('scroll', updateCoords, true);
      return () => {
        window.removeEventListener('resize', updateCoords);
        window.removeEventListener('scroll', updateCoords, true);
      };
    }
  }, [showDropdown, updateCoords]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const mirrorHeight = mirrorRef.current ? mirrorRef.current.scrollHeight : 0;
    el.style.height = Math.max(el.scrollHeight, mirrorHeight) + 'px';
  }, []);

  useEffect(() => {
    if (multiline) autoResize();
  }, [value, activeGhostSuffix, multiline, autoResize]);

  const getTextBeforeCursor = useCallback(() => {
    const el = multiline ? textareaRef.current : inputRef.current;
    if (!el) return '';
    return el.value.slice(0, el.selectionStart || 0);
  }, [multiline]);

  const getBraceContext = useCallback(() => {
    const before = getTextBeforeCursor();

    // Check for {{ format first
    const lastDoubleOpen = before.lastIndexOf('{{');
    const lastDoubleClose = before.lastIndexOf('}}');
    if (lastDoubleOpen !== -1 && lastDoubleClose <= lastDoubleOpen) {
      return {
        pos: lastDoubleOpen,
        partial: before.slice(lastDoubleOpen + 2),
        format: 'double' as const,
        openLen: 2,
        closeLen: 2,
      };
    }

    // Check for { format (single brace, not followed by {)
    const lastSingleOpen = before.lastIndexOf('{');
    const lastSingleClose = before.lastIndexOf('}');
    if (lastSingleOpen !== -1 && lastSingleClose <= lastSingleOpen) {
      if (before[lastSingleOpen + 1] !== '{') {
        return {
          pos: lastSingleOpen,
          partial: before.slice(lastSingleOpen + 1),
          format: 'single' as const,
          openLen: 1,
          closeLen: 1,
        };
      }
    }

    return null;
  }, [getTextBeforeCursor]);

  const ctx = getBraceContext();

  // Compute filtered suggestions based on context
  const items: AutocompleteItem[] = [];
  const partial = (ctx?.partial || '').toLowerCase();

  if (ctx?.format === 'double') {
    // Double curlies: Show environment variables only
    variables.forEach((v) => {
      if (!partial || v.key.toLowerCase().includes(partial)) {
        items.push({
          type: 'variable',
          key: v.key,
          scope: v.scope,
          isSecret: Boolean(v.is_secret || v.isSecret),
        });
      }
    });

    if (onCreateVariable && partial.length > 0 && !variables.some((v) => v.key.toLowerCase() === partial)) {
      items.push({
        type: 'create_variable',
        key: partial.toUpperCase(),
      });
    }
  } else if (ctx?.format === 'single') {
    // Single curly: Show dataset parameters first
    parameters.forEach((p) => {
      if (!partial || p.key.toLowerCase().includes(partial)) {
        items.push({
          type: 'parameter',
          key: p.key,
          datasetName: p.datasetName,
          sampleValue: p.sampleValue,
        });
      }
    });

    if (onCreateParameter && partial.length > 0 && !parameters.some((p) => p.key.toLowerCase() === partial)) {
      items.push({
        type: 'create_parameter',
        key: partial.toLowerCase(),
      });
    }

    // Also include variables as secondary options
    variables.forEach((v) => {
      if (!partial || v.key.toLowerCase().includes(partial)) {
        items.push({
          type: 'variable',
          key: v.key,
          scope: v.scope,
          isSecret: Boolean(v.is_secret || v.isSecret),
        });
      }
    });
  }

  useEffect(() => {
    const bc = getBraceContext();
    if (bc) {
      setSearch(bc.partial);
      setBraceFormat(bc.format);
      setShowDropdown(true);
      setCursorPos(0);
    } else {
      setShowDropdown(false);
      setBraceFormat(null);
    }
  }, [value, getBraceContext]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const insertItem = (item: AutocompleteItem) => {
    if (item.type === 'create_variable') {
      onCreateVariable?.(item.key);
    } else if (item.type === 'create_parameter') {
      onCreateParameter?.(item.key);
    }

    const el = multiline ? textareaRef.current : inputRef.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart || 0);
    const after = el.value.slice(el.selectionStart || 0);
    const ctx2 = getBraceContext();
    if (!ctx2) return;

    // Use {{KEY}} for variables, {param} for parameters
    const openBrace = (item.type === 'variable' || item.type === 'create_variable') ? '{{' : '{';
    const closeBrace = (item.type === 'variable' || item.type === 'create_variable') ? '}}' : '}';
    const tokenText = openBrace + item.key + closeBrace;

    const newValue = before.slice(0, ctx2.pos) + tokenText + after;
    onChange(newValue);
    setShowDropdown(false);

    requestAnimationFrame(() => {
      el.focus();
      const pos = ctx2.pos + tokenText.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showDropdown && items.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursorPos((prev) => Math.min(prev + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursorPos((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (cursorPos >= 0 && cursorPos < items.length) {
          e.preventDefault();
          insertItem(items[cursorPos]);
        }
      } else if (e.key === 'Escape') {
        setShowDropdown(false);
      }
      return;
    }

    if (e.key === 'Tab' && !e.shiftKey && canAcceptSuggestion && onAcceptGhost) {
      e.preventDefault();
      e.stopPropagation();
      onAcceptGhost();
      requestAnimationFrame(() => {
        const el = multiline ? textareaRef.current : inputRef.current;
        if (el) {
          el.focus();
          const len = el.value.length;
          el.setSelectionRange(len, len);
        }
      });
      return;
    }

    if (e.key === 'Escape' && (activeGhostSuffix || canAcceptSuggestion)) {
      e.preventDefault();
      e.stopPropagation();
      setDismissedValue(value);
      return;
    }
  };

  return (
    <div className="relative w-full">
      {activeGhostSuffix && (
        <div
          ref={mirrorRef}
          aria-hidden="true"
          className={cn(
            multiline
              ? 'pointer-events-none absolute inset-0 w-full rounded-lg border border-transparent px-3 py-1.5 text-sm whitespace-pre-wrap break-words overflow-hidden min-h-[32px]'
              : 'pointer-events-none absolute inset-0 flex h-9 w-full items-center rounded-lg border border-transparent px-3 py-1 text-sm whitespace-pre overflow-hidden',
            className,
            'border-transparent bg-transparent shadow-none ring-0'
          )}
        >
          <span className="invisible">{value}</span>
          <span className="text-muted-foreground/45 select-none">{activeGhostSuffix}</span>
          <span className="ml-1.5 inline-flex items-center rounded border border-border/60 bg-muted/60 px-1 py-0 text-[10px] leading-4 font-mono text-muted-foreground/75 align-middle select-none">
            Tab
          </span>
        </div>
      )}
      {multiline ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={activeGhostSuffix && !value ? '' : placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          rows={1}
          className={cn(
            'relative z-10 flex w-full rounded-lg border border-border/50 bg-transparent px-3 py-1.5 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none overflow-hidden min-h-[32px]',
            className
          )}
        />
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={activeGhostSuffix && !value ? '' : placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          className={cn(
            'relative z-10 flex h-9 w-full rounded-lg border border-border/50 bg-transparent px-3 py-1 text-sm shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
            className
          )}
        />
      )}

      {showDropdown && items.length > 0 && typeof document !== 'undefined' && createPortal(
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            width: `${coords.width}px`,
            zIndex: 999999,
          }}
          className="rounded-xl bg-popover border border-border/80 p-1 shadow-2xl max-h-56 overflow-y-auto text-xs animate-in fade-in-0 zoom-in-95 pointer-events-auto"
        >
          <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/30 mb-0.5">
            {ctx?.format === 'double' ? 'Environment Variables' : 'Parameters & Variables'}
          </div>

          {items.map((item, i) => {
            const isSelected = cursorPos === i;

            if (item.type === 'variable') {
              return (
                <button
                  key={`var-${item.key}`}
                  type="button"
                  onClick={() => insertItem(item)}
                  className={cn(
                    'w-full px-2.5 py-1.5 text-left rounded-lg flex items-center justify-between gap-2 transition-colors cursor-pointer',
                    isSelected ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : 'hover:bg-muted/50 text-foreground'
                  )}
                  onMouseEnter={() => setCursorPos(i)}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Globe className="h-3 w-3 text-sky-500 shrink-0" />
                    <span className="font-mono font-medium truncate">{formatVariableName(item.key)}</span>
                    {item.isSecret && <Lock className="h-2.5 w-2.5 text-amber-500 shrink-0" />}
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 shrink-0">
                    {item.scope}
                  </span>
                </button>
              );
            }

            if (item.type === 'create_variable') {
              return (
                <button
                  key={`create-var-${item.key}`}
                  type="button"
                  onClick={() => insertItem(item)}
                  className={cn(
                    'w-full px-2.5 py-1.5 text-left rounded-lg flex items-center gap-2 transition-colors cursor-pointer border border-dashed border-sky-500/40 my-0.5',
                    isSelected ? 'bg-sky-500/20 text-sky-700 dark:text-sky-300' : 'hover:bg-sky-500/10 text-sky-600 dark:text-sky-400'
                  )}
                  onMouseEnter={() => setCursorPos(i)}
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  <span className="font-mono text-xs font-semibold">
                    Create Variable {formatVariableName(item.key)}
                  </span>
                </button>
              );
            }

            if (item.type === 'create_parameter') {
              return (
                <button
                  key={`create-param-${item.key}`}
                  type="button"
                  onClick={() => insertItem(item)}
                  className={cn(
                    'w-full px-2.5 py-1.5 text-left rounded-lg flex items-center gap-2 transition-colors cursor-pointer border border-dashed border-orange-500/40 my-0.5',
                    isSelected ? 'bg-orange-500/20 text-orange-700 dark:text-orange-300' : 'hover:bg-orange-500/10 text-orange-600 dark:text-orange-400'
                  )}
                  onMouseEnter={() => setCursorPos(i)}
                >
                  <Plus className="h-3 w-3 shrink-0" />
                  <span className="font-mono text-xs font-semibold">
                    Add Parameter &#123;{item.key}&#125; to Case
                  </span>
                </button>
              );
            }

            return (
              <button
                key={`param-${item.key}`}
                type="button"
                onClick={() => insertItem(item)}
                className={cn(
                  'w-full px-2.5 py-1.5 text-left rounded-lg flex items-center justify-between gap-2 transition-colors cursor-pointer',
                  isSelected ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300' : 'hover:bg-muted/50 text-foreground'
                )}
                onMouseEnter={() => setCursorPos(i)}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Database className="h-3 w-3 text-orange-500 shrink-0" />
                  <span className="font-mono font-medium truncate">&#123;{item.key}&#125;</span>
                  {item.sampleValue && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">
                      ({item.sampleValue})
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400 shrink-0">
                  PARAM
                </span>
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </div>
  );
}
