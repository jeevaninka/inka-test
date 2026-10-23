'use client';

import { NotificationItem } from './NotificationItem';
import type { Notification } from '@prisma/client';
import { Bell, Loader2 } from 'lucide-react';

interface NotificationListProps {
  notifications: Notification[];
  loading: boolean;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClose?: () => void;
}

export function NotificationList({
  notifications,
  loading,
  onMarkRead,
  onMarkAllRead,
  onClose,
}: NotificationListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/30">
          <Bell className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">No notifications yet</p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Notifications from your team will appear here.
        </p>
      </div>
    );
  }

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="flex flex-col min-h-0">
      {unreadCount > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-border/50 shrink-0">
          <p className="text-xs text-muted-foreground">
            {unreadCount} unread
          </p>
          <button
            onClick={onMarkAllRead}
            className="text-xs font-medium text-primary hover:text-primary/80 transition-colors cursor-pointer"
          >
            Mark all as read
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain max-h-[min(60vh,420px)] divide-y divide-border/30">
        {notifications.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onMarkRead={onMarkRead}
          />
        ))}
      </div>
    </div>
  );
}
