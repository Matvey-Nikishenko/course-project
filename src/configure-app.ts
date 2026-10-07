import 'reflect-metadata';
import path from 'node:path';
import { INestApplication, LogLevel, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
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

/** Same pipes, spec validator and filters as production — E2E must not test a different app. */
export function configureApp(app: INestApplication): INestApplication {
  const config = app.get(ConfigService<Env, true>);
  app.useLogger(LOG_LEVELS[config.get('LOG_LEVEL', { infer: true })]);
  app.enableShutdownHooks();

  app.use(express.json());
  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(process.cwd(), 'openapi', 'openapi.yaml'),
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
  return app;
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ['error', 'warn'],
  });
  return configureApp(app);
}
