import { prisma } from '@/lib/db';

export async function shouldSendEmail(
  userId: number,
  eventType: 'mention' | 'review_request' | 'run_complete' | 'invite' | 'case_assigned'
): Promise<boolean> {
  if (eventType === 'invite' || eventType === 'case_assigned') return true; // Default true

  const prefs = await prisma.userNotificationPrefs.findUnique({
    where: { user_id: userId },
  });

  if (!prefs) return true; // Default to sending

  switch (eventType) {
    case 'mention':
      return prefs.email_mentions;
    case 'review_request':
      return prefs.email_review_requests;
    case 'run_complete':
      return prefs.email_run_complete;
    default:
      return true;
  }
}