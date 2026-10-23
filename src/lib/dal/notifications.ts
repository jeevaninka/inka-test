import { NotificationService } from '@/lib/notifications/service';

export async function notifyRunCompletion(runId: string) {
  await NotificationService.notifyRunCompleted(runId);
}
