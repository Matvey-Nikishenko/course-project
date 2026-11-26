import 'reflect-metadata';
import path from 'node:path';
import { INestApplication, LogLevel, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import { AppModule } from './app.module';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { writeProblem } from './common/problem/problem';
import { ProblemFilter } from './common/problem/problem.filter';
import { validationFactory } from './common/validation/validation';
import { Env } from './config/env.schema';
import { requestContext } from './observability/context';
import { flushTraces } from './observability/otel';
import { logger } from './observability/logger';
import { metricsMiddleware, register } from './observability/metrics';

const LOG_LEVELS: Record<Env['LOG_LEVEL'], LogLevel[]> = {
  debug: ['error', 'warn', 'log', 'debug', 'verbose'],
  info: ['error', 'warn', 'log'],
  warn: ['error', 'warn'],
  error: ['error'],
};

function validatorErrorHandler(
  err: { status?: number; message?: string; errors?: unknown },
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = err.status || 500;
  writeProblem(
    res,
    req,
    status,
    err.message || 'Something went wrong',
    err.errors ? 'validation-failed' : status,
  );
}

/** Same pipes, spec validator and filters as production — E2E must not test a different app. */
export function configureApp(app: INestApplication): INestApplication {
  app.useWebSocketAdapter(new IoAdapter(app));
  const config = app.get(ConfigService<Env, true>);
  app.useLogger(LOG_LEVELS[config.get('LOG_LEVEL', { infer: true })]);
  // SIGTERM is handled in main.ts: readiness goes false, the drain window
  // elapses, and only then the socket closes. Nest's own hook would close
  // immediately, while the balancer still has this pod in the endpoints.

  app.use((req: Request, res: Response, next: NextFunction) => {
    const header = (name: string): string | undefined => {
      const value = req.header(name);
      const trimmed = value?.trim();
      return trimmed ? trimmed : undefined;
    };
    requestContext.run(
      {
        userId: header('x-user-id'),
        tenant: header('x-tenant'),
        idempotencyKey: header('idempotency-key'),
      },
      () => next(),
    );
  });
  app.use(metricsMiddleware);
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const authorization = req.header('authorization');
    const body = req.body;
    const hasBody = body && typeof body === 'object' && Object.keys(body as object).length > 0;
    logger.info(
      {
        req: {
          method: req.method,
          path: req.path,
          ...(authorization ? { headers: { authorization } } : {}),
          ...(hasBody ? { body } : {}),
        },
      },
      'request',
    );
    next();
  });
  app.use('/metrics', async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });
  app.use('/observability/flush', async (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST') {
      next();
      return;
    }
    await flushTraces();
    res.status(204).end();
  });
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(process.cwd(), 'openapi', 'openapi.yaml'),
      validateRequests: true,
      validateResponses: true,
      // SSE is a long-lived text/event-stream. Response validation would
      // buffer it and reject the unfinished body.
      ignorePaths: /\/orders\/[^/]+\/events$/,
    }),
  );
  app.use(validatorErrorHandler as unknown as (...args: unknown[]) => void);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: validationFactory,
    }),
  );
  app.useGlobalFilters(new ProblemFilter());
  app.useGlobalInterceptors(new IdempotencyInterceptor());
  return app;
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: false,
  });
  return configureApp(app);
}
