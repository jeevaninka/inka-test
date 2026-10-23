'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { UserAvatar } from '@/components/common/UserAvatar';
import { InviteDialog } from '@/components/admin/InviteDialog';
import { Users, Trash2, ShieldCheck, UserPlus, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import {
  updateWorkspaceMemberRoleAction,
  removeWorkspaceMemberAction,
} from '@/app/actions/workspace';

interface Member {
  userId: number;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
  createdAt: string;
  user: {
    id: number;
    name: string | null;
    fullName?: string | null;
    email: string;
    avatarUrl: string | null;
    avatarColor?: string | null;
    avatarInitials?: string | null;
  };
}

interface MembersClientProps {
  workspaceId: string;
  workspaceName: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  initialMembers: Member[];
  currentUserId: number;
  currentUserRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
}

export function MembersClient({
  workspaceId,
  workspaceName,
  organizationId,
  organizationName,
  organizationSlug,
  initialMembers,
  currentUserId,
  currentUserRole,
}: MembersClientProps) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState<number | null>(null);

  const handleRoleChange = async (
    userId: number,
    newRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST'
  ) => {
    try {
      await updateWorkspaceMemberRoleAction({
        workspaceId,
        targetUserId: userId,
        role: newRole,
      });
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, role: newRole } : m))
      );
      toast.success('Workspace role updated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to update role');
    }
  };

  const handleRemoveMember = async (userId: number) => {
    try {
      await removeWorkspaceMemberAction({ workspaceId, targetUserId: userId });
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
      toast.success('Member removed from workspace');
      setShowRemoveModal(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove member');
    }
  };

  const columns = [
    {
      id: 'user',
      header: 'Member',
      className: 'w-[45%]',
      accessor: (row: Member) => (
        <div className="flex items-center gap-3">
          <UserAvatar
            userId={row.user.id}
            name={row.user.name || row.user.email}
            fullName={row.user.fullName}
            email={row.user.email}
            imageUrl={row.user.avatarUrl}
            color={row.user.avatarColor}
            initials={row.user.avatarInitials}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-sm text-foreground truncate">
                {row.user.name || row.user.email}
              </p>
              {row.userId === currentUserId && (
                <span className="text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full shrink-0">
                  You
                </span>
              )}
            </div>
            {row.user.name && (
              <p className="text-xs text-muted-foreground truncate font-mono">
                {row.user.email}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Workspace Role',
      className: 'w-[25%] whitespace-nowrap',
      accessor: (row: Member) => {
        const canEdit =
          (currentUserRole === 'OWNER' || currentUserRole === 'ADMIN') &&
          row.userId !== currentUserId &&
          row.role !== 'OWNER';

        if (!canEdit) {
          return (
            <span className="inline-flex items-center gap-1.5 text-xs text-foreground font-mono px-2.5 py-1 rounded-lg bg-muted/60 border border-border/60">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              {row.role}
            </span>
          );
        }

        return (
          <Select
            value={row.role}
            onValueChange={(val) => handleRoleChange(row.userId, val as any)}
            options={[
              { value: 'ADMIN', label: 'Admin' },
              { value: 'MEMBER', label: 'Member' },
              { value: 'GUEST', label: 'Guest' },
            ]}
            className="w-28 h-8 text-xs"
          />
        );
      },
    },
    {
      id: 'joined',
      header: 'Joined On',
      className: 'w-[18%] whitespace-nowrap',
      accessor: (row: Member) => (
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
      className: 'w-[12%] text-right whitespace-nowrap',
      accessor: (row: Member) => {
        const canRemove =
          row.userId !== currentUserId &&
          row.role !== 'OWNER' &&
          (currentUserRole === 'OWNER' || currentUserRole === 'ADMIN');

        if (!canRemove) return null;

        return (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
              onClick={() => setShowRemoveModal(row.userId)}
              title="Remove from workspace"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">Workspace Members</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Active members of <strong className="text-foreground">{workspaceName}</strong> and their role within this workspace.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} className="gradient-btn text-white h-9 px-4 text-xs font-semibold rounded-xl gap-1.5">
          <UserPlus className="h-4 w-4" />
          Invite Member
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
        <DataTable
          data={members}
          columns={columns}
          getId={(row) => row.userId.toString()}
          tableClassName="w-full min-w-[600px]"
          emptyComponent={
            <EmptyState
              icon={Users}
              heading="No members"
              subtext="Invite team members to this workspace."
            />
          }
        />
      </div>

      {organizationId && organizationSlug && (
        <div className="pt-1">
          <Link
            href={`/org/${organizationSlug}/members`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
          >
            <span>Open {organizationName} Organization Console (Members, Approvals, Invitations &amp; Domains)</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {inviteOpen && (
        <InviteDialog
          organizationId={organizationId}
          organizationName={organizationName}
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          defaultWorkspaceId={workspaceId}
          isWorkspaceScoped={true}
          onClose={() => setInviteOpen(false)}
        />
      )}

      <ConfirmModal
        open={showRemoveModal !== null}
        onOpenChange={(open) => setShowRemoveModal(open ? showRemoveModal : null)}
        title="Remove Workspace Member"
        description="Are you sure you want to remove this member? They will lose access to all projects in this workspace."
        onConfirm={() => handleRemoveMember(showRemoveModal!)}
        variant="destructive"
      />
    </div>
  );
}
