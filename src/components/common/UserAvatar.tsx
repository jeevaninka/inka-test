"use client";

import { useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { cn } from '@/lib/utils';

interface UserAvatarProps {
  userId?: number | string | null;
  name?: string | null;
  fullName?: string | null;
  email?: string | null;
  imageUrl?: string | null;
  color?: string | null;
  initials?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Muted, evenly-contrasted palette used when a user has not picked a colour. */
const AVATAR_COLORS = [
  '#0f766e',
  '#4f46e5',
  '#b45309',
  '#9f1239',
  '#7c3aed',
  '#0369a1',
  '#15803d',
  '#a21caf',
  '#c2410c',
  '#475569',
];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Deterministic fallback colour so two defaults never look identical. */
export function getAvatarColor(seed?: string | number | null): string {
  const value = String(seed ?? '').trim().toLowerCase();
  if (!value) return '#6366f1';
  return AVATAR_COLORS[hashSeed(value) % AVATAR_COLORS.length];
}

function splitName(name?: string | null): string[] {
  const raw = (name || '').trim();
  if (!raw) return [];
  const local = raw.includes('@') ? raw.split('@')[0] : raw;
  return local.split(/[\s._-]+/).filter(Boolean);
}

/** Default monogram is first-name + last-name (single names use 2 letters). */
function baseInitials(name?: string | null): string {
  const parts = splitName(name);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return (parts[0].slice(0, 2) || 'U').toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

/**
 * Resolve a unique monogram per project member.
 *
 * Two people whose first+last initials collide both fall back to letters from
 * their first name (e.g. "Jeevan Kumar" / "John King" -> "JE" / "JO") so no two
 * avatars end up with the same label. Single-letter monograms remain valid when
 * that is all a name can produce.
 */
export function resolveAvatarIdentities(
  members: any[] = []
): Map<string, { initials: string; color: string }> {
  const identities = new Map<string, { initials: string; color: string }>();

  const entries = (members || [])
    .map((member: any) => {
      const user = member?.user || member || {};
      const id = member?.userId ?? user?.id ?? null;
      // Prefer a multi-word name so the default monogram is first + last name.
      const nameCandidates = [
        user?.fullName,
        user?.full_name,
        user?.name,
        user?.displayName,
        user?.display_name,
        user?.email,
      ].filter((value): value is string => Boolean(value && String(value).trim()));
      const name =
        nameCandidates.find((value) => splitName(value).length >= 2) || nameCandidates[0] || '';
      return { id, user, name, parts: splitName(name), base: baseInitials(name) };
    })
    .filter((entry) => entry.id != null || Boolean(entry.user?.email));

  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const group = groups.get(entry.base) || [];
    group.push(entry);
    groups.set(entry.base, group);
  }

  const used = new Set<string>();

  function assign(entry: (typeof entries)[number], initials: string) {
    const value = {
      initials,
      color:
        entry.user?.avatarColor ||
        entry.user?.avatar_color ||
        getAvatarColor(entry.user?.email || entry.name || entry.id),
    };
    if (entry.id != null) {
      identities.set(`id:${entry.id}`, value);
      identities.set(String(entry.id), value);
    }
    if (entry.user?.email) {
      identities.set(`email:${String(entry.user.email).toLowerCase()}`, value);
    }
    if (entry.name) {
      identities.set(`name:${entry.name.toLowerCase()}`, value);
    }
  }

  // Members without a collision keep their natural initials.
  for (const entry of entries) {
    if ((groups.get(entry.base) || []).length === 1) {
      used.add(entry.base);
      assign(entry, entry.base);
    }
  }

  // Collisions: deterministic by user id, prefer extra letters from the first name.
  for (const [base, group] of groups) {
    if (group.length < 2) continue;
    group.sort((a, b) => Number(a.id) - Number(b.id));
    for (const entry of group) {
      const first = entry.parts[0] || '';
      const last = entry.parts[entry.parts.length - 1] || '';
      const candidates = [
        first.slice(0, 2),
        first.slice(0, 3),
        `${first[0] || ''}${last.slice(0, 2)}`,
        `${first.slice(0, 2)}${last[0] || ''}`,
        `${first[0] || ''}${last[0] || ''}2`,
      ]
        .map((candidate) => candidate.toUpperCase())
        .filter(Boolean);
      const unique = candidates.find((candidate) => !used.has(candidate)) || `${base}${group.indexOf(entry) + 1}`;
      used.add(unique);
      assign(entry, unique);
    }
  }

  return identities;
}

export function formatUserDisplayName(name?: string | null, email?: string | null): string {
  const raw = (name || email || '').trim();
  if (!raw) return 'User';
  if (raw.includes('@') || /^[a-z0-9]+([._-][a-z0-9]+)+$/i.test(raw)) {
    const localPart = raw.split('@')[0];
    const words = localPart.split(/[._-]+/).filter(Boolean);
    if (words.length > 0) {
      return words
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    }
  }
  return raw;
}

export function getInitials(name?: string | null, customInitials?: string | null): string {
  if (customInitials && customInitials.trim()) return customInitials.trim().toUpperCase();
  return baseInitials(name);
}

const sizeMap = {
  sm: 'h-6 w-6 text-[10px]',
  md: 'h-8 w-8 text-xs',
  lg: 'h-10 w-10 text-sm',
};

export function UserAvatar({
  userId,
  name,
  fullName,
  email,
  imageUrl,
  color,
  initials,
  size = 'md',
  className,
}: UserAvatarProps) {
  const { data: session } = useSession();
  const { members = [], currentUser } = useProjectData();

  const sessionUser = session?.user as
    | {
        id?: number | string;
        name?: string | null;
        displayName?: string | null;
        email?: string | null;
        image?: string | null;
        avatarColor?: string | null;
        avatarInitials?: string | null;
      }
    | undefined;

  const cleanName = (name || '').trim().toLowerCase();
  const cleanEmail = (email || '').trim().toLowerCase();

  // 1. Match against project/workspace members in context
  const matchedMember = members.find((m: any) => {
    const u = m?.user || m;
    if (!u) return false;
    if (userId != null && (Number(m.userId) === Number(userId) || Number(u.id) === Number(userId))) {
      return true;
    }
    if (cleanEmail && u.email && String(u.email).trim().toLowerCase() === cleanEmail) {
      return true;
    }
    if (imageUrl && u.avatarUrl && u.avatarUrl === imageUrl) {
      return true;
    }
    if (cleanName) {
      const uName = String(u.name || '').trim().toLowerCase();
      const uFull = String(u.fullName || '').trim().toLowerCase();
      const uDisp = String(u.displayName || '').trim().toLowerCase();
      if (cleanName === uName || cleanName === uFull || cleanName === uDisp) {
        return true;
      }
    }
    return false;
  });

  const memberUser = matchedMember?.user || matchedMember;

  // Unique monograms + deterministic default colours for the project roster.
  const avatarIdentities = useMemo(() => resolveAvatarIdentities(members as any[]), [members]);
  const memberIdentity =
    (userId != null &&
      (avatarIdentities.get(`id:${userId}`) || avatarIdentities.get(String(userId)))) ||
    (cleanEmail ? avatarIdentities.get(`email:${cleanEmail}`) : undefined) ||
    (cleanName ? avatarIdentities.get(`name:${cleanName}`) : undefined) ||
    null;

  // 2. Match against current authenticated session user
  const isCurrentSessionUser = Boolean(
    sessionUser &&
      ((userId != null && Number(sessionUser.id) === Number(userId)) ||
        (cleanEmail && sessionUser.email && sessionUser.email.trim().toLowerCase() === cleanEmail) ||
        (imageUrl && sessionUser.image && sessionUser.image === imageUrl) ||
        (cleanName &&
          (cleanName === (sessionUser.name || '').trim().toLowerCase() ||
            cleanName === (sessionUser.displayName || '').trim().toLowerCase() ||
            cleanName === (currentUser?.name || '').trim().toLowerCase())))
  );

  // Resolve custom initials first
  const resolvedCustomInitials =
    initials ||
    memberUser?.avatarInitials ||
    memberUser?.avatar_initials ||
    (isCurrentSessionUser ? sessionUser?.avatarInitials : null) ||
    null;

  // Prefer multi-word fullName (e.g. "Jeevan Kumar" -> "JK") over 1-word displayName ("Jeevan" -> "JE")
  const candidateNames = [
    fullName,
    memberUser?.fullName,
    isCurrentSessionUser ? sessionUser?.name : null,
    name,
    memberUser?.name,
    isCurrentSessionUser ? sessionUser?.displayName : null,
    email,
    memberUser?.email,
  ].filter((v): v is string => Boolean(v && v.trim()));

  const multiWordName = candidateNames.find((n) => {
    const local = n.trim().split('@')[0];
    return local.split(/[\s._-]+/).filter(Boolean).length >= 2;
  });
  const bestNameForInitials = multiWordName || candidateNames[0] || 'User';

  const displayInitials = getInitials(
    bestNameForInitials,
    resolvedCustomInitials || memberIdentity?.initials || null
  );

  const resolvedColor =
    color ||
    memberUser?.avatarColor ||
    memberUser?.avatar_color ||
    (isCurrentSessionUser ? sessionUser?.avatarColor : null) ||
    memberIdentity?.color ||
    getAvatarColor(userId ?? email ?? bestNameForInitials);

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center text-white font-semibold select-none shrink-0',
        sizeMap[size],
        className
      )}
      style={{ backgroundColor: resolvedColor }}
    >
      {displayInitials}
    </div>
  );
}

