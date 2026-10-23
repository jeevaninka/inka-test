import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { 
  PutObjectCommand, 
  GetObjectCommand, 
  DeleteObjectCommand 
} from '@aws-sdk/client-s3';
import { s3Client, getBucketName } from './client';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function generateUploadUrl(
  bucketOrKey: string,
  keyOrContentType: string,
  contentTypeOrFileSize?: string | number,
  fileSizeParam?: number
): Promise<string> {
  let bucket: string;
  let key: string;
  let contentType: string;
  let fileSize: number;

  // Support both (key, contentType, fileSize) and (bucket, key, contentType, fileSize)
  if (typeof contentTypeOrFileSize === 'number') {
    bucket = getBucketName();
    key = bucketOrKey;
    contentType = keyOrContentType;
    fileSize = contentTypeOrFileSize;
  } else if (fileSizeParam !== undefined) {
    bucket = bucketOrKey || getBucketName();
    key = keyOrContentType;
    contentType = contentTypeOrFileSize as string;
    fileSize = fileSizeParam;
  } else {
    bucket = getBucketName();
    key = bucketOrKey;
    contentType = keyOrContentType;
    fileSize = 0;
  }

  if (!bucket) {
    throw new Error('S3 bucket name is not configured');
  }

  if (fileSize > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds 10MB limit (${fileSize} bytes)`);
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3Client, command, { expiresIn: 900 }); // 15 min
}

export async function generateDownloadUrl(
  bucketOrKey: string,
  keyParam?: string
): Promise<string> {
  const bucket = keyParam ? bucketOrKey : getBucketName();
  const key = keyParam || bucketOrKey;

  if (!bucket) {
    throw new Error('S3 bucket name is not configured');
  }

  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
}

export async function uploadToS3(
  key: string,
  body: Buffer | Uint8Array | Blob | string,
  contentType: string,
  bucketParam?: string
): Promise<{ key: string; bucket: string }> {
  const bucket = bucketParam || getBucketName();
  if (!bucket) {
    throw new Error('S3 bucket name is not configured');
  }

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  await s3Client.send(command);
  return { key, bucket };
}

export async function generateDeleteUrl(
  bucketOrKey: string,
  keyParam?: string
): Promise<string> {
  const bucket = keyParam ? bucketOrKey : getBucketName();
  const key = keyParam || bucketOrKey;

  if (!bucket) {
    throw new Error('S3 bucket name is not configured');
  }

  const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: 900 });
}
