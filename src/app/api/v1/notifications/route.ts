import { NextResponse } from 'next/server';
import { createApiHandler } from '@/lib/apiHandler';
import { prisma } from '@/lib/db';

export const GET = createApiHandler(async (req, { userId }) => {
  const { searchParams } = new URL(req.url);
  const countOnly = searchParams.get('countOnly') === 'true';

  const unreadCount = await prisma.notification.count({
    where: { user_id: userId, read: false, type: { not: 'JOIN_APPROVED' } },
  });

  if (countOnly) {
    return NextResponse.json({ unreadCount });
  }

  const notifications = await prisma.notification.findMany({
    where: { user_id: userId, type: { not: 'JOIN_APPROVED' } },
    orderBy: { created_at: 'desc' },
    take: 50,
  });

  return NextResponse.json({
    unreadCount,
    notifications,
  });
});
