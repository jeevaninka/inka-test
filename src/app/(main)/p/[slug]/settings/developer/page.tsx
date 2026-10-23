"use client";

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Key,
  Webhook as WebhookIcon,
  Plus,
  Loader2,
  Copy,
  Eye,
  EyeOff,
  RefreshCw,
  Check,
  Trash2,
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  getProjectConnectionsAction,
  testCiCdKeyAction,
  getWebhookActivityLogsAction,
  type WebhookActivityLogItem,
} from '@/app/actions/integrations';
import { generateApiSecretAction, regenerateApiSecretAction } from '@/app/actions/projects';
import {
  getWebhooksAction,
  deleteWebhookAction,
  type WebhookDto,
} from '@/app/actions/webhooks';
import { WebhookManagerModal } from '@/components/settings/WebhookManagerModal';
import { cn } from '@/lib/utils';

export default function DeveloperSettingsPage() {
  const params = useParams();
  const { slug } = params as Record<string, string>;
  const { project } = useProjectData();
  const projectIdOrSlug = project?.id || slug;

  const [activeTab, setActiveTab] = useState<'keys' | 'activity'>('keys');
  const [loading, setLoading] = useState(true);
  const [connectionsData, setConnectionsData] = useState<any>(null);

  // CI/CD Secret State
  const [apiSecret, setApiSecret] = useState<string | null>(null);
  const [showApiSecret, setShowApiSecret] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [testingCicd, setTestingCicd] = useState(false);
  const [cicdTestResult, setCicdTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Custom Webhook State
  const [webhooks, setWebhooks] = useState<WebhookDto[]>([]);
  const [showWebhookManager, setShowWebhookManager] = useState(false);
  const [webhookManagerCreateMode, setWebhookManagerCreateMode] = useState(false);
  const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);

  // Activity Logs State
  const [activityLogs, setActivityLogs] = useState<WebhookActivityLogItem[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsFilter, setLogsFilter] = useState<'ALL' | 'INBOUND' | 'OUTBOUND' | 'ERRORS'>('ALL');
  const [selectedLog, setSelectedLog] = useState<WebhookActivityLogItem | null>(null);

  useEffect(() => {
    let ignore = false;
    async function fetchData() {
      if (!projectIdOrSlug) return;
      try {
        const [conn, whList, logs] = await Promise.all([
          getProjectConnectionsAction(projectIdOrSlug),
          getWebhooksAction(projectIdOrSlug, 'project').catch(() => []),
          getWebhookActivityLogsAction(projectIdOrSlug, 'project').catch(() => []),
        ]);

        if (!ignore) {
          setConnectionsData(conn);
          setWebhooks(whList);
          setActivityLogs(logs);
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

  const refreshLogs = async () => {
    if (!projectIdOrSlug) return;
    setLoadingLogs(true);
    try {
      const logs = await getWebhookActivityLogsAction(projectIdOrSlug, 'project');
      setActivityLogs(logs);
    } catch {
      // non-fatal
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleGenerateApiKey = async () => {
    try {
      const { secret } = await generateApiSecretAction(projectIdOrSlug);
      setApiSecret(secret);
      toast.success('CI/CD API Secret generated');
      const conn = await getProjectConnectionsAction(projectIdOrSlug);
      setConnectionsData(conn);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to generate key';
      toast.error(message);
    }
  };

  const handleRegenerateApiKey = async () => {
    if (!confirm('Regenerating will invalidate the current key for automated pipelines. Continue?')) return;
    try {
      const { secret } = await regenerateApiSecretAction(projectIdOrSlug);
      setApiSecret(secret);
      toast.success('CI/CD API Secret regenerated');
      const conn = await getProjectConnectionsAction(projectIdOrSlug);
      setConnectionsData(conn);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate key';
      toast.error(message);
    }
  };

  const handleTestCicd = async () => {
    setTestingCicd(true);
    setCicdTestResult(null);
    try {
      const res = await testCiCdKeyAction(projectIdOrSlug);
      setCicdTestResult(res);
      if (res.success) toast.success(res.message);
      else toast.error(res.message);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'CI/CD test failed';
      setCicdTestResult({ success: false, message });
      toast.error(message);
    } finally {
      setTestingCicd(false);
    }
  };

  const handleCopySecret = (key: string) => {
    navigator.clipboard.writeText(key);
    setCopiedSecret(true);
    toast.success('API key copied to clipboard');
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Are you sure you want to remove this webhook?')) return;
    try {
      await deleteWebhookAction(id);
      setWebhooks(webhooks.filter((w) => w.id !== id));
      toast.success('Webhook removed');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete webhook';
      toast.error(message);
    }
  };

  const filteredLogs = useMemo(() => {
    return activityLogs.filter((log) => {
      if (logsFilter === 'INBOUND' && log.direction !== 'INBOUND') return false;
      if (logsFilter === 'OUTBOUND' && log.direction !== 'OUTBOUND') return false;
      if (logsFilter === 'ERRORS' && log.statusText !== 'FAILED' && log.statusCode < 400) return false;
      return true;
    });
  }, [activityLogs, logsFilter]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-border/50 bg-card/40 p-12 flex items-center justify-center gap-2 text-sm text-muted-foreground animate-pulse">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span>Loading developer settings...</span>
      </div>
    );
  }

  const isCicdConfigured = Boolean(connectionsData?.cicd?.hasKey || apiSecret);

  return (
    <div className="space-y-6 max-w-5xl animate-fade-in">
      <div className="flex items-center justify-between border-b border-border/40 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('keys')}
            className={cn(
              'px-4 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer',
              activeTab === 'keys'
                ? 'bg-card text-foreground border border-border/80 shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Developer & API
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('activity')}
            className={cn(
              'px-4 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5',
              activeTab === 'activity'
                ? 'bg-card text-foreground border border-border/80 shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span>Delivery Activity</span>
            {activityLogs.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground font-mono">
                {activityLogs.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'keys' && (
        <div className="space-y-8 animate-fade-in">
          {/* Section 1: CI/CD Pipeline Secret Key */}
          <div className="rounded-2xl border border-border/70 bg-card p-6 space-y-5 shadow-card">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/50">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0 shadow-xs text-purple-400">
                  <Key className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-sm text-foreground">CI/CD Pipeline Ingestion Key</h4>
                    {isCicdConfigured ? (
                      <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                        Key active
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full border bg-muted/60 text-muted-foreground border-border/60">
                        No key generated
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Push Playwright, Cypress, or GitHub Actions results directly into test runs.
                  </p>
                </div>
              </div>

              {isCicdConfigured && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTestCicd}
                  disabled={testingCicd}
                  className="h-9 px-3.5 text-xs font-medium rounded-lg border border-border/80 bg-muted/40 hover:bg-muted text-foreground shadow-xs cursor-pointer flex items-center gap-1.5 transition-colors"
                >
                  {testingCicd ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5 text-primary" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                  )}
                  <span>Test runner ping</span>
                </Button>
              )}
            </div>

            <div className="space-y-4">
              <div className="max-w-xl space-y-2">
                <span className="text-xs font-semibold text-foreground block">Project API Secret</span>
                {apiSecret ? (
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      type={showApiSecret ? 'text' : 'password'}
                      value={apiSecret}
                      className="h-10 font-mono text-sm bg-background/80 rounded-lg"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setShowApiSecret(!showApiSecret)}
                      className="h-10 w-10 p-0 rounded-lg shrink-0"
                    >
                      {showApiSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopySecret(apiSecret)}
                      className="h-10 w-10 p-0 rounded-lg shrink-0"
                    >
                      {copiedSecret ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                ) : connectionsData?.cicd?.hasKey ? (
                  <div className="flex items-center justify-between p-3.5 px-4 rounded-xl border border-border/60 bg-muted/40">
                    <span className="font-mono text-sm text-muted-foreground">
                      {connectionsData.cicd.maskedKey || 'inka_live_••••••••••••2032'}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleRegenerateApiKey}
                      className="h-8 px-3 text-xs font-medium rounded-lg"
                    >
                      Regenerate
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleGenerateApiKey}
                    className="bg-primary hover:bg-primary/90 text-primary-foreground h-9 px-4 text-xs font-semibold shadow-xs rounded-lg"
                  >
                    Generate CI/CD Secret Key
                  </Button>
                )}
              </div>

              {cicdTestResult && (
                <div
                  className={cn(
                    'p-3.5 rounded-xl border text-xs max-w-xl',
                    cicdTestResult.success
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                      : 'bg-destructive/10 text-destructive border-destructive/20'
                  )}
                >
                  {cicdTestResult.message}
                </div>
              )}

              {/* Quick-Start Code Snippet for CI/CD */}
              <div className="pt-3 border-t border-border/40 space-y-2 max-w-2xl">
                <span className="text-xs font-semibold text-foreground uppercase tracking-wider block">
                  How to Ingest Automated Results
                </span>
                <p className="text-xs text-muted-foreground">
                  Send execution verdicts directly from Playwright, Cypress, or GitHub Actions using the <code className="font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded text-[11px]">X-Api-Key</code> header:
                </p>
                <div className="p-3.5 rounded-xl border border-border/70 bg-background/80 font-mono text-[11.5px] text-muted-foreground overflow-x-auto space-y-1">
                  <p className="text-emerald-600 dark:text-emerald-400">
                    curl -X PATCH &quot;https://your-domain.com/api/v1/runs/$RUN_ID/results&quot; \
                  </p>
                  <p className="pl-4 text-foreground/90">
                    -H &quot;X-Api-Key: {connectionsData?.cicd?.maskedKey || 'inka_live_••••••••••••2032'}&quot; \
                  </p>
                  <p className="pl-4 text-foreground/90">
                    -H &quot;Content-Type: application/json&quot; \
                  </p>
                  <p className="pl-4 text-foreground/90">
                    -d &apos;&#123;&quot;testCaseId&quot;:&quot;TC-101&quot;,&quot;status&quot;:&quot;pass&quot;&#125;&apos;
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Section 2: Project-Scoped Outgoing Webhooks */}
          <div className="rounded-2xl border border-border/70 bg-card p-6 space-y-5 shadow-card">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/50">
              <div className="flex items-center gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 shadow-xs text-blue-400">
                  <WebhookIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-sm text-foreground">Project Outgoing Webhooks</h4>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-muted/60 border border-border/60 text-muted-foreground font-mono">
                      {webhooks.length} configured
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Stream test runs and defect events to external services for this project only.
                  </p>
                </div>
              </div>

              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setSelectedWebhookId(null);
                  setWebhookManagerCreateMode(true);
                  setShowWebhookManager(true);
                }}
                className="h-9 px-3.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add endpoint</span>
              </Button>
            </div>

            {webhooks.length === 0 ? (
              <div className="p-8 text-center space-y-2 border border-dashed rounded-xl border-border/60 bg-muted/20">
                <p className="font-semibold text-xs text-foreground">No project webhooks configured</p>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  Add endpoints to receive real-time webhook dispatches for test runs and defect creations.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border/40 rounded-xl border border-border/60 bg-background/50 overflow-hidden text-xs">
                {webhooks.map((wh) => (
                  <div
                    key={wh.id}
                    className="p-3.5 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-foreground truncate max-w-md">
                          {wh.url}
                        </span>
                        <span
                          className={cn(
                            'text-[10px] px-1.5 py-0.2 rounded font-semibold',
                            wh.enabled
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {wh.enabled ? 'Active' : 'Disabled'}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Events: {wh.events.join(', ')}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedWebhookId(wh.id);
                          setWebhookManagerCreateMode(false);
                          setShowWebhookManager(true);
                        }}
                        className="h-7.5 px-3 text-xs"
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteWebhook(wh.id)}
                        className="h-7.5 w-7.5 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Activity Log Tab */}
      {activeTab === 'activity' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1.5 bg-muted/20 p-1 rounded-xl border border-border/60 text-xs">
              {(['ALL', 'INBOUND', 'OUTBOUND', 'ERRORS'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setLogsFilter(tab)}
                  className={cn(
                    'px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer text-xs',
                    logsFilter === tab
                      ? 'bg-card text-foreground font-bold shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tab === 'ALL'
                    ? 'All Activity'
                    : tab === 'INBOUND'
                    ? 'Inbound Webhooks'
                    : tab === 'OUTBOUND'
                    ? 'Outgoing'
                    : 'Errors Only'}
                </button>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={refreshLogs}
              disabled={loadingLogs}
              className="h-8 px-2.5 rounded-lg border-border/70 bg-card hover:bg-muted"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loadingLogs && 'animate-spin text-primary')} />
            </Button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card divide-y divide-border/40 shadow-card">
            {filteredLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No webhook delivery events recorded yet for this project.
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isSuccess = log.statusText === 'SUCCESS' || (log.statusCode >= 200 && log.statusCode < 300);
                return (
                  <div
                    key={log.id}
                    onClick={() => setSelectedLog(log)}
                    className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-muted/30 cursor-pointer transition-colors select-none group text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-mono text-[11px] font-semibold border shrink-0',
                          isSuccess
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25'
                            : 'bg-red-500/10 text-red-500 dark:text-red-400 border-red-500/25'
                        )}
                      >
                        {log.direction === 'INBOUND' ? (
                          <ArrowDownLeft className="h-3 w-3 text-blue-400 shrink-0" />
                        ) : (
                          <ArrowUpRight className="h-3 w-3 text-purple-400 shrink-0" />
                        )}
                        <span>{log.statusCode}</span>
                      </span>

                      <span className="font-semibold text-foreground truncate">{log.eventType}</span>
                      <span className="text-muted-foreground truncate text-xs">{log.summary || log.sourceOrTarget}</span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] text-muted-foreground">
                      <span suppressHydrationWarning>{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span className="text-primary group-hover:underline font-sans hidden sm:inline">Inspect →</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Inspect Log Detail Modal */}
      {selectedLog && (
        <Dialog open={selectedLog !== null} onOpenChange={(open) => !open && setSelectedLog(null)}>
          <DialogContent className="max-w-xl bg-popover text-popover-foreground border border-border p-5 rounded-2xl shadow-2xl">
            <DialogHeader className="border-b border-border/40 pb-3">
              <DialogTitle className="text-sm font-bold flex items-center gap-2 font-mono">
                <span>{selectedLog.direction}: {selectedLog.eventType}</span>
                <span
                  className={cn(
                    'px-2 py-0.2 rounded-full text-[10px] font-bold border',
                    selectedLog.statusCode < 400
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                      : 'bg-destructive/10 text-destructive border-destructive/30'
                  )}
                >
                  HTTP {selectedLog.statusCode}
                </span>
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground font-mono mt-1">
                {new Date(selectedLog.timestamp).toISOString()} • {selectedLog.sourceOrTarget}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 text-xs">
              <div className="space-y-1">
                <span className="font-semibold text-muted-foreground text-[11px]">Payload:</span>
                <pre className="p-3 rounded-xl border border-border/60 bg-muted/50 text-[11px] font-mono text-foreground overflow-x-auto max-h-[200px]">
                  {JSON.stringify(selectedLog.payload || {}, null, 2)}
                </pre>
              </div>

              {selectedLog.responseBody && (
                <div className="space-y-1">
                  <span className="font-semibold text-muted-foreground text-[11px]">Response:</span>
                  <pre className="p-3 rounded-xl border border-border/60 bg-muted/50 text-[11px] font-mono text-foreground overflow-x-auto max-h-[140px]">
                    {selectedLog.responseBody}
                  </pre>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Webhook Manager Modal */}
      <WebhookManagerModal
        open={showWebhookManager}
        onOpenChange={(open) => {
          setShowWebhookManager(open);
          if (!open) {
            setSelectedWebhookId(null);
            setWebhookManagerCreateMode(false);
          }
        }}
        scopeId={projectIdOrSlug}
        scope="project"
        webhooks={webhooks}
        onRefresh={async () => {
          const whList = await getWebhooksAction(projectIdOrSlug, 'project').catch(() => []);
          setWebhooks(whList);
          await refreshLogs();
        }}
        initialCreate={webhookManagerCreateMode}
        initialEditId={selectedWebhookId}
      />
    </div>
  );
}
