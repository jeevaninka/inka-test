"use client";

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Webhook as WebhookIcon,
  Plus,
  Trash2,
  Edit3,
  Copy,
  Check,
  Eye,
  EyeOff,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  WebhookDto,
  saveWebhookAction,
  deleteWebhookAction,
  toggleWebhookEnabledAction,
  testOutgoingWebhookAction,
} from '@/app/actions/webhooks';

interface WebhookManagerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scopeId: string;
  scope?: 'workspace' | 'project';
  webhooks: WebhookDto[];
  onRefresh: () => Promise<void>;
  initialCreate?: boolean;
  initialEditId?: string | null;
}

const AVAILABLE_EVENTS = [
  {
    id: 'run.completed',
    label: 'Test Run Completed',
    description: 'Fired when all cases in a test run finish or the run is aborted',
  },
  {
    id: 'defect.created',
    label: 'Defect / Bug Raised',
    description: 'Fired when a tester logs a defect during execution',
  },
  {
    id: 'result.updated',
    label: 'Execution Result Updated',
    description: 'Fired when an individual case status changes (Pass, Fail, Blocked)',
  },
];

export function WebhookManagerModal({
  open,
  onOpenChange,
  scopeId,
  scope = 'workspace',
  webhooks,
  onRefresh,
  initialCreate = false,
  initialEditId = null,
}: WebhookManagerModalProps) {
  const [viewMode, setViewMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form State
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<string[]>(['run.completed', 'defect.created']);
  const [enabled, setEnabled] = useState(true);
  const [isMasked, setIsMasked] = useState(true);
  const [isCopied, setIsCopied] = useState(false);

  // Testing & Saving State
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [testingInlineId, setTestingInlineId] = useState<string | null>(null);
  const [inlineTestResult, setInlineTestResult] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      if (initialEditId) {
        const wh = webhooks.find((w) => w.id === initialEditId);
        if (wh) {
          startEdit(wh);
          return;
        }
      }
      if (initialCreate || webhooks.length === 0) {
        startCreate();
      } else {
        setViewMode('list');
      }
    } else {
      setTestResult(null);
      setInlineTestResult({});
    }
  }, [open, initialCreate, initialEditId, webhooks.length]);

  const generateSecret = () => {
    const randomHex = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `whsec_${randomHex}`;
  };

  const startCreate = () => {
    setEditingId(null);
    setUrl('');
    setSecret(generateSecret());
    setEvents(['run.completed', 'defect.created']);
    setEnabled(true);
    setIsMasked(true);
    setTestResult(null);
    setViewMode('form');
  };

  const startEdit = (wh: WebhookDto) => {
    setEditingId(wh.id);
    setUrl(wh.url);
    setSecret(wh.secret);
    setEvents(wh.events);
    setEnabled(wh.enabled);
    setIsMasked(true);
    setTestResult(null);
    setViewMode('form');
  };

  const handleCopySecret = (text: string) => {
    navigator.clipboard.writeText(text);
    setIsCopied(true);
    toast.success('Webhook secret copied to clipboard');
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleTestConnection = async () => {
    if (!url.trim()) {
      toast.error('Please enter a destination URL first');
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testOutgoingWebhookAction(url.trim(), secret.trim());
      setTestResult(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Connection test failed' });
      toast.error(err.message || 'Connection test failed');
    } finally {
      setIsTesting(false);
    }
  };

  const handleInlineTestPing = async (wh: WebhookDto) => {
    setTestingInlineId(wh.id);
    try {
      const res = await testOutgoingWebhookAction(wh.url, wh.secret);
      setInlineTestResult((prev) => ({
        ...prev,
        [wh.id]: res.success ? `200 OK (${res.latencyMs}ms)` : 'Failed',
      }));
      if (res.success) {
        toast.success(`Ping sent to ${new URL(wh.url).hostname}: ${res.message}`);
      } else {
        toast.error(`Ping failed: ${res.message}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Ping failed');
    } finally {
      setTestingInlineId(null);
    }
  };

  const handleToggleEnabled = async (wh: WebhookDto) => {
    try {
      await toggleWebhookEnabledAction(wh.id, !wh.enabled);
      toast.success(wh.enabled ? 'Webhook disabled' : 'Webhook enabled');
      await onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle status');
    }
  };

  const handleDelete = async (webhookId: string) => {
    setDeletingId(webhookId);
    try {
      await deleteWebhookAction(webhookId);
      toast.success('Outgoing webhook removed');
      await onRefresh();
      if (webhooks.length <= 1) {
        startCreate();
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete webhook');
    } finally {
      setDeletingId(null);
    }
  };

  const handleSave = async () => {
    if (!url.trim()) {
      toast.error('Destination URL is required');
      return;
    }
    if (events.length === 0) {
      toast.error('Select at least one subscribed event');
      return;
    }

    setIsSaving(true);
    try {
      await saveWebhookAction({
        id: editingId || undefined,
        scopeId,
        scope,
        url: url.trim(),
        secret: secret.trim(),
        events,
        enabled,
      });

      toast.success(editingId ? 'Webhook updated successfully' : 'New webhook added');
      await onRefresh();
      setViewMode('list');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save webhook');
    } finally {
      setIsSaving(false);
    }
  };

  const toggleEvent = (evtId: string) => {
    setEvents((prev) =>
      prev.includes(evtId) ? prev.filter((x) => x !== evtId) : [...prev, evtId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onClose={() => onOpenChange(false)}
        className="flex flex-col max-w-xl w-[95vw] p-0 gap-0 overflow-hidden border border-border/80 bg-card text-card-foreground shadow-2xl rounded-2xl max-h-[85vh]"
      >
        {/* Flush Header */}
        <DialogHeader className="px-5 py-3.5 border-b border-border/50 bg-muted/10 space-y-0.5 text-left shrink-0">
          <div className="flex items-center justify-between gap-4 pr-8">
            <div className="flex items-center gap-2.5 min-w-0">
              {viewMode === 'form' && webhooks.length > 0 && (
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className="h-7 w-7 rounded-lg border border-border/60 bg-background/60 hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer transition-colors shrink-0"
                  title="Back to all webhooks"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
              )}
              <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-xs">
                <WebhookIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-base font-bold text-foreground">
                  {viewMode === 'list'
                    ? 'Outgoing Webhooks'
                    : editingId
                    ? 'Edit Outgoing Webhook'
                    : 'New Outgoing Webhook'}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  {viewMode === 'list'
                    ? `Manage HTTP endpoints receiving event deliveries from this ${scope}.`
                    : 'Deliver JSON payloads to this endpoint when chosen events trigger.'}
                </DialogDescription>
              </div>
            </div>

            {viewMode === 'list' && (
              <Button
                type="button"
                size="sm"
                onClick={startCreate}
                className="gradient-btn text-white h-8 px-3 text-xs font-semibold rounded-xl cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add webhook</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4 min-w-0 w-full">
          {viewMode === 'list' ? (
            /* ── VIEW 1: WEBHOOKS LIST ── */
            webhooks.length === 0 ? (
              <div className="py-10 text-center space-y-3">
                <div className="w-11 h-11 rounded-2xl bg-muted/40 border border-border/60 flex items-center justify-center mx-auto text-muted-foreground">
                  <WebhookIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-sm text-foreground">No outgoing webhooks yet</p>
                  <p className="text-xs text-muted-foreground max-w-sm mx-auto mt-1">
                    Configure webhooks to stream test run completions, bugs, and status updates directly to external services.
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={startCreate}
                  className="gradient-btn text-white h-8 px-4 text-xs font-semibold rounded-xl cursor-pointer gap-1.5 mt-2"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add your first webhook</span>
                </Button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {webhooks.map((wh) => {
                  const inlineResult = inlineTestResult[wh.id];
                  return (
                    <div
                      key={wh.id}
                      className={cn(
                        'p-3.5 rounded-xl border transition-all text-xs space-y-2.5',
                        wh.enabled
                          ? 'border-border/60 bg-background/50 hover:border-border'
                          : 'border-border/40 bg-muted/20 opacity-70'
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <button
                            type="button"
                            onClick={() => handleToggleEnabled(wh)}
                            className={cn(
                              'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10.5px] font-mono font-semibold border shrink-0 cursor-pointer transition-colors',
                              wh.enabled
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/20'
                                : 'bg-muted text-muted-foreground border-border/60 hover:bg-muted/80'
                            )}
                            title={wh.enabled ? 'Click to disable webhook' : 'Click to enable webhook'}
                          >
                            <span
                              className={cn(
                                'h-1.5 w-1.5 rounded-full',
                                wh.enabled ? 'bg-emerald-500' : 'bg-muted-foreground'
                              )}
                            />
                            <span>{wh.enabled ? 'Active' : 'Disabled'}</span>
                          </button>

                          <span
                            className="font-mono text-xs font-medium text-foreground truncate select-all"
                            title={wh.url}
                          >
                            {wh.url}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          {inlineResult && (
                            <span className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/25 mr-1">
                              {inlineResult}
                            </span>
                          )}

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={testingInlineId === wh.id}
                            onClick={() => handleInlineTestPing(wh)}
                            className="h-7 px-2.5 text-[11px] font-medium rounded-lg gap-1 cursor-pointer"
                            title="Send test ping"
                          >
                            {testingInlineId === wh.id ? (
                              <Loader2 className="h-3 w-3 animate-spin text-primary" />
                            ) : (
                              <RefreshCw className="h-3 w-3 text-muted-foreground" />
                            )}
                            <span>Ping</span>
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(wh)}
                            className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Edit webhook settings"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>

                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={deletingId === wh.id}
                            onClick={() => handleDelete(wh.id)}
                            className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                            title="Delete webhook"
                          >
                            {deletingId === wh.id ? (
                              <Loader2 className="h-3 w-3 animate-spin text-rose-500" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40 text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] uppercase font-bold text-muted-foreground/80 tracking-wider">
                            Events:
                          </span>
                          {wh.events.map((evt) => (
                            <span
                              key={evt}
                              className="px-1.5 py-0.2 rounded bg-muted/60 border border-border/50 text-[10px] font-mono text-foreground/80"
                            >
                              {evt}
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center gap-3 text-[10.5px] font-mono shrink-0">
                          {wh.failureCount > 0 && (
                            <span className="text-rose-500 font-semibold">
                              {wh.failureCount} fail{wh.failureCount > 1 ? 's' : ''}
                            </span>
                          )}
                          <span>
                            {wh.lastDeliveryAt
                              ? `Last sent: ${new Date(wh.lastDeliveryAt).toLocaleTimeString()}`
                              : 'No deliveries yet'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : (
            /* ── VIEW 2: CREATE / EDIT FORM ── */
            <div className="space-y-4">
              {/* Field 1: Destination URL */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground/90 block">
                  Payload Destination URL
                </label>
                <Input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://api.yourcompany.com/webhooks"
                  className="h-9 bg-background/80 border-input text-xs text-foreground font-mono"
                />
                <p className="text-[11px] text-muted-foreground">
                  InkaTest will dispatch HTTP POST requests with JSON payloads and HMAC signature headers to this URL.
                </p>
              </div>

              {/* Field 2: Signing Secret */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-foreground/90 block">
                    Webhook Signing Secret
                  </label>
                  <button
                    type="button"
                    onClick={() => setSecret(generateSecret())}
                    className="text-[11px] text-primary hover:underline font-medium cursor-pointer"
                  >
                    Regenerate Secret
                  </button>
                </div>
                <div className="relative flex items-center">
                  <Input
                    type={isMasked ? 'password' : 'text'}
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    className="h-9 bg-background/80 border-input text-xs text-foreground font-mono pr-16 select-all"
                  />
                  <div className="absolute right-1.5 flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setIsMasked(!isMasked)}
                      className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                      title={isMasked ? 'Show secret' : 'Hide secret'}
                    >
                      {isMasked ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCopySecret(secret)}
                      className="h-6 w-6 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                      title="Copy to clipboard"
                    >
                      {isCopied ? (
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Sent in the <code className="text-[10px] bg-muted border border-border/50 text-foreground px-1 py-0.5 rounded font-mono">X-Webhook-Secret</code> header with each request to verify sender authenticity.
                </p>
              </div>

              {/* Field 3: Subscribed Events */}
              <div className="space-y-2 pt-2 border-t border-border/50">
                <label className="text-xs font-semibold text-foreground/90 block">
                  Subscribed Events
                </label>
                <div className="grid grid-cols-1 gap-2 text-xs">
                  {AVAILABLE_EVENTS.map((evt) => {
                    const checked = events.includes(evt.id);
                    return (
                      <div
                        key={evt.id}
                        onClick={() => toggleEvent(evt.id)}
                        className={cn(
                          'px-3.5 py-2.5 rounded-xl border flex items-center gap-3 cursor-pointer transition-colors select-none',
                          checked
                            ? 'border-primary/40 bg-primary/[0.04] text-foreground'
                            : 'border-border/60 bg-background/40 text-muted-foreground hover:bg-muted/30'
                        )}
                      >
                        <div onClick={(e) => e.stopPropagation()} className="flex items-center shrink-0">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleEvent(evt.id)}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="font-semibold block text-xs text-foreground">{evt.label}</span>
                          <span className="text-[11px] text-muted-foreground block mt-0.5 leading-snug">
                            {evt.description}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Field 4: Enabled Toggle */}
              <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold text-foreground block">Enable Delivery</span>
                  <span className="text-[11px] text-muted-foreground block">
                    Disable to temporarily pause event deliveries without deleting this webhook.
                  </span>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </div>

              {/* Live Test Connection Result Banner */}
              {testResult && (
                <div
                  className={cn(
                    'p-3 rounded-xl border text-xs flex items-start gap-2 animate-in fade-in-0 duration-200',
                    testResult.success
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300'
                  )}
                >
                  {testResult.success ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-emerald-500" />
                  ) : (
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-500" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold block">
                      {testResult.success ? 'Endpoint Reachable' : 'Connection Error'}
                    </span>
                    <span className="text-[11px] opacity-90 leading-relaxed block mt-0.5">
                      {testResult.message}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Flush Footer (Only in Form Mode) */}
        {viewMode === 'form' && (
          <div className="border-t border-border/50 bg-muted/15 px-5 py-3 flex items-center justify-between gap-3 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={isTesting || isSaving}
              className="h-8 px-3.5 text-xs gap-1.5 cursor-pointer"
            >
              {isTesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span>{isTesting ? 'Pinging...' : 'Test ping'}</span>
            </Button>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => (webhooks.length > 0 ? setViewMode('list') : onOpenChange(false))}
                className="h-8 px-3.5 text-xs cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleSave}
                disabled={isSaving || isTesting}
                className="gradient-btn text-white h-8 px-4 text-xs font-semibold cursor-pointer gap-1.5"
              >
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>{editingId ? 'Save changes' : 'Save webhook'}</span>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
