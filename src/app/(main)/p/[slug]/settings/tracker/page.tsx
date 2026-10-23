"use client";

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Loader2,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getProjectConnectionsAction,
  updateProjectPmDefaultsAction,
  saveProjectPmOverrideAction,
  getPmSpacesAction,
  testPmConnectionAction,
} from '@/app/actions/integrations';
import { InkaBoardLogo, JiraLogo } from '@/components/icons/IntegrationLogos';
import { PmIntegrationConfig, PmSpace } from '@/lib/integrations/pm-client';
import { cn } from '@/lib/utils';

export default function IssueTrackerSettingsPage() {
  const params = useParams();
  const { slug } = params as Record<string, string>;
  const { project } = useProjectData();
  const projectIdOrSlug = project?.id || slug;

  const [loading, setLoading] = useState(true);
  const [connectionsData, setConnectionsData] = useState<any>(null);

  // Default Space State
  const [pmSpaces, setPmSpaces] = useState<PmSpace[]>([]);
  const [selectedDefaultSpaceId, setSelectedDefaultSpaceId] = useState<string>('');
  const [savingDefaultSpace, setSavingDefaultSpace] = useState(false);

  // Custom Override State
  const [hasOverride, setHasOverride] = useState(false);
  const [overrideConfig, setOverrideConfig] = useState<PmIntegrationConfig>({
    baseUrl: '',
    apiKey: '',
    webhookSecret: '',
    autoCreateDefect: true,
  });
  const [showOverrideApiKey, setShowOverrideApiKey] = useState(false);
  const [savingOverride, setSavingOverride] = useState(false);
  const [testingPm, setTestingPm] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    let ignore = false;
    async function fetchData() {
      if (!projectIdOrSlug) return;
      try {
        const [conn, spacesRes] = await Promise.all([
          getProjectConnectionsAction(projectIdOrSlug),
          getPmSpacesAction(projectIdOrSlug),
        ]);

        if (!ignore) {
          setConnectionsData(conn);
          setHasOverride(conn.pm.hasOverride);
          setSelectedDefaultSpaceId(conn.pm.defaultSpace?.id || '');
          setPmSpaces(spacesRes.spaces || []);
          if (conn.pm.hasOverride && conn.pm.baseUrl) {
            setOverrideConfig((prev) => ({
              ...prev,
              baseUrl: conn.pm.baseUrl || '',
            }));
          }
        }
      } catch {
        // Non-fatal
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchData();
    return () => {
      ignore = true;
    };
  }, [projectIdOrSlug]);

  const [refreshingSpaces, setRefreshingSpaces] = useState(false);

  const handleRefreshSpaces = async () => {
    setRefreshingSpaces(true);
    try {
      const res = await getPmSpacesAction(projectIdOrSlug);
      setPmSpaces(res.spaces || []);
      if (res.spaces && res.spaces.length > 0) {
        toast.success(`Fetched ${res.spaces.length} space(s) from PM server`);
      } else {
        toast.info('No remote spaces found; using saved space');
      }
    } catch {
      toast.error('Could not fetch spaces from PM server');
    } finally {
      setRefreshingSpaces(false);
    }
  };

  const reloadData = async () => {
    if (!projectIdOrSlug) return;
    try {
      const [conn, spacesRes] = await Promise.all([
        getProjectConnectionsAction(projectIdOrSlug),
        getPmSpacesAction(projectIdOrSlug),
      ]);
      setConnectionsData(conn);
      setHasOverride(conn.pm.hasOverride);
      setSelectedDefaultSpaceId(conn.pm.defaultSpace?.id || '');
      setPmSpaces(spacesRes.spaces || []);
    } catch {
      // non-fatal
    }
  };

  const handleSaveDefaultSpace = async (spaceId: string) => {
    setSelectedDefaultSpaceId(spaceId);
    const space = pmSpaces.find((s) => s.id === spaceId);

    setSavingDefaultSpace(true);
    try {
      await updateProjectPmDefaultsAction(projectIdOrSlug, {
        spaceId: space?.id || null,
        spaceKey: space?.key || null,
        spaceName: space?.name || null,
      });
      toast.success(space ? `Default space set to ${space.name}` : 'Default space cleared');
      await reloadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update default space';
      toast.error(message);
    } finally {
      setSavingDefaultSpace(false);
    }
  };

  const handleTestPm = async () => {
    setTestingPm(true);
    setTestResult(null);
    try {
      const res = await testPmConnectionAction(projectIdOrSlug);
      setTestResult(res);
      if (res.success) {
        toast.success(res.message || 'Connection verified');
      } else {
        toast.error(res.message || 'Connection failed');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Connection test failed';
      setTestResult({ success: false, message });
      toast.error(message);
    } finally {
      setTestingPm(false);
    }
  };

  const handleSavePmOverride = async () => {
    setSavingOverride(true);
    try {
      if (hasOverride) {
        await saveProjectPmOverrideAction(projectIdOrSlug, {
          enabled: true,
          config: overrideConfig,
        });
        toast.success('Project-specific credentials saved');
      } else {
        await saveProjectPmOverrideAction(projectIdOrSlug, null);
        toast.success('Reverted to workspace credentials');
      }
      await reloadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save credentials';
      toast.error(message);
    } finally {
      setSavingOverride(false);
    }
  };

  const handleRevertPmOverride = async () => {
    setSavingOverride(true);
    try {
      await saveProjectPmOverrideAction(projectIdOrSlug, null);
      setHasOverride(false);
      toast.success('Reverted to workspace PM credentials');
      await reloadData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to revert PM credentials';
      toast.error(message);
    } finally {
      setSavingOverride(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/40 p-12 flex items-center justify-center gap-2 text-sm text-muted-foreground animate-pulse">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span>Loading issue tracker settings...</span>
      </div>
    );
  }

  const isConnected = Boolean(connectionsData?.pm?.enabled && connectionsData?.pm?.baseUrl);

  return (
    <div className="space-y-6 max-w-4xl animate-fade-in">
      <div>
        <h3 className="text-base font-semibold text-foreground">Issue Tracker</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Configure which issue tracker and project space automated bug tickets synchronize with.
        </p>
      </div>

      {/* Main Tracker Configuration Card */}
      <div className="rounded-2xl border border-border/70 bg-card p-6 space-y-6 shadow-card">
        {/* Connected Service Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/50">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#6522ea]/10 border border-[#6522ea]/20 flex items-center justify-center shrink-0 shadow-xs">
              <InkaBoardLogo className="h-6 w-6 rounded-md" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm text-foreground">InkaBoard</h4>
                {isConnected && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                    Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {hasOverride
                  ? 'Using project-specific InkaBoard credentials.'
                  : `Connected via workspace ${connectionsData?.pm?.workspaceName || 'INKA'} defaults.`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestPm}
              disabled={testingPm || !isConnected}
              className="h-9 px-3.5 text-xs font-medium rounded-lg border border-border/80 bg-muted/40 hover:bg-muted text-foreground shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors"
            >
              {testingPm ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5 text-primary" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              )}
              <span>Test connection</span>
            </Button>

            {connectionsData?.pm?.workspaceSlug && !hasOverride && (
              <Button
                variant="ghost"
                size="sm"
                asChild
                className="h-9 px-3 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <a
                  href={`/workspace/${connectionsData.pm.workspaceSlug}/settings/integrations`}
                  className="flex items-center gap-1.5"
                >
                  <span>Workspace settings</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Primary Setting: Default Space Mapping */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between max-w-lg">
            <div>
              <label className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                Default Space for New Bugs
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pre-selected when a tester clicks <strong>Raise Bug</strong> during test execution in this project.
              </p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRefreshSpaces}
              disabled={refreshingSpaces}
              className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer shrink-0"
              title="Refresh spaces list from PM server"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", refreshingSpaces && "animate-spin text-primary")} />
              <span>Refresh</span>
            </Button>
          </div>

          <div className="max-w-lg">
            <div className="relative">
              <select
                value={selectedDefaultSpaceId}
                onChange={(e) => handleSaveDefaultSpace(e.target.value)}
                disabled={savingDefaultSpace || !isConnected}
                className="w-full h-10 rounded-lg border border-input bg-background px-3.5 pr-10 text-sm text-foreground font-medium focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary cursor-pointer shadow-xs appearance-none transition-colors"
              >
                <option value="" disabled className="bg-popover text-muted-foreground">Select space...</option>
                {pmSpaces.map((s) => (
                  <option key={s.id} value={s.id} className="bg-popover text-foreground">
                    {s.name} ({s.key})
                  </option>
                ))}
              </select>
              <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                <ChevronDown className="h-4 w-4 opacity-60" />
              </div>
            </div>

            {selectedDefaultSpaceId && (
              <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>
                  Bugs will be logged to space{' '}
                  <strong className="text-foreground">
                    {pmSpaces.find((s) => s.id === selectedDefaultSpaceId)?.name || connectionsData?.pm?.defaultSpace?.name || 'Selected space'}
                  </strong>
                  .
                </span>
              </p>
            )}
          </div>
        </div>

        {testResult && (
          <div
            className={cn(
              'p-3.5 rounded-xl border text-xs flex items-center gap-2.5 max-w-lg',
              testResult.success
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                : 'bg-destructive/10 text-destructive border-destructive/20'
            )}
          >
            {testResult.success ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}

        {/* Advanced: Project-Level Credential Override */}
        <div className="pt-5 border-t border-border/50 space-y-4">
          <div className="flex items-center justify-between max-w-lg">
            <div>
              <span className="text-xs font-semibold text-foreground block">
                Use custom credentials for this project
              </span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Enable only if this project connects to a different InkaBoard instance or API key than the workspace.
              </p>
            </div>
            <Switch
              checked={hasOverride}
              onCheckedChange={setHasOverride}
            />
          </div>

          {hasOverride && (
            <div className="p-4 rounded-xl border border-border/70 bg-muted/30 space-y-3.5 animate-fade-in max-w-lg">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground block">
                  Custom API Base URL
                </label>
                <Input
                  placeholder="https://pm.example.com/api/v1"
                  value={overrideConfig.baseUrl}
                  onChange={(e) => setOverrideConfig({ ...overrideConfig, baseUrl: e.target.value })}
                  className="h-10 text-sm bg-background/80 rounded-lg"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground block">
                  Custom API Key
                </label>
                <div className="relative">
                  <Input
                    type={showOverrideApiKey ? 'text' : 'password'}
                    placeholder="ink_live_..."
                    value={overrideConfig.apiKey}
                    onChange={(e) => setOverrideConfig({ ...overrideConfig, apiKey: e.target.value })}
                    className="h-10 text-sm bg-background/80 pr-10 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOverrideApiKey(!showOverrideApiKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showOverrideApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRevertPmOverride}
                  disabled={savingOverride}
                  className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  Revert to workspace defaults
                </Button>

                <Button
                  type="button"
                  size="sm"
                  onClick={handleSavePmOverride}
                  disabled={savingOverride}
                  className="h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs cursor-pointer"
                >
                  {savingOverride ? 'Saving...' : 'Save custom credentials'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
