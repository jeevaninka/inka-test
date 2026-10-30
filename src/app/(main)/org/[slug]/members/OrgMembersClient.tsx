'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { UserAvatar } from '@/components/common/UserAvatar';
import { InviteDialog } from '@/components/admin/InviteDialog';
import { MultiSelectWithRoles } from '@/components/admin/MultiSelectWithRoles';
import { Select } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Users,
  UserPlus,
  ShieldCheck,
  Trash2,
  SlidersHorizontal,
  Building2,
  MoreVertical,
  ShieldOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  updateOrganizationMemberAccessAction,
  removeOrganizationMemberAction,
} from '@/app/actions/organization-invitations';
import {
  suspendOrganizationMemberAction,
  unsuspendOrganizationMemberAction,
} from '@/app/actions/organization-access';

interface WorkspaceAccessItem {
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
}

interface OrgMemberRow {
  userId: number;
  orgRole: 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST';
  suspendedAt?: string | null;
  joinedAt: string;
  user: {
    id: number;
    name: string | null;
    fullName?: string | null;
    email: string;
    avatarUrl: string | null;
    avatarColor?: string | null;
    avatarInitials?: string | null;
  };
  workspaceAccess: WorkspaceAccessItem[];
}

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
}

export function OrgMembersClient({
  organizationId,
  organizationName,
  workspaces,
  initialMembers,
  currentUserId,
}: {
  organizationId: string;
  organizationName: string;
  workspaces: WorkspaceInfo[];
  initialMembers: OrgMemberRow[];
  currentUserId: number;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<OrgMemberRow[]>(initialMembers);
  const [showInviteModal, setShowInviteModal] = useState(false);

  // Edit Access Modal state
  const [editingMember, setEditingMember] = useState<OrgMemberRow | null>(null);
  const [editOrgRole, setEditOrgRole] = useState<'OWNER' | 'ADMIN' | 'MEMBER'>('MEMBER');
  const [editWsGrants, setEditWsGrants] = useState<
    Record<string, 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST' | null>
  >({});
  const [isSavingAccess, setIsSavingAccess] = useState(false);

  // Remove Member Modal state
  const [removingUserId, setRemovingUserId] = useState<number | null>(null);

  const handleOpenEdit = (member: OrgMemberRow) => {
    setEditingMember(member);
    setEditOrgRole(member.orgRole === 'GUEST' ? 'MEMBER' : member.orgRole);
    const grants: Record<string, 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST' | null> = {};
    workspaces.forEach((w) => {
      const existing = member.workspaceAccess.find((wa) => wa.workspaceId === w.id);
      grants[w.id] = existing ? existing.role : null;
    });
    setEditWsGrants(grants);
  };

  const handleSaveAccess = async () => {
    if (!editingMember) return;
    setIsSavingAccess(true);

    const workspaceGrants = Object.entries(editWsGrants)
      .filter(
        (entry): entry is [string, 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST'] => entry[1] !== null
      )
      .map(([workspaceId, role]) => ({
        workspaceId,
        role,
      }));

    try {
      await updateOrganizationMemberAccessAction({
        organizationId,
        targetUserId: editingMember.userId,
        orgRole: editOrgRole,
        workspaceGrants,
      });

      setMembers((prev) =>
        prev.map((m) =>
          m.userId === editingMember.userId
            ? {
                ...m,
                orgRole: editOrgRole,
                workspaceAccess: workspaceGrants.map((g) => {
                  const ws = workspaces.find((w) => w.id === g.workspaceId);
                  return {
                    workspaceId: g.workspaceId,
                    workspaceName: ws?.name || '',
                    workspaceSlug: ws?.slug || '',
                    role: g.role,
                  };
                }),
              }
            : m
        )
      );

      toast.success(
        `Updated access for ${editingMember.user.name || editingMember.user.email}`
      );
      setEditingMember(null);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update member access');
    } finally {
      setIsSavingAccess(false);
    }
  };

  const handleToggleSuspendMember = async (member: OrgMemberRow) => {
    try {
      if (member.suspendedAt) {
        await unsuspendOrganizationMemberAction({
          organizationId,
          targetUserId: member.userId,
        });
        setMembers((prev) =>
          prev.map((m) => (m.userId === member.userId ? { ...m, suspendedAt: null } : m))
        );
        toast.success('Member access restored');
      } else {
        await suspendOrganizationMemberAction({
          organizationId,
          targetUserId: member.userId,
        });
        setMembers((prev) =>
          prev.map((m) =>
            m.userId === member.userId
              ? { ...m, suspendedAt: new Date().toISOString() }
              : m
          )
        );
        toast.success('Member suspended — access revoked immediately');
      }
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update member access');
    }
  };

  const handleRemoveMember = async (targetUserId: number) => {
    try {
      await removeOrganizationMemberAction({ organizationId, targetUserId });
      setMembers((prev) => prev.filter((m) => m.userId !== targetUserId));
      toast.success('Member removed from organization');
      setRemovingUserId(null);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove member');
    }
  };

  const columns = [
    {
      id: 'user',
      header: 'Member',
      className: 'w-[34%]',
      accessor: (row: OrgMemberRow) => (
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
              <p className="font-semibold text-sm text-zinc-100 truncate">
                {row.user.name || row.user.email}
              </p>
              {row.userId === currentUserId && (
                <span className="text-[10px] font-mono bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 rounded-full shrink-0">
                  You
                </span>
              )}
              {row.suspendedAt && (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1.5 py-0.5 rounded-full shrink-0">
                  <ShieldOff className="h-2.5 w-2.5" />
                  Suspended
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
      id: 'orgRole',
      header: 'Organization Role',
      className: 'w-[18%] whitespace-nowrap',
      accessor: (row: OrgMemberRow) => (
        <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-zinc-200 whitespace-nowrap">
          <ShieldCheck className="h-3.5 w-3.5 text-primary shrink-0" />
          {row.orgRole === 'OWNER'
            ? 'Org Owner'
            : row.orgRole === 'ADMIN'
            ? 'Org Admin'
            : 'Member'}
        </span>
      ),
    },
    {
      id: 'workspaces',
      header: 'Assigned Workspaces',
      className: 'w-[25%]',
      accessor: (row: OrgMemberRow) =>
        row.workspaceAccess.length === 0 ? (
          <span className="text-xs text-zinc-500 italic">None assigned</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {row.workspaceAccess.map((wa) => (
              <Link
                key={wa.workspaceId}
                href={`/workspace/${wa.workspaceSlug}`}
                className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-zinc-200 hover:bg-white/10 hover:text-white transition-colors whitespace-nowrap"
              >
                <Building2 className="h-3 w-3 text-muted-foreground shrink-0" />
                <span>{wa.workspaceName}</span>
                <span className="text-[10px] text-muted-foreground font-mono">· {wa.role.toLowerCase()}</span>
              </Link>
            ))}
          </div>
        ),
    },
    {
      id: 'joined',
      header: 'Joined On',
      className: 'w-[11%] whitespace-nowrap',
      accessor: (row: OrgMemberRow) => (
        <span className="text-xs text-muted-foreground font-mono whitespace-nowrap" suppressHydrationWarning>
          {new Date(row.joinedAt).toLocaleDateString('en-US', {
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
      className: 'w-[16%] text-right whitespace-nowrap',
      accessor: (row: OrgMemberRow) => {
        const canRemove = row.userId !== currentUserId && row.orgRole !== 'OWNER';

        return (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 rounded-lg text-xs font-medium gap-1.5 cursor-pointer"
              onClick={() => handleOpenEdit(row)}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span>Manage Access</span>
            </Button>

            {canRemove ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-white/10 rounded-lg shrink-0 cursor-pointer"
                    title="More actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 p-1 rounded-xl bg-popover border border-border">
                  <DropdownMenuItem
                    onClick={() => handleToggleSuspendMember(row)}
                    className={cn(
                      'gap-2 px-3 py-2 text-xs cursor-pointer rounded-lg font-medium',
                      row.suspendedAt
                        ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10'
                        : 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
                    )}
                  >
                    {row.suspendedAt ? (
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <ShieldOff className="h-3.5 w-3.5 text-amber-400" />
                    )}
                    <span>{row.suspendedAt ? 'Restore access' : 'Suspend access'}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setRemovingUserId(row.userId)}
                    className="gap-2 px-3 py-2 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 cursor-pointer rounded-lg font-medium"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                    <span>Remove from organization</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="w-8 h-8 shrink-0" />
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Organization Members</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            All active members of <strong className="text-foreground">{organizationName}</strong> and their assigned workspaces.
          </p>
        </div>
        <Button onClick={() => setShowInviteModal(true)} className="gradient-btn text-white h-9 px-4 text-xs font-semibold rounded-xl gap-1.5">
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
              heading="No members found"
              subtext="Invite team members to join your organization."
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
          onInvited={() => router.refresh()}
        />
      )}

      {/* Manage Member Access Modal */}
      <Dialog
        open={editingMember !== null}
        onOpenChange={(open) => !open && setEditingMember(null)}
      >
        <DialogContent className="glass border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="gradient-text text-xl">
              Manage Member Access
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Update organization role and workspace access for this member.
            </p>
          </DialogHeader>

          {editingMember && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-white/5 border border-white/10">
                <UserAvatar
                  userId={editingMember.user.id}
                  name={editingMember.user.name || editingMember.user.email}
                  fullName={editingMember.user.fullName}
                  email={editingMember.user.email}
                  imageUrl={editingMember.user.avatarUrl}
                  color={editingMember.user.avatarColor}
                  initials={editingMember.user.avatarInitials}
                  size="lg"
                />
                <div className="min-w-0">
                  {editingMember.user.name && (
                    <p className="font-semibold text-sm text-zinc-100 truncate">
                      {editingMember.user.name}
                    </p>
                  )}
                  <p className="text-xs text-zinc-200 font-mono truncate">
                    {editingMember.user.email}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300">
                  Organization Role
                </label>
                <Select
                  value={editOrgRole}
                  onValueChange={(val) => setEditOrgRole(val as any)}
                  disabled={
                    editingMember.orgRole === 'OWNER' &&
                    editingMember.userId === currentUserId
                  }
                  options={[
                    { value: 'OWNER', label: 'Org Owner — Full organization control' },
                    { value: 'ADMIN', label: 'Org Admin — Manage approvals, invites & domains' },
                    { value: 'MEMBER', label: 'Member — Standard workspace access' },
                  ]}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-primary" />
                  Assigned Workspaces
                </label>
                <MultiSelectWithRoles
                  placeholder="Select workspaces..."
                  items={workspaces.map((ws) => ({
                    id: ws.id,
                    label: ws.name,
                    sublabel: `/workspace/${ws.slug}`,
                  }))}
                  selectedRoles={editWsGrants}
                  defaultRole="MEMBER"
                  roleOptions={[
                    { value: 'OWNER', label: 'Owner' },
                    { value: 'ADMIN', label: 'Admin' },
                    { value: 'MEMBER', label: 'Member' },
                    { value: 'GUEST', label: 'Guest' },
                  ]}
                  onToggleItem={(id, checked) =>
                    setEditWsGrants((prev) => ({
                      ...prev,
                      [id]: checked ? 'MEMBER' : null,
                    }))
                  }
                  onRoleChange={(id, role) =>
                    setEditWsGrants((prev) => ({
                      ...prev,
                      [id]: role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'GUEST',
                    }))
                  }
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setEditingMember(null)}
              disabled={isSavingAccess}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveAccess}
              disabled={isSavingAccess}
              className="gradient-btn text-white"
            >
              {isSavingAccess ? 'Saving…' : 'Save Access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={removingUserId !== null}
        onOpenChange={(open) => setRemovingUserId(open ? removingUserId : null)}
        title="Remove Member from Organization"
        description={`Are you sure you want to remove this member from ${organizationName}? They will lose access to all workspaces and projects in this organization.`}
        onConfirm={() => handleRemoveMember(removingUserId!)}
        variant="destructive"
      />
    </div>
  );
}
