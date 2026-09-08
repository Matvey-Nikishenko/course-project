import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

interface DbProbeRow {
  current_user: string;
  now: string;
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly db: DatabaseService) {}

  @Get()
  liveness() {
    return { status: 'ok', uptime_sec: process.uptime() };
  }

  @Get('db')
  async database() {
    try {
      const result = await this.db.query<DbProbeRow>(
        'SELECT current_user, now()::text AS now',
      );
      return {
        status: 'ok',
        uptime_sec: process.uptime(),
        db_user: result.rows[0].current_user,
        db_time: result.rows[0].now,
      };
    } catch (err) {
      this.logger.error(`database probe failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException({
        code: 'database-unavailable',
        detail: 'The database did not answer the probe query',
      });
    }
  }
}
