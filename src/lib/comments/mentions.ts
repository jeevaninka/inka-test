import { prisma } from '@/lib/db';

export function extractMentions(text: string): string[] {
  // Match @username pattern (alphanumeric, underscore, hyphen)
  const regex = /@([a-zA-Z0-9_-]+)/g;
  const matches = text.match(regex);
  return matches?.map(m => m.slice(1)) || []; // Remove @ prefix
}

export function formatMentions(text: string): string {
  // Convert @username to highlighted format for display
  return text.replace(/@([a-zA-Z0-9_-]+)/g, '<span class="mention-highlight">@$1</span>');
}

export async function findMentionedUserIds(
  projectId: string,
  usernames: string[]
): Promise<number[]> {
  if (usernames.length === 0) return [];

  // Get all project members
  const members = await prisma.projectMember.findMany({
    where: { project_id: projectId },
    include: { user: true },
  });

  const mentionedIds: number[] = [];
  
  for (const username of usernames) {
    const matchedUser = members.find(m => 
      m.user.name?.toLowerCase() === username.toLowerCase() ||
      m.user.email.split('@')[0].toLowerCase() === username.toLowerCase()
    );
    
    if (matchedUser) {
      mentionedIds.push(matchedUser.user.id);
    }
  }

  return mentionedIds;
}