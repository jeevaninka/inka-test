"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Layers, Key, Plus, Loader2, Copy, RefreshCw, ChevronDown, ChevronLeft,
  ExternalLink, ArrowDownLeft, ArrowUpRight, CheckCircle2, AlertCircle,
  Activity, Check, ShieldCheck, Webhook as WebhookIcon, Workflow,
  Filter, Trash2, Edit3
} from 'lucide-react';
import { toast } from 'sonner';
import { logger } from '@/lib/logger.client';
import {
  IntegrationCard,
  IntegrationCardGrid,
} from '@/components/settings/IntegrationCard';
import {
  SlackLogo,
  InkaBoardLogo,
  JiraLogo,
  ConfluenceLogo,
  NotionLogo,
  FigmaLogo,
  PostmanLogo,
  DatadogLogo,
} from '@/components/icons/IntegrationLogos';
import { Select } from '@/components/ui/select';
import {
  IntegrationConfigModal,
  IntegrationConfigSchema,
} from '@/components/settings/IntegrationConfigModal';
import { WebhookManagerModal } from '@/components/settings/WebhookManagerModal';
import {
  getWorkspacePmIntegrationConfigAction,
  saveWorkspacePmIntegrationConfigAction,
  testWorkspacePmConnectionAction,
  getWebhookActivityLogsAction,
  WebhookActivityLogItem,
  getWorkspaceToolIntegrationsAction,
  saveWorkspaceToolIntegrationAction,
  testWorkspaceToolIntegrationAction,
  type WorkspaceToolIntegrationState,
} from '@/app/actions/integrations';
import type { ToolProviderId } from '@/lib/integrations/tool-clients';
import {
  testProjectSlackWebhookAction,
  getWorkspaceNotificationSettingsAction,
  updateWorkspaceNotificationSettingsAction,
} from '@/app/actions/notifications';
import {
  getWebhooksAction,
  manualRetryWebhookDeliveryAction,
  WebhookDto,
} from '@/app/actions/webhooks';
import { PmIntegrationConfig } from '@/lib/integrations/pm-client';
import { cn } from '@/lib/utils';

function formatRelativeTime(dateString?: string | null): string {
  if (!dateString) return '—';
  const date = new Date(dateString);
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'just now';
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return 'just now';
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export default function WorkspaceIntegrationsPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const slug = params?.slug as string;

  const initialTab = searchParams?.get('tab') === 'activity'
    ? 'activity'
    : 'integrations';
  const [activeTab, setActiveTab] = useState<'integrations' | 'activity'>(initialTab);
  const [activeModal, setActiveModal] = useState<'pm' | 'slack' | ToolProviderId | null>(null);
  const [showWebhookManager, setShowWebhookManager] = useState(false);
  const [webhookManagerCreateMode, setWebhookManagerCreateMode] = useState(false);
  const [retryingDelivery, setRetryingDelivery] = useState(false);

  // PM Tool (InkaBoard) State
  const [pmEnabled, setPmEnabled] = useState(false);
  const [pmConfig, setPmConfig] = useState<PmIntegrationConfig>({
    baseUrl: '',
    apiKey: '',
    webhookSecret: '',
    autoCreateDefect: true,
  });
  const [pmLastSyncedAt, setPmLastSyncedAt] = useState<string | null>(null);
  const [testingPm, setTestingPm] = useState(false);
  const [pmTestResult, setPmTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);
  const [savingPm, setSavingPm] = useState(false);

  // Custom Outgoing Webhooks State
  const [webhooks, setWebhooks] = useState<WebhookDto[]>([]);
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);

  // Slack Workspace State
  const [slackWebhook, setSlackWebhook] = useState('');
  const [, setSlackEnabled] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [slackTestResult, setSlackTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [savingSlack, setSavingSlack] = useState(false);

  // Additional Tool Integrations (Confluence, Notion, Figma, Postman, Datadog)
  const [toolStates, setToolStates] = useState<Record<ToolProviderId, WorkspaceToolIntegrationState>>({
    confluence: { enabled: false, lastSyncedAt: null, config: { baseUrl: '', email: '', apiToken: '', defaultSpaceKey: '' } },
    notion: { enabled: false, lastSyncedAt: null, config: { apiToken: '', defaultDatabaseId: '' } },
    figma: { enabled: false, lastSyncedAt: null, config: { accessToken: '', defaultTeamId: '' } },
    postman: {
      enabled: false,
      lastSyncedAt: null,
      config: {
        apiKey: '',
        workspaceId: '',
        envMapping: { DEV: '', STAGING: '', UAT: '', PROD: '' },
        defaultDelayMs: 0,
        defaultTimeoutMs: 15000,
        bailOnFailure: true,
        persistResponses: true,
        turnOffLogs: false,
        keepVariableValues: true,
        ignoreCookies: false,
        saveCookies: true,
      },
    },
    datadog: {
      enabled: false,
      lastSyncedAt: null,
      config: {
        site: 'datadoghq.com',
        apiKey: '',
        appKey: '',
        envStartUrls: { DEV: '', STAGING: '', UAT: '', PROD: '' },
        defaultExecutionRule: 'blocking',
        defaultMonitoringExpiryMs: 35000,
      },
    },
  });
  const [testingTool, setTestingTool] = useState(false);
  const [toolTestResult, setToolTestResult] = useState<{ success: boolean; message: string; latencyMs?: number; meta?: any } | null>(null);
  const [savingTool, setSavingTool] = useState(false);
  const [newEnvKeyInput, setNewEnvKeyInput] = useState('');

  // Activity Logs State
  const [activityLogs, setActivityLogs] = useState<WebhookActivityLogItem[]>([]);
  const [logsFilter, setLogsFilter] = useState<'ALL' | 'INBOUND' | 'OUTBOUND' | 'ERRORS'>('ALL');
  const [selectedIntegration, setSelectedIntegration] = useState<string>('ALL');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [selectedLog, setSelectedLog] = useState<WebhookActivityLogItem | null>(null);

  const [loading, setLoading] = useState(true);
  const [showAddIntegrationModal, setShowAddIntegrationModal] = useState(false);
  const [pmProviderType, setPmProviderType] = useState<'inkaboard' | 'jira'>('inkaboard');

  const updateToolConfigField = useCallback((provider: ToolProviderId, field: string, value: any) => {
    setToolStates((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        config: {
          ...prev[provider].config,
          [field]: value,
        },
      },
    }));
  }, []);

  const [webhookIngressUrl, setWebhookIngressUrl] = useState(`/api/v1/workspaces/${slug}/webhooks/incoming`);

  useEffect(() => {
    if (slug) {
      setWebhookIngressUrl(`${window.location.origin}/api/v1/workspaces/${slug}/webhooks/incoming`);
    }
  }, [slug]);

  const loadData = useCallback(async () => {
    if (!slug) return;
    try {
      const [pmRes, whRes, notifRes, toolsRes] = await Promise.all([
        getWorkspacePmIntegrationConfigAction(slug).catch(() => null),
        getWebhooksAction(slug, 'workspace').catch(() => []),
        getWorkspaceNotificationSettingsAction(slug).catch(() => null),
        getWorkspaceToolIntegrationsAction(slug).catch(() => null),
      ]);
      if (pmRes) {
        setPmEnabled(pmRes.enabled);
        setPmConfig(pmRes.config);
        setPmLastSyncedAt(pmRes.lastSyncedAt);
      }
      setWebhooks(whRes);
      if (notifRes) {
        setSlackWebhook(notifRes.slack_webhook_url || '');
        setSlackEnabled(Boolean(notifRes.slack_webhook_url));
      }
      if (toolsRes) {
        setToolStates(toolsRes);
      }
    } catch {
      // Non-fatal
    } finally {
      setLoading(false);
    }
  }, [slug]);

  const loadLogs = useCallback(async () => {
    if (!slug) return;
    setLoadingLogs(true);
    try {
      const logs = await getWebhookActivityLogsAction(slug, 'workspace');
      setActivityLogs(logs);
    } catch (err: any) {
      logger.error('Failed to load workspace integration activity logs', {
        component: 'WorkspaceIntegrationsPage',
        action: 'loadLogs',
        workspaceSlug: slug,
        error: err,
      });
    } finally {
      setLoadingLogs(false);
    }
  }, [slug]);

  useEffect(() => {
    loadData();
    loadLogs();
  }, [loadData, loadLogs]);

  const isPmConfigured = Boolean(pmEnabled && pmConfig.baseUrl && pmConfig.apiKey);
  const isSlackConfigured = Boolean(slackWebhook.trim());

  const handleManualRetry = async () => {
    if (!selectedLog?.deliveryId) return;
    setRetryingDelivery(true);
    try {
      const res = await manualRetryWebhookDeliveryAction(selectedLog.deliveryId);
      if (res.success) {
        toast.success(`Retry delivered (HTTP ${res.statusCode}) [${res.latencyMs}ms]`);
      } else {
        toast.error(`Retry attempt failed: HTTP ${res.statusCode}`);
      }
      setSelectedLog((prev) =>
        prev
          ? {
              ...prev,
              statusCode: res.statusCode,
              statusText: res.success ? 'SUCCESS' : 'FAILED',
              responseBody: res.responseBody,
              attempts: res.attempts,
              retryCount: (res.attempts?.length || 1) - 1,
            }
          : null
      );
      await loadLogs();
    } catch (err: any) {
      toast.error(err.message || 'Retry failed');
    } finally {
      setRetryingDelivery(false);
    }
  };

  // Derived Live Telemetry Signals for Connected Services
  const inkaBoardSignal = useMemo(() => {
    if (!isPmConfigured) return undefined;
    const log = activityLogs.find((l) => l.integration === 'InkaBoard');
    if (!log) return { text: 'Ready · Awaiting first event', isOk: true };
    const isOk = log.statusCode < 400;
    const time = formatRelativeTime(log.timestamp);
    const eventName = log.eventType === 'ticket.status_sync' ? 'Status synced' : log.direction === 'INBOUND' ? 'Webhook received' : 'Sync event';
    return {
      text: `${eventName} ${time} (${log.statusCode})`,
      isOk,
    };
  }, [activityLogs, isPmConfigured]);

  const slackSignal = useMemo(() => {
    if (!isSlackConfigured) return undefined;
    const log = activityLogs.find((l) => l.integration === 'Slack');
    if (!log) return { text: 'Ready · No alerts dispatched yet', isOk: true };
    const isOk = log.statusCode < 400;
    const time = formatRelativeTime(log.timestamp);
    return {
      text: `Alert dispatched ${time} (${log.statusCode})`,
      isOk,
    };
  }, [activityLogs, isSlackConfigured]);

  // Modal Configuration Schema Driven by Active Selection
  const modalConfigSchema = useMemo<IntegrationConfigSchema | null>(() => {
    if (activeModal === 'pm') {
      const isJira = pmProviderType === 'jira';
      return {
        id: 'pm',
        title: isJira ? 'Jira Integration' : 'InkaBoard Integration',
        description: isJira
          ? 'Connect your workspace to Atlassian Jira. Test runs and defects will synchronize with your Jira project issues.'
          : 'Connect your workspace to InkaBoard. Test cases and runs will automatically create issues and synchronize status changes.',
        icon: isJira ? <JiraLogo className="h-5 w-5" /> : <InkaBoardLogo className="h-5 w-5" />,
        topContent: (
          <div className="space-y-1.5 pb-1">
            <label className="text-xs font-semibold text-foreground/90 block">Issue Tracker Provider</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPmProviderType('inkaboard')}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors cursor-pointer',
                  !isJira
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground hover:bg-muted/30'
                )}
              >
                <InkaBoardLogo className="h-4 w-4 shrink-0" />
                <span>InkaBoard</span>
              </button>
              <button
                type="button"
                onClick={() => setPmProviderType('jira')}
                className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors cursor-pointer',
                  isJira
                    ? 'border-primary/50 bg-primary/10 text-foreground'
                    : 'border-border/60 bg-background/40 text-muted-foreground hover:text-foreground hover:bg-muted/30'
                )}
              >
                <JiraLogo className="h-4 w-4 shrink-0" />
                <span>Atlassian Jira</span>
              </button>
            </div>
          </div>
        ),
        fields: [
          {
            key: 'baseUrl',
            label: isJira ? 'Jira Instance URL' : 'API Base URL',
            value: pmConfig.baseUrl,
            placeholder: isJira ? 'https://your-domain.atlassian.net' : 'http://localhost:3000/api/v1',
            helperText: isJira
              ? 'Your Jira Cloud or Data Center base URL.'
              : 'Base URL pointing to your InkaBoard or PM API root.',
            onChange: (val) => setPmConfig((prev) => ({ ...prev, baseUrl: val })),
          },
          {
            key: 'apiKey',
            label: isJira ? 'API Token' : 'Workspace API Key / Token',
            value: pmConfig.apiKey,
            placeholder: isJira ? 'ATATT3xFfGF0...' : 'ink_live_...',
            masked: true,
            helperText: isJira
              ? 'Personal API token generated from Atlassian Account Settings.'
              : 'Secret API token generated in InkaBoard > Developer Settings.',
            onChange: (val) => setPmConfig((prev) => ({ ...prev, apiKey: val })),
          },
          {
            key: 'webhookUrl',
            label: 'Unified Inbound Webhook URL (Copy into Issue Tracker)',
            value: webhookIngressUrl,
            readOnly: true,
            copyable: true,
            helperText: 'Paste this single webhook URL into your issue tracker webhook settings.',
          },
          {
            key: 'webhookSecret',
            label: 'Webhook Signing Secret',
            value: pmConfig.webhookSecret || '',
            placeholder: 'whsec_...',
            masked: true,
            copyable: true,
            helperText: 'Paste the signing secret to verify incoming HMAC-SHA256 webhook signatures.',
            onChange: (val) => setPmConfig((prev) => ({ ...prev, webhookSecret: val })),
          },
        ],
        onTest: async () => {
          if (!pmConfig.baseUrl || !pmConfig.apiKey) {
            toast.error('Please enter Base URL and API Key first');
            return;
          }
          setTestingPm(true);
          setPmTestResult(null);
          try {
            const res = await testWorkspacePmConnectionAction(slug, pmConfig);
            setPmTestResult(res);
            toast.success(res.message || 'Connected successfully!');
          } catch (err: any) {
            setPmTestResult({ success: false, message: err.message || 'Connection failed' });
            toast.error(err.message || 'Connection failed');
          } finally {
            setTestingPm(false);
          }
        },
        isTesting: testingPm,
        testResult: pmTestResult,
        onSave: async () => {
          setSavingPm(true);
          try {
            await saveWorkspacePmIntegrationConfigAction(slug, {
              enabled: true,
              config: pmConfig,
            });
            setPmEnabled(true);
            setActiveModal(null);
            toast.success('InkaBoard integration saved successfully');
            loadData();
            loadLogs();
          } catch (err: any) {
            toast.error(err.message || 'Failed to save');
          } finally {
            setSavingPm(false);
          }
        },
        isSaving: savingPm,
      };
    }

    if (activeModal === 'slack') {
      return {
        id: 'slack',
        title: 'Slack Workspace',
        description: 'Configure the default Slack channel webhook for team-wide notifications when projects do not configure a custom channel.',
        icon: <SlackLogo className="h-5 w-5" />,
        fields: [
          {
            key: 'webhookUrl',
            label: 'Default Channel Webhook URL',
            value: slackWebhook,
            placeholder: 'https://hooks.slack.com/services/...',
            helperText: 'Incoming Webhook URL from your Slack app or workflow.',
            onChange: (val) => setSlackWebhook(val),
          },
        ],
        onTest: async () => {
          if (!slackWebhook.trim()) {
            toast.error('Please enter a webhook URL first');
            return;
          }
          setTestingSlack(true);
          setSlackTestResult(null);
          try {
            await testProjectSlackWebhookAction(slackWebhook.trim());
            setSlackTestResult({ success: true, message: 'Test message delivered to Slack channel (200 OK)' });
            toast.success('Slack notification delivered!');
          } catch (err: any) {
            setSlackTestResult({ success: false, message: err.message || 'Slack test failed' });
            toast.error(err.message || 'Slack test failed');
          } finally {
            setTestingSlack(false);
          }
        },
        isTesting: testingSlack,
        testResult: slackTestResult,
        onSave: async () => {
          setSavingSlack(true);
          try {
            await updateWorkspaceNotificationSettingsAction(slug, {
              slack_webhook_url: slackWebhook.trim() || null,
            });
            setSlackEnabled(Boolean(slackWebhook.trim()));
            setActiveModal(null);
            toast.success('Slack settings saved successfully');
            await loadData();
            await loadLogs();
          } catch (err: any) {
            toast.error(err.message || 'Failed to save Slack settings');
          } finally {
            setSavingSlack(false);
          }
        },
        isSaving: savingSlack,
      };
    }

    const toolProviders: ToolProviderId[] = ['postman', 'datadog', 'confluence', 'notion', 'figma'];
    if (activeModal && toolProviders.includes(activeModal as ToolProviderId)) {
      const provider = activeModal as ToolProviderId;
      const state = toolStates[provider];
      const cfg = state?.config || {};

      const handleTestTool = async () => {
        setTestingTool(true);
        setToolTestResult(null);
        try {
          const res = await testWorkspaceToolIntegrationAction(slug, provider, cfg);
          setToolTestResult(res);
          if (res.success) {
            toast.success(res.message);
          } else {
            toast.error(res.message);
          }
        } catch (err: any) {
          setToolTestResult({ success: false, message: err.message || 'Connection test failed' });
          toast.error(err.message || 'Connection test failed');
        } finally {
          setTestingTool(false);
        }
      };

      const handleSaveTool = async (enabledFlag: boolean) => {
        setSavingTool(true);
        try {
          await saveWorkspaceToolIntegrationAction(slug, provider, {
            enabled: enabledFlag,
            config: cfg,
          });
          setActiveModal(null);
          setToolTestResult(null);
          toast.success(`${provider.charAt(0).toUpperCase() + provider.slice(1)} integration saved`);
          await loadData();
        } catch (err: any) {
          toast.error(err.message || 'Failed to save integration');
        } finally {
          setSavingTool(false);
        }
      };

      if (provider === 'postman') {
        const defaultEnvs = { DEV: '', STAGING: '', UAT: '', PROD: '' };
        const envMap: Record<string, string> = { ...defaultEnvs, ...(cfg.envMapping || {}) };
        const envKeys = Object.keys(envMap);
        const discoveredEnvs: Array<{ id: string; uid: string; name: string }> =
          toolTestResult?.meta?.environments || [];
        const hasDelay = Number(cfg.defaultDelayMs ?? 0) > 0;

        return {
          id: 'postman',
          title: 'Postman API Runner',
          description:
            'Run Postman Collections in 1 click with configurable environment mapping (DEV, STAGING, UAT, PROD), dataset iterations, and native Postman runner settings.',
          icon: <PostmanLogo className="h-5 w-5" />,
          fields: [
            {
              key: 'apiKey',
              label: 'Postman API Key (PMAK)',
              value: cfg.apiKey || '',
              placeholder: 'PMAK-65a1b2c3d4e5f6...',
              masked: true,
              helperText: 'Generate a Postman API Key from Postman Settings → API Keys.',
              onChange: (val) => updateToolConfigField('postman', 'apiKey', val),
            },
            {
              key: 'workspaceId',
              label: 'Postman Workspace ID (Optional)',
              value: cfg.workspaceId || '',
              placeholder: 'e.g. 1f0df50a-865c-4d91-...',
              helperText: 'Optional: scope collection & environment discovery to a specific Postman Workspace.',
              onChange: (val) => updateToolConfigField('postman', 'workspaceId', val),
            },
          ],
          extraContent: (
            <div className="space-y-4 pt-2 border-t border-border/50">
              {/* Vertical Configurable Environment Mapping Section */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-foreground">
                    Environment Mapping (InkaTest Env → Postman Env UID)
                  </label>
                  <span className="text-[10px] font-mono text-muted-foreground">
                    Auto-selected per Run Environment
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Map your InkaTest environments (DEV, STAGING, UAT, PROD, or custom) to Postman Environment UIDs. When a run executes on that environment, InkaTest loads its Postman variables and overlays your InkaTest variables.
                </p>

                <div className="space-y-2 pt-1">
                  {envKeys.map((envKey) => (
                    <div key={envKey} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 font-mono text-[11px] font-bold uppercase text-foreground bg-muted/70 px-2.5 py-1.5 rounded-lg border border-border/70 truncate text-center">
                        {envKey}
                      </span>
                      <div className="flex-1 min-w-0">
                        {discoveredEnvs.length > 0 ? (
                          <Select
                            value={envMap[envKey] || ''}
                            onChange={(e) =>
                              updateToolConfigField('postman', 'envMapping', {
                                ...envMap,
                                [envKey]: e.target.value,
                              })
                            }
                            options={[
                              { value: '', label: 'None (Use InkaTest Vars only)' },
                              ...discoveredEnvs.map((pe) => ({
                                value: pe.uid,
                                label: `${pe.name} (${pe.uid})`
                              }))
                            ]}
                            className="w-full h-8 rounded-lg font-mono"
                          />
                        ) : (
                          <Input
                            value={envMap[envKey] || ''}
                            onChange={(e) =>
                              updateToolConfigField('postman', 'envMapping', {
                                ...envMap,
                                [envKey]: e.target.value,
                              })
                            }
                            placeholder={`${envKey} Postman Environment UID (or click Test connection to load dropdown)`}
                            className="h-8 text-xs font-mono w-full"
                          />
                        )}
                      </div>
                      {!['DEV', 'STAGING', 'UAT', 'PROD'].includes(envKey) && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...envMap };
                            delete next[envKey];
                            updateToolConfigField('postman', 'envMapping', next);
                          }}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer shrink-0"
                          title={`Remove ${envKey}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  {/* Add Custom Environment Row */}
                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      value={newEnvKeyInput}
                      onChange={(e) => setNewEnvKeyInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
                      placeholder="Add custom env (e.g. QA, PREPROD, SANDBOX)..."
                      className="h-8 text-xs font-mono flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newEnvKeyInput.trim()) {
                          e.preventDefault();
                          const clean = newEnvKeyInput.trim().toUpperCase();
                          if (clean && !(clean in envMap)) {
                            updateToolConfigField('postman', 'envMapping', { ...envMap, [clean]: '' });
                          }
                          setNewEnvKeyInput('');
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!newEnvKeyInput.trim()}
                      onClick={() => {
                        const clean = newEnvKeyInput.trim().toUpperCase();
                        if (clean && !(clean in envMap)) {
                          updateToolConfigField('postman', 'envMapping', { ...envMap, [clean]: '' });
                        }
                        setNewEnvKeyInput('');
                      }}
                      className="h-8 px-3 text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Env
                    </Button>
                  </div>
                </div>
              </div>

              {/* Native Postman Runner Settings Checkboxes */}
              <div className="space-y-2.5 pt-3 border-t border-border/50">
                <label className="text-xs font-semibold text-foreground block">
                  Default Collection Runner Settings
                </label>

                <div className="space-y-2 text-xs">
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cfg.alertOnMissingEnvVars !== false}
                      onChange={(e) => updateToolConfigField('postman', 'alertOnMissingEnvVars', e.target.checked)}
                      className="rounded border-border text-primary h-3.5 w-3.5"
                    />
                    <span className="text-foreground font-medium">
                      Alert and prompt to update missing environment variables before running
                    </span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cfg.persistResponses !== false}
                      onChange={(e) => updateToolConfigField('postman', 'persistResponses', e.target.checked)}
                      className="rounded border-border text-primary h-3.5 w-3.5"
                    />
                    <span className="text-foreground font-medium">Persist responses for a session</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={Boolean(cfg.turnOffLogs)}
                      onChange={(e) => updateToolConfigField('postman', 'turnOffLogs', e.target.checked)}
                      className="rounded border-border text-primary h-3.5 w-3.5"
                    />
                    <span className="text-foreground font-medium">Turn off logs during run</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={Boolean(cfg.bailOnFailure)}
                      onChange={(e) => updateToolConfigField('postman', 'bailOnFailure', e.target.checked)}
                      className="rounded border-border text-primary h-3.5 w-3.5"
                    />
                    <span className="text-foreground font-medium">Stop run if an error occurs</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cfg.keepVariableValues !== false}
                      onChange={(e) => updateToolConfigField('postman', 'keepVariableValues', e.target.checked)}
                      className="rounded border-border text-primary h-3.5 w-3.5"
                    />
                    <span className="text-foreground font-medium">Keep variable values</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={Boolean(cfg.ignoreCookies)}
                      onChange={(e) => updateToolConfigField('postman', 'ignoreCookies', e.target.checked)}
                      className="rounded border-border text-primary h-3.5 w-3.5"
                    />
                    <span className="text-foreground font-medium">Run collection without using stored cookies</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={cfg.saveCookies !== false}
                      onChange={(e) => updateToolConfigField('postman', 'saveCookies', e.target.checked)}
                      className="rounded border-border text-primary h-3.5 w-3.5"
                    />
                    <span className="text-foreground font-medium">Save cookies after collection run</span>
                  </label>

                  <div className="flex items-center gap-2.5 flex-wrap pt-0.5">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={hasDelay}
                        onChange={(e) =>
                          updateToolConfigField('postman', 'defaultDelayMs', e.target.checked ? 250 : 0)
                        }
                        className="rounded border-border text-primary h-3.5 w-3.5"
                      />
                      <span className="text-foreground font-medium">Add a delay of</span>
                    </label>
                    <div className="relative flex items-center w-24">
                      <input
                        type="number"
                        min={0}
                        max={10000}
                        step={50}
                        value={cfg.defaultDelayMs ?? 0}
                        onChange={(e) =>
                          updateToolConfigField('postman', 'defaultDelayMs', Math.max(0, Number(e.target.value) || 0))
                        }
                        className="w-full h-7 rounded-lg border border-input bg-background pl-2.5 pr-7 text-xs font-mono text-foreground"
                      />
                      <span className="absolute right-2 text-[10px] font-mono text-muted-foreground pointer-events-none">
                        ms
                      </span>
                    </div>
                    <span className="text-foreground font-medium">between requests</span>
                  </div>
                </div>
              </div>
            </div>
          ),
          onTest: handleTestTool,
          isTesting: testingTool,
          testResult: toolTestResult,
          onSave: () => handleSaveTool(Boolean(cfg.apiKey?.trim())),
          isSaving: savingTool,
        };
      }

      if (provider === 'datadog') {
        const defaultEnvs = { DEV: '', STAGING: '', UAT: '', PROD: '' };
        const envUrls: Record<string, string> = { ...defaultEnvs, ...(cfg.envStartUrls || {}) };
        const envKeys = Object.keys(envUrls);
        return {
          id: 'datadog',
          title: 'Datadog Synthetics',
          description:
            'Trigger Datadog API & Browser Synthetic tests in 1 click, override runtime variables & start URLs per environment, and sync pass/fail verdicts.',
          icon: <DatadogLogo className="h-5 w-5" />,
          fields: [
            {
              key: 'site',
              label: 'Datadog Site',
              value: cfg.site || 'datadoghq.com',
              placeholder: 'datadoghq.com (or us3.datadoghq.com, datadoghq.eu)',
              helperText: 'Your Datadog region domain (e.g. datadoghq.com, us5.datadoghq.com, datadoghq.eu).',
              onChange: (val) => updateToolConfigField('datadog', 'site', val),
            },
            {
              key: 'apiKey',
              label: 'Datadog API Key (DD-API-KEY)',
              value: cfg.apiKey || '',
              placeholder: '32-character Datadog API Key...',
              masked: true,
              onChange: (val) => updateToolConfigField('datadog', 'apiKey', val),
            },
            {
              key: 'appKey',
              label: 'Datadog Application Key (DD-APPLICATION-KEY)',
              value: cfg.appKey || '',
              placeholder: '40-character Datadog Application Key (with synthetics_read / trigger)...',
              masked: true,
              onChange: (val) => updateToolConfigField('datadog', 'appKey', val),
            },
          ],
          extraContent: (
            <div className="space-y-4 pt-2 border-t border-border/50">
              <details className="group space-y-2.5">
                <summary className="list-none cursor-pointer flex items-center justify-between py-1 hover:opacity-80 transition-opacity">
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-foreground block cursor-pointer">
                      Environment Start URL Overrides (Optional)
                    </label>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Override the target Start URL passed to Datadog Synthetics when running against DEV, STAGING, UAT, or PROD. All InkaTest variables are also injected automatically.
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="space-y-2 pt-2 border-t border-border/40">
                  {envKeys.map((envKey) => (
                    <div key={envKey} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 font-mono text-[11px] font-bold uppercase text-foreground bg-muted/70 px-2.5 py-1.5 rounded-lg border border-border/70 truncate text-center">
                        {envKey}
                      </span>
                      <Input
                        value={envUrls[envKey] || ''}
                        onChange={(e) =>
                          updateToolConfigField('datadog', 'envStartUrls', {
                            ...envUrls,
                            [envKey]: e.target.value,
                          })
                        }
                        placeholder={`https://${envKey.toLowerCase()}.example.com`}
                        className="h-8 text-xs font-mono flex-1"
                      />
                      {!['DEV', 'STAGING', 'UAT', 'PROD'].includes(envKey) && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = { ...envUrls };
                            delete next[envKey];
                            updateToolConfigField('datadog', 'envStartUrls', next);
                          }}
                          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer shrink-0"
                          title={`Remove ${envKey}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}

                  <div className="flex items-center gap-2 pt-1">
                    <Input
                      value={newEnvKeyInput}
                      onChange={(e) => setNewEnvKeyInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
                      placeholder="Add custom env (e.g. QA, PREPROD)..."
                      className="h-8 text-xs font-mono flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newEnvKeyInput.trim()) {
                          e.preventDefault();
                          const clean = newEnvKeyInput.trim().toUpperCase();
                          if (clean && !(clean in envUrls)) {
                            updateToolConfigField('datadog', 'envStartUrls', { ...envUrls, [clean]: '' });
                          }
                          setNewEnvKeyInput('');
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!newEnvKeyInput.trim()}
                      onClick={() => {
                        const clean = newEnvKeyInput.trim().toUpperCase();
                        if (clean && !(clean in envUrls)) {
                          updateToolConfigField('datadog', 'envStartUrls', { ...envUrls, [clean]: '' });
                        }
                        setNewEnvKeyInput('');
                      }}
                      className="h-8 px-3 text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Add Env
                    </Button>
                  </div>
                </div>
              </details>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2 border-t border-border/40">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    Default Execution Rule
                  </span>
                  <Select
                    value={cfg.defaultExecutionRule || 'blocking'}
                    onChange={(e) =>
                      updateToolConfigField('datadog', 'defaultExecutionRule', e.target.value)
                    }
                    options={[
                      { value: 'blocking', label: 'Blocking (Wait & fail case if it fails)' },
                      { value: 'non_blocking', label: 'Non-blocking (Trigger & immediately pass)' },
                      { value: 'skipped', label: 'Skipped (Skip synthetic execution)' }
                    ]}
                    className="w-full h-8 rounded-lg"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-muted-foreground">
                    Max Result Monitor Timeout
                  </span>
                  <Select
                    value={String(cfg.defaultMonitoringExpiryMs ?? 1800000)}
                    onChange={(e) =>
                      updateToolConfigField('datadog', 'defaultMonitoringExpiryMs', Number(e.target.value))
                    }
                    options={[
                      { value: '900000', label: '15 minutes' },
                      { value: '1800000', label: '30 minutes (Default)' },
                      { value: '3600000', label: '60 minutes' },
                      { value: '7200000', label: '120 minutes' }
                    ]}
                    className="w-full h-8 rounded-lg font-mono"
                  />
                </div>
              </div>
            </div>
          ),
          onTest: handleTestTool,
          isTesting: testingTool,
          testResult: toolTestResult,
          onSave: () => handleSaveTool(Boolean(cfg.apiKey?.trim() && cfg.appKey?.trim())),
          isSaving: savingTool,
        };
      }

      if (provider === 'confluence') {
        return {
          id: 'confluence',
          title: 'Atlassian Confluence',
          description:
            'Sync PRD specifications and requirements pages to generate or update manual test cases when documentation changes.',
          icon: <ConfluenceLogo className="h-5 w-5" />,
          fields: [
            {
              key: 'baseUrl',
              label: 'Confluence Base URL',
              value: cfg.baseUrl || '',
              placeholder: 'https://your-domain.atlassian.net/wiki',
              onChange: (val) => updateToolConfigField('confluence', 'baseUrl', val),
            },
            {
              key: 'email',
              label: 'Atlassian Account Email',
              value: cfg.email || '',
              placeholder: 'qa@company.com',
              onChange: (val) => updateToolConfigField('confluence', 'email', val),
            },
            {
              key: 'apiToken',
              label: 'Atlassian API Token',
              value: cfg.apiToken || '',
              placeholder: 'ATATT3xFfGF0...',
              masked: true,
              onChange: (val) => updateToolConfigField('confluence', 'apiToken', val),
            },
            {
              key: 'defaultSpaceKey',
              label: 'Default Space Key (Optional)',
              value: cfg.defaultSpaceKey || '',
              placeholder: 'e.g. PRD, ENG, QA',
              onChange: (val) => updateToolConfigField('confluence', 'defaultSpaceKey', val),
            },
          ],
          onTest: handleTestTool,
          isTesting: testingTool,
          testResult: toolTestResult,
          onSave: () => handleSaveTool(Boolean(cfg.baseUrl?.trim() && cfg.apiToken?.trim())),
          isSaving: savingTool,
        };
      }

      if (provider === 'notion') {
        return {
          id: 'notion',
          title: 'Notion Docs & Wiki',
          description:
            'Connect your Notion workspace to pull requirement docs and acceptance criteria directly into test case authoring.',
          icon: <NotionLogo className="h-5 w-5" />,
          fields: [
            {
              key: 'apiToken',
              label: 'Notion Internal Integration Secret',
              value: cfg.apiToken || '',
              placeholder: 'ntn_... or secret_...',
              masked: true,
              helperText: 'Create an Internal Integration at notion.so/my-integrations and share your PRD pages with it.',
              onChange: (val) => updateToolConfigField('notion', 'apiToken', val),
            },
            {
              key: 'defaultDatabaseId',
              label: 'Default Specs Database / Page ID (Optional)',
              value: cfg.defaultDatabaseId || '',
              placeholder: 'e.g. 8a2f3c4d-...',
              onChange: (val) => updateToolConfigField('notion', 'defaultDatabaseId', val),
            },
          ],
          onTest: handleTestTool,
          isTesting: testingTool,
          testResult: toolTestResult,
          onSave: () => handleSaveTool(Boolean(cfg.apiToken?.trim())),
          isSaving: savingTool,
        };
      }

      if (provider === 'figma') {
        return {
          id: 'figma',
          title: 'Figma Design Specs',
          description:
            'Render live Figma frame previews inside test cases and steps so testers can verify UI implementation against the latest designs.',
          icon: <FigmaLogo className="h-5 w-5" />,
          fields: [
            {
              key: 'accessToken',
              label: 'Figma Personal Access Token',
              value: cfg.accessToken || '',
              placeholder: 'figd_...',
              masked: true,
              helperText: 'Generate from Figma Account Settings → Personal access tokens (File content: Read).',
              onChange: (val) => updateToolConfigField('figma', 'accessToken', val),
            },
            {
              key: 'defaultTeamId',
              label: 'Default Figma Team / Project ID (Optional)',
              value: cfg.defaultTeamId || '',
              placeholder: 'e.g. 1029384756',
              onChange: (val) => updateToolConfigField('figma', 'defaultTeamId', val),
            },
          ],
          onTest: handleTestTool,
          isTesting: testingTool,
          testResult: toolTestResult,
          onSave: () => handleSaveTool(Boolean(cfg.accessToken?.trim())),
          isSaving: savingTool,
        };
      }
    }

    return null;
  }, [
    activeModal,
    pmProviderType,
    pmConfig,
    webhookIngressUrl,
    testingPm,
    pmTestResult,
    savingPm,
    slackWebhook,
    testingSlack,
    slackTestResult,
    savingSlack,
    isPmConfigured,
    toolStates,
    testingTool,
    toolTestResult,
    savingTool,
    newEnvKeyInput,
    updateToolConfigField,
    slug,
    loadData,
    loadLogs,
  ]);

  const filteredLogs = activityLogs.filter((log) => {
    if (logsFilter === 'INBOUND' && log.direction !== 'INBOUND') return false;
    if (logsFilter === 'OUTBOUND' && log.direction !== 'OUTBOUND') return false;
    if (logsFilter === 'ERRORS' && log.statusText !== 'FAILED' && log.statusCode < 400) return false;
    if (selectedIntegration !== 'ALL' && log.integration !== selectedIntegration) return false;
    return true;
  });

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span>Loading integrations hub...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      {/* ── Workspace Integrations hub (cards only, activity via header button) ── */}
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Connect tools once for the whole workspace. Projects inherit these settings unless overridden.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setActiveTab('activity')}
          className="h-9 px-4 rounded-xl text-xs font-semibold gap-1.5 border-border/80 bg-muted/40 hover:bg-muted shadow-xs cursor-pointer shrink-0"
        >
          <Activity className="h-4 w-4" />
          <span>Activity log ({activityLogs.length})</span>
        </Button>
      </div>

      {/* ── TAB 1: INTEGRATIONS (8-Card Compact 4-Column Hub) ── */}
      {activeTab === 'integrations' && (
        <div className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground">
              Connect tools once for the whole workspace. Projects inherit these settings unless overridden.
            </p>
          </div>
          <IntegrationCardGrid columns={4}>
            {/* Box 1: InkaBoard */}
            <IntegrationCard
              icon={<InkaBoardLogo className="h-5 w-5 rounded-md shadow-xs" />}
              iconBgClass="bg-[#6522ea]/10 border-[#6522ea]/25"
              name="InkaBoard"
              category="Issue Tracker & Releases"
              description="Synchronize bugs, requirements, and release status natively."
              status={isPmConfigured ? 'connected' : 'not_connected'}
              order={isPmConfigured ? 0 : 1}
              statusSignal={inkaBoardSignal}
              onAction={() => {
                setPmTestResult(null);
                setActiveModal('pm');
              }}
            />

            {/* Box 2: Postman */}
            <IntegrationCard
              icon={<PostmanLogo className="h-5 w-5" />}
              iconBgClass="bg-[#FF6C37]/10 border-[#FF6C37]/25"
              name="Postman"
              category="API Collection Runner"
              description="1-click API collection runner with environment mapping, dataset parametrization & request delays."
              status={toolStates.postman?.enabled && toolStates.postman?.config?.apiKey ? 'connected' : 'not_connected'}
              order={toolStates.postman?.enabled && toolStates.postman?.config?.apiKey ? 0 : 1}
              meta={
                toolStates.postman?.enabled && toolStates.postman?.config?.apiKey
                  ? `Delay: ${toolStates.postman.config.defaultDelayMs ?? 250}ms · Timeout: ${(toolStates.postman.config.defaultTimeoutMs ?? 15000) / 1000}s`
                  : undefined
              }
              onAction={() => {
                setToolTestResult(null);
                setActiveModal('postman');
              }}
            />

            {/* Box 3: Datadog Synthetics */}
            <IntegrationCard
              icon={<DatadogLogo className="h-5 w-5" />}
              iconBgClass="bg-[#632CA6]/10 border-[#632CA6]/25"
              name="Datadog Synthetics"
              category="API & Browser Synthetics"
              description="Trigger Datadog Synthetic tests with runtime variable overrides & sync verdicts back to runs."
              status={
                toolStates.datadog?.enabled && toolStates.datadog?.config?.apiKey && toolStates.datadog?.config?.appKey
                  ? 'connected'
                  : 'not_connected'
              }
              order={
                toolStates.datadog?.enabled && toolStates.datadog?.config?.apiKey && toolStates.datadog?.config?.appKey
                  ? 0
                  : 1
              }
              meta={
                toolStates.datadog?.enabled && toolStates.datadog?.config?.apiKey
                  ? `Site: ${toolStates.datadog.config.site || 'datadoghq.com'} · Rule: ${toolStates.datadog.config.defaultExecutionRule || 'blocking'}`
                  : undefined
              }
              onAction={() => {
                setToolTestResult(null);
                setActiveModal('datadog');
              }}
            />

            {/* Box 4: Slack Workspace */}
            <IntegrationCard
              icon={<SlackLogo className="h-4 w-4" />}
              iconBgClass="bg-muted/60 border-border/60"
              name="Slack"
              category="Team Messaging"
              description="Broadcast test run summaries, failures, and review alerts to Slack channels."
              status={isSlackConfigured ? 'connected' : 'not_connected'}
              order={isSlackConfigured ? 0 : 1}
              statusSignal={slackSignal}
              onAction={() => {
                setSlackTestResult(null);
                setActiveModal('slack');
              }}
            />

            {/* Box 5: Confluence */}
            <IntegrationCard
              icon={<ConfluenceLogo className="h-4 w-4" />}
              iconBgClass="bg-[#2684FF]/10 border-[#2684FF]/25"
              name="Confluence"
              category="PRD & Spec Sync"
              description="Pull PRD pages into AI test generation and track specification updates."
              status={
                toolStates.confluence?.enabled && toolStates.confluence?.config?.apiToken
                  ? 'connected'
                  : 'not_connected'
              }
              order={
                toolStates.confluence?.enabled && toolStates.confluence?.config?.apiToken
                  ? 0
                  : 1
              }
              meta={
                toolStates.confluence?.config?.defaultSpaceKey
                  ? `Space: ${toolStates.confluence.config.defaultSpaceKey}`
                  : undefined
              }
              onAction={() => {
                setToolTestResult(null);
                setActiveModal('confluence');
              }}
            />

            {/* Box 6: Notion */}
            <IntegrationCard
              icon={<NotionLogo className="h-4 w-4 text-foreground" />}
              iconBgClass="bg-muted/70 border-border/70"
              name="Notion"
              category="Docs & Wiki Sync"
              description="Sync Notion requirement pages and acceptance criteria with test cases."
              status={toolStates.notion?.enabled && toolStates.notion?.config?.apiToken ? 'connected' : 'not_connected'}
              order={toolStates.notion?.enabled && toolStates.notion?.config?.apiToken ? 0 : 1}
              onAction={() => {
                setToolTestResult(null);
                setActiveModal('notion');
              }}
            />

            {/* Box 7: Figma */}
            <IntegrationCard
              icon={<FigmaLogo className="h-4 w-4" />}
              iconBgClass="bg-[#A259FF]/10 border-[#A259FF]/25"
              name="Figma"
              category="Design Specs"
              description="Preview live Figma frames inside test cases and steps during manual execution."
              status={toolStates.figma?.enabled && toolStates.figma?.config?.accessToken ? 'connected' : 'not_connected'}
              order={toolStates.figma?.enabled && toolStates.figma?.config?.accessToken ? 0 : 1}
              onAction={() => {
                setToolTestResult(null);
                setActiveModal('figma');
              }}
            />

            {/* Box 8: Outgoing Webhooks */}
            <IntegrationCard
              icon={<WebhookIcon className="h-4 w-4 text-primary" />}
              iconBgClass="bg-primary/10 border-primary/25"
              name="Outgoing Webhooks"
              category="Custom HTTP Endpoint"
              description="Stream signed JSON event payloads (run.completed, defect.created) to external URLs."
              status={webhooks.length > 0 ? 'connected' : 'not_connected'}
              order={webhooks.length > 0 ? 0 : 1}
              meta={webhooks.length > 0 ? `${webhooks.length} configured` : undefined}
              onAction={() => {
                setSelectedWebhookId(null);
                setWebhookManagerCreateMode(webhooks.length === 0);
                setShowWebhookManager(true);
              }}
            />
          </IntegrationCardGrid>
        </div>
      )}

      {/* ── TAB 2: ACTIVITY LOG (Compressed 42px Single-Line Rows) ── */}
      {activeTab === 'activity' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2.5 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveTab('integrations')}
                className="h-8 px-2.5 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Integrations
              </Button>
              <div className="flex items-center gap-1 bg-muted/20 p-1 rounded-xl border border-border/60 text-xs">
                {(['ALL', 'INBOUND', 'OUTBOUND', 'ERRORS'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setLogsFilter(tab)}
                    className={cn(
                      'px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer text-xs',
                      logsFilter === tab
                        ? 'bg-primary/15 text-primary font-semibold shadow-xs'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {tab === 'ALL'
                      ? 'All Activity'
                      : tab === 'INBOUND'
                      ? 'Inbound Webhooks'
                      : tab === 'OUTBOUND'
                      ? 'Outgoing Integrations'
                      : 'Errors Only'}
                  </button>
                ))}
              </div>

              <Select
                value={selectedIntegration}
                onValueChange={setSelectedIntegration}
                options={[
                  { value: 'ALL', label: 'All Services' },
                  { value: 'InkaBoard', label: 'InkaBoard' },
                  { value: 'Slack', label: 'Slack' },
                  { value: 'Webhooks', label: 'Custom Webhooks' },
                ]}
                className="w-40 h-8 text-xs"
              />
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={loadLogs}
              disabled={loadingLogs}
              className="h-8 px-3 text-xs font-medium rounded-xl gap-1.5 cursor-pointer"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loadingLogs ? 'animate-spin text-primary' : 'text-muted-foreground')} />
              <span>Refresh</span>
            </Button>
          </div>

          <div className="rounded-xl border border-border/50 bg-card/20 overflow-hidden shadow-xs divide-y divide-border/50">
            {filteredLogs.length === 0 ? (
              <div className="p-12 text-center text-xs text-muted-foreground italic">
                {selectedIntegration !== 'ALL'
                  ? `No activity logs recorded for ${selectedIntegration}`
                  : logsFilter === 'ERRORS'
                  ? 'No failed integration or webhook events recorded'
                  : logsFilter === 'INBOUND'
                  ? 'No incoming webhook events recorded yet'
                  : logsFilter === 'OUTBOUND'
                  ? 'No outgoing integration events recorded yet'
                  : 'No integration activity logs recorded yet'}
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isSuccess = log.statusCode >= 200 && log.statusCode < 300;
                return (
                  <div
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="h-11 px-5 flex items-center justify-between gap-3 hover:bg-white/[0.02] cursor-pointer transition-colors text-xs select-none group"
                  >
                    {/* Left: Combined Status & Direction Indicator */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold border shrink-0',
                          isSuccess
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                            : 'bg-rose-500/10 text-rose-500 border-rose-500/25'
                        )}
                        title={`${log.direction} • ${log.statusCode} ${log.statusText}`}
                      >
                        {log.direction === 'INBOUND' ? (
                          <ArrowDownLeft className="h-3 w-3 text-blue-400 shrink-0" />
                        ) : (
                          <ArrowUpRight className="h-3 w-3 text-purple-400 shrink-0" />
                        )}
                        <span className={cn('h-1.5 w-1.5 rounded-full', isSuccess ? 'bg-emerald-500' : 'bg-rose-500')} />
                        <span>{log.statusCode}</span>
                      </span>

                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-border/60 bg-muted/40 text-muted-foreground font-medium shrink-0">
                        {log.integration || 'InkaBoard'}
                      </span>

                      <span className="font-mono text-[11px] text-foreground font-semibold shrink-0 min-w-[110px] max-w-[140px] truncate" title={log.eventType}>
                        {log.eventType}
                      </span>

                      <div className="flex-1 min-w-0 flex items-center gap-1.5 truncate">
                        {log.ticketKey && (
                          <span className="font-mono font-bold text-primary bg-primary/10 border border-primary/25 px-1.5 py-0.2 rounded text-[10px] shrink-0">
                            #{log.ticketKey}
                          </span>
                        )}
                        <span className="text-muted-foreground truncate text-xs" title={log.summary || log.sourceOrTarget}>
                          {log.summary || log.sourceOrTarget}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 text-muted-foreground font-mono text-[11px]">
                      <span suppressHydrationWarning>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span className="text-[11px] text-primary group-hover:underline font-sans hidden sm:inline">Inspect →</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ── Single Integration Config Modal (Driven by Schema) ── */}
      <IntegrationConfigModal
        open={Boolean(activeModal)}
        onOpenChange={(open) => {
          if (!open) {
            setActiveModal(null);
            setPmTestResult(null);
            setSlackTestResult(null);
          }
        }}
        config={modalConfigSchema}
      />

      {/* ── Inspect Log Detail Dialog ── */}
      {selectedLog && (
        <Dialog open={selectedLog !== null} onOpenChange={(open) => !open && setSelectedLog(null)}>
          <DialogContent className="max-w-xl bg-popover text-popover-foreground border border-border p-5 sm:rounded-2xl shadow-2xl max-h-[85vh] flex flex-col">
            <DialogHeader className="border-b border-border/50 pb-3 shrink-0">
              <div className="flex items-center justify-between gap-3">
                <DialogTitle className="text-sm font-bold flex items-center gap-2 font-mono">
                  <span>{selectedLog.direction}: {selectedLog.eventType}</span>
                  <span
                    className={cn(
                      'px-2 py-0.2 rounded-full text-[10px] font-bold border',
                      selectedLog.statusCode < 400
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-red-500/10 text-red-400 border-red-500/30'
                    )}
                  >
                    HTTP {selectedLog.statusCode}
                  </span>
                </DialogTitle>

                {selectedLog.canRetry && selectedLog.deliveryId && (
                  <Button
                    size="sm"
                    disabled={retryingDelivery}
                    onClick={handleManualRetry}
                    className="h-7.5 px-3 text-xs font-bold rounded-lg bg-white text-black hover:bg-white/90 shadow-xs cursor-pointer flex items-center gap-1.5 shrink-0"
                  >
                    {retryingDelivery ? (
                      <Loader2 className="h-3 w-3 animate-spin text-black" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    <span>Retry now</span>
                  </Button>
                )}
              </div>
              <DialogDescription className="text-xs text-muted-foreground font-mono mt-1">
                {new Date(selectedLog.timestamp).toISOString()} • {selectedLog.sourceOrTarget}
              </DialogDescription>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto py-2 space-y-3.5 text-xs pr-1">
              {/* Delivery Attempts Timeline (When Available) */}
              {selectedLog.attempts && selectedLog.attempts.length > 0 && (
                <div className="space-y-1.5">
                  <span className="font-semibold text-muted-foreground text-[11px] block">
                    Delivery Attempts ({selectedLog.attempts.length} of 3):
                  </span>
                  <div className="space-y-1">
                    {selectedLog.attempts.map((att, idx) => {
                      const isAttOk = att.statusCode >= 200 && att.statusCode < 300;
                      return (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/5 font-mono text-[11px]"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={cn(
                                'h-1.5 w-1.5 rounded-full shrink-0',
                                isAttOk ? 'bg-emerald-400' : 'bg-red-400'
                              )}
                            />
                            <span className="font-semibold text-foreground shrink-0">
                              Attempt {att.attempt || idx + 1}
                            </span>
                            <span
                              className={cn(
                                'px-1.5 py-0.2 rounded text-[10px] font-bold border shrink-0',
                                isAttOk
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                                  : 'bg-red-500/10 text-red-400 border-red-500/25'
                              )}
                            >
                              HTTP {att.statusCode}
                            </span>
                            {att.error && (
                              <span className="text-red-400 text-[10.5px] truncate max-w-xs font-sans">
                                ({att.error})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2.5 text-muted-foreground text-[10.5px] shrink-0">
                            {att.durationMs !== undefined && <span>{att.durationMs}ms</span>}
                            <span suppressHydrationWarning>{new Date(att.timestamp).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Request Payload Data */}
              <div className="space-y-1">
                <span className="font-semibold text-muted-foreground text-[11px]">Request Payload:</span>
                <pre className="p-3 rounded-xl border border-white/10 bg-black/40 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-[180px]">
                  {JSON.stringify(selectedLog.payload || {}, null, 2)}
                </pre>
              </div>

              {/* Response Body Data */}
              <div className="space-y-1">
                <span className="font-semibold text-muted-foreground text-[11px]">Response Data:</span>
                <pre className="p-3 rounded-xl border border-white/10 bg-black/40 text-[11px] font-mono text-zinc-300 overflow-x-auto max-h-[140px]">
                  {selectedLog.responseBody || 'No response body recorded'}
                </pre>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Add Integration Catalog Modal ── */}
      <Dialog open={showAddIntegrationModal} onOpenChange={setShowAddIntegrationModal}>
        <DialogContent
          onClose={() => setShowAddIntegrationModal(false)}
          className="flex flex-col max-w-xl w-[95vw] p-0 gap-0 overflow-hidden border border-border/80 bg-card text-card-foreground shadow-2xl rounded-2xl"
        >
          <DialogHeader className="px-5 py-3.5 border-b border-border/50 bg-muted/10 space-y-0.5 text-left shrink-0">
            <DialogTitle className="text-base font-bold text-foreground pr-8">
              Add Integration
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Select a tool or webhook provider to connect with your workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="p-4 space-y-2.5 max-h-[72vh] overflow-y-auto">
            {[
              {
                id: 'inkaboard',
                name: 'InkaBoard',
                category: 'Issue Tracker & Releases',
                description: 'Synchronize bugs, requirements, and release status natively.',
                icon: <InkaBoardLogo className="h-5 w-5" />,
                connected: isPmConfigured,
                onSelect: () => {
                  setShowAddIntegrationModal(false);
                  setPmProviderType('inkaboard');
                  setPmTestResult(null);
                  setActiveModal('pm');
                },
              },
              {
                id: 'postman',
                name: 'Postman',
                category: 'API Collection Runner',
                description: 'Run Postman Collections in 1 click with environment mapping, variables & request delays.',
                icon: <PostmanLogo className="h-5 w-5" />,
                connected: Boolean(toolStates.postman?.enabled && toolStates.postman?.config?.apiKey),
                onSelect: () => {
                  setShowAddIntegrationModal(false);
                  setToolTestResult(null);
                  setActiveModal('postman');
                },
              },
              {
                id: 'datadog',
                name: 'Datadog Synthetics',
                category: 'API & Browser Synthetics',
                description: 'Trigger Datadog Synthetic tests with runtime variables & sync pass/fail results.',
                icon: <DatadogLogo className="h-5 w-5" />,
                connected: Boolean(toolStates.datadog?.enabled && toolStates.datadog?.config?.apiKey),
                onSelect: () => {
                  setShowAddIntegrationModal(false);
                  setToolTestResult(null);
                  setActiveModal('datadog');
                },
              },
              {
                id: 'confluence',
                name: 'Atlassian Confluence',
                category: 'PRD & Spec Sync',
                description: 'Import Confluence PRD pages to generate and maintain test cases.',
                icon: <ConfluenceLogo className="h-5 w-5" />,
                connected: Boolean(toolStates.confluence?.enabled && toolStates.confluence?.config?.apiToken),
                onSelect: () => {
                  setShowAddIntegrationModal(false);
                  setToolTestResult(null);
                  setActiveModal('confluence');
                },
              },
              {
                id: 'notion',
                name: 'Notion',
                category: 'Docs & Wiki Sync',
                description: 'Connect Notion workspaces to sync requirement specs with test cases.',
                icon: <NotionLogo className="h-5 w-5 text-foreground" />,
                connected: Boolean(toolStates.notion?.enabled && toolStates.notion?.config?.apiToken),
                onSelect: () => {
                  setShowAddIntegrationModal(false);
                  setToolTestResult(null);
                  setActiveModal('notion');
                },
              },
              {
                id: 'figma',
                name: 'Figma',
                category: 'Design Specs',
                description: 'Embed live Figma design frame previews inside test cases and steps.',
                icon: <FigmaLogo className="h-5 w-5" />,
                connected: Boolean(toolStates.figma?.enabled && toolStates.figma?.config?.accessToken),
                onSelect: () => {
                  setShowAddIntegrationModal(false);
                  setToolTestResult(null);
                  setActiveModal('figma');
                },
              },
              {
                id: 'slack',
                name: 'Slack',
                category: 'Team Messaging',
                description: 'Broadcast test run summaries, failures, and review alerts to Slack channels.',
                icon: <SlackLogo className="h-5 w-5" />,
                connected: isSlackConfigured,
                onSelect: () => {
                  setShowAddIntegrationModal(false);
                  setSlackTestResult(null);
                  setActiveModal('slack');
                },
              },
              {
                id: 'webhook',
                name: 'Outgoing Webhook',
                category: 'Custom HTTP Endpoint',
                description: 'Send signed JSON event payloads (run.completed, defect.created) to any URL.',
                icon: <WebhookIcon className="h-5 w-5 text-primary" />,
                connected: webhooks.length > 0,
                onSelect: () => {
                  setShowAddIntegrationModal(false);
                  setSelectedWebhookId(null);
                  setWebhookManagerCreateMode(true);
                  setShowWebhookManager(true);
                },
              },
            ].map((item) => (
              <div
                key={item.id}
                onClick={item.onSelect}
                className="flex items-center justify-between gap-4 p-3.5 rounded-xl border border-border/60 bg-background/40 hover:bg-muted/30 hover:border-primary/40 transition-all cursor-pointer group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl border border-border/60 bg-muted/40 flex items-center justify-center shrink-0">
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {item.name}
                      </span>
                      <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.2 rounded border border-border/50">
                        {item.category}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {item.description}
                    </p>
                  </div>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant={item.connected ? 'outline' : 'default'}
                  className={cn(
                    'h-8 px-3 text-xs font-semibold shrink-0',
                    !item.connected && 'gradient-btn text-white'
                  )}
                >
                  {item.connected ? 'Configure' : 'Connect'}
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Multi-Webhook Manager Modal ── */}
      <WebhookManagerModal
        open={showWebhookManager}
        onOpenChange={(open) => {
          setShowWebhookManager(open);
          if (!open) {
            setSelectedWebhookId(null);
            setWebhookManagerCreateMode(false);
          }
        }}
        scopeId={slug}
        scope="workspace"
        webhooks={webhooks}
        onRefresh={async () => {
          await loadData();
          await loadLogs();
        }}
        initialCreate={webhookManagerCreateMode}
        initialEditId={selectedWebhookId}
      />
    </div>
  );
}
