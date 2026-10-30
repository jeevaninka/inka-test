"use client";

import { useState, useEffect, useRef, useMemo, useSyncExternalStore } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
import { ThemeButton } from './ThemeButton';
import { Breadcrumbs } from './Breadcrumbs';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Menu,
  ChevronDown,
  Sparkles,
  LogOut,
  User,
  Search,
  Maximize2,
  FileText,
  Play,
  Layers,
  Folder,
  ArrowRight,
  X,
  Building,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { navigateTo, type ModifierClickLike } from '@/lib/navigation';
import Image from 'next/image';
import { useMobileSidebar } from '@/components/providers/MobileSidebarProvider';
import { UserAvatar } from '@/components/common/UserAvatar';
import { CommandPalette } from '@/components/common/CommandPalette';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { useSession, signOut } from 'next-auth/react';

interface TopBarProps {
  breadcrumbs?: { label: string; href?: string }[];
  className?: string;
}

interface SearchCaseItem {
  id: string;
  title?: string;
  key?: string;
  displayId?: string;
  display_id?: string;
}

interface SearchRunItem {
  id: string;
  name?: string;
  status?: string;
}

interface SearchSuiteItem {
  id: string;
  title?: string;
}

interface SearchModuleItem {
  id: string;
  name?: string;
}

interface SessionUserExtended {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  displayName?: string;
  avatarColor?: string;
  avatarInitials?: string;
  isPlatformAdmin?: boolean;
}

function subscribeSidebarCollapse(callback: () => void) {
  window.addEventListener('sidebar-toggle', callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener('sidebar-toggle', callback);
    window.removeEventListener('storage', callback);
  };
}

function getSidebarCollapsedSnapshot() {
  try {
    return localStorage.getItem('inka_sidebar_collapsed') === 'true';
  } catch {
    return false;
  }
}

function getSidebarCollapsedServerSnapshot() {
  return false;
}

export function TopBar({ breadcrumbs = [], className }: TopBarProps) {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname() || '';
  const slug = (params?.slug as string) || '';
  const { data: session } = useSession();
  const { setOpen: setMobileSidebarOpen } = useMobileSidebar();
  const { cases = [], suites = [], runs = [], modules = [] } = useProjectData();

  const sidebarCollapsed = useSyncExternalStore(
    subscribeSidebarCollapse,
    getSidebarCollapsedSnapshot,
    getSidebarCollapsedServerSnapshot
  );
  const [showCommandPalette, setShowCommandPalette] = useState(false);

  // Inline Search State
  const [inlineQuery, setInlineQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Close search dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setIsSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sessionUser = session?.user as SessionUserExtended | undefined;
  const currentUser = {
    name: sessionUser?.name || 'User',
    email: sessionUser?.email || '',
    avatarColor: sessionUser?.avatarColor || '#6366f1',
    avatarInitials: sessionUser?.avatarInitials || null,
  };

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/login' });
  };

  const hasSidebar =
    pathname.startsWith('/p/') ||
    (pathname.startsWith('/workspace/') && pathname !== '/workspace');

  // Filter inline search results
  const inlineResults = useMemo(() => {
    const q = inlineQuery.trim().toLowerCase();
    if (!q) return [];

    const results: Array<{
      id: string;
      title: string;
      type: 'case' | 'suite' | 'run' | 'module';
      url: string;
      meta?: string;
    }> = [];

    // Test cases
    (cases as SearchCaseItem[]).forEach((c) => {
      const caseKey = c.displayId || c.display_id || c.key || '';
      const matchTitle = (c.title || '').toLowerCase().includes(q);
      const matchKey = caseKey.toLowerCase().includes(q);
      if (matchTitle || matchKey) {
        results.push({
          id: `case-${c.id}`,
          title: c.title || 'Untitled Case',
          type: 'case',
          url: slug ? `/p/${slug}/repository/${caseKey || c.id}` : '#',
          meta: caseKey,
        });
      }
    });

    // Test runs
    (runs as SearchRunItem[]).forEach((r) => {
      if ((r.name || '').toLowerCase().includes(q)) {
        results.push({
          id: `run-${r.id}`,
          title: r.name || 'Untitled Run',
          type: 'run',
          url: slug ? `/p/${slug}/runs/${r.id}` : '#',
          meta: r.status,
        });
      }
    });

    // Test suites
    (suites as SearchSuiteItem[]).forEach((s) => {
      if ((s.title || '').toLowerCase().includes(q)) {
        results.push({
          id: `suite-${s.id}`,
          title: s.title || 'Untitled Suite',
          type: 'suite',
          url: slug ? `/p/${slug}/suites/${s.id}` : '#',
        });
      }
    });

    // Modules
    (modules as SearchModuleItem[]).forEach((m) => {
      if ((m.name || '').toLowerCase().includes(q)) {
        results.push({
          id: `mod-${m.id}`,
          title: m.name || 'Untitled Module',
          type: 'module',
          url: slug ? `/p/${slug}/repository?module=${m.id}` : '#',
        });
      }
    });

    return results.slice(0, 7);
  }, [inlineQuery, cases, runs, suites, modules, slug]);

  const handleSelectInlineResult = (url: string, event?: ModifierClickLike | null) => {
    if (url && url !== '#') {
      navigateTo(event, url, router.push);
    }
    setIsSearchFocused(false);
    setInlineQuery('');
  };

  const handleInlineKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsSearchFocused(false);
    } else if (e.key === 'Enter' && inlineResults.length > 0) {
      handleSelectInlineResult(inlineResults[0].url);
    }
  };

  return (
    <header
      className={cn(
        'fixed top-0 right-0 z-40 flex h-14 items-center justify-between px-4 transition-all duration-300',
        hasSidebar ? (sidebarCollapsed ? 'left-0 md:left-16' : 'left-0 md:left-48') : 'left-0',
        className
      )}
    >
      {/* Background layer */}
      <div className="absolute inset-0 bg-background/80 backdrop-blur-md border-b border-border/60" />
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/20 to-transparent" />

      {/* Left section: Mobile menu & Breadcrumbs / Brand */}
      <div className="relative flex items-center gap-4 shrink-0">
        {hasSidebar && (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}

        {breadcrumbs.length > 0 ? (
          <Breadcrumbs items={breadcrumbs} />
        ) : (
          <button
            onClick={() => router.push('/projects')}
            className="flex items-center gap-2.5 group cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg overflow-visible shadow-glow-sm group-hover:shadow-glow-md transition-shadow duration-300">
              <Image src="/logo.svg" alt="InkaTest" width={32} height={32} className="w-8 h-8 object-cover rounded-lg" />
            </div>
            <span className="text-xl font-bold gradient-text">InkaTest</span>
          </button>
        )}
      </div>

      {/* Center section: Inline search bar with pop-up option */}
      <div
        ref={searchContainerRef}
        className="relative flex-1 max-w-sm lg:max-w-md mx-6 hidden md:flex justify-center"
      >
        <div className="relative w-full flex items-center group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/70 group-focus-within:text-primary transition-colors pointer-events-none z-10" />
          <input
            type="text"
            value={inlineQuery}
            onChange={(e) => {
              setInlineQuery(e.target.value);
              setIsSearchFocused(true);
            }}
            onFocus={() => setIsSearchFocused(true)}
            onKeyDown={handleInlineKeyDown}
            placeholder="Search cases, suites, runs..."
            className="w-full h-9 pl-10 pr-20 rounded-xl border border-border/80 bg-muted/40 hover:bg-muted/60 focus:bg-card text-foreground text-xs placeholder:text-muted-foreground/60 transition-all focus:outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/15 shadow-xs"
          />

          {inlineQuery && (
            <button
              type="button"
              onClick={() => {
                setInlineQuery('');
                setIsSearchFocused(false);
              }}
              className="absolute right-12 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 transition-colors cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          )}

          {/* Small button to open search as a pop-up dialog */}
          <button
            type="button"
            onClick={() => setShowCommandPalette(true)}
            title="Open search palette (⌘K)"
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-background/80 hover:bg-background border border-border/70 text-[10px] font-mono font-medium text-muted-foreground hover:text-foreground transition-all shadow-2xs cursor-pointer"
          >
            <Maximize2 className="h-2.5 w-2.5 opacity-60" />
            <span>⌘K</span>
          </button>
        </div>

        {/* Inline Search Dropdown Popover */}
        {isSearchFocused && inlineQuery.trim().length > 0 && (
          <div className="absolute top-full mt-1.5 left-0 right-0 z-50 rounded-2xl bg-popover text-popover-foreground border border-border shadow-2xl p-2 max-h-[360px] overflow-y-auto animate-scale-in text-xs space-y-1">
            <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
              <span>Matching results</span>
              <span>{inlineResults.length} found</span>
            </div>

            {inlineResults.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No matching results found.
              </div>
            ) : (
              <div className="space-y-0.5">
                {inlineResults.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={(e) => handleSelectInlineResult(item.url, e)}
                    className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left hover:bg-muted/70 transition-colors group cursor-pointer"
                  >
                    <div className="w-6 h-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 text-primary">
                      {item.type === 'case' && <FileText className="h-3.5 w-3.5" />}
                      {item.type === 'run' && <Play className="h-3.5 w-3.5" />}
                      {item.type === 'suite' && <Layers className="h-3.5 w-3.5" />}
                      {item.type === 'module' && <Folder className="h-3.5 w-3.5" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {item.meta && (
                          <span className="text-[11px] font-mono font-bold px-1.5 py-0.2 rounded bg-primary/15 text-primary border border-primary/25 shrink-0">
                            {item.meta}
                          </span>
                        )}
                        <span className="font-medium text-foreground truncate">{item.title}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground capitalize mt-0.5 block">{item.type}</span>
                    </div>

                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/0 group-hover:text-muted-foreground transition-all shrink-0" />
                  </button>
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-border/50 px-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Press <kbd className="font-mono bg-muted px-1 rounded">Enter</kbd> to select</span>
              <button
                type="button"
                onClick={() => {
                  setIsSearchFocused(false);
                  setShowCommandPalette(true);
                }}
                className="text-primary hover:underline cursor-pointer"
              >
                Open full dialog (⌘K) &rarr;
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Right section: Theme, Bell, User Profile */}
      <div className="relative flex items-center gap-2 sm:gap-3 shrink-0">
        <ThemeButton />
        <NotificationBell />

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 rounded-xl p-1.5 hover:bg-muted/80 transition-colors group cursor-pointer outline-none"
            >
              <div className="relative">
                <UserAvatar
                  name={currentUser.name || sessionUser?.name || 'User'}
                  imageUrl={session?.user?.image}
                  color={currentUser.avatarColor}
                  initials={currentUser.avatarInitials}
                  size="md"
                />
                <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-background" />
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-150 hidden sm:block group-data-[state=open]:rotate-180" />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56 p-1.5 rounded-2xl">
            <div className="px-3 py-2 border-b border-border/50 mb-1">
              <div className="flex items-center gap-3">
                <UserAvatar
                  name={currentUser.name || sessionUser?.name || 'User'}
                  imageUrl={session?.user?.image}
                  color={currentUser.avatarColor}
                  initials={currentUser.avatarInitials}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm truncate">{sessionUser?.displayName || currentUser.name}</p>
                  {currentUser.email && (
                    <p className="text-xs text-muted-foreground truncate">{currentUser.email}</p>
                  )}
                </div>
              </div>
            </div>

            <DropdownMenuItem
              onClick={() => router.push('/profile')}
              className="gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer rounded-xl"
            >
              <User className="h-4 w-4" />
              Profile
            </DropdownMenuItem>

            <DropdownMenuItem
              onClick={() => router.push('/workspace')}
              className="gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer rounded-xl"
            >
              <Building className="h-4 w-4" />
              Workspaces & Org
            </DropdownMenuItem>

            {sessionUser?.isPlatformAdmin && (
              <DropdownMenuItem
                onClick={() => router.push('/platform-admin/organizations')}
                className="gap-2 px-3 py-2 text-sm text-amber-400 hover:text-amber-300 cursor-pointer rounded-xl"
              >
                <Image src="/logo.svg" alt="InkaTest" width={20} height={20} className="w-5 h-5 object-cover" />
                Platform Admin
              </DropdownMenuItem>
            )}

            <DropdownMenuSeparator className="my-1" />

            <DropdownMenuItem
              onClick={handleSignOut}
              className="gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 focus:text-destructive cursor-pointer rounded-xl"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CommandPalette open={showCommandPalette} onOpenChange={setShowCommandPalette} />
    </header>
  );
}
