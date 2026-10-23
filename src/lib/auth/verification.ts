import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { getBaseUrl } from '@/lib/config';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export async function issueEmailVerification(user: {
  id: number;
  email: string;
  name?: string | null;
}): Promise<{ sent: boolean; error?: string }> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS);
  const verifyUrl = `${getBaseUrl()}/verify-email?token=${token}`;
  const displayName = user.name?.trim() || user.email.split('@')[0];

  await prisma.user.update({
    where: { id: user.id },
    data: {
      email_verification_token: token,
      email_verification_expires: expiresAt,
    },
  });

  try {
    const result = await sendEmail({
      to: [user.email],
      subject: 'Verify your InkaTest email address',
      htmlBody: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827;">
          <h2 style="margin:0 0 12px;">Verify your email</h2>
          <p style="font-size:15px;line-height:1.6;">Hi ${displayName}, confirm your email address to finish setting up your InkaTest account.</p>
          <p style="margin:24px 0;">
            <a href="${verifyUrl}" style="display:inline-block;background:#14b8a6;color:#042f2e;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none;">Verify email</a>
          </p>
          <p style="font-size:12px;color:#6b7280;">This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>
        </div>
      `,
      textBody: `Hi ${displayName}, verify your InkaTest email address: ${verifyUrl}`,
    });

    if (!result.success) {
      return { sent: false, error: result.error || 'Could not send verification email' };
    }
    return { sent: true };
  } catch (error: any) {
    logger.error('Failed to send email verification', {
      module: 'Auth',
      action: 'issueEmailVerification',
      userId: user.id,
      errorCode: ErrorCodes.EMAIL_SEND,
      error,
    });
    return { sent: false, error: error?.message || 'Could not send verification email' };
  }
}
