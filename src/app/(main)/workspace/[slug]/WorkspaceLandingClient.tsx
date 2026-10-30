"use client";

import { useRouter } from 'next/navigation';
import { Plus, FolderKanban, Users, ArrowRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { createProjectAction } from '@/app/actions/projects';

interface ProjectListItem {
  id: string;
  name: string;
  slug: string;
  key: string;
  createdAt: string;
  testCaseCount: number;
  memberCount: number;
}

interface WorkspaceLandingClientProps {
  workspaceName: string;
  workspaceSlug: string;
  memberCount: number;
  canCreateProject?: boolean;
  projects: ProjectListItem[];
}

export function WorkspaceLandingClient({
  workspaceName,
  workspaceSlug,
  memberCount,
  canCreateProject = false,
  projects,
}: WorkspaceLandingClientProps) {
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [projectPrefix, setProjectPrefix] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const slugify = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const generateDefaultPrefix = (name: string) =>
    name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    const slug = slugify(newProjectName);
    const prefix = (projectPrefix.trim() || generateDefaultPrefix(newProjectName)).toUpperCase();
    setIsSubmitting(true);
    try {
      await createProjectAction({ name: newProjectName.trim(), slug, prefix, workspaceSlug });
      toast.success('Project created successfully');
      setShowCreateModal(false);
      setNewProjectName('');
      setProjectPrefix('');
      router.push(`/p/${slug}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create project');
    } finally {
      setIsSubmitting(false);
    }
  };

  const sortedProjects = [...projects].sort((a, b) => {
    const numA = parseInt(a.id.split('-')[1] || '0', 10);
    const numB = parseInt(b.id.split('-')[1] || '0', 10);
    return numA - numB;
  });

  return (
    <div className="p-8">
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight gradient-text mb-1">
              {workspaceName}
            </h1>
            <p className="text-sm text-muted-foreground">
              {memberCount} member{memberCount !== 1 ? 's' : ''} · {sortedProjects.length} project{sortedProjects.length !== 1 ? 's' : ''}
            </p>
          </div>
          {canCreateProject && (
            <Button
              onClick={() => setShowCreateModal(true)}
              className="bg-gradient-to-r from-primary via-cyan-500 to-primary bg-[length:200%_100%] hover:bg-[position:100%_0] transition-all duration-500 shadow-glow-sm hover:shadow-glow-md"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          )}
        </div>
      </div>

      {sortedProjects.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center gradient-border">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <FolderKanban className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No projects yet</h3>
          <p className="text-muted-foreground mb-6">
            {canCreateProject
              ? `Create your first project in ${workspaceName} to start managing test cases.`
              : `No projects have been created in ${workspaceName} yet.`}
          </p>
          {canCreateProject && (
            <Button onClick={() => setShowCreateModal(true)} className="gradient-btn text-white">
              <Plus className="h-4 w-4 mr-2" />
              Create Project
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {sortedProjects.map((project, index) => (
            <a
              key={project.id}
              href={`/p/${project.slug}`}
              onClick={(e) => { e.preventDefault(); router.push(`/p/${project.slug}`); }}
              className={cn(
                "group relative block animate-fade-up opacity-0",
                index === 0 && "animation-delay-100",
                index === 1 && "animation-delay-200",
                index === 2 && "animation-delay-300",
                index >= 3 && "animation-delay-400"
              )}
              style={{ animationFillMode: 'forwards' }}
            >
              <div className="absolute -inset-[1px] rounded-2xl bg-gradient-to-br from-[hsl(var(--gradient-start))] via-[hsl(var(--gradient-mid))] to-[hsl(var(--gradient-end))] opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-[2px]" />
              <div className="relative glass rounded-2xl p-5 transition-all duration-300 group-hover:shadow-card-hover border border-border/50 hover:border-primary/20">
                <div className="absolute top-0 left-6 right-6 h-[2px] bg-gradient-to-r from-transparent via-primary/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-sm">
                      <FolderKanban className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-base group-hover:text-primary transition-colors">
                        {project.name}
                      </h3>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {project.key}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-1 transition-all duration-300" />
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/50">
                    <FolderKanban className="h-3.5 w-3.5" />
                    <span>{project.testCaseCount} cases</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-muted/50">
                    <Users className="h-3.5 w-3.5" />
                    <span>{project.memberCount} members</span>
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create a new project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Project name</label>
              <Input
                value={newProjectName}
                onChange={(e) => {
                  setNewProjectName(e.target.value);
                  if (!projectPrefix) setProjectPrefix(generateDefaultPrefix(e.target.value));
                }}
                placeholder="e.g. My App"
                className="rounded-xl"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Project prefix</label>
              <Input
                value={projectPrefix}
                onChange={(e) => setProjectPrefix(e.target.value.toUpperCase().slice(0, 4))}
                placeholder="e.g. MYAPP"
                maxLength={4}
                className="rounded-xl uppercase"
              />
              <p className="text-xs text-muted-foreground">Used as prefix for test case IDs (max 4 chars)</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>Cancel</Button>
            <Button onClick={handleCreateProject} disabled={!newProjectName.trim() || isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
