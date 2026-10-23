import crypto from 'crypto';
import { prisma } from '@/lib/db';
import { sendEmail } from '@/lib/email/send';
import { getBaseUrl } from '@/lib/config';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';

export const PASSWORD_RESET_TTL_MS = 24 * 60 * 60 * 1000;

/** Reset tokens are stored hashed so a database leak cannot be replayed. */
function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Creates (or refreshes) a single-use password reset token and emails the link.
 * Returns `sent: false` when the account cannot receive email (no password
 * account / delivery failure) — callers must not reveal that to the client.
 */
export async function issuePasswordReset(user: {
  id: number;
  email: string;
  name?: string | null;
}): Promise<{ sent: boolean; error?: string }> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
  const resetUrl = `${getBaseUrl()}/reset-password?token=${token}`;
  const displayName = user.name?.trim() || user.email.split('@')[0];

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password_reset_token: hashResetToken(token),
      password_reset_expires: expiresAt,
    },
  });

  try {
    const result = await sendEmail({
      to: [user.email],
      subject: 'Reset your InkaTest password',
      htmlBody: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827;">
          <h2 style="margin:0 0 12px;">Reset your password</h2>
          <p style="font-size:15px;line-height:1.6;">Hi ${displayName}, we received a request to reset the password for your InkaTest account.</p>
          <p style="margin:24px 0;">
            <a href="${resetUrl}" style="display:inline-block;background:#14b8a6;color:#042f2e;padding:12px 20px;border-radius:10px;font-weight:600;text-decoration:none;">Choose a new password</a>
          </p>
          <p style="font-size:12px;color:#6b7280;">This link expires in 24 hours and can only be used once. If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
      textBody: `Hi ${displayName}, reset your InkaTest password: ${resetUrl} (expires in 24 hours)`,
    });

    if (!result.success) {
      return { sent: false, error: result.error || 'Could not send reset email' };
    }
    return { sent: true };
  } catch (error: any) {
    logger.error('Failed to send password reset email', {
      module: 'Auth',
      action: 'issuePasswordReset',
      userId: user.id,
      errorCode: ErrorCodes.EMAIL_SEND,
      error,
    });
    return { sent: false, error: error?.message || 'Could not send reset email' };
  }
}

export type ResetTokenState = 'VALID' | 'INVALID' | 'EXPIRED';

export async function getPasswordResetTokenState(
  token: string | null | undefined
): Promise<{ state: ResetTokenState; email?: string }> {
  if (!token || token.trim().length === 0) return { state: 'INVALID' };

  const user = await prisma.user.findUnique({
    where: { password_reset_token: hashResetToken(token) },
    select: { email: true, password_reset_expires: true },
  });

  if (!user) return { state: 'INVALID' };
  if (!user.password_reset_expires || user.password_reset_expires.getTime() < Date.now()) {
    return { state: 'EXPIRED', email: user.email };
  }
  return { state: 'VALID', email: user.email };
}

/**
 * Atomically verifies and consumes a reset token. Returns the user id when the
 * token was valid, otherwise null. The token is cleared in the same statement
 * so it can never be replayed.
 */
export async function consumePasswordResetToken(token: string): Promise<number | null> {
  if (!token) return null;

  const hashedToken = hashResetToken(token);

  const user = await prisma.user.findUnique({
    where: { password_reset_token: hashedToken },
    select: { id: true, password_reset_expires: true },
  });

  if (!user) return null;
  if (!user.password_reset_expires || user.password_reset_expires.getTime() < Date.now()) {
    return null;
  }

  const updated = await prisma.user.updateMany({
    where: { id: user.id, password_reset_token: hashedToken },
    data: { password_reset_token: null, password_reset_expires: null },
  });

  return updated.count === 1 ? user.id : null;
}
