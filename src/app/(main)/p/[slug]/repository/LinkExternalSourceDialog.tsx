"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search, Link2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PostmanLogo, DatadogLogo } from '@/components/icons/IntegrationLogos';
import {
  getProjectRunnerCatalogAction,
  fetchPostmanCollectionRequestsAction,
  linkTestCaseToExternalSourceAction,
  syncTestCaseFromPostmanAction,
} from '@/app/actions/integrations';
import type { PostmanCollectionRequestItem } from '@/lib/integrations/tool-clients';
import { cn } from '@/lib/utils';

interface LinkExternalSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  testCaseId: string;
  provider: 'postman' | 'datadog';
  onLinked?: () => void;
}

export function LinkExternalSourceDialog({
  open,
  onOpenChange,
  projectId,
  testCaseId,
  provider,
  onLinked,
}: LinkExternalSourceDialogProps) {
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collections, setCollections] = useState<Array<{ id: string; uid: string; name: string }>>([]);
  const [datadogTests, setDatadogTests] = useState<Array<{ public_id: string; name: string; type: string }>>([]);

  const [collectionUid, setCollectionUid] = useState('');
  const [requests, setRequests] = useState<PostmanCollectionRequestItem[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<number | null>(null);
  const [selectedPublicId, setSelectedPublicId] = useState('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setSelectedOrder(null);
    setSelectedPublicId('');
    setCollectionUid('');
    setRequests([]);
    setSearch('');
    getProjectRunnerCatalogAction(projectId)
      .then((res: any) => {
        if (cancelled) return;
        if (provider === 'postman') {
          setCollections(res?.postman?.collections || []);
        } else {
          setDatadogTests(res?.datadog?.tests || []);
        }
      })
      .catch((e: any) => {
        if (!cancelled) setLoadError(e?.message || 'Failed to load external sources');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, provider]);

  useEffect(() => {
    if (!open || provider !== 'postman' || !collectionUid || !projectId) return;
    let cancelled = false;
    setRequestsLoading(true);
    setRequests([]);
    setSelectedOrder(null);
    fetchPostmanCollectionRequestsAction(projectId, collectionUid)
      .then((items) => {
        if (cancelled) return;
        const list = items || [];
        setRequests(list);
        if (list.length === 1) setSelectedOrder(list[0].order);
      })
      .catch((e: any) => {
        if (!cancelled) toast.error(e?.message || 'Failed to load Postman requests');
      })
      .finally(() => {
        if (!cancelled) setRequestsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, provider, collectionUid, projectId]);

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter((r) =>
      `${r.name} ${r.folderPath} ${r.method} ${r.url}`.toLowerCase().includes(q)
    );
  }, [requests, search]);

  const filteredDatadogTests = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = datadogTests;
    if (!q) return list;
    return list.filter((t) => `${t.public_id} ${t.name} ${t.type}`.toLowerCase().includes(q));
  }, [datadogTests, search]);

  const canLink =
    provider === 'postman' ? Boolean(collectionUid && selectedOrder !== null) : Boolean(selectedPublicId);

  const handleLink = async () => {
    if (!canLink) return;
    setSaving(true);
    try {
      if (provider === 'postman') {
        const request = requests.find((r) => r.order === selectedOrder);
        if (!request) throw new Error('Select a Postman request');
        const collection = collections.find((c) => c.uid === collectionUid || c.id === collectionUid);
        await linkTestCaseToExternalSourceAction({
          projectId,
          testCaseId,
          provider: 'postman',
          postman: {
            collectionUid,
            collectionName: collection?.name,
            requestId: request.requestId,
            folderId: request.folderId,
            requestName: request.name,
            folderPath: request.folderPath,
            order: request.order,
            selectedRequestOrders: [request.order],
            curlCommand: request.curlCommand,
            requestSpec: request.requestSpec,
          },
        });
        const synced = await syncTestCaseFromPostmanAction({ projectId, testCaseId });
        toast.success(`Linked to Postman and pulled ${synced.stepsCount} step(s).`);
      } else {
        const test = datadogTests.find((t) => t.public_id === selectedPublicId);
        const result = await linkTestCaseToExternalSourceAction({
          projectId,
          testCaseId,
          provider: 'datadog',
          datadog: {
            publicId: selectedPublicId,
            name: test?.name,
            testType: test?.type === 'browser' ? 'browser' : 'api',
          },
        });
        toast.success(`Linked to Datadog and pulled ${result.stepsCount} step(s).`);
      }
      onLinked?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to link external source');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {provider === 'postman' ? (
              <PostmanLogo className="h-4 w-4" />
            ) : (
              <DatadogLogo className="h-4 w-4" />
            )}
            Link to {provider === 'postman' ? 'Postman' : 'Datadog'}
          </DialogTitle>
          <DialogDescription>
            Links this case to a stable external key and pulls its current steps. Re-sync at any
            time from the case menu.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading {provider === 'postman' ? 'collections' : 'Synthetic tests'}…
            </div>
          ) : loadError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {loadError}
            </div>
          ) : provider === 'postman' ? (
            <>
              <div>
                <label className="block text-xs font-semibold mb-1.5">Collection</label>
                <Select
                  value={collectionUid}
                  onValueChange={(v) => setCollectionUid(v)}
                  options={[
                    { value: '', label: 'Select a collection…' },
                    ...collections.map((c) => ({ value: c.uid || c.id, label: c.name })),
                  ]}
                  className="h-9 text-xs"
                />
              </div>

              {collectionUid && (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Search requests…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="pl-9 h-8 text-xs"
                    />
                  </div>
                  <div className="max-h-[280px] overflow-y-auto rounded-xl border border-border/60 divide-y divide-border/30">
                    {requestsLoading ? (
                      <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading requests…
                      </div>
                    ) : filteredRequests.length === 0 ? (
                      <div className="py-8 text-center text-xs text-muted-foreground">
                        No requests in this collection.
                      </div>
                    ) : (
                      filteredRequests.map((r) => (
                        <button
                          key={r.requestId || `${r.order}-${r.name}`}
                          type="button"
                          onClick={() => setSelectedOrder(r.order)}
                          className={cn(
                            'w-full text-left px-3 py-2 transition-colors cursor-pointer',
                            selectedOrder === r.order ? 'bg-primary/10' : 'hover:bg-muted/40'
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground">
                              {r.method}
                            </span>
                            <span className="text-xs font-medium truncate flex-1">{r.name}</span>
                            {selectedOrder === r.order && (
                              <span className="text-[10px] font-semibold text-primary">Selected</span>
                            )}
                          </div>
                          {r.folderPath && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{r.folderPath}</p>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search Synthetic tests…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 h-8 text-xs"
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto rounded-xl border border-border/60 divide-y divide-border/30">
                {filteredDatadogTests.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No Datadog Synthetic tests available.
                  </div>
                ) : (
                  filteredDatadogTests.map((t) => (
                    <button
                      key={t.public_id}
                      type="button"
                      onClick={() => setSelectedPublicId(t.public_id)}
                      className={cn(
                        'w-full text-left px-3 py-2 transition-colors cursor-pointer',
                        selectedPublicId === t.public_id ? 'bg-primary/10' : 'hover:bg-muted/40'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground uppercase">
                          {t.type || 'api'}
                        </span>
                        <span className="text-xs font-medium truncate flex-1">{t.name}</span>
                        {selectedPublicId === t.public_id && (
                          <span className="text-[10px] font-semibold text-primary">Selected</span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{t.public_id}</p>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleLink}
            disabled={!canLink || saving}
            className="gap-1.5"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            {saving ? 'Linking…' : 'Link & pull steps'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
