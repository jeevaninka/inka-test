"use client";

import { useState } from 'react';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Users, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { inviteMemberAction, updateMemberRoleAction, removeMemberAction } from '@/app/actions/members';

interface MemberRow {
  userId: string | number;
  projectId: string;
  role: string;
  user: {
    id: number;
    name: string;
    email: string;
    avatarUrl?: string | null;
  };
}

export default function MembersPage() {
  const { project, members, setMembers, currentUser } = useProjectData();

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'tester' | 'viewer'>('tester');
  const [showRemoveModal, setShowRemoveModal] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!project) return null;

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return;
    setIsSubmitting(true);
    try {
      const roleEnum = inviteRole.toUpperCase() as 'ADMIN' | 'TESTER' | 'VIEWER';
      const dbMember = await inviteMemberAction(project.id, inviteEmail, roleEnum);
      const newMember: MemberRow = {
        userId: dbMember.user_id,
        projectId: dbMember.project_id,
        role: dbMember.role.toLowerCase(),
        user: {
          id: dbMember.user.id,
          name: dbMember.user.name || dbMember.user.email.split('@')[0],
          email: dbMember.user.email,
          avatarUrl: dbMember.user.image || null,
        },
      };
      setMembers([...members, newMember]);
      toast.success('Member invited');
      setShowInviteModal(false);
      setInviteEmail('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to invite member';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemove = async (userId: string | number) => {
    try {
      await removeMemberAction(project.id, Number(userId));
      setMembers(members.filter((m: MemberRow) => String(m.userId) !== String(userId)));
      toast.success('Member removed');
      setShowRemoveModal(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove member';
      toast.error(message);
    }
  };

  const handleRoleChange = async (userId: string | number, newRole: string) => {
    try {
      const roleEnum = newRole.toUpperCase() as 'ADMIN' | 'TESTER' | 'VIEWER';
      await updateMemberRoleAction(project.id, Number(userId), roleEnum);
      setMembers(
        members.map((m: MemberRow) => (String(m.userId) === String(userId) ? { ...m, role: newRole } : m))
      );
      toast.success('Role updated successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update role';
      toast.error(message);
    }
  };

  const columns = [
    {
      id: 'user',
      header: 'Member',
      sortable: true,
      sortValue: (row: MemberRow) => String(row.user.name || '').toLowerCase(),
      className: 'flex-1 min-w-[220px]',
      accessor: (row: MemberRow) => {
        const isSelf = Number(row.userId) === Number(currentUser?.id);
        return (
          <div className="flex items-center gap-3">
            <UserAvatar name={row.user.name} imageUrl={row.user.avatarUrl} />
            <div>
              <div className="flex items-center gap-1.5">
                <p className="font-semibold text-sm text-foreground">{row.user.name}</p>
                {isSelf && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-muted text-muted-foreground border border-border/60">
                    You
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{row.user.email}</p>
            </div>
          </div>
        );
      },
    },
    {
      id: 'role',
      header: 'Role',
      sortable: true,
      sortValue: (row: MemberRow) => String(row.role || ''),
      className: 'w-36 shrink-0',
      accessor: (row: MemberRow) => (
        <Select
          value={row.role}
          onValueChange={(val) => handleRoleChange(row.userId, val)}
          options={[
            { value: 'admin', label: 'Admin' },
            { value: 'tester', label: 'Tester' },
            { value: 'viewer', label: 'Viewer' },
          ]}
          className="w-28 h-8 text-xs"
        />
      ),
    },
    {
      id: 'lastActive',
      header: 'Last Active',
      className: 'w-32 shrink-0',
      accessor: (row: MemberRow) => {
        const isSelf = Number(row.userId) === Number(currentUser?.id);
        return (
          <span className="text-xs font-mono text-muted-foreground">
            {isSelf ? 'Active now' : '3 days ago'}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: '',
      className: 'w-14 shrink-0 text-right',
      accessor: (row: MemberRow) => {
        const isSelf = Number(row.userId) === Number(currentUser?.id);
        return (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-red-500 disabled:opacity-30 cursor-pointer"
              disabled={isSelf}
              onClick={() => setShowRemoveModal(String(row.userId))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            Members · {members.length}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Admins manage settings and members. Testers create and run tests. Viewers are read-only.
          </p>
        </div>
        <Button
          onClick={() => setShowInviteModal(true)}
          className="gradient-btn text-white h-9 px-4 rounded-xl text-xs font-semibold shadow-sm cursor-pointer shrink-0"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          <span>Invite Member</span>
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
        <DataTable
          data={members as MemberRow[]}
          columns={columns}
          getId={(row) => String(row.userId)}
          tableClassName="w-full min-w-[600px]"
          emptyComponent={<EmptyState icon={Users} heading="No members" subtext="Invite team members" />}
        />
      </div>

      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent onClose={() => setShowInviteModal(false)}>
          <DialogHeader>
            <DialogTitle>Invite Member</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Email</label>
              <Input
                type="email"
                placeholder="teammate@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Role</label>
              <Select
                value={inviteRole}
                onValueChange={(val) => setInviteRole(val as 'admin' | 'tester' | 'viewer')}
                options={[
                  { value: 'admin', label: 'Admin' },
                  { value: 'tester', label: 'Tester' },
                  { value: 'viewer', label: 'Viewer' },
                ]}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInviteModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={!inviteEmail.trim() || isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Send Invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={showRemoveModal !== null}
        onOpenChange={(open) => setShowRemoveModal(open ? showRemoveModal : null)}
        title="Remove Member"
        description="Remove this member from the project?"
        onConfirm={() => handleRemove(showRemoveModal!)}
        variant="destructive"
      />
    </div>
  );
}
