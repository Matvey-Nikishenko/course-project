import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SlidingWindowService } from '../sliding-window/sliding-window.service';
import { applyLimit } from '../sliding-window/window';

/** The first hop of X-Forwarded-For. req.ip without trust proxy is the balancer. */
export function clientAddress(req: Request): string {
  const header = req.headers['x-forwarded-for'];
  const raw = Array.isArray(header) ? header[0] : header;
  const first = raw?.split(',')[0]?.trim();
  if (first) return first;
  return req.socket?.remoteAddress || 'local';
}

@Injectable()
export class SharedRateLimitGuard implements CanActivate {
  constructor(private readonly limits: SlidingWindowService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const ip = clientAddress(req);
    const decision = await this.limits.take(ip);
    if (!decision || decision.allowed) return true;
    applyLimit(res, decision);
    throw new HttpException(
      { status: 429, title: 'Too Many Requests', detail: 'rate limit exceeded' },
      429,
    );
  }
}
