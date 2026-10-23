import { prisma } from '@/lib/db';
import { sendSlackWebhook, SlackPayload } from '@/lib/slack/send';
import { sendEmail } from '@/lib/email/send';
import { shouldSendEmail } from '@/lib/email/preferences';
import { runCompleteTemplate } from '@/lib/email/templates/runComplete';
import { reviewRequestTemplate } from '@/lib/email/templates/reviewRequest';
import { mentionTemplate } from '@/lib/email/templates/mention';
import { logger } from '@/lib/logger';
import { getBaseUrl } from '@/lib/config';
import { ErrorCodes } from '@/lib/errors';

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
   * 1. Test Case Assigned in a Test Run
   */
  async notifyCaseAssigned(params: {
    runResultId: string;
    targetUserId: number;
    assignerId: number;
  }) {
    try {
      const [runResult, assigner, assignee] = await Promise.all([
        prisma.runResult.findUnique({
          where: { id: params.runResultId },
          include: {
            test_case: {
              select: { id: true, display_id: true, title: true, priority: true },
            },
            run: {
              include: {
                project: {
                  select: { id: true, slug: true, name: true, notification_settings: true },
                },
              },
            },
          },
        }),
        prisma.user.findUnique({
          where: { id: params.assignerId },
          select: { id: true, name: true, email: true },
        }),
        prisma.user.findUnique({
          where: { id: params.targetUserId },
          select: { id: true, name: true, email: true, user_prefs: true },
        }),
      ]);

      if (!runResult || !assignee) return;

      const project = runResult.run.project;
      const testCase = runResult.test_case;
      const testRun = runResult.run;
      const assignerName = assigner?.name || 'A team lead';
      const assigneeName = assignee.name || 'Team Member';
      const caseKey = testCase.display_id || testCase.id;
      const actionUrl = `/p/${project.slug}/runs/${testRun.id}/${caseKey}`;
      const fullActionUrl = getAppUrl(actionUrl);

      logger.info('Dispatching CASE_ASSIGNED notification', {
        module: 'Notifications',
        action: 'notifyCaseAssigned',
        projectId: project.id,
        runId: testRun.id,
        testCaseId: testCase.id,
        targetUserId: assignee.id,
      });

      // A. In-App Notification (Always)
      await prisma.notification.create({
        data: {
          user_id: assignee.id,
          type: 'CASE_ASSIGNED',
          entity_type: 'TestRun',
          entity_id: testRun.id,
          action_url: actionUrl,
          metadata: {
            assignerName,
            testCaseKey: testCase.display_id,
            testCaseTitle: testCase.title,
            runName: testRun.name,
          },
        },
      });
      logger.debug('Created in-app notification for assigned case', {
        module: 'Notifications',
        action: 'notifyCaseAssigned',
        targetUserId: assignee.id,
        projectId: project.id,
      });

      // B. Slack Payload
      const priorityEmoji =
        testCase.priority === 'P0' ? '🔴' : testCase.priority === 'P1' ? '🟠' : testCase.priority === 'P2' ? '🟡' : '🔵';

      const slackPayload: SlackPayload = {
        text: `🎯 *Test Case Assigned:* [${testCase.display_id}] ${testCase.title} to *${assigneeName}* in *${testRun.name}*`,
        blocks: [
          {
            type: 'header',
            text: {
              type: 'plain_text',
              text: '🎯 Test Case Assigned in Run',
              emoji: true,
            },
          },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Hi ${assigneeName}*, you have been assigned a test case to execute in *${testRun.name}*.`,
            },
          },
          {
            type: 'section',
            fields: [
              {
                type: 'mrkdwn',
                text: `*Test Case:*\n\`${testCase.display_id}\` ${testCase.title}`,
              },
              {
                type: 'mrkdwn',
                text: `*Assigned By:*\n${assignerName}`,
              },
              {
                type: 'mrkdwn',
                text: `*Priority:*\n${priorityEmoji} ${testCase.priority}`,
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
                  text: 'Execute Test Case →',
                  emoji: true,
                },
                style: 'primary',
                url: fullActionUrl,
              },
            ],
          },
        ],
      };

      // Dispatch external notifications (Slack Channel, Slack DM, Email) concurrently
      const externalDispatches: Promise<any>[] = [];

      // 1. Send to Slack Channel (Hierarchical: Project -> Workspace -> .env)
      externalDispatches.push(
        (async () => {
          const targetSlackUrl = await resolveSlackWebhookUrl(project.id, (project as any).workspace_id);
          if (targetSlackUrl) {
            await sendSlackWebhook(targetSlackUrl, slackPayload, {
              projectId: project.id,
              eventType: 'CASE_ASSIGNED',
              recipientType: 'channel',
            });
          } else {
            logger.debug('Skipped Slack channel notification: no webhook URL configured', {
              module: 'Notifications',
              action: 'notifyCaseAssigned',
              projectId: project.id,
            });
          }
        })()
      );

      // 2. Send to User Slack DM if configured
      if (assignee.user_prefs?.slack_dm_webhook) {
        externalDispatches.push(
          sendSlackWebhook(assignee.user_prefs.slack_dm_webhook, slackPayload, {
            projectId: project.id,
            userId: String(assignee.id),
            eventType: 'CASE_ASSIGNED',
            recipientType: 'dm',
          })
        );
      }

      // C. Email Notification
      externalDispatches.push(
        (async () => {
          const shouldEmail = await shouldSendEmail(assignee.id, 'case_assigned').catch(() => true);
          if (shouldEmail && assignee.email) {
            const emailSubject = `[InkaTest] Test Case Assigned: [${testCase.display_id}] in ${testRun.name}`;
            const emailHtml = `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb;">
            <h2 style="color: #111827; margin-top: 0;">🎯 Test Case Assigned</h2>
            <p style="color: #374151; font-size: 15px;">Hello <strong>${assigneeName}</strong>,</p>
            <p style="color: #374151; font-size: 15px;"><strong>${assignerName}</strong> has assigned the following test case to you for execution in <strong>${testRun.name}</strong>:</p>
            <div style="background: #f9fafb; padding: 16px; border-radius: 8px; border-left: 4px solid #3b82f6; margin: 20px 0;">
              <p style="margin: 0 0 8px; font-weight: 600; color: #111827;">[${testCase.display_id}] ${testCase.title}</p>
              <p style="margin: 0; font-size: 13px; color: #6b7280;">Priority: ${testCase.priority} • Environment: ${testRun.environment || 'Default'}</p>
            </div>
            <a href="${fullActionUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 8px; font-weight: 600; text-decoration: none; margin: 12px 0;">Execute Test Case →</a>
            <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 12px;">InkaTest Test Management</p>
          </div>
        `;
            await sendEmail({
              to: [assignee.email],
              subject: emailSubject,
              htmlBody: emailHtml,
              textBody: `Hi ${assigneeName}, ${assignerName} assigned test case [${testCase.display_id}] ${testCase.title} to you in ${testRun.name}. Execute: ${fullActionUrl}`,
            });
          }
        })()
      );

      await Promise.allSettled(externalDispatches);
    } catch (err: any) {
      logger.error('Failed to dispatch case assignment notification', {
        module: 'Notifications',
        action: 'notifyCaseAssigned',
        error: err.message,
      });
    }
  },

  /**
   * 2. Defect / Bug Raised
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
