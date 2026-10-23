import { SESv2Client, SESv2ClientConfig } from '@aws-sdk/client-sesv2';

export function getSesConfig(): SESv2ClientConfig {
  const config: SESv2ClientConfig = {
    region:
      process.env.SES_REGION?.trim() ||
      process.env.AWS_SES_REGION?.trim() ||
      process.env.S3_REGION?.trim() ||
      process.env.AWS_REGION?.trim() ||
      'ap-south-1',
  };

  if (
    process.env.AWS_ACCESS_KEY_ID?.trim() &&
    process.env.AWS_SECRET_ACCESS_KEY?.trim()
  ) {
    config.credentials = {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
    };
  }

  // Stage & Production without explicit keys use AWS IAM Role via AWS SDK v3 default credential chain
  return config;
}

const globalForSes = globalThis as unknown as {
  sesClient: SESv2Client | undefined;
};

export const sesClient = globalForSes.sesClient ?? new SESv2Client(getSesConfig());

if (process.env.NODE_ENV !== 'production') globalForSes.sesClient = sesClient;
