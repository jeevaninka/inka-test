export function getAvatarInitials(name: string | null | undefined, email: string | null | undefined): string {
  if (name) {
    const parts = name.trim().split(' ').filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
  }
  
  if (email) {
    return email.split('@')[0].slice(0, 2).toUpperCase();
  }
  
  return 'IQ';
}

export function getAvatarColor(seed: string): string {
  const colors = [
    '#6366f1', // indigo
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#f43f5e', // rose
    '#ef4444', // red
    '#f97316', // orange
    '#eab308', // yellow
    '#22c55e', // green
    '#14b8a6', // teal
    '#06b6d4', // cyan
    '#3b82f6', // blue
    '#a855f7', // purple
  ];
  
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}

export function checkInitialsCollision(
  initials: string,
  currentUserId: string,
  members: Array<{ userId: string; user: { name: string | null; email: string } }>
): boolean {
  return members.some(
    (m) =>
      m.userId !== currentUserId &&
      getAvatarInitials(m.user.name, m.user.email) === initials
  );
}