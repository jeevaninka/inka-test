"use client";

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Layers,
  Play,
  TrendingUp,
  Plus,
  ArrowUpRight,
  ChevronRight,
  ChevronLeft,
  Rocket,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Clock,
  User,
  Bug,
  FileCheck,
  ExternalLink,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { QualityTrendChart } from '@/components/common/QualityTrendChart';
import { ProgressCircle } from '@/components/common/ProgressCircle';
import { createTestCaseAction } from '@/app/actions/cases';
import { createTestSuiteAction } from '@/app/actions/suites';
import { createReleaseAction } from '@/app/actions/releases';
import { createTestRunAction } from '@/app/actions/runs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import type {
  DashboardData,
  ActiveReleaseCardData,
  AttentionRowItem,
  MyQueueItem,
  TopFailingCaseItem,
  ActivityItem,
  NeedsAttentionData,
} from '@/app/actions/dashboard';
import type { EnhancedDashboardStats } from '@/lib/dal';
import { navigateTo } from '@/lib/navigation';

interface DashboardClientProps {
  project: Project | null;
  stats: EnhancedDashboardStats | null;
  needsAttention?: NeedsAttentionData | null;
  dashboardData?: DashboardData | null;
  slug: string;
  activity: ActivityItem[];
  users: {
    id: string;
    name: string;
    avatarUrl: string | null;
  }[];
  loading?: boolean;
}

function getUserInitials(name?: string): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function DashboardClient({
  project,
  stats,
  dashboardData,
  slug,
  activity = [],
  users = [],
  loading = false,
}: DashboardClientProps) {
  const router = useRouter();
  const { modules = [], suites = [], currentUser } = useProjectData();

  // Carousel & Activity Expansion States
  const [activeReleaseIndex, setActiveReleaseIndex] = useState(0);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [showPassRateModal, setShowPassRateModal] = useState(false);

  // Quick Modal Open States
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [showSuiteModal, setShowSuiteModal] = useState(false);
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [showRunModal, setShowRunModal] = useState(false);

  // Quick Modal Form States
  const [caseTitle, setCaseTitle] = useState('');
  const [casePriority, setCasePriority] = useState('P2');
  const [caseModuleId, setCaseModuleId] = useState('');
  const [caseSubmoduleId, setCaseSubmoduleId] = useState('');
  const [caseDesc, setCaseDesc] = useState('');
  const [isSubmittingCase, setIsSubmittingCase] = useState(false);

  const [suiteName, setSuiteName] = useState('');
  const [suiteType, setSuiteType] = useState('smoke');
  const [isSubmittingSuite, setIsSubmittingSuite] = useState(false);

  const [releaseName, setReleaseName] = useState('');
  const [releaseDueDate, setReleaseDueDate] = useState('');
  const [isSubmittingRelease, setIsSubmittingRelease] = useState(false);

  const [runName, setRunName] = useState('');

  useEffect(() => {
    setRunName(`Test Run - ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`);
  }, []);
  const [runEnv, setRunEnv] = useState('STAGING');
  const [runSuiteId, setRunSuiteId] = useState('');
  const [isSubmittingRun, setIsSubmittingRun] = useState(false);

  const moduleTreeOptions = useMemo(() => {
    const rootMods = modules.filter((m: any) => !m.parentId);
    const options: { value: string; label: string }[] = [
      { value: '', label: 'General (No module)' },
    ];
    rootMods.forEach((rm: any) => {
      options.push({ value: rm.id, label: `📁 ${rm.name}` });
      const children = modules.filter((m: any) => m.parentId === rm.id);
      children.forEach((cm: any) => {
        options.push({ value: cm.id, label: `    ↳ 📁 ${cm.name}` });
      });
    });
    return options;
  }, [modules]);

  if (!project) return null;

  // Resolved Stats
  const totalCases = stats?.totalCases ?? 0;
  const casesThisWeek = stats?.casesThisWeek ?? 0;
  const activeSuites = stats?.suites ?? 0;
  const suiteCasesCovered = stats?.suiteCasesCovered ?? 0;
  const activeRuns = stats?.openRuns ?? 0;
  const openRunsWithFailures = stats?.openRunsWithFailures ?? 0;
  const passRate = stats?.passRate ?? 0;
  const runHistory = stats?.runHistory ?? [];

  // Active Releases List & Current Carousel Item
  const activeReleases: ActiveReleaseCardData[] =
    dashboardData?.activeReleases?.length
      ? dashboardData.activeReleases
      : dashboardData?.activeRelease
      ? [dashboardData.activeRelease]
      : [];

  const currentRelease = activeReleases[activeReleaseIndex] || activeReleases[0] || null;

  // Needs Attention Items (Capped at 5 rows)
  const attentionItems: AttentionRowItem[] = dashboardData?.needsAttentionItems ?? [];

  // My Queue (Personal items assigned to logged in user)
  const myQueue: MyQueueItem[] = dashboardData?.myQueue ?? [];

  // Top Failing Cases
  const topFailingCases: TopFailingCaseItem[] = dashboardData?.topFailingCases ?? [];

  // User Activities (Human only)
  const userActivities = (dashboardData?.activity ?? activity).filter((a) => a.userId !== null);
  const visibleActivities = showAllActivity ? userActivities.slice(0, 10) : userActivities.slice(0, 5);
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  // Stat Cards: All 4 equal height with clean context subtitles and arrow in top corner
  const statCards = [
    {
      label: 'Total Cases',
      value: totalCases,
      subtext: casesThisWeek > 0 ? `+${casesThisWeek} added this week` : 'Repository specification',
      icon: FileText,
      gradient: 'from-teal-500 to-cyan-500',
      bgGradient: 'from-teal-500/20 to-cyan-500/20',
      iconColor: 'text-teal-600 dark:text-teal-400',
      href: `/p/${slug}/repository`,
      showSparkline: false,
    },
    {
      label: 'Active Suites',
      value: activeSuites,
      subtext: suiteCasesCovered > 0 ? `Covering ${suiteCasesCovered} cases` : 'Across modules',
      icon: Layers,
      gradient: 'from-blue-500 to-indigo-500',
      bgGradient: 'from-blue-500/20 to-indigo-500/20',
      iconColor: 'text-blue-600 dark:text-blue-400',
      href: `/p/${slug}/suites`,
      showSparkline: false,
    },
    {
      label: 'Open Runs',
      value: activeRuns,
      subtext: openRunsWithFailures > 0 ? `${openRunsWithFailures} with active failures` : 'Active execution queue',
      icon: Play,
      gradient: 'from-amber-500 to-orange-500',
      bgGradient: 'from-amber-500/20 to-orange-500/20',
      iconColor: 'text-amber-600 dark:text-amber-400',
      href: `/p/${slug}/runs`,
      showSparkline: false,
    },
    {
      label: 'Pass Rate',
      value: `${passRate}%`,
      subtext: stats?.sparklinePeriodLabel ? `Last ${stats.recentRuns?.length || 13} runs` : 'Run-by-run pass rate',
      icon: TrendingUp,
      data: stats?.recentRuns?.length ? stats.recentRuns : [75, 80, 72, 85, passRate],
      gradient: 'from-emerald-500 to-teal-500',
      bgGradient: 'from-emerald-500/20 to-teal-500/20',
      iconColor: 'text-emerald-600 dark:text-emerald-400',
      href: null,
      showSparkline: true,
    },
  ];

  // Quick Action Handlers
  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseTitle.trim()) return;
    setIsSubmittingCase(true);
    try {
      const created = await createTestCaseAction({
        projectId: project.id,
        title: caseTitle.trim(),
        priority: casePriority,
        description: caseDesc.trim() || undefined,
        moduleId: caseSubmoduleId || caseModuleId || null,
        type: 'manual',
        status: 'draft',
        tags: [],
        steps: [],
      });
      toast.success(`Created test case ${created.display_id}`);
      setShowCaseModal(false);
      setCaseTitle('');
      setCaseDesc('');
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create test case');
    } finally {
      setIsSubmittingCase(false);
    }
  };

  const handleCreateSuite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suiteName.trim()) return;
    setIsSubmittingSuite(true);
    try {
      const created = await createTestSuiteAction({
        projectId: project.id,
        name: suiteName.trim(),
        type: suiteType,
      });
      toast.success(`Created suite "${created.name}"`);
      setShowSuiteModal(false);
      setSuiteName('');
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create suite');
    } finally {
      setIsSubmittingSuite(false);
    }
  };

  const handleCreateRelease = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!releaseName.trim()) return;
    setIsSubmittingRelease(true);
    try {
      const created = await createReleaseAction({
        projectId: project.id,
        name: releaseName.trim(),
        dueDate: releaseDueDate ? new Date(releaseDueDate).toISOString() : undefined,
      });
      toast.success(`Created release "${created.name}"`);
      setShowReleaseModal(false);
      setReleaseName('');
      setReleaseDueDate('');
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create release');
    } finally {
      setIsSubmittingRelease(false);
    }
  };

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!runName.trim()) return;
    setIsSubmittingRun(true);
    try {
      const created = await createTestRunAction({
        projectId: project.id,
        name: runName.trim(),
        environment: runEnv,
        suiteId: runSuiteId || undefined,
        createdBy: currentUser?.id || 1,
      });
      toast.success(`Started run "${created.name}"`);
      setShowRunModal(false);
      router.push(`/p/${slug}/runs/${created.id}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to start run');
    } finally {
      setIsSubmittingRun(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 xl:space-y-6 max-w-7xl mx-auto w-full min-w-0">
      {/* ── 1. Top Stat Cards Grid (Equal height on all 4 cards, arrow higher & righter) ── */}
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4 xl:gap-5 items-stretch">
        {statCards.map((stat) => (
          <div
            key={stat.label}
            onClick={() => {
              if (stat.href) router.push(stat.href);
              else setShowPassRateModal(true);
            }}
            className="relative group cursor-pointer h-full"
          >
            {/* Gradient glow border on hover */}
            <div
              className={cn(
                "absolute -inset-[1px] rounded-2xl bg-gradient-to-br opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-xs",
                stat.gradient
              )}
            />
            <div className="relative glass rounded-2xl p-5 transition-all duration-300 group-hover:shadow-card-hover border border-border/50 hover:border-primary/20 flex flex-col justify-between h-full min-h-[160px]">
              {/* Arrow repositioned slightly higher & righter */}
              <ArrowUpRight className="absolute top-3.5 right-3.5 h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-300" />

              <div>
                <div className="mb-3">
                  <div
                    className={cn(
                      "w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center shadow-2xs",
                      stat.bgGradient
                    )}
                  >
                    <stat.icon className={cn("h-5 w-5", stat.iconColor)} />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">{stat.label}</p>
                  <p className="text-3xl font-bold tracking-tight text-foreground">{stat.value}</p>
                </div>
              </div>

              {/* Bottom area: either sparkline on Pass Rate, or clean subtext on others */}
              <div className="mt-3 pt-2 border-t border-border/30">
                {stat.showSparkline && stat.data ? (
                  <div>
                    <div className="h-7 w-full relative">
                      <svg className="w-full h-full" viewBox="0 0 100 30" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id={`gradient-${stat.label}`} x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.2" />
                            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.8" />
                          </linearGradient>
                        </defs>
                        <path
                          d={`M ${stat.data.map((v: number, i: number) => `${i * (100 / Math.max(stat.data.length - 1, 1))},${30 - Math.min(Math.max(v, 0), 100) * 0.28}`).join(' L ')}`}
                          fill="none"
                          stroke="hsl(var(--primary))"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <circle
                          cx="100"
                          cy={30 - Math.min(Math.max(stat.data[stat.data.length - 1] ?? 50, 0), 100) * 0.28}
                          r="3"
                          fill="hsl(var(--primary))"
                        />
                      </svg>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-1">
                      <span>{stat.subtext}</span>
                      <span className="text-primary hover:underline text-[10px] font-medium">View full graph ›</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-0.5">{stat.subtext}</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── 2. Quick Actions Row (Opens quick create modals without route hopping) ── */}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => setShowCaseModal(true)}
          className="group relative overflow-hidden border-border/50 hover:border-primary/30 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
          <Plus className="h-4 w-4 mr-2 text-primary" />
          New Case
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowSuiteModal(true)}
          className="group relative overflow-hidden border-border/50 hover:border-primary/30 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
          <Plus className="h-4 w-4 mr-2 text-primary" />
          New Suite
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowRunModal(true)}
          className="group relative overflow-hidden border-border/50 hover:border-primary/30 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
          <Plus className="h-4 w-4 mr-2 text-primary" />
          New Run
        </Button>
        <Button
          variant="outline"
          onClick={() => setShowReleaseModal(true)}
          className="group relative overflow-hidden border-border/50 hover:border-primary/30 transition-all duration-300"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/5 to-primary/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
          <Plus className="h-4 w-4 mr-2 text-primary" />
          New Release
        </Button>
      </div>

      {/* ── 3. Main Dashboard Layout: Left 2/3 and Right 1/3 ── */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 xl:gap-6 items-start min-w-0">
        {/* ── Left Column: ~2/3 (Active Release Carousel, Capped Needs Attention, Top Failing Cases) ── */}
        <div className="min-w-0 xl:col-span-8 space-y-4 xl:space-y-6">
          {/* Active Release Card (with carousel support if multiple releases active) */}
          {currentRelease && (
            <div className="relative glass rounded-2xl p-5 border border-border/50 hover:border-primary/20 transition-all">
              <div className="flex items-center justify-between gap-4 flex-wrap pb-3 border-b border-border/30">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                    <Rocket className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Active Release</span>
                      <span
                        className={cn(
                          "text-xs px-2 py-0.5 rounded-full font-medium border",
                          currentRelease.isDueToday
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                            : currentRelease.isOverdue
                            ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                            : "bg-muted text-muted-foreground border-border/50"
                        )}
                      >
                        {currentRelease.daysRemainingText}
                      </span>
                    </div>
                    <h2 className="text-base font-semibold text-foreground mt-0.5">{currentRelease.name}</h2>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {/* Carousel Controls if multiple active releases */}
                  {activeReleases.length > 1 && (
                    <div className="flex items-center gap-1.5 bg-muted/40 border border-border/40 rounded-lg p-0.5">
                      <button
                        onClick={() =>
                          setActiveReleaseIndex((prev) =>
                            prev > 0 ? prev - 1 : activeReleases.length - 1
                          )
                        }
                        className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title="Previous release"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      <span className="text-[11px] font-mono px-1.5 text-muted-foreground">
                        {activeReleaseIndex + 1}/{activeReleases.length}
                      </span>
                      <button
                        onClick={() =>
                          setActiveReleaseIndex((prev) =>
                            prev < activeReleases.length - 1 ? prev + 1 : 0
                          )
                        }
                        className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        title="Next release"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}

                  <button
                    onClick={() => router.push(`/p/${slug}/releases`)}
                    className="text-xs font-medium text-primary hover:text-primary/80 flex items-center gap-1 transition-colors group cursor-pointer"
                  >
                    View Release
                    <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </div>

              {/* Prominent ProgressCircle & Execution Metrics */}
              <div className="mt-4 flex items-center justify-between gap-6 flex-wrap sm:flex-nowrap">
                {/* Left: Prominent ProgressCircle */}
                <div className="flex items-center gap-4 shrink-0">
                  <ProgressCircle
                    segments={{
                      pass: currentRelease.passCount,
                      fail: currentRelease.failCount,
                      total: currentRelease.totalCount,
                    }}
                    size={52}
                    strokeWidth={4.5}
                  />
                  <div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold font-mono text-foreground tracking-tight">
                        {currentRelease.passRate}%
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">pass rate</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground font-mono block">
                      {currentRelease.passCount + currentRelease.failCount}/{currentRelease.totalCount} tests evaluated
                    </span>
                  </div>
                </div>

                {/* Right: Passing, Failing, Pending, and Tickets */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap sm:justify-end">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <span><strong className="text-foreground font-mono">{currentRelease.passCount}</strong> passing</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" />
                    <span><strong className="text-foreground font-mono">{currentRelease.failCount}</strong> failing</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-muted-foreground/40 shrink-0" />
                    <span><strong className="text-foreground font-mono">{currentRelease.pendingCount}</strong> pending</span>
                  </span>
                  {currentRelease.uncoveredTickets > 0 && (
                    <span className="text-amber-500/90 font-medium text-xs bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                      {currentRelease.uncoveredTickets} uncovered
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Needs Attention (Capped at top 5 rows, sorted by severity, quiet styling) */}
          <div className="relative glass rounded-2xl p-5 border border-border/50 hover:border-primary/20 transition-all">
            <div className="flex items-center justify-between pb-3 border-b border-border/30">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <h2 className="text-base font-semibold text-foreground">Needs Attention</h2>
                {attentionItems.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium border border-amber-500/20">
                    {attentionItems.length}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">Prioritized by severity</span>
            </div>

            <div className="divide-y divide-border/30 mt-1">
              {attentionItems.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500/70 mb-2" />
                  <p className="text-sm font-medium text-foreground">All clear</p>
                  <p className="text-xs text-muted-foreground mt-0.5">No critical issues or blockers require your immediate attention.</p>
                </div>
              ) : (
                attentionItems.map((item) => {
                  let Icon = AlertCircle;
                  if (item.type === 'release') Icon = Rocket;
                  else if (item.type === 'run') Icon = Play;
                  else if (item.type === 'review') Icon = FileCheck;
                  else if (item.type === 'bug') Icon = Bug;
                  else if (item.type === 'stale_runs') Icon = Clock;

                  return (
                    <div
                      key={item.id}
                      onClick={(e) => navigateTo(e, `/p/${slug}${item.link}`, router.push)}
                      className="py-3 px-2 flex items-center justify-between gap-3 group hover:bg-muted/30 rounded-xl transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-muted/60 border border-border/40 flex items-center justify-center shrink-0 text-muted-foreground group-hover:text-primary transition-colors">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                            {item.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {item.subtitle}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {item.badge && (
                          <span
                            className={cn(
                              "text-xs px-2 py-0.5 rounded-full font-medium border",
                              item.badge.variant === 'danger'
                                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                                : item.badge.variant === 'warning'
                                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                : "bg-muted text-muted-foreground border-border/40"
                            )}
                          >
                            {item.badge.label}
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Top Failing Cases: "X times" copy */}
          {topFailingCases.length > 0 && (
            <div className="relative glass rounded-2xl p-5 border border-border/50 hover:border-primary/20 transition-all">
              <div className="flex items-center justify-between pb-3 border-b border-border/30">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500" />
                  <h2 className="text-base font-semibold text-foreground">Top Failing Test Cases</h2>
                </div>
                <span className="text-xs text-muted-foreground">Flakiest areas across runs</span>
              </div>

              <div className="divide-y divide-border/30 mt-1">
                {topFailingCases.map((c) => (
                  <div
                    key={c.id}
                    onClick={(e) => navigateTo(e, `/p/${slug}/repository?case=${c.id}`, router.push)}
                    className="py-2.5 px-2 flex items-center justify-between gap-3 group hover:bg-muted/30 rounded-xl transition-all cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-xs font-mono font-semibold text-primary px-1.5 py-0.5 rounded-md bg-primary/10 shrink-0">
                        {c.displayId}
                      </span>
                      <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                        {c.title}
                      </p>
                    </div>
                    {/* Explicitly updated to "X times" */}
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 font-medium border border-rose-500/20 shrink-0">
                      {c.failCount} times
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right Column: ~1/3 (My Queue & User Activities) ── */}
        <div className="min-w-0 xl:col-span-4 space-y-4 xl:space-y-6">
          {/* My Queue (Personal tasks assigned to logged-in user) */}
          <div className="relative glass rounded-2xl p-5 border border-border/50 hover:border-primary/20 transition-all">
            <div className="flex items-center justify-between pb-3 border-b border-border/30">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-primary" />
                <h2 className="text-base font-semibold text-foreground">My Queue</h2>
              </div>
              {myQueue.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">
                  {myQueue.length}
                </span>
              )}
            </div>

            <div className="divide-y divide-border/30 mt-1">
              {myQueue.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground">
                  <p className="text-xs text-muted-foreground">No pending runs or reviews assigned to you.</p>
                </div>
              ) : (
                myQueue.map((item) => (
                  <div
                    key={item.id}
                    onClick={(e) => navigateTo(e, `/p/${slug}${item.link}`, router.push)}
                    className="py-3 px-1.5 flex items-center justify-between gap-2.5 group hover:bg-muted/30 rounded-xl transition-all cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {item.subtitle}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.badge && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground border border-border/40 font-medium">
                          {item.badge}
                        </span>
                      )}
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* User Activities: Top 5 by default with View More button */}
          <div className="relative glass rounded-2xl p-5 border border-border/50 hover:border-primary/20 transition-all">
            <div className="flex items-center justify-between pb-3 border-b border-border/30">
              <h2 className="text-base font-semibold text-foreground">User Activities</h2>
              <span className="text-xs text-muted-foreground">
                {visibleActivities.length} of {userActivities.length}
              </span>
            </div>

            <div className="divide-y divide-border/30 mt-1">
              {visibleActivities.length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">
                  <p className="text-xs text-muted-foreground">No recent user activity recorded yet.</p>
                </div>
              ) : (
                visibleActivities.map((entry) => {
                  const userName = entry.userId ? userMap.get(entry.userId) || 'Team Member' : 'Team Member';
                  const initials = getUserInitials(userName);

                  return (
                    <div key={entry.id} className="py-3 px-1 flex items-start gap-3">
                      {/* Round purple/indigo initials avatar */}
                      <div className="w-8 h-8 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center shrink-0 shadow-2xs mt-0.5">
                        {initials}
                      </div>

                      {/* Ergonomic details layout */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-sm font-semibold text-foreground truncate">
                            {userName}
                          </p>
                          <span className="text-xs text-muted-foreground shrink-0 font-normal">
                            {entry.displayDate || entry.formattedTime}
                          </span>
                        </div>
                        <p className="text-sm text-foreground/80 leading-snug mt-0.5 break-words">
                          {entry.displayText}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* View More / View Less Toggle Button */}
            {userActivities.length > 5 && (
              <button
                onClick={() => setShowAllActivity(!showAllActivity)}
                className="w-full pt-3 mt-1 text-center text-xs font-medium text-primary hover:text-primary/80 transition-colors border-t border-border/30 cursor-pointer block"
              >
                {showAllActivity ? 'Show less' : `View more (${userActivities.length - 5} more)`}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── 4. Quick Create Modals ── */}
      {/* Modal 1: Quick Create Case */}
      <Dialog open={showCaseModal} onOpenChange={setShowCaseModal}>
        <DialogContent className="max-w-md bg-card border-border/80 p-5 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">New Test Case</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateCase} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Title *</label>
              <Input
                placeholder="e.g. Verify user can reset password"
                value={caseTitle}
                onChange={(e) => setCaseTitle(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Priority</label>
                <Select
                  value={casePriority}
                  onValueChange={setCasePriority}
                  options={[
                    { value: 'P0', label: 'P0 - Blocker' },
                    { value: 'P1', label: 'P1 - High' },
                    { value: 'P2', label: 'P2 - Medium' },
                    { value: 'P3', label: 'P3 - Low' },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Module</label>
                <Select
                  value={caseSubmoduleId || caseModuleId}
                  onValueChange={(val) => {
                    const picked = modules.find((m: any) => m.id === val);
                    if (picked?.parentId) {
                      setCaseModuleId(picked.parentId);
                      setCaseSubmoduleId(picked.id);
                    } else {
                      setCaseModuleId(val);
                      setCaseSubmoduleId('');
                    }
                  }}
                  placeholder="No module"
                  options={moduleTreeOptions}
                />
              </div>
            </div>

            {/* Dependent Sub-module selector (Shown when selected module has sub-modules) */}
            {caseModuleId && modules.filter((m: any) => m.parentId === caseModuleId).length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Sub-module</label>
                <Select
                  value={caseSubmoduleId}
                  onValueChange={setCaseSubmoduleId}
                  options={[
                    { value: '', label: `Keep under ${modules.find((m: any) => m.id === caseModuleId)?.name} (No sub-module)` },
                    ...modules.filter((m: any) => m.parentId === caseModuleId).map((sm: any) => ({ value: sm.id, label: sm.name })),
                  ]}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Description</label>
              <Input
                placeholder="Optional brief description"
                value={caseDesc}
                onChange={(e) => setCaseDesc(e.target.value)}
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowCaseModal(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!caseTitle.trim() || isSubmittingCase}>
                {isSubmittingCase ? 'Creating...' : 'Create Case'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal 2: Quick Create Suite */}
      <Dialog open={showSuiteModal} onOpenChange={setShowSuiteModal}>
        <DialogContent className="max-w-md bg-card border-border/80 p-5 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">New Test Suite</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSuite} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Suite Name *</label>
              <Input
                placeholder="e.g. Smoke Tests"
                value={suiteName}
                onChange={(e) => setSuiteName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Suite Type</label>
              <Select
                value={suiteType}
                onValueChange={setSuiteType}
                options={[
                  { value: 'smoke', label: 'Smoke Suite' },
                  { value: 'regression', label: 'Regression Suite' },
                  { value: 'sanity', label: 'Sanity Suite' },
                  { value: 'integration', label: 'Integration Suite' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowSuiteModal(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!suiteName.trim() || isSubmittingSuite}>
                {isSubmittingSuite ? 'Creating...' : 'Create Suite'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal 3: Quick Create Release */}
      <Dialog open={showReleaseModal} onOpenChange={setShowReleaseModal}>
        <DialogContent className="max-w-md bg-card border-border/80 p-5 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">New Release</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateRelease} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Release Name *</label>
              <Input
                placeholder="e.g. Release 10-15-2026"
                value={releaseName}
                onChange={(e) => setReleaseName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Target Due Date</label>
              <Input
                type="date"
                value={releaseDueDate}
                onChange={(e) => setReleaseDueDate(e.target.value)}
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowReleaseModal(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!releaseName.trim() || isSubmittingRelease}>
                {isSubmittingRelease ? 'Creating...' : 'Create Release'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal 4: Quick Start Run */}
      <Dialog open={showRunModal} onOpenChange={setShowRunModal}>
        <DialogContent className="max-w-md bg-card border-border/80 p-5 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-foreground">Start Test Run</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateRun} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Run Name *</label>
              <Input
                placeholder="e.g. Staging Regression Run"
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Environment</label>
                <Select
                  value={runEnv}
                  onValueChange={setRunEnv}
                  options={[
                    { value: 'DEV', label: 'Development' },
                    { value: 'STAGING', label: 'Staging' },
                    { value: 'UAT', label: 'UAT' },
                    { value: 'PROD', label: 'Production' },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Suite</label>
                <Select
                  value={runSuiteId}
                  onValueChange={setRunSuiteId}
                  placeholder="All Cases"
                  options={[
                    { value: '', label: 'All Cases in Project' },
                    ...suites.map((s: any) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </div>
            </div>
            <div className="pt-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Need custom parameters or targets?</span>
              <button
                type="button"
                onClick={() => {
                  setShowRunModal(false);
                  router.push(`/p/${slug}/runs/new`);
                }}
                className="text-primary hover:underline font-medium cursor-pointer"
              >
                Open Full Run Builder →
              </button>
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setShowRunModal(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!runName.trim() || isSubmittingRun}>
                {isSubmittingRun ? 'Starting...' : 'Start Run'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal 5: Pass Rate Full Analytics & Run History Dialog */}
      <Dialog open={showPassRateModal} onOpenChange={setShowPassRateModal}>
        <DialogContent className="max-w-2xl bg-card border-border/80 p-6 rounded-2xl max-h-[85vh] overflow-y-auto custom-scrollbar">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-emerald-500" />
              Pass Rate Analytics
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Historical pass rate and execution quality across completed test runs
            </p>
          </DialogHeader>

          {/* KPI Strip */}
          <div className="grid grid-cols-3 gap-3 pt-3">
            <div className="p-3 rounded-xl bg-muted/40 border border-border/50 text-center">
              <span className="text-xs text-muted-foreground">Overall Pass Rate</span>
              <p className="text-2xl font-bold font-mono text-emerald-500 mt-0.5">{passRate}%</p>
            </div>
            <div className="p-3 rounded-xl bg-muted/40 border border-border/50 text-center flex flex-col justify-center">
              <span className="text-xs text-muted-foreground">Latest Run</span>
              <p className={cn(
                "text-2xl font-bold font-mono mt-0.5",
                runHistory.length > 0 && runHistory[runHistory.length - 1].passRate >= 80
                  ? "text-emerald-500"
                  : runHistory.length > 0 && runHistory[runHistory.length - 1].passRate >= 50
                  ? "text-amber-500"
                  : "text-rose-500"
              )}>
                {runHistory.length > 0 ? `${runHistory[runHistory.length - 1].passRate}%` : '—'}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-muted/40 border border-border/50 text-center">
              <span className="text-xs text-muted-foreground">Runs Analyzed</span>
              <p className="text-2xl font-bold font-mono text-foreground mt-0.5">{runHistory.length || stats?.recentRuns?.length || 0}</p>
            </div>
          </div>

          {/* Quality Trend Chart with pointed line graph, strict 0-100% bounds, and responsive width */}
          <div className="pt-2">
            <QualityTrendChart
              data={runHistory.map((r) => ({
                id: r.id,
                name: r.name,
                environment: r.environment,
                passRate: r.passRate,
                pass: r.passCount,
                fail: r.failCount,
                pending: r.pendingCount,
                total: r.totalCount,
                date: r.dateStr,
                createdAt: r.createdAtIso,
                completedAt: r.completedAtIso,
                startedAt: r.startedAtIso,
              }))}
              height={190}
              onSelectRun={(runId) => {
                setShowPassRateModal(false);
                router.push(`/p/${slug}/runs/${runId}`);
              }}
            />
          </div>

          <DialogFooter className="pt-3">
            <Button variant="outline" size="sm" onClick={() => setShowPassRateModal(false)}>
              Close
            </Button>
            <Button size="sm" onClick={() => {
              setShowPassRateModal(false);
              router.push(`/p/${slug}/runs`);
            }}>
              View All Runs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
