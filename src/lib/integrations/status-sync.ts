import { prisma } from '@/lib/db';
import { NotificationService } from '@/lib/notifications/service';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';

export interface ProcessStatusUpdateParams {
  projectId: string;
  externalTicketId: string;
  ticketStatus: string;
  statusMapping?: Record<string, string>;
  actorType?: 'webhook' | 'user' | 'system';
  userId?: number;
}

export function formatTicketStatusName(rawStatus: string): string {
  if (!rawStatus) return 'To Do';
  const clean = String(rawStatus).trim();
  const lower = clean.toLowerCase();

  if (
    lower === 'approvedgolive' ||
    lower === 'approved_go_live' ||
    lower === 'approved-go-live' ||
    lower === 'approved/go-live' ||
    lower.includes('approved') ||
    lower.includes('golive')
  ) {
    return 'Approved/Go-live';
  }

  if (lower === 'to_do' || lower === 'todo') return 'To Do';
  if (lower === 'in_progress' || lower === 'inprogress') return 'In Progress';
  if (lower === 'in_qa' || lower === 'inqa') return 'In QA';
  if (lower === 'in_uat' || lower === 'inuat') return 'In UAT';
  if (lower === 'released') return 'Released';
  if (lower === 'done') return 'Done';
  if (lower === 'closed') return 'Closed';

  return clean;
}

export function mapExternalStatusToLocal(
  externalStatus: string,
  customMapping?: Record<string, string>
): string {
  if (!externalStatus) return 'OPEN';

  // Check custom mapping first (exact or case-insensitive)
  if (customMapping) {
    if (customMapping[externalStatus]) {
      return customMapping[externalStatus];
    }
    const lowerKey = Object.keys(customMapping).find(
      (k) => k.toLowerCase() === externalStatus.toLowerCase()
    );
    if (lowerKey && customMapping[lowerKey]) {
      return customMapping[lowerKey];
    }
  }

  const s = externalStatus.trim().toLowerCase();

  if (
    s.includes('done') ||
    s.includes('resolved') ||
    s.includes('closed') ||
    s.includes('fixed') ||
    s.includes('verified') ||
    s.includes('completed') ||
    s.includes('released') ||
    s.includes('approved') ||
    s.includes('go-live') ||
    s.includes('golive')
  ) {
    return 'RESOLVED';
  }

  if (
    s.includes('progress') ||
    s.includes('review') ||
    s.includes('testing') ||
    s.includes('investigating') ||
    s.includes('active') ||
    s.includes('qa') ||
    s.includes('uat')
  ) {
    return 'IN_PROGRESS';
  }

  if (
    s.includes('wont') ||
    s.includes("won't") ||
    s.includes('cant') ||
    s.includes('duplicate') ||
    s.includes('invalid') ||
    s.includes('cancel') ||
    s.includes('rejected')
  ) {
    return 'WONT_FIX';
  }

  return 'OPEN';
}

export async function processStatusUpdate(params: ProcessStatusUpdateParams) {
  const {
    projectId,
    externalTicketId,
    ticketStatus,
    statusMapping,
    actorType = 'webhook',
    userId,
  } = params;

  if (!projectId || !externalTicketId || !ticketStatus) {
    return { count: 0 };
  }

  const localStatus = mapExternalStatusToLocal(ticketStatus, statusMapping);
  const formattedTicketStatus = formatTicketStatusName(ticketStatus);

  // Find defects linked to this project via runResult -> run -> project_id
  const matchingDefects = await prisma.defect.findMany({
    where: {
      external_ticket_id: externalTicketId,
      run_result: {
        run: {
          project_id: projectId,
        },
      },
    },
    select: { id: true, title: true, ticket_status: true },
  });

  if (matchingDefects.length === 0) {
    // Also check if externalTicketId matches ticket_url ending
    const urlMatches = await prisma.defect.findMany({
      where: {
        ticket_url: { contains: externalTicketId },
        run_result: {
          run: {
            project_id: projectId,
          },
        },
      },
      select: { id: true, title: true, ticket_status: true },
    });

    if (urlMatches.length > 0) {
      const urlStatusChanged = urlMatches.some(
        (d) => (d.ticket_status || '').toLowerCase() !== formattedTicketStatus.toLowerCase()
      );

      if (!urlStatusChanged) {
        await prisma.defect.updateMany({
          where: { id: { in: urlMatches.map((d) => d.id) } },
          data: { last_synced_at: new Date() },
        });
        return { count: urlMatches.length, localStatus, changed: false };
      }

      await prisma.defect.updateMany({
        where: { id: { in: urlMatches.map((d) => d.id) } },
        data: {
          external_ticket_id: externalTicketId,
          ticket_status: formattedTicketStatus,
          local_status: localStatus,
          last_synced_at: new Date(),
        },
      });

      await prisma.activityLog.create({
        data: {
          project_id: projectId,
          user_id: userId || null,
          actor_type: actorType,
          action: `Synced external ticket #${externalTicketId} status to "${formattedTicketStatus}" (${localStatus})`,
          entity_type: 'defect',
          entity_id: urlMatches[0].id,
        },
      });

      NotificationService.notifyDefectStatusChanged({
        projectId,
        externalTicketId,
        newStatus: formattedTicketStatus,
        localStatus,
      }).catch((err) =>
        logger.error('Failed to notify defect status change', {
          module: 'StatusSync',
          action: 'processStatusUpdate',
          projectId,
          externalTicketId,
          errorCode: ErrorCodes.INTERNAL,
          error: err,
        })
      );

      return { count: urlMatches.length, localStatus, changed: true };
    }

    return { count: 0 };
  }

  const defectIds = matchingDefects.map((d) => d.id);
  const statusChanged = matchingDefects.some(
    (d) => (d.ticket_status || '').toLowerCase() !== formattedTicketStatus.toLowerCase()
  );

  if (!statusChanged) {
    // Prevent duplicate Slack notifications when status is already up to date
    await prisma.defect.updateMany({
      where: { id: { in: defectIds } },
      data: { last_synced_at: new Date() },
    });
    return {
      count: defectIds.length,
      localStatus,
      defectIds,
      changed: false,
    };
  }

  await prisma.defect.updateMany({
    where: { id: { in: defectIds } },
    data: {
      ticket_status: formattedTicketStatus,
      local_status: localStatus,
      last_synced_at: new Date(),
    },
  });

  await prisma.activityLog.create({
    data: {
      project_id: projectId,
      user_id: userId || null,
      actor_type: actorType,
      action: `External ticket #${externalTicketId} status updated to "${formattedTicketStatus}" (${localStatus})`,
      entity_type: 'defect',
      entity_id: defectIds[0],
    },
  });

  // Dispatch Slack notification ONLY when status actually changed
  NotificationService.notifyDefectStatusChanged({
    projectId,
    externalTicketId,
    newStatus: formattedTicketStatus,
    localStatus,
  }).catch((err) =>
    logger.error('Failed to notify defect status change', {
      module: 'StatusSync',
      action: 'processStatusUpdate',
      projectId,
      externalTicketId,
      errorCode: ErrorCodes.INTERNAL,
      error: err,
    })
  );

  return {
    count: defectIds.length,
    localStatus,
    defectIds,
    changed: true,
  };
}
