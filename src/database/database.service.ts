import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResult, QueryResultRow } from 'pg';
import { Env } from '../config/env.schema';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;

  constructor(config: ConfigService<Env, true>) {
    const url = new URL(config.get('DB_URL', { infer: true }));
    const passwordFile = resolve(config.get('DB_PASSWORD_FILE', { infer: true }));

    this.pool = new Pool({
      host: url.hostname,
      port: Number(url.port),
      database: url.pathname.replace(/^\//, ''),
      user: decodeURIComponent(url.username),
      // pg calls this on every new connection, so a rotated password is picked
      // up without restarting the process. An env variable could not do this:
      // the environment of a running process is a snapshot taken at exec.
      password: async () => (await readFile(passwordFile, 'utf8')).trim(),
      max: config.get('DB_POOL_MAX', { infer: true }),
    });

    // Rotation kills idle backends, and the pool reports that as an 'error'
    // event. Without this listener Node dies on Unhandled 'error' event.
    this.pool.on('error', (err: Error & { code?: string }) => {
      this.logger.warn(
        `server closed an idle connection (${err.code ?? err.message}) — the pool will open a new one`,
      );
    });
  }

  query<T extends QueryResultRow>(sql: string): Promise<QueryResult<T>> {
    return this.pool.query<T>(sql);
  }

  onModuleDestroy(): Promise<void> {
    return this.pool.end();
  }
}
