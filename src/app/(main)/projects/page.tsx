import { TopBar } from '@/components/layout/TopBar';
import { Button } from '@/components/ui/button';
import { Plus, ArrowRight, FolderKanban, Sparkles } from 'lucide-react';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { getProjects } from '@/lib/dal/projects';
import { cn } from '@/lib/utils';
import type { Project } from '@/lib/types';
import { ProjectsClient } from './ProjectsClient';

function mapPrismaProjectToMock(p: Record<string, unknown>): Project {
  return {
    id: p.id as string,
    name: p.name as string,
    slug: p.slug as string,
    aiEnabled: (p.ai_enabled as boolean) ?? false,
    reviewRequired: (p.review_required as boolean) ?? false,
    createdBy: p.created_by as string,
    createdAt: (p.created_at as string) || new Date().toISOString(),
  };
}

export default async function ProjectsPage() {
  const session = await getServerSession(authOptions);
  const workspaceId = (session?.user as any)?.workspaceId as string | undefined;

  let projects: Project[] = [];

  if (workspaceId) {
    try {
      const prismaProjects = await getProjects(workspaceId);
      projects = (prismaProjects as unknown as Record<string, unknown>[]).map(mapPrismaProjectToMock);
    } catch {
      // DB may not be set up yet
    }
  }

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-0 mesh-gradient opacity-60" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />
      <div className="absolute top-20 left-10 w-72 h-72 bg-primary/20 dark:bg-primary/10 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-cyan-500/20 dark:bg-cyan-500/10 rounded-full blur-3xl animate-float animation-delay-300" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-teal-500/10 dark:bg-teal-500/5 rounded-full blur-3xl" />

      <TopBar />

      <main className="relative pt-14 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-12 animate-fade-up">
            <h1 className="text-4xl font-bold mb-3">
              <span className="gradient-text">Your Projects</span>
            </h1>
            <p className="text-muted-foreground text-lg max-w-xl">
              Select a project to manage test cases, create test suites, and run executions.
            </p>
          </div>

          <ProjectsClient projects={projects} />
        </div>
      </main>
    </div>
  );
}