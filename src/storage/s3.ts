import { createHash } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** S3 rejects a non-final part smaller than this. The last part may be shorter. */
export const MIN_PART_BYTES = 5 * 1024 * 1024;

/** Hard cap from the S3 multipart API. */
export const MAX_PARTS = 10_000;

/**
 * A file that fits in one minimum part stays a single PUT. Multipart needs a
 * non-final part of at least MIN_PART_BYTES, so the threshold is that size.
 */
export function multipartThreshold(): number {
  return MIN_PART_BYTES;
}

/** part >= file / 10_000, and at least the S3 minimum, so Complete never sees EntityTooSmall. */
export function partSizeFor(bytes: number): number {
  const byCount = Math.ceil(bytes / MAX_PARTS);
  return Math.max(MIN_PART_BYTES, byCount);
}

export function partCount(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / partSizeFor(bytes)));
}

export type StorageConfig = {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  expiresIn: number;
};

export function storageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig | null {
  const accessKeyId = env.STORAGE_ACCESS_KEY;
  const secretAccessKey = env.STORAGE_SECRET_KEY;
  const bucket = env.STORAGE_BUCKET;
  if (!accessKeyId || !secretAccessKey || !bucket) return null;
  const expiresRaw = Number(env.PRESIGN_EXPIRES_SECONDS ?? '300');
  return {
    endpoint: env.STORAGE_ENDPOINT || undefined,
    region: env.STORAGE_REGION || 'us-east-1',
    accessKeyId,
    secretAccessKey,
    bucket,
    expiresIn: Number.isFinite(expiresRaw) && expiresRaw > 0 ? expiresRaw : 300,
  };
}

export function createStorageClient(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // Presign happens before the body exists. The default checksum would sign
    // the CRC of empty bytes and the real PUT would be rejected.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export function httpStatus(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('$metadata' in err)) return undefined;
  const meta = (err as { $metadata?: { httpStatusCode?: number } }).$metadata;
  return meta?.httpStatusCode;
}

let bucketReady: Promise<void> | null = null;

export function ensureBucket(client: S3Client, bucket: string): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw err;
      }
      try {
        await client.send(
          new PutBucketLifecycleConfigurationCommand({
            Bucket: bucket,
            LifecycleConfiguration: {
              Rules: [
                {
                  ID: 'abort-incomplete-multipart',
                  Status: 'Enabled',
                  Filter: { Prefix: '' },
                  AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
                },
              ],
            },
          }),
        );
      } catch {
        // The rule is hygiene. A store that rejects lifecycle still serves the demos.
      }
    })().catch((err: unknown) => {
      bucketReady = null;
      throw err;
    });
  }
  return bucketReady;
}

export async function presignPut(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
  expiresIn: number,
): Promise<string> {
  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
    { expiresIn },
  );
}

export async function presignPart(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
  partNumber: number,
  expiresIn: number,
): Promise<string> {
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    }),
    { expiresIn },
  );
}

export async function startMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
): Promise<string> {
  const created = await client.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
  );
  if (!created.UploadId) throw new Error('multipart upload did not return an id');
  return created.UploadId;
}

export async function listPartNumbers(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<number[]> {
  const numbers: number[] = [];
  let marker: string | undefined;
  do {
    const page = await client.send(
      new ListPartsCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: marker,
      }),
    );
    for (const part of page.Parts ?? []) {
      if (part.PartNumber !== undefined) numbers.push(part.PartNumber);
    }
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);
  return numbers;
}

export async function completeMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<void> {
  const parts: { ETag: string; PartNumber: number }[] = [];
  let marker: string | undefined;
  do {
    const page = await client.send(
      new ListPartsCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumberMarker: marker,
      }),
    );
    for (const part of page.Parts ?? []) {
      if (part.ETag && part.PartNumber !== undefined) {
        parts.push({ ETag: part.ETag, PartNumber: part.PartNumber });
      }
    }
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);
  parts.sort((a, b) => a.PartNumber - b.PartNumber);
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    }),
  );
}

export async function headObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<{ size: number; etag: string } | null> {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { size: Number(head.ContentLength ?? -1), etag: head.ETag ?? '' };
  } catch (err) {
    const status = httpStatus(err);
    const name = err instanceof Error ? err.name : '';
    if (status === 404 || name === 'NotFound' || name === 'NoSuchKey') return null;
    throw err;
  }
}

export async function abortMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<void> {
  try {
    await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
  } catch (err) {
    const status = httpStatus(err);
    const name = err instanceof Error ? err.name : '';
    if (status === 404 || name === 'NoSuchUpload') return;
    throw err;
  }
}

export async function deleteObject(client: S3Client, bucket: string, key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function resetPrefix(client: S3Client, bucket: string, prefix: string): Promise<void> {
  let keyMarker: string | undefined;
  let uploadMarker: string | undefined;
  do {
    const page = await client.send(
      new ListMultipartUploadsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        UploadIdMarker: uploadMarker,
      }),
    );
    for (const upload of page.Uploads ?? []) {
      if (upload.Key && upload.UploadId) await abortMultipart(client, bucket, upload.Key, upload.UploadId);
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    uploadMarker = page.IsTruncated ? page.NextUploadIdMarker : undefined;
  } while (keyMarker);

  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      if (object.Key) await deleteObject(client, bucket, object.Key);
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
}

export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Public asset name carries a content hash, so a new deploy is a new URL. */
export async function putVersionedAsset(
  client: S3Client,
  bucket: string,
  body: string,
): Promise<{ key: string }> {
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8);
  const key = `assets/app.${hash}.css`;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'text/css',
      CacheControl: IMMUTABLE_CACHE_CONTROL,
    }),
  );
  return { key };
}

export async function readObject(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<{ body: Buffer; cacheControl: string }> {
  const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = object.Body ? Buffer.from(await object.Body.transformToByteArray()) : Buffer.alloc(0);
  return { body: bytes, cacheControl: object.CacheControl ?? '' };
}

export function objectUrl(endpoint: string, bucket: string, key: string): string {
  const base = endpoint.replace(/\/$/, '');
  const encoded = key.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `${base}/${bucket}/${encoded}`;
}
