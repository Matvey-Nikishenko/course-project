import 'reflect-metadata';
import path from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import { AppModule } from './app.module';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { writeProblem } from './utils/problem';
import { ProblemFilter } from './problem.filter';
import { validationFactory } from './utils/validation';

const PORT = Number(process.env.PORT) || 3000;

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
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
    bodyParser: false,
  });

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

  await app.listen(PORT);
  console.log(`Marketplace API (hw-09, variant B, NestJS) on http://localhost:${PORT}`);
}

bootstrap();
