import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { AccessClaims } from './tokens';

export type AuthedRequest = Request & { user: AccessClaims };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match) {
      await this.auth.authenticate('');
    }
    req.user = await this.auth.authenticate(match?.[1] ?? '');
    return true;
  }
}
