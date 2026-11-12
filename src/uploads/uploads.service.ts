import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import {
  completeMultipart,
  createStorageClient,
  deleteObject,
  ensureBucket,
  headObject,
  listPartNumbers,
  multipartThreshold,
  partCount,
  partSizeFor,
  presignPart,
  presignPut,
  startMultipart,
  abortMultipart,
  StorageConfig,
  storageConfig,
} from '../storage/s3';
import { AccessClaims } from '../auth/tokens';
import { TypeormService } from '../typeorm/typeorm.service';
import { CreateUploadIntentDto } from './dto/create-upload-intent.dto';

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/octet-stream': 'bin',
};

const DAY_MS = 24 * 60 * 60 * 1000;

type FileRow = {
  id: string;
  owner_id: string;
  object_key: string;
  status: string;
  size_bytes: string;
  content_type: string;
  upload_id: string | null;
  idempotency_key: string | null;
};

export type IntentView = {
  id: number;
  key: string;
  status: 'pending';
  expires_in: number;
  url: string | null;
  upload_id: string | null;
  part_size: number | null;
  parts: { part_number: number; url: string }[] | null;
};

function rowsOf<T>(raw: unknown): T[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw[0] as T[];
  return raw as T[];
}

@Injectable()
export class UploadsService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly typeorm: TypeormService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (!storageConfig(process.env)) return;
    this.timer = setInterval(() => {
      this.sweepStale().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`upload sweep failed: ${message}`);
      });
    }, DAY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async intent(user: AccessClaims, dto: CreateUploadIntentDto, idempotencyKey?: string): Promise<IntentView> {
    const ext = EXTENSIONS[dto.content_type];
    if (!ext) {
      throw new BadRequestException({
        code: 'content-type',
        detail: 'content_type is not in the allowlist',
      });
    }
    const storage = this.storage();
    const keyHeader = idempotencyKey?.trim() || null;
    if (keyHeader) {
      const existing = rowsOf<FileRow>(
        await this.typeorm.ds.query(
          `SELECT id, owner_id, object_key, status, size_bytes, content_type, upload_id, idempotency_key
           FROM files
           WHERE owner_id = $1 AND idempotency_key = $2`,
          [user.id, keyHeader],
        ),
      )[0];
      if (existing) {
        if (existing.status !== 'pending' || Number(existing.size_bytes) !== dto.size_bytes) {
          throw new ConflictException({
            code: 'idempotency-key-reuse',
            detail: 'This Idempotency-Key was already used',
          });
        }
        return this.sign(storage, existing);
      }
    }

    const key = `uploads/${user.id}/${randomUUID()}.${ext}`;
    const multipart = dto.size_bytes > multipartThreshold();
    const client = createStorageClient(storage);
    await ensureBucket(client, storage.bucket);
    let uploadId: string | null = null;
    if (multipart) {
      uploadId = await startMultipart(client, storage.bucket, key, dto.content_type);
    }
    const inserted = rowsOf<{ id: string }>(
      await this.typeorm.ds.query(
        `INSERT INTO files (owner_id, object_key, status, size_bytes, content_type, upload_id, idempotency_key)
         VALUES ($1, $2, 'pending', $3, $4, $5, $6)
         RETURNING id`,
        [user.id, key, dto.size_bytes, dto.content_type, uploadId, keyHeader],
      ),
    );
    console.log(`upload intent id=${inserted[0].id} key=${key}`);
    return this.sign(storage, {
      id: inserted[0].id,
      owner_id: user.id,
      object_key: key,
      status: 'pending',
      size_bytes: String(dto.size_bytes),
      content_type: dto.content_type,
      upload_id: uploadId,
      idempotency_key: keyHeader,
    });
  }

  async resume(user: AccessClaims, id: number): Promise<{ id: number; parts: { part_number: number; url: string }[] }> {
    const row = await this.owned(user, id);
    if (!row.upload_id) {
      throw new ConflictException({
        code: 'not-multipart',
        detail: 'this upload is a single PUT',
      });
    }
    const storage = this.storage();
    const client = createStorageClient(storage);
    const present = new Set(
      await listPartNumbers(client, storage.bucket, row.object_key, row.upload_id),
    );
    const total = partCount(Number(row.size_bytes));
    const missing: { part_number: number; url: string }[] = [];
    for (let part = 1; part <= total; part += 1) {
      if (present.has(part)) continue;
      missing.push({
        part_number: part,
        url: await presignPart(client, storage.bucket, row.object_key, row.upload_id, part, storage.expiresIn),
      });
    }
    return { id: Number(row.id), parts: missing };
  }

  async commit(user: AccessClaims, id: number): Promise<{ id: number; key: string; status: 'completed'; size: number }> {
    const row = await this.owned(user, id);
    if (row.status === 'completed') {
      return {
        id: Number(row.id),
        key: row.object_key,
        status: 'completed',
        size: Number(row.size_bytes),
      };
    }
    const storage = this.storage();
    const client = createStorageClient(storage);
    if (row.upload_id) {
      try {
        await completeMultipart(client, storage.bucket, row.object_key, row.upload_id);
      } catch (err) {
        throw new ConflictException({
          code: 'multipart-incomplete',
          detail: err instanceof Error ? err.name : 'multipart complete failed',
        });
      }
    }
    const head = await headObject(client, storage.bucket, row.object_key);
    if (!head) {
      throw new ConflictException({
        code: 'object-missing',
        detail: 'the object is not in the store',
      });
    }
    const expected = Number(row.size_bytes);
    if (head.size !== expected) {
      throw new ConflictException({
        code: 'size-mismatch',
        detail: `store has ${head.size} bytes, intent declared ${expected}`,
      });
    }
    await this.typeorm.ds.query(`UPDATE files SET status = 'completed' WHERE id = $1`, [row.id]);
    console.log(`upload commit id=${row.id} key=${row.object_key}`);
    return { id: Number(row.id), key: row.object_key, status: 'completed', size: head.size };
  }

  async sweepStale(): Promise<void> {
    const storage = storageConfig(process.env);
    if (!storage) return;
    const stale = rowsOf<FileRow>(
      await this.typeorm.ds.query(
        `SELECT id, owner_id, object_key, status, size_bytes, content_type, upload_id, idempotency_key
         FROM files
         WHERE status = 'pending' AND created_at < now() - interval '1 day'`,
      ),
    );
    if (stale.length === 0) return;
    const client = createStorageClient(storage);
    for (const row of stale) {
      if (row.upload_id) await abortMultipart(client, storage.bucket, row.object_key, row.upload_id);
      await deleteObject(client, storage.bucket, row.object_key);
      await this.typeorm.ds.query(`DELETE FROM files WHERE id = $1`, [row.id]);
      console.log(`upload sweep dropped id=${row.id} key=${row.object_key}`);
    }
  }

  private storage(): StorageConfig {
    const config = storageConfig(process.env);
    if (!config) {
      throw new ServiceUnavailableException({
        code: 'storage-unconfigured',
        detail: 'STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY and STORAGE_BUCKET are required',
      });
    }
    return { ...config, expiresIn: this.config.get('PRESIGN_EXPIRES_SECONDS', { infer: true }) };
  }

  private async owned(user: AccessClaims, id: number): Promise<FileRow> {
    const rows = rowsOf<FileRow>(
      await this.typeorm.ds.query(
        `SELECT id, owner_id, object_key, status, size_bytes, content_type, upload_id, idempotency_key
         FROM files WHERE id = $1`,
        [id],
      ),
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({ code: 'not-found', detail: `upload ${id} not found` });
    }
    if (row.owner_id !== user.id) {
      throw new ForbiddenException({ code: 'not-owner', detail: 'upload belongs to another user' });
    }
    return row;
  }

  private async sign(storage: StorageConfig, row: FileRow): Promise<IntentView> {
    const client = createStorageClient(storage);
    const size = Number(row.size_bytes);
    if (row.upload_id) {
      const parts = partCount(size);
      const signed: { part_number: number; url: string }[] = [];
      for (let part = 1; part <= parts; part += 1) {
        signed.push({
          part_number: part,
          url: await presignPart(
            client,
            storage.bucket,
            row.object_key,
            row.upload_id,
            part,
            storage.expiresIn,
          ),
        });
      }
      return {
        id: Number(row.id),
        key: row.object_key,
        status: 'pending',
        expires_in: storage.expiresIn,
        url: null,
        upload_id: row.upload_id,
        part_size: partSizeFor(size),
        parts: signed,
      };
    }
    return {
      id: Number(row.id),
      key: row.object_key,
      status: 'pending',
      expires_in: storage.expiresIn,
      url: await presignPut(client, storage.bucket, row.object_key, row.content_type, storage.expiresIn),
      upload_id: null,
      part_size: null,
      parts: null,
    };
  }
}
