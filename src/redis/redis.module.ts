import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { CacheService } from '../cache/cache.service';
import { RatingJobsService } from '../rating-jobs/rating-jobs.service';
import { RollingSessionInterceptor } from '../rolling-session/rolling-session.interceptor';
import { SessionStoreService } from '../session-store/session-store.service';
import { SharedRateLimitGuard } from '../shared-rate-limit/shared-rate-limit.guard';
import { SlidingWindowService } from '../sliding-window/sliding-window.service';
import { TypeormModule } from '../typeorm/typeorm.module';

@Module({
  imports: [TypeormModule],
  providers: [
    CacheService,
    SessionStoreService,
    SlidingWindowService,
    RatingJobsService,
    { provide: APP_INTERCEPTOR, useClass: RollingSessionInterceptor },
    { provide: APP_GUARD, useClass: SharedRateLimitGuard },
  ],
  exports: [CacheService, SessionStoreService, SlidingWindowService, RatingJobsService],
})
export class RedisModule {}