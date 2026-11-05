import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { SlidingWindowService } from '../sliding-window/sliding-window.service';
import { applyLimit } from '../sliding-window/window';

@Injectable()
export class SharedRateLimitGuard implements CanActivate {
  constructor(private readonly limits: SlidingWindowService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const ip = req.ip || req.socket?.remoteAddress || 'local';
    const decision = await this.limits.take(ip);
    if (!decision || decision.allowed) return true;
    applyLimit(res, decision);
    throw new HttpException(
      { status: 429, title: 'Too Many Requests', detail: 'rate limit exceeded' },
      429,
    );
  }
}
