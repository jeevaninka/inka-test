'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotificationList } from './NotificationList';
import { apiClient } from '@/lib/apiClient';
import {
  markReadAction,
  markAllReadAction,
  clearAllAction,
} from '@/app/actions/notifications';
import type { Notification } from '@prisma/client';

// Module-level cache — survives client-side navigations within the same tab.
let cachedUnreadCount = -1; // -1 = not yet fetched this session

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(Math.max(0, cachedUnreadCount));
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  const fetchUnreadCount = useCallback(async () => {
    if (cachedUnreadCount >= 0) return;
    try {
      const data = await apiClient.get<{ unreadCount: number }>(
        '/api/v1/notifications',
        { countOnly: true },
        { ttl: 30000 }
      );
      if (data && typeof data.unreadCount === 'number') {
        cachedUnreadCount = data.unreadCount;
        setUnreadCount(data.unreadCount);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchUnreadCount();
  }, [fetchUnreadCount]);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<{ unreadCount: number; notifications: Notification[] }>(
        '/api/v1/notifications'
      );
      if (data) {
        setNotifications(data.notifications || []);
        cachedUnreadCount = data.unreadCount ?? 0;
        setUnreadCount(cachedUnreadCount);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpen = () => {
    if (!open) {
      setOpen(true);
      if (!fetchedRef.current) {
        fetchedRef.current = true;
        fetchNotifications();
      }
    } else {
      setOpen(false);
    }
  };

  const handleMarkRead = async (id: string) => {
    await markReadAction(id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((prev) => {
      const next = Math.max(0, prev - 1);
      cachedUnreadCount = next;
      return next;
    });
  };

  const handleMarkAllRead = async () => {
    await markAllReadAction();
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    cachedUnreadCount = 0;
    setUnreadCount(0);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleOpen}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-all duration-200"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-[380px] rounded-2xl glass border border-border/50 shadow-xl animate-scale-in overflow-hidden">
            <div className="px-4 py-3 border-b border-border/50">
              <h3 className="text-sm font-semibold">Notifications</h3>
            </div>
            <NotificationList
              notifications={notifications}
              loading={loading}
              onMarkRead={handleMarkRead}
              onMarkAllRead={handleMarkAllRead}
              onClose={() => setOpen(false)}
            />
          </div>
        </>
      )}
    </div>
  );
}
