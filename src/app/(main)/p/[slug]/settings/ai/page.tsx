"use client";

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Switch } from '@/components/ui/switch';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  updateProjectAiEnabledAction,
  getProjectAiUsageAction,
  getProjectAiConfigAction,
  updateProjectAiConfigAction,
  type ProjectAiConfig,
} from '@/app/actions/ai';
import { cn } from '@/lib/utils';

const DEFAULT_SUB_FEATURES: ProjectAiConfig = {
  enrichment: true,
  excelGeneration: true,
  defectDrafting: true,
  evidenceVision: true,
  datasetGeneration: true,
  selfHealing: true,
  deduplication: true,
  exploratory: false,
};

export default function AISettingsPage() {
  const params = useParams();
  const { slug } = params as Record<string, string>;
  const { project } = useProjectData();
  const projectIdOrSlug = project?.id || slug;

  const storageKey = `inka_ai_features_${projectIdOrSlug}`;

  const [aiEnabled, setAiEnabled] = useState<boolean>(() => {
    return Boolean(project?.ai_enabled ?? true);
  });

  const [subFeatures, setSubFeatures] = useState<ProjectAiConfig>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem(`inka_ai_features_${projectIdOrSlug}`);
        if (saved) return { ...DEFAULT_SUB_FEATURES, ...JSON.parse(saved) };
      } catch {
        // Non-fatal
      }
    }
    return DEFAULT_SUB_FEATURES;
  });

  const [usage, setUsage] = useState({ used: 0, limit: 500 });
  const [togglingMaster, setTogglingMaster] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function fetchUsageAndConfig() {
      if (!projectIdOrSlug) return;
      try {
        const [usageRes, cfgRes] = await Promise.all([
          getProjectAiUsageAction(projectIdOrSlug),
          getProjectAiConfigAction(projectIdOrSlug),
        ]);
        if (!ignore) {
          if (usageRes) setUsage(usageRes);
          if (cfgRes) {
            setAiEnabled(cfgRes.aiEnabled);
            setSubFeatures(cfgRes.config);
            try {
              localStorage.setItem(storageKey, JSON.stringify(cfgRes.config));
            } catch {
              // Non-fatal
            }
          }
        }
      } catch {
        // Non-fatal
      }
    }
    fetchUsageAndConfig();
    return () => {
      ignore = true;
    };
  }, [projectIdOrSlug, storageKey]);

  const handleToggleMaster = async (checked: boolean) => {
    setTogglingMaster(true);
    try {
      await updateProjectAiEnabledAction(projectIdOrSlug, checked);
      setAiEnabled(checked);
      toast.success(checked ? 'AI features enabled' : 'AI features disabled');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update AI setting';
      toast.error(message);
    } finally {
      setTogglingMaster(false);
    }
  };

  const handleToggleSubFeature = async (key: keyof ProjectAiConfig, checked: boolean) => {
    const previous = subFeatures;
    const next = { ...subFeatures, [key]: checked };
    setSubFeatures(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      await updateProjectAiConfigAction(projectIdOrSlug, { [key]: checked });
      toast.success('Feature setting updated');
    } catch (err: unknown) {
      setSubFeatures(previous);
      const message = err instanceof Error ? err.message : 'Failed to update AI feature';
      toast.error(message);
    }
  };

  const usagePercent = Math.min(100, Math.round((usage.used / usage.limit) * 100));

  return (
    <div className="space-y-6">
      {/* 1. Master AI Switch Card (Matches Image 1) */}
      <div className="rounded-2xl border border-border/70 bg-card p-5 flex items-center justify-between gap-4 shadow-card">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center text-violet-400 shrink-0">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-foreground">AI features</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              AI-written cases are always saved as Draft until someone reviews them.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {togglingMaster && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          <Switch
            checked={aiEnabled}
            onCheckedChange={handleToggleMaster}
            disabled={togglingMaster}
          />
        </div>
      </div>

      {/* 2. Granular Features Card (Matches Image 1) */}
      <div
        className={cn(
          'rounded-2xl border border-border/70 bg-card divide-y divide-border/40 shadow-card transition-opacity',
          !aiEnabled && 'opacity-50 pointer-events-none'
        )}
      >
        {/* Test case enrichment */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h4 className="font-semibold text-sm text-foreground">Test case enrichment</h4>
            <p className="text-xs text-muted-foreground">
              Suggest steps, expected results and edge cases.
            </p>
          </div>
          <Switch
            checked={subFeatures.enrichment}
            onCheckedChange={(checked) => handleToggleSubFeature('enrichment', checked)}
          />
        </div>

        {/* Generate cases from Excel */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h4 className="font-semibold text-sm text-foreground">Generate cases from Excel</h4>
            <p className="text-xs text-muted-foreground">
              Turn imported spreadsheets into draft cases.
            </p>
          </div>
          <Switch
            checked={subFeatures.excelGeneration}
            onCheckedChange={(checked) => handleToggleSubFeature('excelGeneration', checked)}
          />
        </div>

        {/* One-click defect drafting */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h4 className="font-semibold text-sm text-foreground">Defect drafting</h4>
            <p className="text-xs text-muted-foreground">
              Draft bug titles, reproduction steps and expected vs. actual from failed step context.
            </p>
          </div>
          <Switch
            checked={subFeatures.defectDrafting}
            onCheckedChange={(checked) => handleToggleSubFeature('defectDrafting', checked)}
          />
        </div>

        {/* Evidence screenshot & log extraction */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h4 className="font-semibold text-sm text-foreground">Screenshot & log analysis in defect drafts</h4>
            <p className="text-xs text-muted-foreground">
              Allow AI defect drafting to inspect attached step screenshots and PII-scrubbed logs.
            </p>
          </div>
          <Switch
            checked={subFeatures.evidenceVision}
            onCheckedChange={(checked) => handleToggleSubFeature('evidenceVision', checked)}
          />
        </div>

        {/* Dataset boundary & row generation */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h4 className="font-semibold text-sm text-foreground">Dataset test row generation</h4>
            <p className="text-xs text-muted-foreground">
              Generate positive, boundary and negative parameter rows as unsaved drafts.
            </p>
          </div>
          <Switch
            checked={subFeatures.datasetGeneration}
            onCheckedChange={(checked) => handleToggleSubFeature('datasetGeneration', checked)}
          />
        </div>

        {/* Self-healing suggestions */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h4 className="font-semibold text-sm text-foreground">Self-healing suggestions</h4>
            <p className="text-xs text-muted-foreground">
              Propose a fix when an automated step breaks.
            </p>
          </div>
          <Switch
            checked={subFeatures.selfHealing}
            onCheckedChange={(checked) => handleToggleSubFeature('selfHealing', checked)}
          />
        </div>

        {/* Defect deduplication */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h4 className="font-semibold text-sm text-foreground">Defect deduplication</h4>
            <p className="text-xs text-muted-foreground">
              Flag bugs that look like ones already raised.
            </p>
          </div>
          <Switch
            checked={subFeatures.deduplication}
            onCheckedChange={(checked) => handleToggleSubFeature('deduplication', checked)}
          />
        </div>

        {/* Exploratory sessions */}
        <div className="p-5 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h4 className="font-semibold text-sm text-foreground">Exploratory sessions</h4>
            <p className="text-xs text-muted-foreground">
              Summarize notes and suggest follow-up charters.
            </p>
          </div>
          <Switch
            checked={subFeatures.exploratory}
            onCheckedChange={(checked) => handleToggleSubFeature('exploratory', checked)}
          />
        </div>
      </div>

      {/* 3. AI Usage Card (Matches Image 1) */}
      <div className="rounded-2xl border border-border/70 bg-card p-5 space-y-3 shadow-card">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-foreground text-sm">AI usage this month</span>
          <span className="text-muted-foreground">
            {usage.used} of {usage.limit} calls · resets monthly
          </span>
        </div>

        <div className="h-2 rounded-full bg-border/40 overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${Math.max(usagePercent, 2)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
