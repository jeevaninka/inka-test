'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Building2, FolderGit, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { MultiSelectWithRoles } from './MultiSelectWithRoles';
import {
  createOrganizationInvitationAction,
  getOrganizationWorkspacesAndProjectsAction,
} from '@/app/actions/organization-invitations';

export interface WorkspaceOption {
  id: string;
  name: string;
  slug: string;
}

export interface ProjectOption {
  id: string;
  name: string;
  workspace_id: string;
}

export function InviteDialog({
  organizationId,
  organizationName = 'Organization',
  defaultWorkspaceId,
  workspaceId,
  workspaceName,
  isWorkspaceScoped = false,
  initialWorkspaces,
  initialProjects,
  onClose,
  onInvited,
}: {
  organizationId: string;
  organizationName?: string;
  defaultWorkspaceId?: string;
  workspaceId?: string;
  workspaceName?: string;
  isWorkspaceScoped?: boolean;
  initialWorkspaces?: WorkspaceOption[];
  initialProjects?: ProjectOption[];
  onClose: () => void;
  onInvited?: (inv: any) => void;
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>(initialWorkspaces || []);
  const [projects, setProjects] = useState<ProjectOption[]>(initialProjects || []);
  const [loadingData, setLoadingData] = useState(!initialWorkspaces);

  const [email, setEmail] = useState('');
  const [orgRole, setOrgRole] = useState<'ADMIN' | 'MEMBER'>('MEMBER');
  const [workspaceRole, setWorkspaceRoleSingle] = useState<'ADMIN' | 'MEMBER' | 'GUEST'>('MEMBER');

  const activeWorkspaceId = workspaceId || defaultWorkspaceId;

  const [grants, setGrants] = useState<Record<string, 'ADMIN' | 'MEMBER' | 'GUEST' | null>>(() => {
    if (activeWorkspaceId && isWorkspaceScoped) {
      return { [activeWorkspaceId]: 'MEMBER' };
    }
    const init: Record<string, 'ADMIN' | 'MEMBER' | 'GUEST' | null> = {};
    if (initialWorkspaces) {
      initialWorkspaces.forEach((w) => {
        init[w.id] = 'MEMBER';
      });
    }
    return init;
  });

  const [projectGrants, setProjectGrants] = useState<
    Record<string, 'ADMIN' | 'TESTER' | 'VIEWER' | null>
  >({});
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialWorkspaces && initialProjects) {
      if (activeWorkspaceId && isWorkspaceScoped) {
        setGrants({ [activeWorkspaceId]: 'MEMBER' });
      }
      return;
    }

    let cancelled = false;
    setLoadingData(!initialWorkspaces);
    getOrganizationWorkspacesAndProjectsAction(organizationId)
      .then((res) => {
        if (cancelled) return;
        setWorkspaces(res.workspaces);
        setProjects(res.projects);

        if (activeWorkspaceId && isWorkspaceScoped) {
          setGrants({ [activeWorkspaceId]: 'MEMBER' });
        } else {
          // Pre-populate all organization workspaces by default so invitations aren't empty
          setGrants((prev) => {
            const next = { ...prev };
            res.workspaces.forEach((w) => {
              if (next[w.id] === undefined) {
                next[w.id] = 'MEMBER';
              }
            });
            return next;
          });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load workspaces');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingData(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId, activeWorkspaceId, isWorkspaceScoped, initialWorkspaces, initialProjects]);

  function toggleWorkspace(id: string, checked: boolean) {
    setGrants((g) => ({ ...g, [id]: checked ? 'MEMBER' : null }));
  }

  function setWorkspaceRole(id: string, role: string) {
    setGrants((g) => ({ ...g, [id]: role as 'ADMIN' | 'MEMBER' | 'GUEST' }));
  }

  function toggleProject(id: string, checked: boolean) {
    setProjectGrants((g) => ({ ...g, [id]: checked ? 'TESTER' : null }));
  }

  function setProjectRole(id: string, role: string) {
    setProjectGrants((g) => ({ ...g, [id]: role as 'ADMIN' | 'TESTER' | 'VIEWER' }));
  }

  function handleSubmit() {
    setError(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }

    const workspaceGrants = Object.entries(grants)
      .filter((entry): entry is [string, 'ADMIN' | 'MEMBER' | 'GUEST'] => entry[1] !== null)
      .map(([workspaceId, role]) => ({ workspaceId, role }));

    const activeWorkspaceIds = new Set(workspaceGrants.map((g) => g.workspaceId));

    const projectAssignments = Object.entries(projectGrants)
      .filter((entry): entry is [string, 'ADMIN' | 'TESTER' | 'VIEWER'] => {
        if (!entry[1]) return false;
        const proj = projects.find((p) => p.id === entry[0]);
        return proj ? activeWorkspaceIds.has(proj.workspace_id) : false;
      })
      .map(([projectId, role]) => {
        const proj = projects.find((p) => p.id === projectId);
        const wsRole = proj ? grants[proj.workspace_id] : null;
        return {
          projectId,
          role: wsRole === 'GUEST' ? ('VIEWER' as const) : role,
        };
      });

    startTransition(async () => {
      try {
        if (isWorkspaceScoped && activeWorkspaceId) {
          // Workspace-scoped invitation: only this workspace, grants selected workspace role
          const { inviteByEmailAction } = await import('@/app/actions/workspace');
          const activeProjAssignments = Object.entries(projectGrants)
            .filter((entry): entry is [string, 'ADMIN' | 'TESTER' | 'VIEWER'] => {
              if (!entry[1]) return false;
              const proj = projects.find((p) => p.id === entry[0]);
              return proj ? proj.workspace_id === activeWorkspaceId : false;
            })
            .map(([projectId, role]) => ({ projectId, role }));

          await inviteByEmailAction({
            workspaceId: activeWorkspaceId,
            email: trimmedEmail,
            role: workspaceRole,
            projectAssignments: activeProjAssignments,
          });
          toast.success(`Invitation sent to ${trimmedEmail}`);
          onInvited?.({ email: trimmedEmail, role: workspaceRole });
          onClose();
          return;
        }

        // Organization-level invitation
        const workspaceGrants = Object.entries(grants)
          .filter((entry): entry is [string, 'ADMIN' | 'MEMBER' | 'GUEST'] => entry[1] !== null)
          .map(([wsId, role]) => ({ workspaceId: wsId, role }));

        const activeWorkspaceIds = new Set(workspaceGrants.map((g) => g.workspaceId));

        const projectAssignments = Object.entries(projectGrants)
          .filter((entry): entry is [string, 'ADMIN' | 'TESTER' | 'VIEWER'] => {
            if (!entry[1]) return false;
            const proj = projects.find((p) => p.id === entry[0]);
            return proj ? activeWorkspaceIds.has(proj.workspace_id) : false;
          })
          .map(([projectId, role]) => ({ projectId, role }));

        const res = await createOrganizationInvitationAction({
          organizationIdOrSlug: organizationId,
          email: trimmedEmail,
          role: orgRole,
          workspaceGrants,
          projectAssignments,
        });

        toast.success(`Invitation sent to ${trimmedEmail}`);
        onInvited?.({
          ...res,
          workspaceGrants: workspaceGrants.map((g) => {
            const ws = workspaces.find((w) => w.id === g.workspaceId);
            return {
              workspaceId: g.workspaceId,
              workspaceName: ws?.name || '',
              workspaceSlug: ws?.slug || '',
              role: g.role,
            };
          }),
        });
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send invitation.');
      }
    });
  }

  const availableProjects = projects.filter((p) => {
    if (isWorkspaceScoped && activeWorkspaceId) {
      return p.workspace_id === activeWorkspaceId;
    }
    return grants[p.workspace_id] != null;
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onClose={onClose}
        className="flex flex-col max-w-lg w-[95vw] p-0 gap-0 overflow-hidden border border-border/80 bg-card text-card-foreground shadow-2xl rounded-2xl"
      >
        <DialogHeader className="px-5 py-3.5 border-b border-border/50 bg-muted/10 space-y-0.5 text-left shrink-0">
          <DialogTitle className="text-base font-bold text-foreground pr-8">
            {isWorkspaceScoped ? `Invite to ${workspaceName || 'Workspace'}` : `Invite to ${organizationName}`}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            {isWorkspaceScoped
              ? `Invite a teammate to collaborate in ${workspaceName || 'this workspace'} and assign their permissions.`
              : `Invite a team member to the organization and choose which workspaces and projects they can access.`}
          </p>
        </DialogHeader>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email" className="text-xs font-semibold text-foreground/90">
              Email Address
            </Label>
            <Input
              id="invite-email"
              type="email"
              placeholder="colleague@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && email.trim() && handleSubmit()}
              className="h-9 bg-background/80 border-input text-xs text-foreground"
              autoFocus
            />
          </div>

          {/* If workspace scoped: Show Workspace Roles (Admin / Member / Guest) */}
          {isWorkspaceScoped ? (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground/90">Workspace Role</Label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'MEMBER' as const, label: 'Member', desc: 'Standard access' },
                  { value: 'ADMIN' as const, label: 'Admin', desc: 'Full control' },
                  { value: 'GUEST' as const, label: 'Guest', desc: 'View only' },
                ].map(({ value, label, desc }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setWorkspaceRoleSingle(value)}
                    className={`flex flex-col items-center justify-center rounded-xl border p-2.5 text-xs transition-colors cursor-pointer text-center ${
                      workspaceRole === value
                        ? 'border-primary/50 bg-primary/15 text-primary font-semibold'
                        : 'border-border/70 bg-background/50 text-foreground hover:bg-muted/40'
                    }`}
                  >
                    <span className="font-semibold text-xs">{label}</span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">{desc}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* If Org level: Show Organization Role (Member vs Org Admin) */
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground/90">Organization Role</Label>
              <div className="flex gap-2">
                {(['MEMBER', 'ADMIN'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setOrgRole(r)}
                    className={`flex-1 rounded-xl border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                      orgRole === r
                        ? 'border-primary/50 bg-primary/15 text-primary font-semibold'
                        : 'border-border/70 bg-background/50 text-foreground hover:bg-muted/40'
                    }`}
                  >
                    {r === 'ADMIN' ? 'Org Admin (Full governance)' : 'Member (Standard access)'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Only show Multi-Workspace Selector in Organization-level invitations */}
          {!isWorkspaceScoped && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground/90 flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                Workspaces to Grant
              </Label>
              {loadingData ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <MultiSelectWithRoles
                  placeholder="Select workspaces to grant..."
                  items={workspaces.map((ws) => ({
                    id: ws.id,
                    label: ws.name,
                    sublabel: `/workspace/${ws.slug}`,
                  }))}
                  selectedRoles={grants}
                  defaultRole="MEMBER"
                  roleOptions={[
                    { value: 'MEMBER', label: 'Member' },
                    { value: 'ADMIN', label: 'Admin' },
                    { value: 'GUEST', label: 'Guest' },
                  ]}
                  onToggleItem={toggleWorkspace}
                  onRoleChange={setWorkspaceRole}
                />
              )}
            </div>
          )}

          {availableProjects.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground/90 flex items-center gap-1.5">
                <FolderGit className="h-3.5 w-3.5 text-primary" />
                Projects <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <MultiSelectWithRoles
                placeholder="Select projects to pre-assign..."
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
                onToggleItem={toggleProject}
                onRoleChange={setProjectRole}
              />
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}
        </div>

        <div className="border-t border-border/50 bg-muted/15 px-5 py-3 flex items-center justify-end gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending} className="h-8 px-3.5 text-xs">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || !email.trim()}
            className="gradient-btn text-white h-8 px-4 text-xs font-semibold"
          >
            {isPending ? 'Sending…' : 'Send Invite'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
