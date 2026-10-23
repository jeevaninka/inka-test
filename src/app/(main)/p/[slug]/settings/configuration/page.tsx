"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  FolderOpen,
  ClipboardCheck,
  Play,
  Rocket,
  Archive,
  Loader2,
  Check,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { updateProjectReviewSettingAction } from '@/app/actions/reviews';
import { getEnvironmentsAction } from '@/app/actions/variables';

type ConfigSection = 'repository' | 'reviews' | 'runs' | 'releases' | 'retention';

interface ProjectWorkflowConfig {
  // 1. Repository
  defaultPriority: 'P0' | 'P1' | 'P2' | 'P3';
  defaultModuleId: string;
  defaultCaseType: 'manual' | 'auto';
  requirePreconditions: boolean;
  requireExpectedResult: boolean;
  requireModuleAssignment: boolean;

  // 2. Reviews
  reviewRequired: boolean;
  approverRole: 'any_tester' | 'admins_only';
  minApprovers: '1' | '2';
  reReviewOnStepEdit: boolean;

  // 3. Runs
  defaultEnvironment: string;
  defaultRunMode: 'manual' | 'automated';
  draftExecutionPolicy: 'warn' | 'block';
  requireFailureEvidence: boolean;
  alertOnMissingEnvVars: boolean;

  // 4. Releases
  approvalMode: 'manual' | 'auto';
  passCriteria: 'strict' | 'allow_skipped';
  uncoveredTickets: 'warn' | 'block' | 'ignore';
  whenTicketsAdded: 'manual' | 'auto';

  // 5. Retention & Export
  autoArchiveRunsDays: 'never' | '30' | '60' | '90';
  defaultExportFormat: 'xlsx' | 'csv';
}

const DEFAULT_ENV_NAMES = ['DEV', 'STAGING', 'QA', 'UAT', 'PROD'];

const DEFAULT_CONFIG: ProjectWorkflowConfig = {
  defaultPriority: 'P2',
  defaultModuleId: '',
  defaultCaseType: 'manual',
  requirePreconditions: false,
  requireExpectedResult: true,
  requireModuleAssignment: false,

  reviewRequired: false,
  approverRole: 'any_tester',
  minApprovers: '1',
  reReviewOnStepEdit: true,

  defaultEnvironment: 'STAGING',
  defaultRunMode: 'manual',
  draftExecutionPolicy: 'warn',
  requireFailureEvidence: false,
  alertOnMissingEnvVars: true,

  approvalMode: 'manual',
  passCriteria: 'strict',
  uncoveredTickets: 'warn',
  whenTicketsAdded: 'manual',

  autoArchiveRunsDays: 'never',
  defaultExportFormat: 'xlsx',
};

const NAV_SECTIONS: {
  id: ConfigSection;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'repository',
    label: 'Repository',
    description: 'Authoring defaults & required fields',
    icon: FolderOpen,
  },
  {
    id: 'reviews',
    label: 'Reviews',
    description: 'Peer review & approval rules',
    icon: ClipboardCheck,
  },
  {
    id: 'runs',
    label: 'Runs',
    description: 'Execution defaults & failure policy',
    icon: Play,
  },
  {
    id: 'releases',
    label: 'Releases',
    description: 'Sign-off & coverage rules',
    icon: Rocket,
  },
  {
    id: 'retention',
    label: 'Retention & Export',
    description: 'Auto-archival & export format',
    icon: Archive,
  },
];

export default function ProjectConfigurationSettingsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { slug } = params as Record<string, string>;
  const { project, modules = [] } = useProjectData();
  const projectIdOrSlug = project?.id || slug;

  const initialSectionParam = searchParams.get('section') as ConfigSection | null;
  const [activeSection, setActiveSection] = useState<ConfigSection>(
    initialSectionParam && NAV_SECTIONS.some((s) => s.id === initialSectionParam)
      ? initialSectionParam
      : 'repository'
  );

  const storageKey = `inka_workflow_config_${projectIdOrSlug}`;
  const legacyReleaseKey = `inka_release_settings_${projectIdOrSlug}`;

  const [savedConfig, setSavedConfig] = useState<ProjectWorkflowConfig>(() => ({
    ...DEFAULT_CONFIG,
    reviewRequired: Boolean(project?.review_required ?? project?.reviewRequired ?? false),
  }));
  const [draftConfig, setDraftConfig] = useState<ProjectWorkflowConfig>(() => ({
    ...DEFAULT_CONFIG,
    reviewRequired: Boolean(project?.review_required ?? project?.reviewRequired ?? false),
  }));
  const [environments, setEnvironments] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(storageKey);
        const legacyRel = localStorage.getItem(legacyReleaseKey);
        const parsedRel = legacyRel ? JSON.parse(legacyRel) : {};
        const parsed = raw ? JSON.parse(raw) : {};
        const merged: ProjectWorkflowConfig = {
          ...DEFAULT_CONFIG,
          ...parsedRel,
          ...parsed,
          reviewRequired: Boolean(
            project?.review_required ?? project?.reviewRequired ?? parsed.reviewRequired ?? false
          ),
        };
        setSavedConfig(merged);
        setDraftConfig(merged);
      } catch {
        // Non-fatal
      }
    }

    if (project?.id) {
      getEnvironmentsAction(project.id)
        .then((envs) => setEnvironments(envs || []))
        .catch(() => {});
    }
  }, [project?.id, project?.review_required, project?.reviewRequired, storageKey, legacyReleaseKey]);

  const environmentOptions = useMemo(() => {
    const list: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    for (const env of environments) {
      const upper = String(env.name || '').trim().toUpperCase();
      if (!upper || seen.has(upper)) continue;
      seen.add(upper);
      list.push({ value: env.name, label: env.name.toUpperCase() });
    }
    for (const std of DEFAULT_ENV_NAMES) {
      if (!seen.has(std)) {
        seen.add(std);
        list.push({ value: std, label: std });
      }
    }
    return list;
  }, [environments]);

  const moduleOptions = useMemo(() => {
    return [
      { value: '', label: 'None (Unassigned)' },
      ...modules
        .filter((m: any) => !m.parentId)
        .map((m: any) => ({ value: m.id, label: m.name })),
    ];
  }, [modules]);

  const hasChanges = useMemo(() => {
    return JSON.stringify(draftConfig) !== JSON.stringify(savedConfig);
  }, [draftConfig, savedConfig]);

  const updateField = <K extends keyof ProjectWorkflowConfig>(
    key: K,
    value: ProjectWorkflowConfig[K]
  ) => {
    setDraftConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleReset = () => {
    setDraftConfig(savedConfig);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (draftConfig.reviewRequired !== savedConfig.reviewRequired) {
        await updateProjectReviewSettingAction(projectIdOrSlug, draftConfig.reviewRequired);
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem(storageKey, JSON.stringify(draftConfig));
        localStorage.setItem(
          legacyReleaseKey,
          JSON.stringify({
            approvalMode: draftConfig.approvalMode,
            passCriteria: draftConfig.passCriteria,
            uncoveredTickets: draftConfig.uncoveredTickets,
            whenTicketsAdded: draftConfig.whenTicketsAdded,
          })
        );
      }
      setSavedConfig(draftConfig);
      toast.success('Configuration saved');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save configuration';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (!project) return null;

  const currentSectionMeta = NAV_SECTIONS.find((s) => s.id === activeSection) || NAV_SECTIONS[0];

  return (
    <div className="flex flex-col md:flex-row gap-6 items-start">
      {/* Left Vertical Sub-Nav (Clean Single-Line Items) */}
      <aside className="w-full md:w-48 shrink-0 space-y-1">
        {NAV_SECTIONS.map((sec) => {
          const Icon = sec.icon;
          const isActive = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              type="button"
              onClick={() => setActiveSection(sec.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-xl text-xs transition-colors flex items-center gap-2.5 cursor-pointer relative',
                isActive
                  ? 'bg-primary/12 text-primary font-semibold'
                  : 'text-foreground/80 dark:text-muted-foreground hover:text-foreground hover:bg-muted/50 font-medium'
              )}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-4 rounded-r-full bg-primary" />
              )}
              <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground')} />
              <span className="truncate">{sec.label}</span>
            </button>
          );
        })}
      </aside>

      {/* Right Content Area */}
      <div className="flex-1 min-w-0 w-full">
        <div className="rounded-xl border border-border/60 bg-card divide-y divide-border/50 shadow-xs overflow-hidden">
          {/* Card Header with Unified Explicit Save Action */}
          <div className="px-5 py-3.5 bg-muted/20 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h3 className="font-semibold text-sm text-foreground">{currentSectionMeta.label}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {currentSectionMeta.description}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {hasChanges ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    disabled={saving}
                    className="h-8 px-3 text-xs text-muted-foreground hover:text-foreground cursor-pointer gap-1 rounded-lg"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Discard</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSave}
                    disabled={saving}
                    className="gradient-btn text-white h-8 px-3.5 text-xs font-semibold cursor-pointer rounded-lg shadow-xs"
                  >
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    <span>Save changes</span>
                  </Button>
                </>
              ) : (
                <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/40 border border-border/50 select-none">
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Saved</span>
                </span>
              )}
            </div>
          </div>

          {/* ── SECTION 1: REPOSITORY ── */}
          {activeSection === 'repository' && (
            <div className="divide-y divide-border/50">
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Default test case priority
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Initial priority pre-selected when creating new test cases.
                  </p>
                </div>
                <div className="w-48 shrink-0">
                  <Select
                    value={draftConfig.defaultPriority}
                    onValueChange={(val) =>
                      updateField('defaultPriority', val as ProjectWorkflowConfig['defaultPriority'])
                    }
                    options={[
                      { value: 'P0', label: 'P0 - Critical' },
                      { value: 'P1', label: 'P1 - High' },
                      { value: 'P2', label: 'P2 - Medium' },
                      { value: 'P3', label: 'P3 - Low' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Default case execution type
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Default mode assigned to newly authored test cases.
                  </p>
                </div>
                <div className="w-48 shrink-0">
                  <Select
                    value={draftConfig.defaultCaseType}
                    onValueChange={(val) =>
                      updateField('defaultCaseType', val as 'manual' | 'auto')
                    }
                    options={[
                      { value: 'manual', label: 'Manual' },
                      { value: 'auto', label: 'Automated' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="px-5 py-4 space-y-3">
                <div>
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Required fields to leave Draft
                  </h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Mandate these fields before a test case can be published as Active.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    {
                      key: 'requireExpectedResult' as const,
                      label: 'Expected Result',
                      desc: 'Every step or case must define expected output',
                    },
                    {
                      key: 'requirePreconditions' as const,
                      label: 'Pre-conditions',
                      desc: 'Require test setup or preconditions text',
                    },
                    {
                      key: 'requireModuleAssignment' as const,
                      label: 'Module Assignment',
                      desc: 'Disallow publishing cases without a module',
                    },
                  ].map((item) => {
                    const checked = draftConfig[item.key];
                    return (
                      <div
                        key={item.key}
                        onClick={() => updateField(item.key, !checked)}
                        className={cn(
                          'p-3.5 rounded-xl border flex items-start gap-2.5 cursor-pointer transition-all select-none',
                          checked
                            ? 'border-primary/40 bg-primary/[0.04] shadow-2xs'
                            : 'border-zinc-200 dark:border-border/60 bg-background/50 hover:bg-muted/30 hover:border-zinc-300 dark:hover:border-border'
                        )}
                      >
                        <div onClick={(e) => e.stopPropagation()} className="mt-0.5 shrink-0">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(val) => updateField(item.key, Boolean(val))}
                          />
                        </div>
                        <div className="min-w-0">
                          <span className="text-xs font-semibold text-foreground block">
                            {item.label}
                          </span>
                          <span className="text-[11px] text-muted-foreground block mt-0.5 leading-snug">
                            {item.desc}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ── SECTION 2: REVIEWS ── */}
          {activeSection === 'reviews' && (
            <div className="divide-y divide-border/50">
              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Require peer review before execution
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    New and edited test cases must be approved before they can be executed in a run.
                  </p>
                </div>
                <Switch
                  checked={draftConfig.reviewRequired}
                  onCheckedChange={(val) => updateField('reviewRequired', val)}
                />
              </div>

              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Who can approve reviews
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Control which project roles are allowed to approve peer review requests.
                  </p>
                </div>
                <div className="w-52 shrink-0">
                  <Select
                    value={draftConfig.approverRole}
                    onValueChange={(val) =>
                      updateField('approverRole', val as 'any_tester' | 'admins_only')
                    }
                    options={[
                      { value: 'any_tester', label: 'Any Tester or Admin' },
                      { value: 'admins_only', label: 'Project Admins Only' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Minimum approvers required
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Number of approvals required before a review request is marked Approved.
                  </p>
                </div>
                <div className="w-52 shrink-0">
                  <Select
                    value={draftConfig.minApprovers}
                    onValueChange={(val) => updateField('minApprovers', val as '1' | '2')}
                    options={[
                      { value: '1', label: '1 Approver' },
                      { value: '2', label: '2 Approvers' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Re-trigger review when steps are edited
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Automatically move Active test cases back to review when steps or expected results change.
                  </p>
                </div>
                <Switch
                  checked={draftConfig.reReviewOnStepEdit}
                  onCheckedChange={(val) => updateField('reReviewOnStepEdit', val)}
                />
              </div>
            </div>
          )}

          {/* ── SECTION 3: RUNS ── */}
          {activeSection === 'runs' && (
            <div className="divide-y divide-border/50">
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Default execution environment
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Pre-selected target environment when starting a new test run.
                  </p>
                </div>
                <div className="w-48 shrink-0">
                  <Select
                    value={draftConfig.defaultEnvironment}
                    onValueChange={(val) => updateField('defaultEnvironment', val)}
                    options={environmentOptions}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Default run mode
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Default execution mode pre-selected in the New Test Run modal.
                  </p>
                </div>
                <div className="w-48 shrink-0">
                  <Select
                    value={draftConfig.defaultRunMode}
                    onValueChange={(val) =>
                      updateField('defaultRunMode', val as 'manual' | 'automated')
                    }
                    options={[
                      { value: 'manual', label: 'Manual' },
                      { value: 'automated', label: 'Automated' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Draft case execution policy
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    How the runner handles unapproved Draft test cases when starting a run.
                  </p>
                </div>
                <div className="w-48 shrink-0">
                  <Select
                    value={draftConfig.draftExecutionPolicy}
                    onValueChange={(val) =>
                      updateField('draftExecutionPolicy', val as 'warn' | 'block')
                    }
                    options={[
                      { value: 'warn', label: 'Allow with warning' },
                      { value: 'block', label: 'Block draft cases' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Require note or evidence on failure
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Prompt testers to attach a failure note, screenshot, or defect when marking a case Failed.
                  </p>
                </div>
                <Switch
                  checked={draftConfig.requireFailureEvidence}
                  onCheckedChange={(val) => updateField('requireFailureEvidence', val)}
                />
              </div>

              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Alert on missing environment variables before API runs
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Show an inline alert in the Postman runner modal when a request variable is missing a value for the selected environment.
                  </p>
                </div>
                <Switch
                  checked={draftConfig.alertOnMissingEnvVars !== false}
                  onCheckedChange={(val) => updateField('alertOnMissingEnvVars', val)}
                />
              </div>
            </div>
          )}

          {/* ── SECTION 4: RELEASES ── */}
          {activeSection === 'releases' && (
            <div className="divide-y divide-border/50">
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Release approval mode
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Whether a person clicks Approve manually or releases auto-approve once runs pass.
                  </p>
                </div>
                <div className="w-48 shrink-0">
                  <Select
                    value={draftConfig.approvalMode}
                    onValueChange={(val) =>
                      updateField('approvalMode', val as 'manual' | 'auto')
                    }
                    options={[
                      { value: 'manual', label: 'Manual Sign-off' },
                      { value: 'auto', label: 'Auto-approve on Pass' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Pass criteria
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Whether every case in linked runs must pass strictly or skipped cases are permitted.
                  </p>
                </div>
                <div className="w-48 shrink-0">
                  <Select
                    value={draftConfig.passCriteria}
                    onValueChange={(val) =>
                      updateField('passCriteria', val as 'strict' | 'allow_skipped')
                    }
                    options={[
                      { value: 'strict', label: 'Strict (100% Pass)' },
                      { value: 'allow_skipped', label: 'Allow Skipped Cases' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Tickets without test cases
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    How uncovered release tickets affect release readiness and sign-off.
                  </p>
                </div>
                <div className="w-48 shrink-0">
                  <Select
                    value={draftConfig.uncoveredTickets}
                    onValueChange={(val) =>
                      updateField('uncoveredTickets', val as 'warn' | 'block' | 'ignore')
                    }
                    options={[
                      { value: 'warn', label: 'Warn on Release' },
                      { value: 'block', label: 'Block Sign-off' },
                      { value: 'ignore', label: 'Ignore' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    When new tickets are added
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    How linked runs respond when new tickets are added to an active release.
                  </p>
                </div>
                <div className="w-48 shrink-0">
                  <Select
                    value={draftConfig.whenTicketsAdded}
                    onValueChange={(val) =>
                      updateField('whenTicketsAdded', val as 'manual' | 'auto')
                    }
                    options={[
                      { value: 'manual', label: 'Prompt to Refresh' },
                      { value: 'auto', label: 'Auto-sync Cases' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ── SECTION 5: RETENTION & EXPORT ── */}
          {activeSection === 'retention' && (
            <div className="divide-y divide-border/50">
              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Auto-archive completed test runs
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Automatically move completed runs to the Archived tab after a set period.
                  </p>
                </div>
                <div className="w-48 shrink-0">
                  <Select
                    value={draftConfig.autoArchiveRunsDays}
                    onValueChange={(val) =>
                      updateField(
                        'autoArchiveRunsDays',
                        val as ProjectWorkflowConfig['autoArchiveRunsDays']
                      )
                    }
                    options={[
                      { value: 'never', label: 'Never' },
                      { value: '30', label: 'After 30 days' },
                      { value: '60', label: 'After 60 days' },
                      { value: '90', label: 'After 90 days' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="font-medium text-xs sm:text-sm text-foreground">
                    Default export format
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    Preferred spreadsheet format when exporting test cases or execution reports.
                  </p>
                </div>
                <div className="w-48 shrink-0">
                  <Select
                    value={draftConfig.defaultExportFormat}
                    onValueChange={(val) =>
                      updateField('defaultExportFormat', val as 'xlsx' | 'csv')
                    }
                    options={[
                      { value: 'xlsx', label: 'Excel (.xlsx)' },
                      { value: 'csv', label: 'CSV (.csv)' },
                    ]}
                    className="h-8 text-xs"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
