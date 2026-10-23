import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';

export function isLocalS3(): boolean {
  return Boolean(process.env.S3_ENDPOINT_LOCAL);
}

export function getBucketName(): string {
  if (isLocalS3()) {
    return process.env.S3_BUCKET_NAME_LOCAL || '';
  }
  return process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET || process.env.S3_BUCKET_NAME_LOCAL || '';
}

export function getS3Config(): S3ClientConfig {
  if (isLocalS3()) {
    const config: S3ClientConfig = {
      endpoint: process.env.S3_ENDPOINT_LOCAL,
      region: process.env.S3_REGION_LOCAL || 'us-east-1',
      forcePathStyle: true,
    };

    if (process.env.S3_ACCESS_KEY_ID_LOCAL && process.env.S3_ACCESS_KEY_LOCAL) {
      config.credentials = {
        accessKeyId: process.env.S3_ACCESS_KEY_ID_LOCAL,
        secretAccessKey: process.env.S3_ACCESS_KEY_LOCAL,
      };
    }

    return config;
  }

  // Production: Use AWS IAM Role (handled automatically by AWS SDK v3 default credential chain)
  return {
    region: process.env.S3_REGION || process.env.AWS_REGION || 'ap-south-1',
  };
}

const globalForS3 = globalThis as unknown as {
  s3Client: S3Client | undefined;
};

export const s3Client = globalForS3.s3Client ?? new S3Client(getS3Config());

if (process.env.NODE_ENV !== 'production') globalForS3.s3Client = s3Client;
