import { prisma } from '@/lib/db';
import { sendSlackWebhook, SlackPayload } from '@/lib/slack/send';
import { sendEmail } from '@/lib/email/send';
import { shouldSendEmail } from '@/lib/email/preferences';
import { runCompleteTemplate } from '@/lib/email/templates/runComplete';
import { reviewRequestTemplate } from '@/lib/email/templates/reviewRequest';
import { mentionTemplate } from '@/lib/email/templates/mention';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/config';

function getAppUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${getBaseUrl()}${cleanPath}`;
}

async function resolveSlackWebhookUrl(projectId: string, workspaceId?: string | null): Promise<string | null> {
  // 1. Check Project-level custom Slack webhook
  const projectSettings = await prisma.notificationSettings.findUnique({
    where: { project_id: projectId },
    select: { slack_webhook_url: true },
  });
  if (projectSettings?.slack_webhook_url && projectSettings.slack_webhook_url.trim()) {
    return projectSettings.slack_webhook_url.trim();
  }

  // 2. Check Workspace-level default Slack webhook
  let wsId = workspaceId;
  if (!wsId) {
    const proj = await prisma.project.findUnique({
      where: { id: projectId },
      select: { workspace_id: true },
    });
    wsId = proj?.workspace_id;
  }

  if (wsId) {
    const workspaceSettings = await prisma.notificationSettings.findUnique({
      where: { workspace_id: wsId },
      select: { slack_webhook_url: true },
    });
    if (workspaceSettings?.slack_webhook_url && workspaceSettings.slack_webhook_url.trim()) {
      return workspaceSettings.slack_webhook_url.trim();
    }
  }

  // 3. Fallback to process.env.SLACK_WEBHOOK_URL
  if (process.env.SLACK_WEBHOOK_URL && process.env.SLACK_WEBHOOK_URL.trim()) {
    return process.env.SLACK_WEBHOOK_URL.trim();
  }

  return null;
}

export const NotificationService = {
  /**
   * 1. Defect / Bug Raised
   */
  async notifyDefectRaised(params: { defectId: string }) {
    try {
      const defect = await prisma.defect.findUnique({
        where: { id: params.defectId },
        include: {
          run_result: {
            include: {
              test_case: true,
              run: {
                include: {
                  project: {
                    include: { notification_settings: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!defect) return;

      const reporter = await prisma.user.findUnique({
        where: { id: defect.raised_by },
        select: { id: true, name: true, email: true },
      });

      const project = defect.run_result.run.project;
      const testRun = defect.run_result.run;
      const testCase = defect.run_result.test_case;
      const reporterName = reporter?.name || 'A tester';
      const caseKey = testCase.display_id || testCase.id;
      const inkaUrl = getAppUrl(`/p/${project.slug}/runs/${testRun.id}/${caseKey}`);
      const bugIdentifier = defect.external_ticket_id || defect.id;

      logger.info('Dispatching DEFECT_RAISED notification', {
        module: 'Notifications',
        action: 'notifyDefectRaised',
        projectId: project.id,
        defectId: defect.id,
        externalTicketId: bugIdentifier,
      });

      const slackPayload: SlackPayload = {
        text: `🐛 *New Defect Logged:* ${bugIdentifier} "${defect.title}" by *${reporterName}*`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `🐛 Bug Logged: ${bugIdentifier}`,
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${defect.title}*\nReported by *${reporterName}* in test run *${testRun.name}*.`,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Severity:*\n🔴 ${defect.severity}`,
              },
              {
                type: 'mrkdwn',
                text: `*Test Case:*\n\`${testCase.display_id}\``,
              },
              {
                type: 'mrkdwn',
                text: `*Status:*\n${defect.ticket_status || 'OPEN'}`,
              },
              {
                type: 'mrkdwn',
                text: `*Environment:*\n${testRun.environment || 'Default'}`,
              },
            ],
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'View in InkaTest →',
                  emoji: true,
                },
                style: 'danger',
                url: inkaUrl,
              },
              ...(defect.ticket_url
                ? [
                    {
                      type: 'button',
                      text: {
                        type: 'plain_text',
                        text: `View in PM Tool (${bugIdentifier}) ↗`,
                        emoji: true,
                      },
                      url: defect.ticket_url,
                    },
                  ]
                : []),
            ],
          },
        ],
      };

      const targetSlackUrl = await resolveSlackWebhookUrl(project.id, (project as any).workspace_id);
      if (targetSlackUrl) {
        await sendSlackWebhook(targetSlackUrl, slackPayload, {
          projectId: project.id,
          eventType: 'DEFECT_RAISED',
          recipientType: 'channel',
        });
      }
    } catch (err: any) {
      logger.error('Failed to dispatch defect raised notification', {
        module: 'Notifications',
        action: 'notifyDefectRaised',
        error: err.message,
      });
    }
  },

  /**
   * 3. Defect Status Changed via Webhook
   */
  async notifyDefectStatusChanged(params: {
    projectId: string;
    externalTicketId: string;
    newStatus: string;
    localStatus: string;
  }) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: params.projectId },
        include: { notification_settings: true },
      });

      if (!project) return;

      const isResolved = ['RESOLVED', 'CLOSED'].includes(params.localStatus);
      const icon = isResolved ? '✅' : '🔄';

      const slackPayload: SlackPayload = {
        text: `${icon} *Defect Status Updated:* ${params.externalTicketId} transitioned to *${params.newStatus}*`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${icon} *External Ticket Status Updated: \`${params.externalTicketId}\`*\nStatus is now *${params.newStatus}* (Mapped: \`${params.localStatus}\`).`,
            },
          },
        ],
      };

      const targetSlackUrl = await resolveSlackWebhookUrl(project.id, (project as any).workspace_id);
      if (targetSlackUrl) {
        await sendSlackWebhook(targetSlackUrl, slackPayload, {
          projectId: project.id,
          eventType: 'DEFECT_STATUS_CHANGED',
          recipientType: 'channel',
        });
      }
    } catch (err: any) {
      logger.error('Failed to dispatch defect status changed notification', {
        module: 'Notifications',
        action: 'notifyDefectStatusChanged',
        error: err.message,
      });
    }
  },

  /**
   * 4. Test Run Completed
   */
  async notifyRunCompleted(runId: string) {
    try {
      const run = await prisma.testRun.findUnique({
        where: { id: runId },
        include: {
          project: {
            include: { notification_settings: true },
          },
          results: true,
        },
      });

      if (!run) return;

      // Deduplicate results to only consider the latest attempt per test case
      const sortedResults = [...run.results].sort((a, b) => (b.attempt_number || 1) - (a.attempt_number || 1));
      const seen = new Set<string>();
      const latestResults = sortedResults.filter((r) => {
        if (seen.has(r.test_case_id)) return false;
        seen.add(r.test_case_id);
        return true;
      });

      const totalCases = latestResults.length;
      const passedCases = latestResults.filter((r) => r.status === 'PASS').length;
      const failedCases = latestResults.filter((r) => r.status === 'FAIL').length;
      const blockedCases = latestResults.filter((r) => r.status === 'BLOCKED').length;
      const invalidCases = latestResults.filter((r) => r.status === 'INVALID').length;
      const skippedCases = latestResults.filter((r) => r.status === 'SKIP').length;
      const passRate = totalCases > 0 ? Math.round((passedCases / totalCases) * 100) : 0;
      const statusText = failedCases > 0 ? 'FAILED' : passRate >= 90 ? 'PASSED' : 'COMPLETED';
      const reportUrl = getAppUrl(`/p/${run.project.slug}/runs/${run.id}/report`);
      const pdfUrl = getAppUrl(`/p/${run.project.slug}/runs/${run.id}/report?print=true`);

      // Calculate real run duration
      const startDate = run.started_at || run.created_at;
      const endDate = run.completed_at || new Date();
      const diffSeconds = Math.max(1, Math.floor((new Date(endDate).getTime() - new Date(startDate).getTime()) / 1000));
      const formatRunDuration = (secs: number) => {
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        const remSecs = secs % 60;
        if (hrs > 0) return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
        if (mins > 0) return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
        return `${remSecs}s`;
      };
      const durationStr = formatRunDuration(diffSeconds);

      // Fetch all Project Members (explicit ProjectMember + WorkspaceMember with access)
      const [projMembers, wsMembers] = await Promise.all([
        prisma.projectMember.findMany({
          where: { project_id: run.project.id },
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
        prisma.workspaceMember.findMany({
          where: { workspace_id: (run.project as any).workspace_id },
          include: { user: { select: { id: true, name: true, email: true } } },
        }),
      ]);

      const recipientUsersMap = new Map<number, { id: number; name: string | null; email: string }>();
      for (const pm of projMembers) {
        if (pm.user?.email) recipientUsersMap.set(pm.user.id, pm.user);
      }
      for (const wm of wsMembers) {
        if (wm.user?.email && !recipientUsersMap.has(wm.user.id)) {
          recipientUsersMap.set(wm.user.id, wm.user);
        }
      }

      // Ensure run creator is always included
      if (!recipientUsersMap.has(run.created_by)) {
        const creator = await prisma.user.findUnique({
          where: { id: run.created_by },
          select: { id: true, name: true, email: true },
        });
        if (creator?.email) recipientUsersMap.set(creator.id, creator);
      }

      const recipientUsers = Array.from(recipientUsersMap.values());

      // A. In-App Notifications to all Project Members
      if (recipientUsers.length > 0) {
        await prisma.notification.createMany({
          data: recipientUsers.map((u) => ({
            user_id: u.id,
            type: 'RUN_COMPLETE',
            entity_type: 'TestRun',
            entity_id: run.id,
            action_url: `/p/${run.project.slug}/runs/${run.id}/report`,
            metadata: {
              runName: run.name,
              passRate,
              totalCases,
              passedCases,
              failedCases,
              invalidCases,
            },
          })),
        });
      }

      // Build stats breakdown for Slack
      const statsSummaryParts = [
        `*Total Tests:* ${totalCases}`,
        `*Passed:* ✅ ${passedCases}`,
        `*Failed:* ❌ ${failedCases}`,
      ];
      if (blockedCases > 0) statsSummaryParts.push(`*Blocked:* ⚠️ ${blockedCases}`);
      if (invalidCases > 0) statsSummaryParts.push(`*Invalid:* 🟣 ${invalidCases}`);
      if (skippedCases > 0) statsSummaryParts.push(`*Skipped:* ⚪ ${skippedCases}`);

      // B. Slack Channel Notification
      const slackPayload: SlackPayload = {
        text: `🏁 *Test Run Completed:* ${run.name} - *${statusText}* (${passRate}% Pass Rate)`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: `🏁 Test Run Completed: ${run.name}`,
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Status:* *${statusText}* (${passRate}% Pass Rate)\n${statsSummaryParts.join(' | ')}`,
            },
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'View Full Report →',
                  emoji: true,
                },
                style: passRate >= 90 && failedCases === 0 ? 'primary' : 'danger',
                url: reportUrl,
              },
            ],
          },
        ],
      };

      const targetSlackUrl = await resolveSlackWebhookUrl(run.project.id, (run.project as any).workspace_id);
      if (targetSlackUrl) {
        await sendSlackWebhook(targetSlackUrl, slackPayload, {
          projectId: run.project.id,
          eventType: 'RUN_COMPLETED',
          recipientType: 'channel',
        });
      }

      // C. Email to All Project Members (if enabled on project)
      if ((run.project as any).email_run_complete_enabled !== false) {
        const eligibleEmails: string[] = [];
        for (const u of recipientUsers) {
          const allowed = await shouldSendEmail(u.id, 'run_complete').catch(() => true);
          if (allowed && u.email) {
            eligibleEmails.push(u.email.trim().toLowerCase());
          }
        }

        const uniqueEmails = Array.from(new Set(eligibleEmails));
        if (uniqueEmails.length > 0) {
          const emailStatus: 'PASS' | 'FAIL' | 'PARTIAL' =
            failedCases > 0 ? 'FAIL' : passRate >= 90 ? 'PASS' : 'PARTIAL';
          const template = runCompleteTemplate(
            run.name,
            emailStatus,
            passRate,
            totalCases,
            durationStr,
            reportUrl,
            failedCases,
            run.project.name,
            {
              pdfUrl,
              passed: passedCases,
              failed: failedCases,
              blocked: blockedCases,
              skipped: skippedCases,
              invalid: invalidCases,
            }
          );
          await Promise.allSettled(
            uniqueEmails.map((emailAddr) =>
              sendEmail({
                to: [emailAddr],
                subject: template.subject,
                htmlBody: template.html,
                textBody: template.text,
              })
            )
          );
        }
      }
    } catch (err: any) {
      logger.error('Failed to dispatch run completed notification', {
        module: 'Notifications',
        action: 'notifyRunCompleted',
        error: err.message,
      });
    }
  },
};
