import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthedRequest } from './auth.guard';
import { AccessClaims } from './tokens';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AccessClaims => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});
