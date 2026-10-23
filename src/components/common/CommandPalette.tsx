"use client";

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import {
  Search,
  Play,
  Layers,
  ClipboardCheck,
  Plus,
  ArrowRight,
  FileText,
  Folder,
  Globe,
  Variable,
  Package,
  Database,
  X,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { cn } from '@/lib/utils';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PaletteCase {
  id: string;
  title?: string;
  displayId?: string;
  display_id?: string;
  tags?: string[];
  priority?: string;
}

interface PaletteRun {
  id: string;
  name?: string;
  environment?: string;
}

interface PaletteSuite {
  id: string;
  name?: string;
  type?: string;
}

interface PaletteModule {
  id: string;
  name?: string;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const params = useParams();
  const slug = params?.slug as string;
  const { cases = [], suites = [], runs = [], modules = [] } = useProjectData();

  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [prevOpen, setPrevOpen] = useState(open);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when opening
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }

  // Global hotkey listener (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  // Quick navigation / actions
  const quickActions = useMemo(() => {
    if (!slug) return [];
    return [
      {
        id: 'action-new-case',
        category: 'Quick Actions',
        title: 'Create New Test Case',
        icon: Plus,
        shortcut: 'N C',
        action: () => router.push(`/p/${slug}/repository?action=new`),
      },
      {
        id: 'action-new-run',
        category: 'Quick Actions',
        title: 'Start New Test Run',
        icon: Play,
        shortcut: 'N R',
        action: () => router.push(`/p/${slug}/runs/new`),
      },
      {
        id: 'action-step-library',
        category: 'Quick Actions',
        title: 'Open Step Library',
        icon: Package,
        action: () => router.push(`/p/${slug}/configuration/step-library`),
      },
      {
        id: 'action-reviews',
        category: 'Quick Actions',
        title: 'Go to Review Queue',
        icon: ClipboardCheck,
        action: () => router.push(`/p/${slug}/reviews`),
      },
      {
        id: 'action-variables',
        category: 'Quick Actions',
        title: 'Manage Variables',
        icon: Variable,
        action: () => router.push(`/p/${slug}/configuration/variables`),
      },
      {
        id: 'action-environments',
        category: 'Quick Actions',
        title: 'Manage Environments',
        icon: Globe,
        action: () => router.push(`/p/${slug}/configuration/environments`),
      },
      {
        id: 'action-datasets',
        category: 'Quick Actions',
        title: 'Manage Datasets & Parameters',
        icon: Database,
        action: () => router.push(`/p/${slug}/configuration/datasets`),
      },
    ];
  }, [slug, router]);

  // Filtered results across entities
  const filteredItems = useMemo(() => {
    const q = query.toLowerCase().trim();

    const items: Array<{
      id: string;
      category: string;
      title: string;
      subtitle?: string;
      icon: React.ComponentType<{ className?: string }>;
      badge?: React.ReactNode;
      action: () => void;
    }> = [];

    // Filter Quick Actions
    const matchingActions = quickActions.filter((a) =>
      !q || a.title.toLowerCase().includes(q)
    );
    items.push(...matchingActions);

    if (slug) {
      // Filter Test Cases
      const matchingCases = (cases as PaletteCase[])
        .filter((c) =>
          !q ||
          c.displayId?.toLowerCase().includes(q) ||
          c.display_id?.toLowerCase().includes(q) ||
          c.title?.toLowerCase().includes(q) ||
          c.tags?.some((t: string) => t.toLowerCase().includes(q))
        )
        .slice(0, 15)
        .map((c) => {
          const caseKey = c.displayId || c.display_id || '';
          return {
            id: `case-${c.id}`,
            category: 'Test Cases',
            title: c.title || 'Untitled Case',
            subtitle: caseKey,
            icon: FileText,
            badge: (
              <div className="flex items-center gap-1.5 shrink-0">
                {caseKey && (
                  <span className="font-mono text-[11px] font-bold text-primary bg-primary/10 border border-primary/25 px-1.5 py-0.5 rounded">
                    {caseKey}
                  </span>
                )}
                {c.priority && <PriorityBadge priority={c.priority as 'P0' | 'P1' | 'P2' | 'P3'} />}
              </div>
            ),
            action: () => router.push(`/p/${slug}/repository/${caseKey || c.id}`),
          };
        });
      items.push(...matchingCases);

      // Filter Test Runs
      const matchingRuns = (runs as PaletteRun[])
        .filter((r) =>
          !q ||
          r.name?.toLowerCase().includes(q) ||
          r.environment?.toLowerCase().includes(q)
        )
        .slice(0, 8)
        .map((r) => ({
          id: `run-${r.id}`,
          category: 'Test Runs',
          title: r.name || 'Untitled Run',
          subtitle: r.environment ? `Env: ${r.environment}` : undefined,
          icon: Play,
          action: () => router.push(`/p/${slug}/runs/${r.id}`),
        }));
      items.push(...matchingRuns);

      // Filter Test Suites
      const matchingSuites = (suites as PaletteSuite[])
        .filter((s) => !q || s.name?.toLowerCase().includes(q))
        .slice(0, 6)
        .map((s) => ({
          id: `suite-${s.id}`,
          category: 'Suites',
          title: s.name || 'Untitled Suite',
          subtitle: s.type ? `Type: ${s.type}` : undefined,
          icon: Layers,
          action: () => router.push(`/p/${slug}/suites/${s.id}`),
        }));
      items.push(...matchingSuites);

      // Filter Modules
      const matchingModules = (modules as PaletteModule[])
        .filter((m) => !q || m.name?.toLowerCase().includes(q))
        .slice(0, 6)
        .map((m) => ({
          id: `module-${m.id}`,
          category: 'Modules',
          title: m.name || 'Untitled Module',
          icon: Folder,
          action: () => router.push(`/p/${slug}/repository?module=${m.id}`),
        }));
      items.push(...matchingModules);
    }

    return items;
  }, [query, quickActions, cases, runs, suites, modules, slug, router]);

  // Keyboard navigation inside list
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filteredItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredItems.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].action();
        onOpenChange(false);
      }
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="max-w-2xl p-0 bg-card text-card-foreground border border-border/80 shadow-2xl overflow-hidden rounded-2xl">
        {/* Search input header */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border/50 bg-muted/20">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search test cases, runs, suites, modules, or actions..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            autoFocus
          />
          <div className="flex items-center gap-2 shrink-0">
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-mono text-muted-foreground bg-muted/60 border border-border/50 rounded-md select-none">
              ESC
            </kbd>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="Close (ESC)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto p-2 space-y-1 divide-y divide-border/10"
        >
          {filteredItems.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No results found for &quot;{query}&quot;
            </div>
          ) : (
            (() => {
              let currentCategory = '';
              return filteredItems.map((item, idx) => {
                const showCategory = item.category !== currentCategory;
                currentCategory = item.category;
                const Icon = item.icon;
                const isSelected = selectedIndex === idx;

                return (
                  <div key={item.id}>
                    {showCategory && (
                      <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 mt-1">
                        {item.category}
                      </div>
                    )}
                    <button
                      type="button"
                      data-index={idx}
                      onClick={() => {
                        item.action();
                        onOpenChange(false);
                      }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={cn(
                        'w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left text-sm transition-colors cursor-pointer group',
                        isSelected
                          ? 'bg-primary/10 text-primary font-medium'
                          : 'text-foreground/90 hover:bg-muted/50'
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div
                          className={cn(
                            'p-1.5 rounded-lg shrink-0 transition-colors',
                            isSelected
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted/60 text-muted-foreground group-hover:text-foreground'
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs sm:text-sm">{item.title}</p>
                          {item.subtitle && (
                            <p className="text-[11px] text-muted-foreground truncate">
                              {item.subtitle}
                            </p>
                          )}
                        </div>
                      </div>

                      {item.badge ? (
                        item.badge
                      ) : (
                        <ArrowRight
                          className={cn(
                            'h-3.5 w-3.5 shrink-0 transition-opacity',
                            isSelected ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                      )}
                    </button>
                  </div>
                );
              });
            })()
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/20 border-t border-border/40 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              <kbd className="font-mono bg-muted/60 px-1.5 py-0.5 rounded border border-border/40 text-[10px]">↑</kbd>{' '}
              <kbd className="font-mono bg-muted/60 px-1.5 py-0.5 rounded border border-border/40 text-[10px]">↓</kbd> to navigate
            </span>
            <span>
              <kbd className="font-mono bg-muted/60 px-1.5 py-0.5 rounded border border-border/40 text-[10px]">↵</kbd> to select
            </span>
          </div>
          <span className="font-medium text-primary/80">InkaTest Quick Search</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}