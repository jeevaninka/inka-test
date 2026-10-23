"use client";

import { cn } from '@/lib/utils';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { apiClient } from '@/lib/apiClient';
import { useMobileSidebar } from '@/components/providers/MobileSidebarProvider';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Tooltip } from '@/components/ui/tooltip';
import { motion } from 'framer-motion';
import { MOTION } from '@/lib/motion';
import {
  LayoutDashboard,
  FolderOpen,
  Layers,
  Play,
  Settings,
  ChevronDown,
  FolderKanban,
  ChevronRight,
  Building,
  ArrowLeft,
  Users,
  UserPlus,
  ShieldCheck,
  Sparkles,
  ClipboardCheck,
  AlertTriangle,
  PanelLeftClose,
  PanelLeftOpen,
  Bug,
  SlidersHorizontal,
  Rocket,
  X,
  Search,
  Folder,
} from 'lucide-react';

export interface WorkspaceState {
  id: string;
  name: string;
  slug: string;
  role: string;
  organizationName?: string;
  isOrgAdmin?: boolean;
}

interface SidebarProps {
  collapsed?: boolean;
  /** Server-rendered workspace so the header never flashes placeholder names. */
  initialWorkspace?: WorkspaceState | null;
}

export function Sidebar({ collapsed = false, initialWorkspace = null }: SidebarProps) {
  const router = useRouter();
  const currentPath = usePathname();
  const { data: session } = useSession();
  const { open: mobileOpen, setOpen: setMobileOpen } = useMobileSidebar();
  const pathParts = currentPath.split('/').filter(Boolean);
  const isWorkspaceContext = currentPath.startsWith('/workspace/');
  const { project, projects, modules = [], cases = [], members, currentUser, canEdit = true } = useProjectData();
  const isProjectRoute = currentPath.startsWith('/p/');
  const isProjectContext = isProjectRoute || (!isWorkspaceContext && Boolean(project));

  const slug = (pathParts[0] === 'p' && pathParts[1]) ? pathParts[1] : (project?.slug || '');

  // Mobile modules drawer state
  const [mobileModuleFilter, setMobileModuleFilter] = useState('');
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [expandedMobileModules, setExpandedMobileModules] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (modules.length > 0) {
      setExpandedMobileModules(new Set(modules.map((m: any) => m.id)));
    }
  }, [modules]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setSelectedModuleId(params.get('module'));
    }
    const handleSelect = (e: any) => {
      setSelectedModuleId(e.detail?.moduleId ?? null);
    };
    window.addEventListener('inka-select-module', handleSelect);
    return () => window.removeEventListener('inka-select-module', handleSelect);
  }, [currentPath]);

  const rootModules = useMemo(() => {
    return modules.filter((m: any) => !m.parentId);
  }, [modules]);

  const getChildModules = (parentId: string) => {
    return modules.filter((m: any) => m.parentId === parentId);
  };

  const getModuleCaseCount = (moduleId: string): number => {
    const direct = cases.filter((c: any) => c.moduleId === moduleId).length;
    const children = getChildModules(moduleId);
    return direct + children.reduce((sum, child) => sum + cases.filter((c: any) => c.moduleId === child.id).length, 0);
  };

  const noModuleCaseCount = useMemo(() => {
    return cases.filter((c: any) => !c.moduleId).length;
  }, [cases]);

  const filteredRootModules = useMemo(() => {
    if (!mobileModuleFilter.trim()) return rootModules;
    const q = mobileModuleFilter.trim().toLowerCase();
    return rootModules.filter((m: any) =>
      m.name.toLowerCase().includes(q) ||
      getChildModules(m.id).some((sub: any) => sub.name.toLowerCase().includes(q))
    );
  }, [rootModules, modules, mobileModuleFilter]);

  const handleSelectModule = (moduleId: string | null) => {
    if (currentPath === `/p/${slug}/repository`) {
      window.dispatchEvent(new CustomEvent('inka-select-module', { detail: { moduleId } }));
      const url = moduleId ? `/p/${slug}/repository?module=${encodeURIComponent(moduleId)}` : `/p/${slug}/repository`;
      router.replace(url);
    } else {
      const url = moduleId ? `/p/${slug}/repository?module=${encodeURIComponent(moduleId)}` : `/p/${slug}/repository`;
      router.push(url);
    }
    setMobileOpen(false);
  };

  useEffect(() => {
    if (isProjectRoute && slug && typeof window !== 'undefined') {
      localStorage.setItem('inka_last_project_slug', slug);
      document.cookie = `inka_last_project_slug=${slug}; path=/; max-age=31536000; SameSite=Lax`;
    }
  }, [isProjectRoute, slug]);
  const derivedPendingReviewCount = useMemo(() => {
    return cases.filter(
      (c: any) => c.reviewStatus === 'pending' || c.reviewStatus === 'changes_requested'
    ).length;
  }, [cases]);

  const [pendingReviewCount, setPendingReviewCount] = useState(derivedPendingReviewCount);
  const [showProjectSwitcher, setShowProjectSwitcher] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(initialWorkspace);

  useEffect(() => {
    setPendingReviewCount(derivedPendingReviewCount);
  }, [derivedPendingReviewCount]);

  const [isCollapsed, setIsCollapsed] = useState<boolean>(collapsed);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsCollapsed(localStorage.getItem('inka_sidebar_collapsed') === 'true');
    }
  }, []);

  const toggleCollapse = () => {
    const next = !isCollapsed;
    setIsCollapsed(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('inka_sidebar_collapsed', next ? 'true' : 'false');
      document.cookie = `inka_sidebar_collapsed=${next ? 'true' : 'false'}; path=/; max-age=31536000; SameSite=Lax`;
    }
    window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed: next } }));
  };

  const workspaceSlug = isWorkspaceContext ? pathParts[1] : null;

  useEffect(() => {
    let cancelled = false;
    const fetchWorkspace = async () => {
      try {
        const endpoint = workspaceSlug
          ? `/api/v1/workspaces/${encodeURIComponent(workspaceSlug)}`
          : '/api/v1/workspaces/active';

        const ws = await apiClient.get<WorkspaceState>(endpoint, undefined, { ttl: 60000 });
        if (!cancelled && ws) {
          setWorkspace(ws);
        }
      } catch {
        // silent fallback
      }
    };
    if (session) {
      fetchWorkspace();
    }
    return () => {
      cancelled = true;
    };
  }, [(session?.user as any)?.id, workspaceSlug]);

  // Sync pending review count for sidebar badge when review-updated event fires
  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    const badgeUrl = `/api/v1/projects/${encodeURIComponent(project.id)}/badges`;

    const handleReviewUpdate = async () => {
      try {
        apiClient.invalidate(badgeUrl);
        const badges = await apiClient.get<{ pendingReviews: number; openDefects: number; pendingReleases?: number }>(
          badgeUrl,
          undefined,
          { ttl: 30000, forceRefresh: true }
        );
        if (!cancelled && badges) {
          setPendingReviewCount(badges.pendingReviews || 0);
        }
      } catch {
        // silent fallback
      }
    };
    window.addEventListener('review-updated', handleReviewUpdate);

    return () => {
      cancelled = true;
      window.removeEventListener('review-updated', handleReviewUpdate);
    };
  }, [project?.id]);

  const navItems = [
    { label: 'Dashboard', href: `/p/${slug}`, icon: LayoutDashboard },
    { label: 'Repository', href: `/p/${slug}/repository`, icon: FolderOpen },
    { label: 'Suites', href: `/p/${slug}/suites`, icon: Layers },
    { label: 'Runs', href: `/p/${slug}/runs`, icon: Play },
    { label: 'Releases', href: `/p/${slug}/releases`, icon: Rocket },
    { label: 'Bugs', href: `/p/${slug}/defects`, icon: Bug },
    { label: 'Review', href: `/p/${slug}/reviews`, icon: ClipboardCheck },
    ...(canEdit
      ? [
          { label: 'Test Config', href: `/p/${slug}/configuration`, icon: SlidersHorizontal },
          { label: 'Project Settings', href: `/p/${slug}/settings/members`, icon: Settings },
        ]
      : []),
  ];

  const activeWorkspaceSlug = workspaceSlug || workspace?.slug;

  const workspaceSettingsItems = activeWorkspaceSlug ? [
    { label: 'General', href: `/workspace/${activeWorkspaceSlug}/settings/general`, icon: Settings },
    { label: 'Members', href: `/workspace/${activeWorkspaceSlug}/settings/members`, icon: Users },
    { label: 'Integrations', href: `/workspace/${activeWorkspaceSlug}/settings/integrations`, icon: Layers },
  ] : [];

  const workspaceNavItems = activeWorkspaceSlug ? [
    { label: 'Projects', href: `/workspace/${activeWorkspaceSlug}`, icon: FolderKanban },
    ...workspaceSettingsItems,
  ] : [];

  const isWorkspaceAdminOrOwner = workspace?.role === 'OWNER' || workspace?.role === 'ADMIN';

  if (collapsed) {
    const itemsToRender = isWorkspaceContext ? workspaceNavItems : navItems;
    return (
      <div className="flex flex-col items-center gap-3 p-4">
        {itemsToRender.map((item, index) => {
          const Icon = item.icon;
          const isActive = currentPath === item.href || (item.href !== `/p/${slug}` && item.href !== `/workspace/${activeWorkspaceSlug}` && item.href !== `/workspace/${workspace?.slug}` && currentPath.startsWith(item.href));
          return (
            <Tooltip key={item.href} content={item.label} side="right">
              <button
                onClick={() => router.push(item.href)}
                className={cn(
                  'flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-300',
                  isActive
                    ? 'bg-gradient-active text-primary shadow-glow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground hover-lift'
                )}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <Icon className="h-4 w-4" />
              </button>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <>
      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs md:hidden animate-in fade-in-0 duration-200"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile Dual-Pane Navigation Drawer */}
      {mobileOpen && (
        <div
          className="fixed left-0 top-0 bottom-0 z-50 flex md:hidden max-w-[92vw] animate-in slide-in-from-left duration-250 ease-out shadow-2xl overflow-hidden rounded-r-2xl"
        >
          {/* Left Rail: Main Navigation Icons (56px) */}
          <aside className="w-14 bg-card/95 border-r border-border/60 flex flex-col items-center py-3 select-none shrink-0 h-full">
            <button
              onClick={() => { router.push('/workspace'); setMobileOpen(false); }}
              className="w-9 h-9 rounded-xl gradient-btn flex items-center justify-center shadow-glow-sm hover:scale-105 transition-transform cursor-pointer mb-3 shrink-0"
              title="InkaTest Workspace"
            >
              <Sparkles className="h-4 w-4 text-white" />
            </button>

            <nav className="flex-1 overflow-y-auto space-y-1.5 scrollbar-none w-full px-1.5">
              {(isWorkspaceContext ? workspaceNavItems : navItems).map((item) => {
                const Icon = item.icon;
                const isActive = currentPath === item.href || (item.href !== `/p/${slug}` && currentPath.startsWith(item.href));
                const showReviewDot = item.label === 'Review' && pendingReviewCount > 0;

                return (
                  <button
                    key={item.href}
                    onClick={() => {
                      router.push(item.href);
                      if (!item.href.includes('/repository')) {
                        setMobileOpen(false);
                      }
                    }}
                    className={cn(
                      "relative w-11 h-11 mx-auto rounded-xl flex items-center justify-center transition-all cursor-pointer group",
                      isActive
                        ? "bg-primary/20 text-primary shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-primary/[0.08] dark:hover:bg-white/[0.07]"
                    )}
                    title={showReviewDot ? `${item.label} (${pendingReviewCount} pending)` : item.label}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r bg-primary" />
                    )}
                    <Icon className="h-4 w-4" />
                    {showReviewDot && (
                      <span className="absolute top-2.5 right-2.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Bottom: Close button */}
            <button
              onClick={() => setMobileOpen(false)}
              className="mt-auto p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0"
              title="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          </aside>

          {/* Right Panel: Modules Tree & Project Scope (256px) */}
          <section className="w-64 bg-background/95 backdrop-blur-xl flex flex-col h-full border-r border-border/60 overflow-hidden">
            {/* Header: Project / Section Name + Close */}
            <div className="px-3.5 py-3 border-b border-border/50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-md bg-primary/15 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                  <FolderKanban className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-foreground truncate">{project?.name || workspace?.name || 'Project'}</h4>
                  <span className="text-[10px] text-muted-foreground uppercase font-mono tracking-wider">
                    {isWorkspaceContext ? 'Workspace' : 'Modules'}
                  </span>
                </div>
              </div>

              <button
                onClick={() => setMobileOpen(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                title="Close drawer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isProjectContext ? (
              <>
                {/* Search / Filter input */}
                {rootModules.length > 2 && (
                  <div className="p-2 border-b border-border/30 shrink-0">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Filter modules..."
                        value={mobileModuleFilter}
                        onChange={(e) => setMobileModuleFilter(e.target.value)}
                        className="w-full h-7 pl-7 pr-2 text-xs bg-muted/40 border border-border/50 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                )}

                {/* Modules Hierarchy */}
                <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                  {/* All Cases */}
                  <button
                    onClick={() => handleSelectModule(null)}
                    className={cn(
                      "w-full text-left px-2.5 py-2 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer",
                      selectedModuleId === null
                        ? "bg-primary/15 text-primary font-semibold border-l-2 border-primary shadow-xs"
                        : "text-foreground/80 hover:bg-muted"
                    )}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="truncate">All Cases</span>
                    </span>
                    <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground font-semibold shrink-0">
                      {cases.length}
                    </span>
                  </button>

                  <div className="h-px bg-border/40 my-1 mx-1" />

                  {/* Without Module (if cases exist) */}
                  {noModuleCaseCount > 0 && (
                    <button
                      onClick={() => handleSelectModule('no-module')}
                      className={cn(
                        "w-full text-left px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer",
                        selectedModuleId === 'no-module'
                          ? "bg-primary/15 text-primary font-semibold border-l-2 border-primary shadow-xs"
                          : "text-foreground/80 hover:bg-muted"
                      )}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">Without Module</span>
                      </span>
                      <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground font-semibold shrink-0">
                        {noModuleCaseCount}
                      </span>
                    </button>
                  )}

                  {/* Root Modules */}
                  {filteredRootModules.map((m: any) => {
                    const directCount = getModuleCaseCount(m.id);
                    const isSelected = selectedModuleId === m.id;
                    const submodules = getChildModules(m.id);
                    const isExpanded = expandedMobileModules.has(m.id);

                    return (
                      <div key={m.id} className="space-y-0.5">
                        <div
                          className={cn(
                            "w-full px-2.5 py-1.5 rounded-xl text-xs flex items-center justify-between transition-colors cursor-pointer group",
                            isSelected
                              ? "bg-primary/15 text-primary font-semibold border-l-2 border-primary shadow-xs"
                              : "text-foreground/80 hover:bg-muted"
                          )}
                        >
                          <div
                            className="flex items-center gap-2 flex-1 min-w-0"
                            onClick={() => handleSelectModule(m.id)}
                          >
                            <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span className="truncate" title={m.name}>{m.name}</span>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground font-semibold">
                              {directCount}
                            </span>
                            {submodules.length > 0 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedMobileModules((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(m.id)) next.delete(m.id);
                                    else next.add(m.id);
                                    return next;
                                  });
                                }}
                                className="p-0.5 text-muted-foreground hover:text-foreground"
                              >
                                <ChevronRight className={cn("h-3 w-3 transition-transform", isExpanded && "rotate-90")} />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Submodules */}
                        {isExpanded && submodules.length > 0 && (
                          <div className="pl-4 space-y-0.5 border-l border-primary/20 ml-3 py-0.5">
                            {submodules.map((sub: any) => {
                              const subCount = cases.filter((c: any) => c.moduleId === sub.id).length;
                              const isSubSelected = selectedModuleId === sub.id;
                              return (
                                <button
                                  key={sub.id}
                                  onClick={() => handleSelectModule(sub.id)}
                                  className={cn(
                                    "w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer",
                                    isSubSelected
                                      ? "bg-primary/15 text-primary font-semibold border-l-2 border-primary shadow-xs"
                                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                                  )}
                                >
                                  <span className="flex items-center gap-1.5 truncate">
                                    <Folder className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <span className="truncate" title={sub.name}>{sub.name}</span>
                                  </span>
                                  <span className="font-mono text-[9px] px-1.5 py-0.2 rounded-full bg-muted/60 text-muted-foreground shrink-0">
                                    {subCount}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              /* Workspace Nav */
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {workspaceNavItems.map((item) => (
                  <button
                    key={item.href}
                    onClick={() => {
                      router.push(item.href);
                      setMobileOpen(false);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center gap-2.5 transition-colors cursor-pointer",
                      currentPath === item.href
                        ? "bg-primary/15 text-primary font-semibold border-l-2 border-primary"
                        : "text-foreground/80 hover:bg-muted"
                    )}
                  >
                    <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Desktop Sidebar (hidden on mobile, visible on md+) */}
      <aside className={cn(
        "fixed left-0 top-0 z-40 h-full transition-[width] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
        isCollapsed ? "w-16" : "w-48",
        "hidden md:flex flex-col"
      )}>
      <div className="absolute inset-0 glass border-r border-border/50" />

      <div className="relative flex h-full flex-col">
        {/* InkaTest Logo - Click to go to active workspace & Collapse button */}
        <div className={cn(
          "border-b border-border/50 py-3 flex items-center",
          isCollapsed ? "flex-col gap-2 px-2" : "justify-between px-3"
        )}>
          <button
            onClick={() => router.push('/workspace')}
            className="flex items-center gap-2.5 group shrink-0"
            title="InkaTest Workspace"
          >
            <div className="w-8 h-8 rounded-lg gradient-btn flex items-center justify-center shadow-glow-sm group-hover:shadow-glow-md transition-shadow duration-300">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            {!isCollapsed && <span className="text-lg font-bold gradient-text">InkaTest</span>}
          </button>

          <button
            onClick={toggleCollapse}
            className="hidden md:flex p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/60 transition-colors"
            title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>

        {isProjectContext ? (
          <div className={cn("relative border-b border-border/50", isCollapsed ? "p-2 flex justify-center" : "p-3")}>
            {isCollapsed ? (
              <Tooltip content={project?.name || 'Switch Project'} side="right">
                <button
                  onClick={() => setShowProjectSwitcher(!showProjectSwitcher)}
                  className="w-10 h-10 rounded-xl flex items-center justify-center p-0 hover:bg-muted/80 cursor-pointer transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                    <FolderKanban className="h-4 w-4 text-primary" />
                  </div>
                </button>
              </Tooltip>
            ) : (
              <button
                onClick={() => setShowProjectSwitcher(!showProjectSwitcher)}
                className="w-full group flex items-center justify-between p-2 rounded-xl transition-colors hover:bg-muted/80 cursor-pointer text-left"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                    <FolderKanban className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold text-sm">{project?.name || 'Select Project'}</h3>
                    <p className="truncate text-xs text-muted-foreground font-mono">{project?.slug}</p>
                  </div>
                </div>
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200',
                    showProjectSwitcher && 'rotate-180 text-primary'
                  )}
                />
              </button>
            )}

            {showProjectSwitcher && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowProjectSwitcher(false)} />
                <div className="absolute left-2 right-2 top-full z-20 mt-2 rounded-xl glass border border-border/50 py-2 shadow-lg animate-scale-in overflow-hidden">
                  <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Switch Project
                  </div>
                  {projects
                    .filter((p) => p.id !== project?.id)
                    .sort((a, b) => {
                      const numA = parseInt(a.id.split('-')[1] || '0', 10);
                      const numB = parseInt(b.id.split('-')[1] || '0', 10);
                      return numA - numB;
                    })
                    .map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          router.push(`/p/${p.slug}`);
                          setShowProjectSwitcher(false);
                        }}
                        className="group flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/80 transition-colors"
                      >
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <FolderKanban className="h-4 w-4 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{p.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{p.slug}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/0 group-hover:text-muted-foreground transition-all shrink-0" />
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>
        ) : isWorkspaceContext ? (
          <div className={cn("relative border-b border-border/50", isCollapsed ? "p-2 flex justify-center" : "p-3")}>
            <div className="flex flex-col gap-2.5 w-full">
              {isCollapsed ? (
                <Tooltip content={workspace?.name || ''} side="right">
                  <button
                    type="button"
                    onClick={() => router.push(`/workspace/${activeWorkspaceSlug}`)}
                    className="w-10 h-10 rounded-xl flex items-center justify-center p-0 mx-auto hover:bg-muted/60 transition-colors cursor-pointer"
                    title="Go to Workspace Projects"
                  >
                    <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                      <Building className="h-4 w-4 text-primary" />
                    </div>
                  </button>
                </Tooltip>
              ) : (
                <button
                  type="button"
                  onClick={() => router.push(`/workspace/${activeWorkspaceSlug}`)}
                  className="flex items-center gap-3 w-full px-2 py-1.5 rounded-xl text-left hover:bg-muted/60 transition-colors group cursor-pointer"
                  title="Go to Workspace Projects"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                    <Building className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {workspace ? (
                      <>
                        {workspace.organizationName && (
                          <p className="truncate text-[10px] font-mono uppercase tracking-wider text-primary/80">
                            {workspace.organizationName}
                          </p>
                        )}
                        <h3 className="truncate font-semibold text-sm group-hover:text-primary transition-colors">{workspace.name}</h3>
                      </>
                    ) : (
                      <div className="flex flex-col gap-1.5 animate-pulse" aria-hidden="true">
                        <div className="h-2 w-16 rounded-full bg-primary/20" />
                        <div className="h-3.5 w-24 rounded-full bg-muted-foreground/20" />
                      </div>
                    )}
                  </div>
                </button>
              )}

              {!isCollapsed && currentPath.includes('/settings') ? (
                <div className="flex flex-col gap-1 pt-1 border-t border-border/30">
                  <button
                    onClick={() => router.push(`/workspace/${activeWorkspaceSlug}`)}
                    className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Back to Projects</span>
                  </button>
                  <button
                    onClick={() => router.push('/workspace')}
                    className="text-[11px] text-muted-foreground/60 hover:text-muted-foreground transition-colors px-2 py-0.5 text-left cursor-pointer"
                  >
                    Switch Workspace &rarr;
                  </button>
                </div>
              ) : !isCollapsed ? (
                <button
                  onClick={() => router.push('/workspace')}
                  className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5 rounded-lg hover:bg-muted/50 cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Back to Workspaces</span>
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Sidebar Nav */}
        <nav className={cn("flex-1 overflow-y-auto scrollbar-thin", isCollapsed ? "p-2 space-y-4" : "p-3 space-y-6")}>
          {isWorkspaceContext && workspace && (
            <div className="space-y-4">
              {/* Workspace Main Nav: Projects */}
              <div>
                <ul className="space-y-0.5 w-full">
                  <li className="w-full">
                    {isCollapsed ? (
                      <Tooltip content="Projects" side="right">
                        <button
                          onClick={() => router.push(`/workspace/${activeWorkspaceSlug}`)}
                          className={cn(
                            'group relative flex items-center justify-center rounded-xl transition-colors cursor-pointer w-10 h-10 mx-auto p-0',
                            currentPath === `/workspace/${activeWorkspaceSlug}`
                              ? 'bg-primary/15 text-primary font-semibold'
                              : 'text-muted-foreground hover:text-foreground hover:bg-primary/[0.08] dark:hover:bg-white/[0.07]'
                          )}
                        >
                          <FolderKanban className="h-4 w-4" />
                        </button>
                      </Tooltip>
                    ) : (
                      <button
                        onClick={() => router.push(`/workspace/${activeWorkspaceSlug}`)}
                        className={cn(
                          'group relative flex items-center rounded-xl transition-colors cursor-pointer w-full gap-3 px-3 py-2 text-sm',
                          currentPath === `/workspace/${activeWorkspaceSlug}`
                            ? 'bg-primary/15 text-primary font-semibold'
                            : 'text-muted-foreground hover:text-foreground hover:bg-primary/[0.08] dark:hover:bg-white/[0.07]'
                        )}
                      >
                        {currentPath === `/workspace/${activeWorkspaceSlug}` && (
                          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-primary" />
                        )}
                        <FolderKanban className={cn(
                          'h-4 w-4 transition-transform duration-200',
                          currentPath === `/workspace/${activeWorkspaceSlug}` ? 'text-primary' : 'group-hover:scale-105'
                        )} />
                        <span className="font-medium flex-1 text-left truncate">Projects</span>
                      </button>
                    )}
                  </li>
                </ul>
              </div>

              {/* Workspace Settings */}
              {isWorkspaceAdminOrOwner && (
                <div>
                  {!isCollapsed && (
                    <div className="mb-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Workspace Settings
                    </div>
                  )}
                  <ul className="space-y-0.5 w-full">
                    {workspaceSettingsItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = currentPath === item.href || currentPath.startsWith(item.href);
                      return (
                        <li key={item.href} className="w-full">
                          {isCollapsed ? (
                            <Tooltip content={item.label} side="right">
                              <button
                                onClick={() => router.push(item.href)}
                                className={cn(
                                  'group relative flex items-center justify-center rounded-xl transition-colors cursor-pointer w-10 h-10 mx-auto p-0',
                                  isActive
                                    ? 'bg-primary/15 text-primary font-semibold'
                                    : 'text-muted-foreground hover:text-foreground hover:bg-primary/[0.08] dark:hover:bg-white/[0.07]'
                                )}
                              >
                                <Icon className="h-4 w-4" />
                              </button>
                            </Tooltip>
                          ) : (
                            <button
                              onClick={() => router.push(item.href)}
                              className={cn(
                                'group relative flex items-center rounded-xl transition-colors cursor-pointer w-full gap-3 px-3 py-2 text-sm',
                                isActive
                                  ? 'bg-primary/15 text-primary font-semibold'
                                  : 'text-muted-foreground hover:text-foreground hover:bg-primary/[0.08] dark:hover:bg-white/[0.07]'
                              )}
                            >
                              {isActive && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-primary" />
                              )}
                              <Icon className={cn(
                                'h-4 w-4 transition-transform duration-200',
                                isActive ? 'text-primary' : 'group-hover:scale-105'
                              )} />
                              <span className="font-medium flex-1 text-left truncate">{item.label}</span>
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {isProjectContext && (
            <div>
              <ul className="space-y-0.5 w-full">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentPath === item.href || (item.href !== `/p/${slug}` && currentPath.startsWith(item.href));
                  const showReviewDot = item.label === 'Review' && pendingReviewCount > 0;

                  return (
                    <li key={item.href} className="w-full">
                      {isCollapsed ? (
                        <Tooltip content={showReviewDot ? `${item.label} (${pendingReviewCount} pending)` : item.label} side="right">
                          <button
                            onClick={() => router.push(item.href)}
                            className={cn(
                              'group relative flex items-center justify-center rounded-xl transition-colors cursor-pointer w-10 h-10 mx-auto p-0',
                              isActive
                                ? 'bg-primary/15 text-primary font-semibold'
                                : 'text-foreground/80 dark:text-muted-foreground hover:text-foreground hover:bg-primary/[0.08] dark:hover:bg-white/[0.07]'
                            )}
                          >
                            <div className="relative flex items-center justify-center">
                              <Icon className="h-4 w-4" />
                              {showReviewDot && (
                                <span className="absolute -top-1 -right-1 h-1.5 w-1.5 rounded-full bg-amber-400" />
                              )}
                            </div>
                          </button>
                        </Tooltip>
                      ) : (
                        <button
                          onClick={() => router.push(item.href)}
                          title={showReviewDot ? `${item.label} (${pendingReviewCount} pending)` : undefined}
                          className={cn(
                            'group relative flex items-center rounded-xl transition-colors cursor-pointer w-full gap-3 px-3 py-2 text-sm',
                            isActive
                              ? 'bg-primary/15 text-primary font-semibold'
                              : 'text-muted-foreground hover:text-foreground hover:bg-primary/[0.08] dark:hover:bg-white/[0.07]'
                          )}
                        >
                          {isActive && (
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full bg-primary" />
                          )}
                          <div className="relative flex items-center justify-center shrink-0">
                            <Icon className={cn('h-4 w-4 transition-transform duration-200', !isActive && 'group-hover:scale-105')} />
                          </div>
                          <span className="font-medium flex-1 text-left truncate">{item.label}</span>
                          {showReviewDot && (
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                          )}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {isProjectContext && workspace && isWorkspaceAdminOrOwner && (
            <div>
              {!isCollapsed && (
                <div className="mb-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Workspace
                </div>
              )}
              <ul className="space-y-0.5 w-full">
                <li className="w-full">
                  {isCollapsed ? (
                    <Tooltip content={workspace.name} side="right">
                      <button
                        onClick={() => router.push(`/workspace/${workspace.slug}/settings/members`)}
                        className="group relative flex items-center justify-center rounded-xl transition-colors text-foreground/80 dark:text-muted-foreground hover:text-foreground hover:bg-primary/[0.08] dark:hover:bg-white/[0.07] cursor-pointer w-10 h-10 mx-auto p-0"
                      >
                        <Building className="h-4 w-4 transition-transform duration-200 group-hover:scale-105" />
                      </button>
                    </Tooltip>
                  ) : (
                    <button
                      onClick={() => router.push(`/workspace/${workspace.slug}/settings/members`)}
                      className="group relative flex items-center rounded-xl transition-colors text-foreground/80 dark:text-muted-foreground hover:text-foreground hover:bg-primary/[0.08] dark:hover:bg-white/[0.07] cursor-pointer w-full gap-3 px-3 py-2 text-sm"
                    >
                      <Building className="h-4 w-4 transition-transform duration-200 group-hover:scale-105 shrink-0" />
                      <span className="font-semibold flex-1 text-left truncate">{workspace.name}</span>
                    </button>
                  )}
                </li>
              </ul>
            </div>
          )}
        </nav>
      </div>
    </aside>
    </>
  );
}