import type { Request, Response } from 'express';

export const PROBLEM_BASE = 'https://api.marketplace.example/problems';

export const TITLES: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
};

export function writeProblem(
  res: Response,
  req: Request,
  status: number,
  detail: string,
  code?: string | number,
  extra?: Record<string, unknown>,
): void {
  res.status(status).type('application/problem+json').json({
    type: `${PROBLEM_BASE}/${code ?? status}`,
    title: TITLES[status] ?? 'Error',
    status,
    detail,
    instance: req.originalUrl,
    ...extra,
  });
}
