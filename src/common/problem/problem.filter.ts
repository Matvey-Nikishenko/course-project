import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { writeProblem } from './problem';

interface ValidatorError {
  status?: number;
  message?: string;
  errors?: unknown;
}

function isValidatorError(exception: unknown): exception is ValidatorError {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    'status' in exception &&
    typeof (exception as ValidatorError).status === 'number'
  );
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const extra =
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>)
          : {};
      const detail =
        (extra.detail as string) ??
        (typeof body === 'string'
          ? body
          : (extra.message as string) ?? 'Something went wrong');
      writeProblem(
        res,
        req,
        status,
        detail,
        (extra.code as string) ?? status,
        extra.errors ? { errors: extra.errors } : undefined,
      );
      return;
    }

    if (isValidatorError(exception)) {
      const status = exception.status ?? 500;
      writeProblem(
        res,
        req,
        status,
        exception.message ?? 'Something went wrong',
        exception.errors ? 'validation-failed' : status,
      );
      return;
    }

    writeProblem(res, req, 500, 'Something went wrong');
  }
}
