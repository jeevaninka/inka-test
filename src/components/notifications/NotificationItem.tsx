'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { Notification } from '@prisma/client';
import {
  AtSign,
  FileCheck,
  Play,
  UserPlus,
  CheckCircle,
  XCircle,
  UserCheck,
  AlertCircle,
  RotateCcw,
  RefreshCw,
  Target,
  Bug,
  MessageSquare,
} from 'lucide-react';
import { UserAvatar } from '@/components/common/UserAvatar';

const typeConfig: Record<string, { icon: React.ReactNode; label: string }> = {
  CASE_ASSIGNED: { icon: <Target className="h-4 w-4 text-blue-500" />, label: 'assigned a test case to you' },
  DEFECT_RAISED: { icon: <Bug className="h-4 w-4 text-red-500" />, label: 'logged a defect' },
  DEFECT_STATUS_CHANGED: { icon: <RefreshCw className="h-4 w-4 text-emerald-500" />, label: 'defect status updated' },
  ASSIGNED_COMMENT: { icon: <MessageSquare className="h-4 w-4 text-amber-500" />, label: 'assigned a comment to you' },
  MENTION: { icon: <AtSign className="h-4 w-4 text-violet-500" />, label: 'mentioned you in a comment' },
  REVIEW_REQUEST: { icon: <FileCheck className="h-4 w-4 text-blue-500" />, label: 'requested a review from you' },
  REVIEW_APPROVED: { icon: <CheckCircle className="h-4 w-4 text-green-500" />, label: 'approved your review request' },
  REVIEW_CHANGES_REQUESTED: { icon: <AlertCircle className="h-4 w-4 text-amber-500" />, label: 'requested changes on your test case' },
  REVIEW_CANCELLED: { icon: <RotateCcw className="h-4 w-4 text-muted-foreground" />, label: 'cancelled a review request' },
  REVIEW_RESUBMITTED: { icon: <RefreshCw className="h-4 w-4 text-indigo-500" />, label: 'resubmitted a test case for review' },
  REVIEW_UPDATED: { icon: <RefreshCw className="h-4 w-4 text-blue-500" />, label: 'updated a test case in review' },
  RUN_COMPLETE: { icon: <Play className="h-4 w-4 text-primary" />, label: 'test run completed' },
  JOIN_REQUEST: { icon: <UserPlus className="h-4 w-4" />, label: 'wants to join the workspace' },
  JOIN_REJECTED: { icon: <XCircle className="h-4 w-4 text-red-500" />, label: 'rejected your workspace request' },
  ADDED_TO_PROJECT: { icon: <UserCheck className="h-4 w-4 text-teal-500" />, label: 'added you to a project' },
};

function getTypeConfig(type: string) {
  return typeConfig[type] || { icon: <FileCheck className="h-4 w-4" />, label: type.toLowerCase().replace(/_/g, ' ') };
}

function timeAgo(date: Date): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(date).toLocaleDateString();
}

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: (id: string) => void;
}

export function NotificationItem({ notification, onMarkRead }: NotificationItemProps) {
  const router = useRouter();
  const config = getTypeConfig(notification.type);

  let displayLabel: React.ReactNode = config.label;
  let actorName: string | null = null;
  let actorImage: string | null = null;

  const handleLinkClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!notification.read) {
      onMarkRead(notification.id);
    }
  };

  const renderEntityLink = (label: string, url?: string | null) => {
    if (!url) return <span className="font-semibold text-foreground">{label}</span>;
    return (
      <Link href={url} onClick={handleLinkClick} className="font-semibold text-foreground hover:underline">
        {label}
      </Link>
    );
  };

  if (notification.type === 'JOIN_REQUEST' && notification.action_url) {
    try {
      const url = new URL(notification.action_url, 'http://localhost');
      const requester = url.searchParams.get('requester');
      if (requester) {
        displayLabel = <><span className="font-semibold text-foreground">{requester}</span> wants to join the workspace.</>;
      }
    } catch (e) {}
  } else if (notification.metadata && typeof notification.metadata === 'object') {
    const meta = notification.metadata as any;
    
    if (notification.type === 'CASE_ASSIGNED' && meta.assignerName && meta.testCaseKey) {
      actorName = meta.assignerName;
      actorImage = meta.assignerImage;
      displayLabel = (
        <>
          <span className="font-semibold text-foreground">{actorName}</span> assigned {renderEntityLink(meta.testCaseKey, notification.action_url)} to you in {meta.runName || 'a test run'}.
        </>
      );
    } else if (notification.type === 'DEFECT_RAISED' && meta.bugKey) {
      actorName = meta.reporterName || 'Someone';
      actorImage = meta.reporterImage;
      displayLabel = (
        <>
          <span className="font-semibold text-foreground">{actorName}</span> raised defect {renderEntityLink(meta.bugKey, notification.action_url)}: "{meta.title || ''}".
        </>
      );
    } else if (notification.type === 'DEFECT_STATUS_CHANGED' && meta.bugKey) {
      actorName = meta.updaterName;
      actorImage = meta.updaterImage;
      const actorPrefix = actorName ? <><span className="font-semibold text-foreground">{actorName}</span> updated </> : 'Defect ';
      displayLabel = (
        <>
          {actorPrefix}{renderEntityLink(meta.bugKey, notification.action_url)} status to <span className="font-semibold">{meta.newStatus}</span>.
        </>
      );
    } else if (notification.type === 'REVIEW_REQUEST' && meta.requesterName && meta.testCaseKey) {
      actorName = meta.requesterName;
      actorImage = meta.requesterImage;
      const tcLabel = meta.testCaseName ? `${meta.testCaseKey} - ${meta.testCaseName}` : meta.testCaseKey;
      displayLabel = (
        <>
          <span className="font-semibold text-foreground">{actorName}</span> requested a review from you for {renderEntityLink(tcLabel, notification.action_url)}.
        </>
      );
    } else if (notification.type === 'REVIEW_APPROVED' && meta.testCaseKey) {
      actorName = meta.approverName || 'Someone';
      actorImage = meta.approverImage;
      const tcLabel = meta.testCaseName ? `${meta.testCaseKey} - ${meta.testCaseName}` : meta.testCaseKey;
      displayLabel = (
        <>
          <span className="font-semibold text-foreground">{actorName}</span> approved your review request for {renderEntityLink(tcLabel, notification.action_url)}.
        </>
      );
    } else if (notification.type === 'REVIEW_CHANGES_REQUESTED' && meta.testCaseKey) {
      actorName = meta.reviewerName || 'Someone';
      actorImage = meta.reviewerImage;
      const tcLabel = meta.testCaseName ? `${meta.testCaseKey} - ${meta.testCaseName}` : meta.testCaseKey;
      displayLabel = (
        <>
          <span className="font-semibold text-foreground">{actorName}</span> requested changes on {renderEntityLink(tcLabel, notification.action_url)}.
        </>
      );
    } else if (notification.type === 'REVIEW_RESUBMITTED' && meta.requesterName && meta.testCaseKey) {
      actorName = meta.requesterName;
      actorImage = meta.requesterImage;
      const tcLabel = meta.testCaseName ? `${meta.testCaseKey} - ${meta.testCaseName}` : meta.testCaseKey;
      displayLabel = (
        <>
          <span className="font-semibold text-foreground">{actorName}</span> resubmitted {renderEntityLink(tcLabel, notification.action_url)} for review.
        </>
      );
    } else if (notification.type === 'REVIEW_UPDATED' && meta.requesterName && meta.testCaseKey) {
      actorName = meta.requesterName;
      actorImage = meta.requesterImage;
      const tcLabel = meta.testCaseName ? `${meta.testCaseKey} - ${meta.testCaseName}` : meta.testCaseKey;
      displayLabel = (
        <>
          <span className="font-semibold text-foreground">{actorName}</span> updated {renderEntityLink(tcLabel, notification.action_url)} in review.
        </>
      );
    } else if (notification.type === 'RUN_COMPLETE' && meta.runName) {
      displayLabel = (
        <>
          Test run {renderEntityLink(meta.runName, notification.action_url)} completed — {meta.passRate ?? 100}% pass rate.
        </>
      );
    }
  }

  const handleRowClick = () => {
    if (!notification.read) {
      onMarkRead(notification.id);
    }
    if (notification.action_url) {
      router.push(notification.action_url);
    }
  };

  return (
    <div
      onClick={handleRowClick}
      className={cn(
        'relative flex items-start gap-3 w-full px-4 py-3 text-left transition-colors hover:bg-muted/50 cursor-pointer',
        !notification.read && 'bg-muted/20'
      )}
    >
      {!notification.read && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-primary" />
      )}
      
      {actorName ? (
        <div className="mt-0.5 shrink-0">
          <UserAvatar
            name={actorName}
            imageUrl={actorImage}
            size="md"
          />
        </div>
      ) : (
        <div className={cn(
          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          !notification.read ? 'bg-primary/10 text-primary' : 'bg-muted/30 text-muted-foreground'
        )}>
          {config.icon}
        </div>
      )}
      
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-sm leading-snug',
          !notification.read ? 'font-medium text-foreground/90' : 'text-muted-foreground'
        )}>
          {displayLabel}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {timeAgo(notification.created_at)}
        </p>
      </div>
    </div>
  );
}
