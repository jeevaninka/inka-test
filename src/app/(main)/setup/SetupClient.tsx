'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ThemeButton } from '@/components/layout/ThemeButton';
import { toast } from 'sonner';
import { createWorkspaceAction } from '@/app/actions/workspace';
import { Sparkles, LogOut, Building2 } from 'lucide-react';

interface SetupClientProps {
  userName: string;
  userEmail: string;
}

export function SetupClient({ userName, userEmail }: SetupClientProps) {
  const router = useRouter();
  const { update } = useSession();
  const [workspaceName, setWorkspaceName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!workspaceName.trim()) return;
    setIsCreating(true);
    try {
      const workspace = await createWorkspaceAction({ name: workspaceName.trim() });
      await update({ workspaceId: workspace.id, workspaceSlug: workspace.slug });
      toast.success('Workspace created successfully');
      router.push(`/workspace/${workspace.slug}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create workspace');
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && workspaceName.trim()) {
      handleCreate();
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 mesh-gradient opacity-60" />
      <div className="absolute top-20 left-10 w-72 h-72 bg-primary/15 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-accent/15 rounded-full blur-3xl animate-float animation-delay-300" />

      {/* Top bar with theme controls */}
      <div className="absolute top-4 right-4 flex items-center gap-3 z-10">
        <ThemeButton />
      </div>

      <div className="relative max-w-[520px] w-full rounded-[2.5rem] border border-border bg-card/90 backdrop-blur-2xl p-10 shadow-2xl animate-scale-in">
        <div className="text-center mb-8">
          <div className="mx-auto w-12 h-12 rounded-2xl gradient-btn flex items-center justify-center mb-6 shadow-glow-md">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">Welcome to InkaTest</h1>
          <p className="text-sm text-muted-foreground">
            Create your workspace to get started.
          </p>
        </div>

        {userEmail && (
          <div className="mb-6 p-3 rounded-xl bg-muted/40 border border-border">
            <p className="text-xs text-muted-foreground mb-1">Signed in as</p>
            <p className="text-sm text-foreground font-medium">{userEmail}</p>
          </div>
        )}

        <div className="space-y-4 mb-6">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Workspace Name
            </label>
            <Input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. My Team Workspace"
              className="text-sm rounded-xl h-12"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              You can rename this later in Settings.
            </p>
          </div>
        </div>

        <Button
          onClick={handleCreate}
          disabled={!workspaceName.trim() || isCreating}
          className="w-full h-12 rounded-xl text-base font-semibold"
        >
          {isCreating ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Creating workspace...
            </span>
          ) : (
            'Continue'
          )}
        </Button>

        <div className="mt-6 pt-6 border-t border-white/10">
          <Button
            variant="ghost"
            className="w-full text-zinc-500 hover:text-zinc-300 h-10 rounded-xl"
            onClick={() => signOut({ callbackUrl: '/login' })}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Sign out
          </Button>
        </div>
      </div>

      <p className="mt-6 text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
        InkaTest
      </p>
    </div>
  );
}
