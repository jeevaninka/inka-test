'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import { MultiSelectWithRoles } from '@/components/admin/MultiSelectWithRoles';
import {
  UserCheck,
  Check,
  X,
  FolderGit,
  Building2,
  Globe,
} from 'lucide-react';
import { toast } from 'sonner';
import { UserAvatar } from '@/components/common/UserAvatar';
import { approveJoinRequestAction, rejectJoinRequestAction } from '@/app/actions/workspace';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface JoinRequest {
  id: string;
  message: string | null;
  createdAt: string;
  isOrgRequest?: boolean;
  requestType?: 'NEW_SIGNUP' | 'WORKSPACE_ACCESS';
  contextPrimary?: string;
  contextSecondary?: string;
  requestedWorkspaceId?: string | null;
  requestedWorkspaceName?: string | null;
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

interface WorkspaceInfo {
  id: string;
  name: string;
  slug: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  workspace_id: string;
}

interface ApprovalsClientProps {
  workspaceId?: string;
  workspaceName?: string;
  organizationName: string;
  initialRequests: JoinRequest[];
  workspaces: WorkspaceInfo[];
  projects: ProjectInfo[];
  mode?: 'organization' | 'workspace';
}

export function ApprovalsClient({
  workspaceId,
  organizationName,
  initialRequests,
  workspaces,
  projects,
}: ApprovalsClientProps) {
  const router = useRouter();
  const [requests, setRequests] = useState<JoinRequest[]>(initialRequests);
  const [selectedRequest, setSelectedRequest] = useState<JoinRequest | null>(null);

  const [wsGrants, setWsGrants] = useState<
    Record<string, 'ADMIN' | 'MEMBER' | 'GUEST' | null>
  >({});
  const [projectGrants, setProjectGrants] = useState<
    Record<string, 'ADMIN' | 'TESTER' | 'VIEWER' | null>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleReject = async (request: JoinRequest) => {
    try {
      await rejectJoinRequestAction({
        requestId: request.id,
        isOrgRequest: request.isOrgRequest,
      });
      setRequests((prev) => prev.filter((r) => r.id !== request.id));
      toast.success('Access request declined');
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to decline request');
    }
  };

  const handleOpenApprove = (request: JoinRequest) => {
    setSelectedRequest(request);

    const initWs: Record<string, 'ADMIN' | 'MEMBER' | 'GUEST' | null> = {};
    workspaces.forEach((w) => {
      if (request.requestedWorkspaceId) {
        initWs[w.id] = w.id === request.requestedWorkspaceId ? 'MEMBER' : null;
      } else if (workspaceId) {
        initWs[w.id] = w.id === workspaceId ? 'MEMBER' : null;
      } else {
        initWs[w.id] = workspaces.length === 1 ? 'MEMBER' : null;
      }
    });
    setWsGrants(initWs);
    setProjectGrants({});
  };

  const handleConfirmApprove = async () => {
    if (!selectedRequest) return;

    const chosenWorkspaces = Object.entries(wsGrants)
      .filter((entry): entry is [string, 'ADMIN' | 'MEMBER' | 'GUEST'] => entry[1] !== null)
      .map(([wsId, role]) => ({
        workspaceId: wsId,
        role,
      }));

    if (chosenWorkspaces.length === 0) {
      toast.error('Please select at least one workspace to grant access to');
      return;
    }

    setIsSubmitting(true);

    const activeWsIds = new Set(chosenWorkspaces.map((w) => w.workspaceId));

    const projectAssignments = Object.entries(projectGrants)
      .filter((entry): entry is [string, 'ADMIN' | 'TESTER' | 'VIEWER'] => {
        if (!entry[1]) return false;
        const proj = projects.find((p) => p.id === entry[0]);
        return proj ? activeWsIds.has(proj.workspace_id) : false;
      })
      .map(([projectId, role]) => {
        const proj = projects.find((p) => p.id === projectId);
        const wsRole = proj ? wsGrants[proj.workspace_id] : null;
        return {
          projectId,
          role: wsRole === 'GUEST' ? ('VIEWER' as const) : role,
        };
      });

    try {
      await approveJoinRequestAction({
        requestId: selectedRequest.id,
        isOrgRequest: selectedRequest.isOrgRequest,
        workspaceAssignments: chosenWorkspaces,
        projectAssignments,
      });

      setRequests((prev) => prev.filter((r) => r.id !== selectedRequest.id));
      toast.success(
        `${selectedRequest.user.name || selectedRequest.user.email} approved and assigned`
      );
      setSelectedRequest(null);
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to approve request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const availableProjects = projects.filter((p) => wsGrants[p.workspace_id] != null);

  const columns = [
    {
      id: 'user',
      header: 'Requester',
      className: 'w-[35%]',
      accessor: (row: JoinRequest) => (
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
            {row.user.name ? (
              <>
                <p className="font-semibold text-sm text-zinc-100 truncate">
                  {row.user.name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {row.user.email}
                </p>
              </>
            ) : (
              <p className="font-medium text-sm text-zinc-100 truncate">
                {row.user.email}
              </p>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'domain',
      header: 'Matched Domain',
      className: 'w-[20%] whitespace-nowrap',
      accessor: (row: JoinRequest) => {
        const domain = row.user.email.split('@')[1] || '';
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-mono px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary whitespace-nowrap">
            <Globe className="h-3 w-3 shrink-0" />
            @{domain}
          </span>
        );
      },
    },
    {
      id: 'message',
      header: 'Note',
      className: 'w-[20%]',
      accessor: (row: JoinRequest) => (
        <p className="text-xs text-zinc-300 max-w-[220px] truncate">
          {row.message ? `"${row.message}"` : <span className="text-zinc-600">—</span>}
        </p>
      ),
    },
    {
      id: 'requested',
      header: 'Requested On',
      className: 'w-[12%] whitespace-nowrap',
      accessor: (row: JoinRequest) => (
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
      className: 'w-[13%] text-right whitespace-nowrap',
      accessor: (row: JoinRequest) => (
        <div className="flex items-center gap-2 justify-end">
          <Button
            variant="outline"
            onClick={() => handleOpenApprove(row)}
            className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 hover:border-emerald-500/50"
          >
            <Check className="h-3.5 w-3.5" />
            Approve &amp; Assign
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-red-400 hover:bg-red-500/10"
            onClick={() => handleReject(row)}
            title="Decline request"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Access Approvals</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Review domain-matched signups for <strong className="text-foreground">{organizationName}</strong> and assign their workspace and project access.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
        <DataTable
          data={requests}
          columns={columns}
          getId={(row) => row.id}
          tableClassName="w-full min-w-[600px]"
          emptyComponent={
            <EmptyState
              icon={UserCheck}
              heading="No pending access requests"
              subtext="New employees signing up with your corporate email domain will appear here for approval."
            />
          }
        />
      </div>

      {/* Approve & Assign Dialog */}
      <Dialog
        open={selectedRequest !== null}
        onOpenChange={(open) => !open && setSelectedRequest(null)}
      >
        <DialogContent className="glass border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="gradient-text text-xl">
              Approve &amp; Assign Access
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Select which workspaces and projects this user can access inside {organizationName}.
            </p>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4 py-2">
              <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-white/5 border border-white/10">
                <div className="flex items-center gap-3 min-w-0">
                  <UserAvatar
                    userId={selectedRequest.user.id}
                    name={selectedRequest.user.name || selectedRequest.user.email}
                    fullName={selectedRequest.user.fullName}
                    email={selectedRequest.user.email}
                    imageUrl={selectedRequest.user.avatarUrl}
                    color={selectedRequest.user.avatarColor}
                    initials={selectedRequest.user.avatarInitials}
                    size="lg"
                  />
                  <div className="min-w-0">
                    {selectedRequest.user.name && (
                      <p className="font-semibold text-sm text-zinc-100 truncate">
                        {selectedRequest.user.name}
                      </p>
                    )}
                    <p className="text-xs text-zinc-200 truncate">
                      {selectedRequest.user.email}
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary shrink-0">
                  @{selectedRequest.user.email.split('@')[1]}
                </span>
              </div>

              {selectedRequest.message && (
                <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-xs text-zinc-300">
                  <span className="text-zinc-500 font-medium mr-1.5">Note:</span>
                  &ldquo;{selectedRequest.message}&rdquo;
                </div>
              )}

              {/* Workspaces Multi-Select */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-primary" />
                  Workspaces
                </label>
                <MultiSelectWithRoles
                  placeholder="Select workspaces to grant..."
                  items={workspaces.map((ws) => ({
                    id: ws.id,
                    label: ws.name,
                    sublabel: `/workspace/${ws.slug}`,
                  }))}
                  selectedRoles={wsGrants}
                  defaultRole="MEMBER"
                  roleOptions={[
                    { value: 'MEMBER', label: 'Member' },
                    { value: 'ADMIN', label: 'Admin' },
                    { value: 'GUEST', label: 'Guest' },
                  ]}
                  onToggleItem={(id, checked) =>
                    setWsGrants((prev) => ({ ...prev, [id]: checked ? 'MEMBER' : null }))
                  }
                  onRoleChange={(id, role) =>
                    setWsGrants((prev) => ({
                      ...prev,
                      [id]: role as 'ADMIN' | 'MEMBER' | 'GUEST',
                    }))
                  }
                />
              </div>

              {/* Projects Multi-Select */}
              {availableProjects.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-300 flex items-center gap-1.5">
                    <FolderGit className="h-3.5 w-3.5 text-cyan-400" />
                    Projects <span className="text-zinc-500 font-normal">(optional)</span>
                  </label>
                  <MultiSelectWithRoles
                    placeholder="Select projects to assign..."
                    items={availableProjects.map((p) => {
                      const ws = workspaces.find((w) => w.id === p.workspace_id);
                      return {
                        id: p.id,
                        label: p.name,
                        sublabel: ws ? ws.name : undefined,
                      };
                    })}
                    selectedRoles={projectGrants}
                    defaultRole="TESTER"
                    roleOptions={[
                      { value: 'TESTER', label: 'Tester' },
                      { value: 'ADMIN', label: 'Admin' },
                      { value: 'VIEWER', label: 'Viewer' },
                    ]}
                    onToggleItem={(id, checked) =>
                      setProjectGrants((prev) => ({
                        ...prev,
                        [id]: checked ? 'TESTER' : null,
                      }))
                    }
                    onRoleChange={(id, role) =>
                      setProjectGrants((prev) => ({
                        ...prev,
                        [id]: role as 'ADMIN' | 'TESTER' | 'VIEWER',
                      }))
                    }
                  />
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setSelectedRequest(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmApprove}
              disabled={isSubmitting}
              className="gradient-btn text-white"
            >
              {isSubmitting ? 'Approving…' : 'Confirm & Grant Access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
