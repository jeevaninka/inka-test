'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { InviteDialog } from '@/components/admin/InviteDialog';
import {
  UserPlus,
  Mail,
  Check,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCw,
  Link2,
  Building2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  revokeOrganizationInvitationAction,
  resendOrganizationInvitationAction,
} from '@/app/actions/organization-invitations';

interface WorkspaceGrant {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
}

interface OrgInvitationItem {
  id: string;
  email: string;
  role: string;
  status: string;
  token: string;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  workspaceGrants: WorkspaceGrant[];
}

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
}

interface OrgInvitationsClientProps {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  initialInvitations: OrgInvitationItem[];
  workspaces: WorkspaceInfo[];
}

export function OrgInvitationsClient({
  organizationId,
  organizationName,
  initialInvitations,
  workspaces,
}: OrgInvitationsClientProps) {
  const router = useRouter();
  const [invitations, setInvitations] = useState<OrgInvitationItem[]>(initialInvitations);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(id);
  }, []);

  const handleCopyInviteLink = async (inv: OrgInvitationItem) => {
    const url = `${window.location.origin}/invite?token=${inv.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(inv.id);
      toast.success('Invite link copied to clipboard');
      setTimeout(() => setCopiedId((prev) => (prev === inv.id ? null : prev)), 2000);
    } catch {
      toast.error('Failed to copy link');
    }
  };

  const handleRegenerate = async (id: string) => {
    setResendingId(id);
    try {
      const res = await resendOrganizationInvitationAction(id);
      setInvitations((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                token: res.token,
                status: 'PENDING',
                expiresAt: res.expiresAt,
              }
            : i
        )
      );
      toast.success('New invitation token generated and email sent');
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate new invite');
    } finally {
      setResendingId(null);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeOrganizationInvitationAction(id);
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
      header: 'Invited Email',
      className: 'w-[28%] min-w-[180px] text-left',
      accessor: (row: OrgInvitationItem) => (
        <span className="font-medium text-sm text-zinc-200 font-mono">{row.email}</span>
      ),
    },
    {
      id: 'role',
      header: 'Org Role',
      className: 'w-[12%] text-left whitespace-nowrap',
      accessor: (row: OrgInvitationItem) => (
        <span className="text-xs text-zinc-300 font-mono px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 whitespace-nowrap">
          {row.role}
        </span>
      ),
    },
    {
      id: 'workspaces',
      header: 'Granted Workspaces',
      className: 'w-[26%] text-left',
      accessor: (row: OrgInvitationItem) =>
        row.workspaceGrants.length === 0 ? (
          <span className="text-xs text-zinc-500 italic">None assigned</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {row.workspaceGrants.map((g) => (
              <span
                key={g.workspaceId}
                className="inline-flex items-center gap-1 text-xs font-mono px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-zinc-200 whitespace-nowrap"
              >
                <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                <span>{g.workspaceName}</span>
                <span className="text-[10px] text-muted-foreground">· {g.role.toLowerCase()}</span>
              </span>
            ))}
          </div>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      className: 'w-[15%] text-left whitespace-nowrap',
      accessor: (row: OrgInvitationItem) => getStatusBadge(row.status, row.expiresAt),
    },
    {
      id: 'created',
      header: 'Sent On',
      className: 'w-[9%] text-left whitespace-nowrap',
      accessor: (row: OrgInvitationItem) => (
        <span className="text-xs text-muted-foreground font-mono whitespace-nowrap" suppressHydrationWarning>
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
      header: 'Actions',
      className: 'w-[10%] text-right whitespace-nowrap',
      accessor: (row: OrgInvitationItem) => {
        const isExpired =
          row.status === 'EXPIRED' ||
          (nowMs !== null && new Date(row.expiresAt).getTime() <= nowMs);
        const isPendingValid = row.status === 'PENDING' && !isExpired;
        const isAccepted = row.status === 'ACCEPTED';
        const isRevoked = row.status === 'REJECTED';

        if (isAccepted) {
          return (
            <span className="text-xs text-muted-foreground font-mono italic pr-2">
              Joined
            </span>
          );
        }

        return (
          <div className="flex items-center justify-end gap-1.5">
            {isPendingValid && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs border-white/10 text-zinc-300 hover:text-white hover:bg-white/5 rounded-lg cursor-pointer"
                onClick={() => handleCopyInviteLink(row)}
                title="Copy invitation link"
              >
                {copiedId === row.id ? (
                  <>
                    <Check className="h-3 w-3 mr-1 text-emerald-400" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Link2 className="h-3 w-3 mr-1" />
                    <span>Copy Link</span>
                  </>
                )}
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className={cn(
                "h-8 px-2.5 text-xs rounded-lg gap-1.5 cursor-pointer",
                isExpired
                  ? "border-primary/40 text-primary hover:bg-primary/10"
                  : "border-white/10 text-zinc-300 hover:text-white hover:bg-white/5"
              )}
              onClick={() => handleRegenerate(row.id)}
              disabled={resendingId === row.id}
              title={isExpired ? "Generate new 7-day invite token" : "Resend invitation email & refresh token"}
            >
              <RotateCw className={cn('h-3.5 w-3.5', resendingId === row.id && 'animate-spin')} />
              <span>Resend</span>
            </Button>

            {!isRevoked && (
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
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Organization Invitations</h2>
          <p className="text-sm text-muted-foreground">
            Invite team members to <strong className="text-foreground">{organizationName}</strong> and pre-provision their access across multiple workspaces.
          </p>
        </div>
        <Button onClick={() => setShowInviteModal(true)} className="h-9 px-4 text-xs font-semibold gradient-btn text-white rounded-xl">
          <UserPlus className="h-4 w-4 mr-1.5" />
          Invite to Organization
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
              heading="No invitations sent"
              subtext="Invite new team members and grant them access to multiple workspaces at once."
            />
          }
        />
      </div>

      {showInviteModal && (
        <InviteDialog
          organizationId={organizationId}
          organizationName={organizationName}
          initialWorkspaces={workspaces}
          onClose={() => setShowInviteModal(false)}
          onInvited={(newInv) => {
            setInvitations((prev) => {
              const filtered = prev.filter((i) => i.email.toLowerCase() !== newInv.email.toLowerCase());
              return [
                {
                  id: newInv.id,
                  email: newInv.email,
                  role: newInv.role,
                  status: 'PENDING',
                  token: newInv.token,
                  expiresAt: newInv.expiresAt,
                  createdAt: newInv.createdAt,
                  acceptedAt: null,
                  workspaceGrants: newInv.workspaceGrants || [],
                },
                ...filtered,
              ];
            });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
