import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import nodemailer, { type Transporter } from 'nodemailer';
import { sesClient, getSesConfig } from '@/lib/email/ses-client';
import {
  isLocalSmtp,
  getEmailProvider,
  getFromEmail,
  sendEmail,
} from '@/lib/email/send';

describe('Email Comms (Local SMTP & AWS SES)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.EMAIL_PROVIDER;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.MAIL_FROM;
    delete process.env.SES_FROM_EMAIL;
    delete process.env.AWS_SES_FROM_EMAIL;
    delete process.env.SES_REGION;
    delete process.env.AWS_SES_REGION;
    delete process.env.S3_REGION;
    delete process.env.AWS_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Provider & From Address Resolution', () => {
    it('selects smtp when SMTP_HOST is configured', () => {
      process.env.SMTP_HOST = 'smtp.resend.com';
      process.env.MAIL_FROM = 'onboarding@resend.dev';

      expect(isLocalSmtp()).toBe(true);
      expect(getEmailProvider()).toBe('smtp');
      expect(getFromEmail()).toBe('onboarding@resend.dev');
    });

    it('selects ses when SMTP_HOST is empty and EMAIL_PROVIDER is unset', () => {
      process.env.AWS_SES_FROM_EMAIL = 'no-reply@inka.qa';

      expect(isLocalSmtp()).toBe(false);
      expect(getEmailProvider()).toBe('ses');
      expect(getFromEmail()).toBe('no-reply@inka.qa');
    });

    it('respects explicit EMAIL_PROVIDER=ses even if SMTP_HOST is present', () => {
      process.env.EMAIL_PROVIDER = 'ses';
      process.env.SMTP_HOST = 'smtp.resend.com';
      process.env.AWS_SES_FROM_EMAIL = 'alerts@inka.qa';

      expect(isLocalSmtp()).toBe(false);
      expect(getEmailProvider()).toBe('ses');
      expect(getFromEmail()).toBe('alerts@inka.qa');
    });

    it('builds SES config without explicit credentials when using IAM roles', () => {
      process.env.AWS_SES_REGION = 'ap-south-1';
      const config = getSesConfig();

      expect(config.region).toBe('ap-south-1');
      expect(config.credentials).toBeUndefined();
    });

    it('builds SES config with explicit credentials when provided', () => {
      process.env.AWS_REGION = 'ap-south-1';
      process.env.AWS_ACCESS_KEY_ID = 'AKIA_TEST';
      process.env.AWS_SECRET_ACCESS_KEY = 'SECRET_TEST';
      const config = getSesConfig();

      expect(config.region).toBe('ap-south-1');
      expect(config.credentials).toEqual({
        accessKeyId: 'AKIA_TEST',
        secretAccessKey: 'SECRET_TEST',
      });
    });
  });

  describe('sendEmail dispatch', () => {
    it('dispatches via SMTP when local SMTP is configured', async () => {
      process.env.SMTP_HOST = 'smtp.resend.com';
      process.env.SMTP_PORT = '587';
      process.env.SMTP_SECURE = 'false';
      process.env.SMTP_USER = 'resend';
      process.env.SMTP_PASS = 're_test_key';
      process.env.MAIL_FROM = 'onboarding@resend.dev';

      const sendMailMock = vi.fn().mockResolvedValue({ messageId: 'smtp-msg-123' });
      vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
        sendMail: sendMailMock,
      } as unknown as Transporter);

      const res = await sendEmail({
        to: ['qa@example.com'],
        subject: 'Welcome to InkaTest',
        htmlBody: '<p>Hello</p>',
        textBody: 'Hello',
      });

      expect(res).toEqual({ success: true, messageId: 'smtp-msg-123' });
      expect(sendMailMock).toHaveBeenCalledWith({
        from: 'onboarding@resend.dev',
        to: 'qa@example.com',
        subject: 'Welcome to InkaTest',
        html: '<p>Hello</p>',
        text: 'Hello',
      });
    });

    it('dispatches via AWS SES when SES provider is active', async () => {
      process.env.EMAIL_PROVIDER = 'ses';
      process.env.AWS_SES_FROM_EMAIL = 'noreply@inka.qa';

      const sesSendSpy = vi
        .spyOn(sesClient, 'send')
        .mockResolvedValue({ MessageId: 'ses-msg-456' } as unknown as never);

      const res = await sendEmail({
        to: ['lead@example.com'],
        subject: 'Test Run Complete',
        htmlBody: '<h1>Passed</h1>',
        textBody: 'Passed',
      });

      expect(res).toEqual({ success: true, messageId: 'ses-msg-456' });
      expect(sesSendSpy).toHaveBeenCalledTimes(1);
    });

    it('returns an error when sender email is not configured', async () => {
      process.env.EMAIL_PROVIDER = 'ses';

      const res = await sendEmail({
        to: ['user@example.com'],
        subject: 'Test',
        htmlBody: '<p>Test</p>',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('AWS_SES_FROM_EMAIL');
    });

    it('returns an error when recipient list is empty', async () => {
      process.env.SMTP_HOST = 'smtp.resend.com';
      process.env.MAIL_FROM = 'onboarding@resend.dev';

      const res = await sendEmail({
        to: [''],
        subject: 'Test',
        htmlBody: '<p>Test</p>',
      });

      expect(res.success).toBe(false);
      expect(res.error).toContain('No valid recipient');
    });
  });
});
