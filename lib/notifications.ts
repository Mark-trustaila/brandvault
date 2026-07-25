/**
 * Notifications — one row per alert Bree actually sends, so the same events
 * surface in the in-app Bree panel (Phase 4b, "see in app"). Written at send
 * time by the alert job / status-change / digest. The Deadline.alert_*_sent
 * flags remain the dedupe mechanism; this table is a delivery record, not a
 * dedupe gate.
 */
import type { NotificationChannel, NotificationType } from '@prisma/client';
import { prisma } from './db';
import { APP_BASE_URL } from './slack';

/** Deep link that opens the dashboard with the Bree panel on this item. */
export const notificationLink = (id: string) => `${APP_BASE_URL}/?notification=${id}`;

export async function createNotification(input: {
  companyId: string;
  trademarkId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  channel?: NotificationChannel; // defaults to slack (the only live channel)
}): Promise<{ id: string; link: string }> {
  const n = await prisma.notification.create({
    data: {
      companyId: input.companyId,
      trademarkId: input.trademarkId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      channel: input.channel ?? 'slack',
    },
    select: { id: true },
  });
  return { id: n.id, link: notificationLink(n.id) };
}

/** Deep link to the side-by-side comparison for a third-party filing notice. */
export const watchNoticeLink = (id: string) => `${APP_BASE_URL}/watch/${id}`;
