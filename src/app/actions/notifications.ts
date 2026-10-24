'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { revalidatePath } from 'next/cache';
import {
  requireProjectAdmin,
  requireProjectMember,
  requireWorkspaceAdmin,
  resolveWorkspaceId,
} from '@/lib/permissions';
import { logger } from '@/lib/logger';

export async function getNotificationsAction(unreadOnly = false) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  return prisma.notification.findMany({
    where: {
      user_id: userId,
      type: { not: 'JOIN_APPROVED' },
      ...(unreadOnly ? { read: false } : {}),
    },
    orderBy: { created_at: 'desc' },
    take: 50,
  });
}

export async function getUnreadCountAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return 0;
  const userId = (session.user as any).id as number;

  return prisma.notification.count({
    where: { user_id: userId, read: false, type: { not: 'JOIN_APPROVED' } },
  });
}

export async function markReadAction(id: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  await prisma.notification.updateMany({
    where: { id, user_id: userId },
    data: { read: true },
  });

  revalidatePath('/');
}

export async function markAllReadAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  await prisma.notification.updateMany({
    where: { user_id: userId, read: false },
    data: { read: true },
  });

  revalidatePath('/');
}

export async function clearAllAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  await prisma.notification.deleteMany({
    where: { user_id: userId },
  });

  revalidatePath('/');
}

export async function getNotificationPrefsAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  let prefs = await prisma.userNotificationPrefs.findUnique({
    where: { user_id: userId },
  });

  if (!prefs) {
    prefs = await prisma.userNotificationPrefs.create({
      data: { user_id: userId },
    });
  }

  return prefs;
}

import { sendSlackWebhook } from '@/lib/slack/send';

export async function getUserNotificationPrefsAction() {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  let prefs = await prisma.userNotificationPrefs.findUnique({
    where: { user_id: userId },
  });

  if (!prefs) {
    prefs = await prisma.userNotificationPrefs.create({
      data: { user_id: userId },
    });
  }

  return prefs;
}

export async function updateNotificationPrefsAction(data: {
  email_mentions?: boolean;
  email_review_requests?: boolean;
  email_run_complete?: boolean;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  await prisma.userNotificationPrefs.upsert({
    where: { user_id: userId },
    create: { user_id: userId, ...data },
    update: data,
  });

  revalidatePath('/profile');
}

export async function testProjectSlackWebhookAction(webhookUrl: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  if (!webhookUrl || !webhookUrl.trim()) {
    throw new Error('Please enter a valid Slack webhook URL');
  }

  const result = await sendSlackWebhook(
    webhookUrl.trim(),
    {
      text: `🔔 *InkaTest Project Slack Channel Connected!* This channel will receive automated test run, defect, and assignment notifications. 🚀`,
    },
    {
      recipientType: 'channel',
      eventType: 'PROJECT_SLACK_TEST',
    }
  );

  if (!result.success) {
    throw new Error(result.error || 'Slack webhook request failed. Please check the URL.');
  }

  return { success: true };
}

export async function getProjectNotificationSettingsAction(projectIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  const actualProjectId = await requireProjectMember(projectIdOrSlug, userId);

  let settings = await prisma.notificationSettings.findUnique({
    where: { project_id: actualProjectId },
  });

  if (!settings) {
    settings = await prisma.notificationSettings.create({
      data: { project_id: actualProjectId },
    });
  }

  return settings;
}

export async function updateProjectNotificationSettingsAction(
  projectIdOrSlug: string,
  data: {
    email_enabled?: boolean;
    slack_webhook_url?: string | null;
    slack_channel_tier?: string;
    slack_dm_tier?: string;
    in_app_tier?: string;
    email_tier?: string;
    cross_post_to_workspace?: boolean;
    custom_events_matrix?: any;
  }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');

  const userId = (session.user as any).id as number;
  const actualProjectId = await requireProjectAdmin(projectIdOrSlug, userId);

  const updated = await prisma.notificationSettings.upsert({
    where: { project_id: actualProjectId },
    create: { project_id: actualProjectId, ...data },
    update: data,
  });

  logger.info('Project notification settings updated', {
    module: 'Notifications',
    action: 'updateProjectNotificationSettingsAction',
    projectId: actualProjectId,
    userId,
  });

  revalidatePath('/p');
  return updated;
}

export async function getWorkspaceNotificationSettingsAction(workspaceIdOrSlug: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  const actualWsId = await resolveWorkspaceId(workspaceIdOrSlug);
  const wm = await prisma.workspaceMember.findFirst({
    where: { workspace_id: actualWsId, user_id: userId },
  });
  if (!wm) throw new Error('Forbidden: not a workspace member');

  let settings = await prisma.notificationSettings.findUnique({
    where: { workspace_id: actualWsId },
  });

  if (!settings) {
    settings = await prisma.notificationSettings.create({
      data: { workspace_id: actualWsId },
    });
  }

  return settings;
}

export async function updateWorkspaceNotificationSettingsAction(
  workspaceIdOrSlug: string,
  data: {
    slack_webhook_url?: string | null;
    slack_channel_tier?: string;
    email_enabled?: boolean;
  }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;

  const actualWsId = await requireWorkspaceAdmin(workspaceIdOrSlug, userId);

  const updated = await prisma.notificationSettings.upsert({
    where: { workspace_id: actualWsId },
    create: { workspace_id: actualWsId, ...data },
    update: data,
  });

  const firstProject = await prisma.project.findFirst({
    where: { workspace_id: actualWsId },
    select: { id: true },
  });

  if (firstProject) {
    await prisma.activityLog.create({
      data: {
        project_id: firstProject.id,
        user_id: userId,
        actor_type: 'user',
        entity_type: 'integration',
        entity_id: 'slack_settings',
        action: data.slack_webhook_url
          ? 'Configured workspace Slack notifications webhook'
          : 'Updated workspace Slack notifications settings',
      },
    }).catch(() => null);
  }

  revalidatePath('/workspace');
  return updated;
}
