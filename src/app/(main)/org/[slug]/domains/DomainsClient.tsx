'use client';

import { useState, useTransition } from 'react';
import { X, Globe, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { updateOrganizationDomainsAction } from '@/app/actions/organization-invitations';

export function DomainsClient({
  organizationId,
  organizationName,
  initialDomains,
  initialAllowRequests,
}: {
  organizationId: string;
  organizationName: string;
  initialDomains: string[];
  initialAllowRequests: boolean;
}) {
  const [domains, setDomains] = useState(initialDomains);
  const [allowRequests, setAllowRequests] = useState(initialAllowRequests);
  const [newDomain, setNewDomain] = useState('');
  const [isPending, startTransition] = useTransition();

  function persist(nextDomains: string[], nextAllow: boolean) {
    startTransition(async () => {
      try {
        const res = await updateOrganizationDomainsAction({
          organizationIdOrSlug: organizationId,
          domains: nextDomains,
          allowDomainRequests: nextAllow,
        });
        setDomains(res.domains);
        setAllowRequests(res.allowDomainRequests);
        toast.success('Organization domain rules updated');
      } catch (err: any) {
        toast.error(err.message || 'Failed to update domain rules');
      }
    });
  }

  function handleAddDomain() {
    const domain = newDomain.trim().toLowerCase().replace(/^@/, '');
    if (!domain) return;
    if (domains.includes(domain)) {
      setNewDomain('');
      return;
    }
    const next = [...domains, domain];
    setNewDomain('');
    persist(next, allowRequests);
  }

  function handleRemoveDomain(domain: string) {
    const next = domains.filter((d) => d !== domain);
    persist(next, allowRequests);
  }

  function handleToggleAllow(checked: boolean) {
    setAllowRequests(checked);
    persist(domains, checked);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-zinc-100">Corporate Domains</h2>
        <p className="text-sm text-muted-foreground">
          Anyone signing up with an email matching these domains will be routed to{' '}
          <strong className="text-zinc-200">{organizationName}</strong> and can request workspace access.
        </p>
      </div>

      <div className="glass rounded-2xl border border-border/50 p-6 space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
              Allowed Email Domains
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {domains.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">
                No domains configured — users can only join via direct invitation links.
              </span>
            ) : (
              domains.map((domain) => (
                <span
                  key={domain}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-mono text-primary"
                >
                  @{domain}
                  <button
                    type="button"
                    onClick={() => handleRemoveDomain(domain)}
                    disabled={isPending}
                    className="hover:text-white transition-colors cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))
            )}
          </div>

          <div className="flex gap-2 pt-1 max-w-sm">
            <Input
              placeholder="e.g. inkasure.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddDomain()}
              className="bg-white/5 border-white/10 text-sm font-mono h-9"
            />
            <Button
              variant="outline"
              onClick={handleAddDomain}
              disabled={isPending || !newDomain.trim()}
              className="h-9 text-xs shrink-0"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Domain
            </Button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/50 pt-5">
          <div>
            <p className="text-sm font-medium text-zinc-200">Allow Domain Access Requests</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              When off, new signups from these domains land on &quot;No Organization Found&quot; and must be invited manually.
            </p>
          </div>
          <Switch checked={allowRequests} onCheckedChange={handleToggleAllow} disabled={isPending} />
        </div>
      </div>
    </div>
  );
}
