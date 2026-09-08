import 'reflect-metadata';
import path from 'node:path';
import { LogLevel, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import { AppModule } from './app.module';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { writeProblem } from './common/problem/problem';
import { ProblemFilter } from './common/problem/problem.filter';
import { validationFactory } from './common/validation/validation';
import { Env } from './config/env.schema';

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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  const config = app.get(ConfigService<Env, true>);
  app.useLogger(LOG_LEVELS[config.get('LOG_LEVEL', { infer: true })]);
  // SIGTERM has to close the server and the pg pool, otherwise the container
  // hangs until SIGKILL — a listener that only logs is worse than none.
  app.enableShutdownHooks();

  app.use(express.json());
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(__dirname, '..', 'openapi', 'openapi.yaml'),
      validateRequests: true,
      validateResponses: true,
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

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  console.log(`Marketplace API (NestJS) on http://localhost:${port}`);
}

bootstrap();
