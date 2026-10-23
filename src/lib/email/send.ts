import { SendEmailCommand } from '@aws-sdk/client-sesv2';
import nodemailer, { Transporter } from 'nodemailer';
import { sesClient } from './ses-client';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';

export type EmailProvider = 'smtp' | 'ses';

export function isLocalSmtp(): boolean {
  const explicitProvider = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  if (explicitProvider === 'smtp') return true;
  if (explicitProvider === 'ses') return false;
  return Boolean(process.env.SMTP_HOST?.trim());
}

export function getEmailProvider(): EmailProvider {
  return isLocalSmtp() ? 'smtp' : 'ses';
}

export function getFromEmail(): string {
  if (isLocalSmtp()) {
    return (
      process.env.MAIL_FROM?.trim() ||
      process.env.SES_FROM_EMAIL?.trim() ||
      process.env.AWS_SES_FROM_EMAIL?.trim() ||
      ''
    );
  }
  return (
    process.env.SES_FROM_EMAIL?.trim() ||
    process.env.AWS_SES_FROM_EMAIL?.trim() ||
    process.env.MAIL_FROM?.trim() ||
    ''
  );
}

let cachedSmtpTransporter: Transporter | null = null;
let cachedSmtpKey = '';

export function getSmtpTransporter(): Transporter {
  const host = process.env.SMTP_HOST?.trim() || '';
  const port = Number(process.env.SMTP_PORT) || 587;
  const secure =
    process.env.SMTP_SECURE?.trim().toLowerCase() === 'true' || port === 465;
  const user = process.env.SMTP_USER?.trim() || '';
  const pass = process.env.SMTP_PASS?.trim() || '';

  const configKey = `${host}:${port}:${secure}:${user}:${pass}`;
  if (cachedSmtpTransporter && cachedSmtpKey === configKey) {
    return cachedSmtpTransporter;
  }

  cachedSmtpTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });
  cachedSmtpKey = configKey;

  return cachedSmtpTransporter;
}

export async function sendEmail(options: {
  to: string[];
  subject: string;
  htmlBody: string;
  textBody?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const provider = getEmailProvider();
  const recipients = (options.to || [])
    .map((addr) => addr?.trim())
    .filter((addr): addr is string => Boolean(addr));

  if (recipients.length === 0) {
    logger.warn('Email skipped: no valid recipient addresses', {
      module: 'Email',
      action: 'send',
      provider,
      subject: options.subject,
    });
    return { success: false, error: 'No valid recipient email address provided' };
  }

  const fromEmail = getFromEmail();
  if (!fromEmail) {
    const missingVar = provider === 'smtp' ? 'MAIL_FROM' : 'AWS_SES_FROM_EMAIL';
    logger.error(`Email send failed: ${missingVar} is not configured`, {
      module: 'Email',
      action: 'send',
      provider,
      to: recipients,
      subject: options.subject,
      errorCode: ErrorCodes.EMAIL_SEND,
      error: `Sender email (${missingVar}) is not configured`,
    });
    return {
      success: false,
      error: `Sender email (${missingVar}) is not configured`,
    };
  }

  try {
    if (provider === 'smtp') {
      const host = process.env.SMTP_HOST?.trim();
      if (!host) {
        throw new Error('SMTP_HOST is not configured');
      }

      const transporter = getSmtpTransporter();
      const info = await transporter.sendMail({
        from: fromEmail,
        to: recipients.join(', '),
        subject: options.subject,
        html: options.htmlBody,
        text: options.textBody || options.htmlBody,
      });

      logger.info('Email sent via SMTP', {
        module: 'Email',
        action: 'send',
        provider: 'smtp',
        to: recipients,
        subject: options.subject,
        messageId: info.messageId,
      });

      return { success: true, messageId: info.messageId };
    }

    const command = new SendEmailCommand({
      FromEmailAddress: fromEmail,
      Destination: { ToAddresses: recipients },
      Content: {
        Simple: {
          Subject: { Data: options.subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: options.htmlBody, Charset: 'UTF-8' },
            Text: {
              Data: options.textBody || options.htmlBody,
              Charset: 'UTF-8',
            },
          },
        },
      },
    });

    const response = await sesClient.send(command);

    logger.info('Email sent via AWS SES', {
      module: 'Email',
      action: 'send',
      provider: 'ses',
      to: recipients,
      subject: options.subject,
      messageId: response.MessageId,
    });

    return { success: true, messageId: response.MessageId };
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string };
    const errorMessage = err?.message || 'Unknown email send error';
    logger.error('Email send failed', {
      module: 'Email',
      action: 'send',
      provider,
      to: recipients,
      subject: options.subject,
      errorCode: ErrorCodes.EMAIL_SEND,
      error: e,
      providerCode: err?.code,
    });

    return { success: false, error: errorMessage };
  }
}