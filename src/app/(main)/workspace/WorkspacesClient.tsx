'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Building2, ArrowRight, Plus, Sparkles, FolderKanban, Shield, Search, Check, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { createWorkspaceAction, requestJoinAction } from '@/app/actions/workspace';

interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string;
  projectCount: number;
  createdAt: string;
}

interface AvailableWorkspace {
  id: string;
  name: string;
  slug: string;
}

interface WorkspacesClientProps {
  organizationName?: string;
  organizationSlug?: string;
  isOrgAdmin?: boolean;
  isPlatformAdmin?: boolean;
  pendingOrgRequestsCount?: number;
  workspaces: Workspace[];
  availableWorkspaces: AvailableWorkspace[];
  canCreateWorkspace: boolean;
  pendingRequestWorkspaceIds: string[];
}

export function WorkspacesClient({
  organizationName = 'Inka Insurance',
  organizationSlug,
  isOrgAdmin = false,
  isPlatformAdmin = false,
  pendingOrgRequestsCount = 0,
  workspaces,
  availableWorkspaces,
  canCreateWorkspace,
  pendingRequestWorkspaceIds,
}: WorkspacesClientProps) {
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredWorkspaces = availableWorkspaces
    .filter(w => w.name.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      const numA = parseInt(a.id.split('-')[1] || '0', 10);
      const numB = parseInt(b.id.split('-')[1] || '0', 10);
      return numA - numB;
    });

  const sortedWorkspaces = [...workspaces].sort((a, b) => {
    const numA = parseInt(a.id.split('-')[1] || '0', 10);
    const numB = parseInt(b.id.split('-')[1] || '0', 10);
    return numA - numB;
  });

  const handleCreate = async () => {
    if (!newWorkspaceName.trim()) return;
    setIsCreating(true);
    try {
      const workspace = await createWorkspaceAction({ name: newWorkspaceName.trim() });
      toast.success('Workspace created successfully');
      setShowCreateModal(false);
      setNewWorkspaceName('');
      router.push(`/workspace/${workspace.slug}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create workspace');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRequest = async () => {
    if (!selectedWorkspaceId) return;
    setIsRequesting(true);
    try {
      await requestJoinAction({ workspaceId: selectedWorkspaceId, message: requestMessage || undefined });
      toast.success('Access request sent');
      setShowRequestModal(false);
      setSelectedWorkspaceId(null);
      setRequestMessage('');
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to send request');
    } finally {
      setIsRequesting(false);
    }
  };

  const hasWorkspaces = workspaces.length > 0;
  const hasAvailableWorkspaces = availableWorkspaces.length > 0;

  return (
    <>
      <div className="relative z-10 mb-12 animate-fade-up">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-xs font-mono uppercase tracking-wider">
            <Building2 className="h-3.5 w-3.5" />
            <span>{organizationName}</span>
          </div>

          <div className="flex items-center gap-2.5">
            {isPlatformAdmin && (
              <Button
                onClick={() => router.push('/platform-admin/organizations')}
                variant="outline"
                className="border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/15 text-amber-400 gap-2 cursor-pointer"
              >
                <Zap className="h-4 w-4" />
                <span>Platform Admin</span>
              </Button>
            )}

            {isOrgAdmin && organizationSlug && (
              <Button
                onClick={() => router.push(`/org/${organizationSlug}/members`)}
                variant="outline"
                className="gap-2 cursor-pointer"
              >
                <Shield className="h-4 w-4 text-primary" />
                <span>Organization Console</span>
                {pendingOrgRequestsCount > 0 && (
                  <span className="font-mono text-[10px] px-1.5 py-0.2 rounded-full bg-primary text-primary-foreground font-bold">
                    {pendingOrgRequestsCount}
                  </span>
                )}
              </Button>
            )}
          </div>
        </div>
        <h1 className="text-4xl font-bold mb-3">
          <span className="gradient-text">Your Workspaces</span>
        </h1>
        <p className="text-muted-foreground text-lg max-w-xl">
          {hasWorkspaces
            ? `Select a workspace inside ${organizationName} to manage projects, test cases, and team collaboration.`
            : 'Request access to an existing workspace in your organization.'}
        </p>
      </div>

      {hasWorkspaces ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedWorkspaces.map((workspace, i) => (
            <button
              key={workspace.id}
              onClick={() => router.push(`/workspace/${workspace.slug}`)}
              className={cn(
                'group relative rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 text-left transition-all duration-300',
                'hover:border-primary/50 hover:shadow-lg hover:-translate-y-1 hover:shadow-primary/10',
                'animate-fade-up'
              )}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-primary" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all duration-300" />
              </div>
              <h3 className="font-semibold text-lg mb-1 group-hover:text-primary transition-colors">{workspace.name}</h3>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <FolderKanban className="h-3.5 w-3.5" />
                  {workspace.projectCount} {workspace.projectCount === 1 ? 'project' : 'projects'}
                </span>
                <span className="flex items-center gap-1">
                  <Shield className="h-3.5 w-3.5" />
                  {workspace.role === 'OWNER'
                    ? 'Owner'
                    : workspace.role === 'ADMIN'
                    ? 'Admin'
                    : workspace.role === 'GUEST'
                    ? 'Guest'
                    : 'Member'}
                </span>
              </div>
            </button>
          ))}

          {canCreateWorkspace && (
            <button
              onClick={() => setShowCreateModal(true)}
              className={cn(
                'group relative rounded-2xl border border-dashed border-border/50 bg-card/30 backdrop-blur-sm p-6 text-left transition-all duration-300',
                'hover:border-primary/50 hover:shadow-lg hover:-translate-y-1',
                'flex flex-col items-center justify-center min-h-[160px]',
                'animate-fade-up'
              )}
              style={{ animationDelay: `${workspaces.length * 60}ms` }}
            >
              <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center mb-3 group-hover:bg-primary/10 transition-colors">
                <Plus className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <span className="font-medium text-sm text-muted-foreground group-hover:text-primary transition-colors">Create Workspace</span>
            </button>
          )}

          {hasAvailableWorkspaces && (
            <button
              onClick={() => setShowRequestModal(true)}
              className={cn(
                'group relative rounded-2xl border border-dashed border-border/50 bg-card/30 backdrop-blur-sm p-6 text-left transition-all duration-300',
                'hover:border-primary/50 hover:shadow-lg hover:-translate-y-1',
                'flex flex-col items-center justify-center min-h-[160px]',
                'animate-fade-up'
              )}
              style={{ animationDelay: `${(workspaces.length + (canCreateWorkspace ? 1 : 0)) * 60}ms` }}
            >
              <div className="w-10 h-10 rounded-xl bg-muted/50 flex items-center justify-center mb-3 group-hover:bg-primary/10 transition-colors">
                <Search className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <span className="font-medium text-sm text-muted-foreground group-hover:text-primary transition-colors">Request Access</span>
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 animate-fade-up">
          <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-6">
            <Building2 className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">No workspaces yet</h2>
          <p className="text-muted-foreground mb-8 text-center max-w-md">
            Create your first workspace to start managing test cases, or request access to join an existing team.
          </p>
          <div className="flex flex-col sm:flex-row gap-3">
            {canCreateWorkspace && (
              <Button onClick={() => setShowCreateModal(true)} className="gap-2">
                <Plus className="h-4 w-4" />
                Create Workspace
              </Button>
            )}
            {hasAvailableWorkspaces && (
              <Button variant="outline" onClick={() => setShowRequestModal(true)} className="gap-2">
                <Search className="h-4 w-4" />
                Request Access
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Create Workspace Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Workspace</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Workspace Name</label>
              <Input
                placeholder="e.g., My Team Workspace"
                value={newWorkspaceName}
                onChange={(e) => setNewWorkspaceName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!newWorkspaceName.trim() || isCreating}>
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Access Modal */}
      <Dialog open={showRequestModal} onOpenChange={setShowRequestModal}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Access</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search workspaces..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {filteredWorkspaces.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No workspaces found</p>
              ) : (
                filteredWorkspaces.map((workspace) => {
                  const isPending = pendingRequestWorkspaceIds.includes(workspace.id);
                  const isSelected = selectedWorkspaceId === workspace.id;
                  return (
                    <button
                      key={workspace.id}
                      onClick={() => !isPending && setSelectedWorkspaceId(workspace.id)}
                      disabled={isPending}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all',
                        isPending
                          ? 'opacity-50 cursor-not-allowed border-border/50'
                          : isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border/50 hover:border-primary/50 hover:bg-muted/50'
                      )}
                    >
                      <div className="w-10 h-10 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center shrink-0">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{workspace.name}</p>
                      </div>
                      {isPending ? (
                        <span className="text-xs text-muted-foreground shrink-0">Request Pending</span>
                      ) : isSelected ? (
                        <Check className="h-5 w-5 text-primary shrink-0" />
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
            {selectedWorkspaceId && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Message (optional)</label>
                <Input
                  placeholder="Why do you want to join this workspace?"
                  value={requestMessage}
                  onChange={(e) => setRequestMessage(e.target.value)}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowRequestModal(false); setSelectedWorkspaceId(null); setRequestMessage(''); }}>Cancel</Button>
            <Button onClick={handleRequest} disabled={!selectedWorkspaceId || isRequesting}>
              {isRequesting ? 'Sending...' : 'Send Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
