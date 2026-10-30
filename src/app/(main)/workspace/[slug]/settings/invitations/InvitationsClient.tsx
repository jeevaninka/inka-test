'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Mail,
  Trash2,
  CheckCircle2,
  Clock,
  XCircle,
  RotateCw,
  Plus,
  Globe,
  Shield,
  Save,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  revokeInvitationAction,
  resendInvitationAction,
  inviteByEmailAction,
  updateDomainSettingsAction,
} from '@/app/actions/workspace';

interface Invitation {
  id: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
  expiresAt: string;
  createdAt: string;
}

interface InvitationsClientProps {
  workspaceId: string;
  workspaceName: string;
  organizationName: string;
  initialAllowedDomains: string[];
  initialDomainJoinEnabled: boolean;
  initialInvitations: Invitation[];
}

export function InvitationsClient({
  workspaceId,
  workspaceName,
  organizationName,
  initialAllowedDomains,
  initialDomainJoinEnabled,
  initialInvitations,
}: InvitationsClientProps) {
  const [invitations, setInvitations] = useState<Invitation[]>(initialInvitations);

  // Domain configuration state
  const [allowedDomainsStr, setAllowedDomainsStr] = useState(initialAllowedDomains.join(', '));
  const [domainJoinEnabled, setDomainJoinEnabled] = useState(initialDomainJoinEnabled);
  const [isSavingDomain, setIsSavingDomain] = useState(false);

  // Invite modal state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'MEMBER' | 'GUEST'>('MEMBER');
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(id);
  }, []);

  const handleSaveDomainSettings = async () => {
    setIsSavingDomain(true);
    try {
      const domains = allowedDomainsStr
        .split(',')
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean);

      const res = await updateDomainSettingsAction({
        workspaceId,
        allowedDomains: domains,
        domainJoinEnabled,
      });

      setAllowedDomainsStr(res.allowedDomains.join(', '));
      setDomainJoinEnabled(res.domainJoinEnabled);
      toast.success('Organization domain settings saved');
    } catch (err: any) {
      toast.error(err.message || 'Failed to save domain settings');
    } finally {
      setIsSavingDomain(false);
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) return;
    setIsSendingInvite(true);
    try {
      const newInv = await inviteByEmailAction({
        workspaceId,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      });

      const formatted: Invitation = {
        id: newInv.id,
        email: newInv.email,
        role: newInv.role,
        status: newInv.status as any,
        expiresAt: newInv.expires_at.toISOString(),
        createdAt: newInv.created_at.toISOString(),
      };

      setInvitations((prev) => [formatted, ...prev]);
      toast.success(`Invitation sent to ${newInv.email}`);
      setShowInviteModal(false);
      setInviteEmail('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to send invitation');
    } finally {
      setIsSendingInvite(false);
    }
  };

  const handleResend = async (id: string) => {
    setResendingId(id);
    try {
      await resendInvitationAction(id);
      setInvitations((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, status: 'PENDING', expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() }
            : i
        )
      );
      toast.success('Invitation resent successfully');
    } catch (err: any) {
      toast.error(err.message || 'Failed to resend invitation');
    } finally {
      setResendingId(null);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeInvitationAction(id);
      setInvitations((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status: 'REJECTED' } : i))
      );
      toast.success('Invitation revoked');
    } catch (err: any) {
      toast.error(err.message || 'Failed to revoke invitation');
    }
  };

  const formatRelativeExpiry = (expiresAt: string, status: string) => {
    if (nowMs === null) {
      return status === 'EXPIRED' ? 'Expired' : 'Active';
    }
    const diffMs = new Date(expiresAt).getTime() - nowMs;
    const isExpired = diffMs <= 0 || status === 'EXPIRED';
    const absDiff = Math.abs(diffMs);

    const totalMinutes = Math.floor(absDiff / (1000 * 60));
    const totalHours = Math.floor(totalMinutes / 60);
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    const mins = totalMinutes % 60;

    let timeString = '';
    if (days > 0) {
      timeString = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    } else if (hours > 0) {
      timeString = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    } else {
      timeString = `${Math.max(1, mins)}m`;
    }

    if (isExpired) {
      return `Expired ${timeString} ago`;
    }
    return `Expires in ${timeString}`;
  };

  const getStatusBadge = (status: string, expiresAt: string) => {
    const isExpired =
      status === 'EXPIRED' ||
      (nowMs !== null && new Date(expiresAt).getTime() <= nowMs);

    if (status === 'ACCEPTED') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>Accepted</span>
        </span>
      );
    }
    if (status === 'REJECTED') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500 font-medium">
          <XCircle className="h-3.5 w-3.5" />
          <span>Revoked</span>
        </span>
      );
    }
    if (isExpired) {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-rose-400 font-medium">
          <Clock className="h-3.5 w-3.5" />
          <span>Expired</span>
          {nowMs !== null && (
            <span className="text-muted-foreground/80 font-mono text-[11px]" suppressHydrationWarning>
              ({formatRelativeExpiry(expiresAt, status)})
            </span>
          )}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-medium">
        <Clock className="h-3.5 w-3.5" />
        <span>Pending</span>
        {nowMs !== null && (
          <span className="text-muted-foreground/80 font-mono text-[11px]" suppressHydrationWarning>
            ({formatRelativeExpiry(expiresAt, status)})
          </span>
        )}
      </span>
    );
  };

  const columns = [
    {
      id: 'email',
      header: 'Email',
      accessor: (row: Invitation) => (
        <span className="font-medium text-sm text-zinc-200">{row.email}</span>
      ),
    },
    {
      id: 'role',
      header: 'Assigned Role',
      accessor: (row: Invitation) => (
        <span className="text-xs text-zinc-400 font-mono px-2 py-0.5 rounded bg-white/5 border border-white/5">
          {row.role}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (row: Invitation) => getStatusBadge(row.status, row.expiresAt),
    },
    {
      id: 'created',
      header: 'Sent On',
      accessor: (row: Invitation) => (
        <span className="text-xs text-muted-foreground font-mono" suppressHydrationWarning>
          {new Date(row.createdAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            timeZone: 'UTC',
          })}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      accessor: (row: Invitation) => {
        const isExpired =
          nowMs !== null && row.status === 'PENDING' && new Date(row.expiresAt).getTime() <= nowMs;
        const isPending = row.status === 'PENDING' && !isExpired;

        return (
          <div className="flex items-center justify-end gap-2">
            {(isPending || isExpired) && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs border-white/10 text-zinc-300 hover:text-white hover:bg-white/5 rounded-lg cursor-pointer"
                onClick={() => handleResend(row.id)}
                disabled={resendingId === row.id}
                title={isExpired ? "Generate new 7-day invite token" : "Resend invitation email"}
              >
                <RotateCw className={`h-3 w-3 mr-1 ${resendingId === row.id ? 'animate-spin' : ''}`} />
                <span>Resend</span>
              </Button>
            )}
            {isPending && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10 rounded-lg cursor-pointer"
                onClick={() => handleRevoke(row.id)}
                title="Revoke invitation"
              >
                Revoke
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-8">
      {/* Domain Matching Configuration Card */}
      <div className="glass rounded-2xl border border-border/50 p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20 text-primary">
              <Globe className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-100">
                Organization Email Domain & Self-Serve Access
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Users signing up with these email domains will automatically match {organizationName} and can request workspace access.
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300">
              Allowed Email Domains <span className="text-zinc-500">(comma-separated)</span>
            </label>
            <Input
              value={allowedDomainsStr}
              onChange={(e) => setAllowedDomainsStr(e.target.value)}
              placeholder="e.g. inkasure.com, inka.io"
              className="bg-white/5 border-white/10 text-sm font-mono text-zinc-200"
            />
            <p className="text-[11px] text-zinc-500">
              Only employees with these email domains will be recognized under {organizationName}.
            </p>
          </div>

          <div className="flex flex-col justify-between p-4 rounded-xl bg-white/5 border border-white/5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-200">Domain-Matched Self-Serve</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Allow domain-matched users to request access upon signup.
                </p>
              </div>
              <input
                type="checkbox"
                checked={domainJoinEnabled}
                onChange={(e) => setDomainJoinEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-white/10 text-primary focus:ring-primary cursor-pointer"
              />
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={handleSaveDomainSettings}
                disabled={isSavingDomain}
                className="h-8 text-xs font-semibold gradient-btn text-white"
              >
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {isSavingDomain ? 'Saving...' : 'Save Domain Settings'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Invitations Management Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-zinc-100">Invitations Log</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Directly invite team members to <strong className="text-zinc-300">{workspaceName}</strong> or manage previously sent invites.
            </p>
          </div>
          <Button
            onClick={() => setShowInviteModal(true)}
            className="h-9 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm rounded-xl"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Invite Member
          </Button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
          <DataTable
            data={invitations}
            columns={columns}
            getId={(row) => row.id}
            tableClassName="w-full min-w-[600px]"
            emptyComponent={
              <EmptyState
                icon={Mail}
                heading="No invitations"
                subtext="No email invitations have been sent yet. Click 'Invite Member' to invite someone."
              />
            }
          />
        </div>
      </div>

      {/* Invite Modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent className="glass border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="gradient-text text-xl">Invite to {workspaceName}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300">Email Address</label>
              <Input
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="bg-white/5 border-white/10 text-sm"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300">Workspace Role</label>
              <Select
                value={inviteRole}
                onValueChange={(val) => setInviteRole(val as any)}
                options={[
                  { value: 'MEMBER', label: 'Member — Create and run test cases' },
                  { value: 'ADMIN', label: 'Admin — Full workspace management' },
                  { value: 'GUEST', label: 'Guest — Limited access' },
                ]}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowInviteModal(false)} disabled={isSendingInvite}>
              Cancel
            </Button>
            <Button
              onClick={handleSendInvite}
              disabled={!inviteEmail.trim() || isSendingInvite}
              className="gradient-btn text-white"
            >
              {isSendingInvite ? 'Sending...' : 'Send Invitation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
