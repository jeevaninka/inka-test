'use client';

import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { LogOut, ShieldAlert, Mail } from 'lucide-react';

export function SuspendedClient({
  organizationName,
  kind,
  reason,
  userEmail,
}: {
  organizationName: string;
  kind: 'ORG' | 'MEMBER';
  reason: string | null;
  userEmail: string;
}) {
  const title =
    kind === 'ORG' ? 'Organization suspended' : 'Your access is suspended';
  const body =
    kind === 'ORG'
      ? `Access to ${organizationName} has been suspended. No member of this organization can use it until a platform administrator restores access.`
      : `Your membership in ${organizationName} has been suspended. You no longer have access to its workspaces and projects.`;

  return (
    <div className="min-h-screen bg-[#050507] flex flex-col items-center justify-center p-6 relative overflow-hidden text-foreground">
      <div className="absolute inset-0 mesh-gradient opacity-60" />
      <div className="absolute top-20 left-10 w-72 h-72 bg-amber-500/10 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-red-500/10 rounded-full blur-3xl animate-float animation-delay-300" />

      <div className="relative max-w-[520px] w-full rounded-[2.5rem] border border-white/10 bg-white/5 backdrop-blur-2xl p-10 shadow-2xl animate-scale-in">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-amber-500/50 to-transparent" />

        <div className="space-y-6">
          <div className="text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-white">{title}</h1>
            <p className="text-sm text-zinc-400 leading-relaxed">{body}</p>
            {reason && (
              <p className="text-xs text-zinc-500 leading-relaxed">
                Reason: <span className="text-zinc-300">{reason}</span>
              </p>
            )}
          </div>

          <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2 text-xs text-zinc-400">
            <p className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              Signed in as <strong className="text-zinc-200">{userEmail}</strong>
            </p>
            <p>
              If you believe this is a mistake, contact your platform administrator to restore
              access. Nothing has been deleted — access returns as soon as the suspension is lifted.
            </p>
          </div>

          <Button
            variant="outline"
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full h-11 rounded-xl border-white/10 text-zinc-300 hover:text-white flex items-center justify-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
