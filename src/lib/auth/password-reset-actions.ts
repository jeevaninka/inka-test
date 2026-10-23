'use server';

import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';
import { consumePasswordResetToken, issuePasswordReset } from '@/lib/auth/password-reset';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_COOLDOWN_MS = 60 * 1000;

const globalForReset = globalThis as unknown as {
  passwordResetCooldown?: Map<string, number>;
};
const resetCooldown = globalForReset.passwordResetCooldown ?? new Map<string, number>();
globalForReset.passwordResetCooldown = resetCooldown;

function validatePassword(password: string): string | null {
  if (password.length < 10) return 'Password must be at least 10 characters long.';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
  return null;
}

/**
 * Requests a reset link. The response is intentionally identical whether or
 * not the email belongs to an account (no account enumeration).
 */
export async function requestPasswordResetAction(
  rawEmail: string
): Promise<{ success: boolean; error?: string }> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { success: false, error: 'Enter a valid email address.' };
  }

  const now = Date.now();
  if (resetCooldown.size > 500) {
    for (const [key, sentAt] of resetCooldown) {
      if (now - sentAt >= RESET_COOLDOWN_MS) resetCooldown.delete(key);
    }
  }
  const lastSent = resetCooldown.get(email);
  if (lastSent && now - lastSent < RESET_COOLDOWN_MS) {
    return {
      success: false,
      error: 'A reset link was just sent. Please wait a minute before trying again.',
    };
  }
  resetCooldown.set(email, now);

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, password_hash: true },
    });

    // Google-only accounts have no password to reset. The response stays
    // generic so we never reveal which emails exist.
    if (user?.password_hash) {
      await issuePasswordReset(user);
    }
  } catch (error: any) {
    logger.error('Password reset request failed', {
      module: 'Auth',
      action: 'requestPasswordReset',
      errorCode: ErrorCodes.UNAUTHORIZED,
      error,
    });
  }

  return { success: true };
}

/**
 * Sets a new password using a single-use reset token.
 */
export async function resetPasswordAction(input: {
  token: string;
  password: string;
  confirmPassword: string;
}): Promise<{ success: boolean; error?: string }> {
  const { token, password, confirmPassword } = input;

  if (!token) {
    return { success: false, error: 'Missing reset token. Please request a new link.' };
  }
  if (password !== confirmPassword) {
    return { success: false, error: 'Passwords do not match.' };
  }

  const passwordError = validatePassword(password);
  if (passwordError) return { success: false, error: passwordError };

  try {
    const userId = await consumePasswordResetToken(token);
    if (!userId) {
      return {
        success: false,
        error: 'This reset link is invalid or has expired. Please request a new one.',
      };
    }

    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: await bcrypt.hash(password, 12) },
    });

    return { success: true };
  } catch (error: any) {
    logger.error('Password reset failed', {
      module: 'Auth',
      action: 'resetPassword',
      errorCode: ErrorCodes.UNAUTHORIZED,
      error,
    });
    return { success: false, error: 'Could not reset your password. Please try again.' };
  }
}
