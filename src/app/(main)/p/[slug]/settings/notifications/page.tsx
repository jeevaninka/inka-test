"use client";

import { useState, useEffect, Fragment } from 'react';
import { useParams } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, RotateCcw, Loader2, Save, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  getProjectNotificationSettingsAction,
  updateProjectNotificationSettingsAction,
  testProjectSlackWebhookAction,
} from '@/app/actions/notifications';
import {
  getProjectConnectionsAction,
  revertProjectSlackOverrideAction,
} from '@/app/actions/integrations';
import { SlackLogo } from '@/components/icons/IntegrationLogos';
import { cn } from '@/lib/utils';

type EventKey =
  | 'run_completed'
  | 'bug_raised'
  | 'release_approved'
  | 'review_requested'
  | 'sync_failed';

type ChannelKey = 'slack' | 'in_app' | 'email';

type MatrixState = Record<EventKey, Record<ChannelKey, boolean>>;

const RECOMMENDED_MATRIX: MatrixState = {
  run_completed: { slack: true, in_app: true, email: false },
  bug_raised: { slack: true, in_app: true, email: false },
  release_approved: { slack: true, in_app: true, email: true },
  review_requested: { slack: false, in_app: true, email: true },
  sync_failed: { slack: true, in_app: true, email: false },
};

const EVENT_ROWS: Array<{ key: EventKey; label: string; description: string }> = [
  {
    key: 'run_completed',
    label: 'Run completed',
    description: 'A test run finishes',
  },
  {
    key: 'bug_raised',
    label: 'Bug raised',
    description: 'A defect is created in InkaBoard',
  },
  {
    key: 'release_approved',
    label: 'Release approved',
    description: 'A release is approved or rejected',
  },
  {
    key: 'review_requested',
    label: 'Review requested',
    description: 'A case needs your review',
  },
  {
    key: 'sync_failed',
    label: 'Sync failed',
    description: 'An integration delivery fails',
  },
];

const EVENT_GROUP_ORDER: Record<EventKey, string> = {
  run_completed: 'Runs',
  bug_raised: 'Bugs',
  release_approved: 'Releases',
  review_requested: 'Reviews',
  sync_failed: 'Runs',
};

export default function NotificationsSettingsPage() {
  const params = useParams();
  const { slug } = params as Record<string, string>;
  const { project } = useProjectData();
  const projectIdOrSlug = project?.id || slug;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [matrix, setMatrix] = useState<MatrixState>(RECOMMENDED_MATRIX);

  // Slack Channel Destination State
  const [connectionsData, setConnectionsData] = useState<any>(null);
  const [slackWebhook, setSlackWebhook] = useState('');
  const [showSlackWebhook, setShowSlackWebhook] = useState(false);
  const [slackDirty, setSlackDirty] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [savingSlack, setSavingSlack] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function fetchSettings() {
      if (!projectIdOrSlug) return;
      try {
        const [settings, conn] = await Promise.all([
          getProjectNotificationSettingsAction(projectIdOrSlug),
          getProjectConnectionsAction(projectIdOrSlug).catch(() => null),
        ]);
        if (ignore) return;
        setConnectionsData(conn);
        setSlackWebhook(conn?.slack?.projectWebhookUrl || settings?.slack_webhook_url || '');

        if (settings?.custom_events_matrix && typeof settings.custom_events_matrix === 'object') {
          const saved = settings.custom_events_matrix as Record<string, Record<string, boolean>>;
          const merged: MatrixState = { ...RECOMMENDED_MATRIX };

          EVENT_ROWS.forEach(({ key }) => {
            if (saved[key]) {
              merged[key] = {
                slack: saved[key].slack ?? saved[key].slack_channel ?? RECOMMENDED_MATRIX[key].slack,
                in_app: saved[key].in_app ?? RECOMMENDED_MATRIX[key].in_app,
                email: saved[key].email ?? RECOMMENDED_MATRIX[key].email,
              };
            }
          });
          setMatrix(merged);
        }
      } catch {
        // Non-fatal
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    fetchSettings();
    return () => {
      ignore = true;
    };
  }, [projectIdOrSlug]);

  const handleTestSlack = async () => {
    const url = slackWebhook.trim() || connectionsData?.slack?.workspaceWebhookUrl;
    if (!url) {
      toast.error('No Slack webhook URL configured');
      return;
    }
    setTestingSlack(true);
    try {
      await testProjectSlackWebhookAction(url);
      toast.success('Test message delivered to Slack channel (200 OK)');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Slack test failed';
      toast.error(message);
    } finally {
      setTestingSlack(false);
    }
  };

  const handleSaveSlack = async () => {
    setSavingSlack(true);
    try {
      await updateProjectNotificationSettingsAction(projectIdOrSlug, {
        slack_webhook_url: slackWebhook.trim() || null,
      });
      setSlackDirty(false);
      toast.success('Slack channel settings saved');
      const conn = await getProjectConnectionsAction(projectIdOrSlug).catch(() => null);
      setConnectionsData(conn);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save Slack channel';
      toast.error(message);
    } finally {
      setSavingSlack(false);
    }
  };

  const handleRevertSlack = async () => {
    setSavingSlack(true);
    try {
      await revertProjectSlackOverrideAction(projectIdOrSlug);
      setSlackWebhook('');
      setSlackDirty(false);
      toast.success('Reverted to workspace Slack channel');
      const conn = await getProjectConnectionsAction(projectIdOrSlug).catch(() => null);
      setConnectionsData(conn);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to revert Slack channel';
      toast.error(message);
    } finally {
      setSavingSlack(false);
    }
  };

  const toggleCell = (eventKey: EventKey, channelKey: ChannelKey) => {
    const next = {
      ...matrix,
      [eventKey]: { ...matrix[eventKey], [channelKey]: !matrix[eventKey][channelKey] },
    };
    setMatrix(next);
    setHasChanges(true);
    void handleSave(next);
  };

  const toggleChannel = (channelKey: ChannelKey) => {
    EVENT_ROWS.forEach(({ key }) => toggleCell(key, channelKey));
  };

  const handleResetToRecommended = () => {
    setMatrix(RECOMMENDED_MATRIX);
    setHasChanges(true);
    void handleSave(RECOMMENDED_MATRIX);
    toast.info('Reset to recommended notification rules');
  };

  const handleSave = async (nextMatrix?: MatrixState) => {
    const toSave = nextMatrix ?? matrix;
    setSaving(true);
    try {
      await updateProjectNotificationSettingsAction(projectIdOrSlug, {
        custom_events_matrix: toSave,
      });
      setMatrix(toSave);
      setHasChanges(false);
      toast.success('Notification settings saved');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/40 p-12 flex items-center justify-center gap-2 text-sm text-muted-foreground animate-pulse">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span>Loading notification matrix...</span>
      </div>
    );
  }

  const isSlackConnected = Boolean(connectionsData?.slack?.connected || slackWebhook.trim());
  const hasSlackOverride = Boolean(connectionsData?.slack?.hasOverride);
  const isSlackInherited = Boolean(connectionsData?.slack?.isInherited && !hasSlackOverride);

  return (
    <div className="space-y-6">
      {/* ── Section 1: Slack Channel Routing Destination ── */}
      <div className="rounded-2xl border border-border/70 bg-card p-6 space-y-5 shadow-card max-w-4xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/50">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/10 flex items-center justify-center shrink-0 shadow-xs">
              <SlackLogo className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm text-foreground">Slack Channel Alerts</h4>
                {isSlackConnected && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                    Connected
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {hasSlackOverride
                  ? 'Posting automated test results and defect alerts to a custom channel.'
                  : isSlackInherited
                  ? `Posting to workspace ${connectionsData?.pm?.workspaceName || 'INKA'} default channel.`
                  : 'Connect Slack in workspace settings to receive team alerts.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestSlack}
              disabled={testingSlack || !isSlackConnected}
              className="h-9 px-3.5 text-xs font-medium rounded-lg border border-border/80 bg-muted/40 hover:bg-muted text-foreground shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors"
            >
              {testingSlack ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5 text-primary" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              )}
              <span>Test connection</span>
            </Button>
          </div>
        </div>

        {/* Custom Channel Override Input */}
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between max-w-xl">
            <div>
              <span className="text-xs font-semibold text-foreground block">
                Custom Slack webhook URL for this project
              </span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Leave blank to automatically use the workspace default Slack channel.
              </p>
            </div>
          </div>

          <div className="space-y-2.5 max-w-xl">
            <div className="flex items-center gap-2.5">
              <Input
                type={showSlackWebhook ? 'text' : 'password'}
                placeholder={
                  connectionsData?.slack?.workspaceWebhookUrl
                    ? 'Inheriting workspace default channel...'
                    : 'https://hooks.slack.com/services/...'
                }
                value={slackWebhook}
                onChange={(e) => {
                  setSlackWebhook(e.target.value);
                  setSlackDirty(true);
                }}
                className="h-10 text-sm bg-background/80 rounded-lg"
              />
              <Button
                type="button"
                size="sm"
                onClick={() => setShowSlackWebhook(!showSlackWebhook)}
                className="h-10 w-10 p-0 rounded-lg shrink-0 border border-border/80 bg-muted/40 hover:bg-muted"
                aria-label={showSlackWebhook ? 'Hide Slack webhook URL' : 'Reveal Slack webhook URL'}
              >
                {showSlackWebhook ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSaveSlack}
                disabled={savingSlack || !slackDirty}
                className="h-10 px-5 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs cursor-pointer shrink-0 rounded-lg"
              >
                {savingSlack ? 'Saving...' : 'Save channel'}
              </Button>
            </div>

            {hasSlackOverride && (
              <button
                type="button"
                onClick={handleRevertSlack}
                disabled={savingSlack}
                className="text-xs font-medium text-primary hover:underline cursor-pointer disabled:opacity-50"
              >
                Revert to workspace channel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 2: Event Delivery Matrix ── */}
      <div className="space-y-4">
        {/* Header & Reset Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">Event Delivery Rules</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Choose which channels receive automated notifications for each event.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetToRecommended}
              className="h-8 text-xs font-medium border-border/60 hover:bg-card text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3 mr-1.5" />
              Reset to recommended
            </Button>

            {hasChanges && (
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSave()}
                disabled={saving}
                className="h-8 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                Save changes
              </Button>
            )}
          </div>
        </div>

      {/* Notifications Matrix Table */}
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
        {/* Table Header */}
        <div className="grid grid-cols-[1fr_80px_80px_80px] sm:grid-cols-[1fr_100px_100px_100px] items-center px-6 py-3.5 border-b border-border/50 bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <div className="pr-4">EVENT</div>
          <div className="text-center">
            {isSlackConnected ? (
              <button
                type="button"
                onClick={() => toggleChannel('slack')}
                className="cursor-pointer hover:underline text-foreground"
              >
                SLACK
              </button>
            ) : (
              <button
                type="button"
                disabled
                title="Slack is not connected"
                className="text-muted-foreground/50 cursor-not-allowed"
              >
                SLACK
              </button>
            )}
          </div>
          <div className="text-center">
            <button
              type="button"
              onClick={() => toggleChannel('in_app')}
              className="cursor-pointer hover:underline text-foreground"
            >
              IN-APP
            </button>
          </div>
          <div className="text-center">
            <button
              type="button"
              onClick={() => toggleChannel('email')}
              className="cursor-pointer hover:underline text-foreground"
            >
              EMAIL
            </button>
          </div>
        </div>

        {/* Table Rows */}
        <div className="divide-y divide-border/30">
          {(() => {
            let lastGroup: string | null = null;
            return EVENT_ROWS.map(({ key, label, description }) => {
              const group = EVENT_GROUP_ORDER[key];
              const rowState = matrix[key] || RECOMMENDED_MATRIX[key];
              const showGroupHeader = group !== lastGroup;
              lastGroup = group;

              return (
                <Fragment key={key}>
                  {showGroupHeader && (
                    <div
                      className="grid grid-cols-[1fr_80px_80px_80px] sm:grid-cols-[1fr_100px_100px_100px] items-center px-6 py-2 bg-muted/50 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40"
                    >
                      <div className="pr-4">{group}</div>
                      <div className="text-center">ALL</div>
                      <div className="text-center">ALL</div>
                      <div className="text-center">ALL</div>
                    </div>
                  )}
                  <div
                    className="grid grid-cols-[1fr_80px_80px_80px] sm:grid-cols-[1fr_100px_100px_100px] items-center px-6 py-4 hover:bg-muted/30 transition-colors"
                  >
                    {/* Event Title & Subtitle */}
                    <div className="pr-4">
                      <span className="font-semibold text-sm text-foreground block">{label}</span>
                      <span className="text-xs text-muted-foreground mt-0.5 block">{description}</span>
                    </div>

                    {/* Slack Checkbox */}
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => toggleCell(key, 'slack')}
                        disabled={!isSlackConnected}
                        aria-label={`${label} on Slack`}
                        title={!isSlackConnected ? 'Slack is not connected' : undefined}
                        className={cn(
                          'w-5 h-5 rounded-md flex items-center justify-center transition-all cursor-pointer',
                          rowState.slack
                            ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/40'
                            : 'border border-border/60 hover:border-border/90 bg-transparent'
                        )}
                      >
                        {rowState.slack && <Check className="h-3.5 w-3.5 stroke-[3] text-emerald-600" />}
                      </button>
                    </div>

                    {/* In-App Checkbox */}
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => toggleCell(key, 'in_app')}
                        aria-label={`${label} In-App`}
                        className={cn(
                          'w-5 h-5 rounded-md flex items-center justify-center transition-all cursor-pointer',
                          rowState.in_app
                            ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/40'
                            : 'border border-border/60 hover:border-border/90 bg-transparent'
                        )}
                      >
                        {rowState.in_app && <Check className="h-3.5 w-3.5 stroke-[3] text-emerald-600" />}
                      </button>
                    </div>

                    {/* Email Checkbox */}
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={() => toggleCell(key, 'email')}
                        aria-label={`${label} via Email`}
                        className={cn(
                          'w-5 h-5 rounded-md flex items-center justify-center transition-all cursor-pointer',
                          rowState.email
                            ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/40'
                            : 'border border-border/60 hover:border-border/90 bg-transparent'
                        )}
                      >
                        {rowState.email && <Check className="h-3.5 w-3.5 stroke-[3] text-emerald-600" />}
                      </button>
                    </div>
                  </div>
                </Fragment>
              );
            });
          })()}
        </div>
      </div>
    </div>

      {/* Quick Save Bar if modified */}
      {hasChanges && (
        <div className="flex items-center justify-between p-4 rounded-xl border border-primary/20 bg-primary/5 text-xs">
          <span className="text-muted-foreground">You have unsaved changes to your notification matrix.</span>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving}
            className="h-8 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            Save rules
          </Button>
        </div>
      )}
    </div>
  );
}
