import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, mergeMap } from 'rxjs';
import { SessionStoreService } from '../session-store/session-store.service';

@Injectable()
export class RollingSessionInterceptor implements NestInterceptor {
  constructor(private readonly sessions: SessionStoreService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const id = context.switchToHttp().getRequest<{ header(name: string): string | undefined }>().header(
      'x-session-id',
    );
    if (!id) return next.handle();
    return from(this.sessions.touch(id)).pipe(mergeMap(() => next.handle()));
  }
}
