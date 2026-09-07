import { createHash } from 'node:crypto';
import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, from, mergeMap, of } from 'rxjs';

const KEY_TTL_MS = 24 * 60 * 60 * 1000;

interface IdemRecord {
  state: 'in-flight' | 'done';
  fingerprint: string;
  expiresAt: number;
  body?: { id: number };
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly map = new Map<string, IdemRecord>();

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    if (req.method !== 'POST') return next.handle();

    const key = req.header('idempotency-key');
    if (!key) return next.handle();

    return from(this.handle(key, req, res, next)).pipe(mergeMap((obs) => obs));
  }

  private async handle(
    key: string,
    req: Request,
    res: Response,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(req.body ?? null))
      .digest('hex');

    this.sweep();

    const rec = this.map.get(key);
    if (rec) {
      if (rec.fingerprint !== fingerprint) {
        throw new UnprocessableEntityException({
          code: 'idempotency-key-reuse',
          detail: 'This Idempotency-Key was already used with a different request body',
        });
      }
      if (rec.state === 'in-flight') {
        throw new ConflictException({
          code: 'idempotency-in-flight',
          detail: 'A request with this key is still in flight — retry later',
        });
      }
      res.status(201);
      res.setHeader('Idempotency-Replay', 'true');
      if (rec.body) res.setHeader('Location', `/orders/${rec.body.id}`);
      return of(rec.body);
    }

    const expiresAt = Date.now() + KEY_TTL_MS;
    this.map.set(key, { state: 'in-flight', fingerprint, expiresAt });
    return next.handle().pipe(
      mergeMap(async (body: { id: number }) => {
        this.map.set(key, { state: 'done', fingerprint, expiresAt, body });
        return body;
      }),
    );
  }

  // Every record gets the same TTL and Map.set keeps the original insertion
  // slot, so insertion order is expiry order and the scan can stop at the
  // first live record instead of walking the whole store.
  private sweep(): void {
    const now = Date.now();
    for (const [key, rec] of this.map) {
      if (rec.expiresAt > now) break;
      this.map.delete(key);
    }
  }
}
