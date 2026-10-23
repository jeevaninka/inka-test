'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, Shield, UserPlus, Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

export function OrgPortalNav({
  slug,
  membersCount = 0,
  pendingApprovalsCount = 0,
  invitationsCount = 0,
}: {
  slug: string;
  membersCount?: number;
  pendingApprovalsCount?: number;
  invitationsCount?: number;
}) {
  const pathname = usePathname();
  const isMembers = pathname.includes('/members');
  const isApprovals = pathname.includes('/approvals');
  const isInvitations = pathname.includes('/invitations');
  const isDomains = pathname.includes('/domains');

  return (
    <div className="flex items-center gap-2 border-b border-border/50 text-xs overflow-x-auto">
      <Link
        href={`/org/${slug}/members`}
        className={cn(
          'px-4 py-3 font-semibold transition-colors flex items-center gap-2 border-b-2 cursor-pointer whitespace-nowrap',
          isMembers
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        )}
      >
        <Users className="h-4 w-4" />
        <span>Members</span>
        <span className="font-mono text-[11px] px-1.5 py-0.2 rounded-full bg-white/5 text-zinc-400">
          {membersCount}
        </span>
      </Link>

      <Link
        href={`/org/${slug}/approvals`}
        className={cn(
          'px-4 py-3 font-semibold transition-colors flex items-center gap-2 border-b-2 cursor-pointer whitespace-nowrap',
          isApprovals
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        )}
      >
        <Shield className="h-4 w-4" />
        <span>Access Approvals</span>
        <span
          className={cn(
            'font-mono text-[11px] px-1.5 py-0.2 rounded-full',
            pendingApprovalsCount > 0
              ? 'bg-primary/20 text-primary border border-primary/30'
              : 'bg-white/5 text-zinc-400'
          )}
        >
          {pendingApprovalsCount}
        </span>
      </Link>

      <Link
        href={`/org/${slug}/invitations`}
        className={cn(
          'px-4 py-3 font-semibold transition-colors flex items-center gap-2 border-b-2 cursor-pointer whitespace-nowrap',
          isInvitations
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        )}
      >
        <UserPlus className="h-4 w-4" />
        <span>Invitations</span>
        <span className="font-mono text-[11px] px-1.5 py-0.2 rounded-full bg-white/5 text-zinc-400">
          {invitationsCount}
        </span>
      </Link>

      <Link
        href={`/org/${slug}/domains`}
        className={cn(
          'px-4 py-3 font-semibold transition-colors flex items-center gap-2 border-b-2 cursor-pointer whitespace-nowrap',
          isDomains
            ? 'border-primary text-primary'
            : 'border-transparent text-muted-foreground hover:text-foreground'
        )}
      >
        <Globe className="h-4 w-4" />
        <span>Email Domains</span>
      </Link>
    </div>
  );
}
