import { Histogram, Registry, collectDefaultMetrics, Counter } from 'prom-client';
import type { Request, Response } from 'express';

export const register = new Registry();
collectDefaultMetrics({ register });

/**
 * The last finite bucket has to sit above the slowest catalog read.
 * Default client buckets stop at 10s; a stuck pool would then clamp
 * histogram_quantile to that edge and look healthy. 60s is the ceiling.
 */
export const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests by method, route template and status',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: DURATION_BUCKETS,
  registers: [register],
});

function skipped(req: Request): boolean {
  const url = req.originalUrl || req.url || req.path || '';
  return url === '/metrics' || url.startsWith('/metrics?') || url.startsWith('/observability/flush');
}

/** Route template (`/catalog/:id`), never the raw path. Unmatched stays one series. */
export function routeTemplate(req: Request): string | null {
  if (skipped(req)) return null;
  const pattern = (req as Request & { route?: { path?: string } }).route?.path;
  if (!pattern) return 'unmatched';
  const base = req.baseUrl ?? '';
  if (pattern.startsWith(base) && pattern.includes('/')) return pattern;
  const joined = `${base}${pattern.startsWith('/') ? pattern : `/${pattern}`}`;
  return joined.replace(/\/{2,}/g, '/') || pattern;
}

export function metricsMiddleware(req: Request, res: Response, next: () => void): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = routeTemplate(req);
    if (!route) return;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequests.inc(labels);
    httpDuration.observe(labels, Number(process.hrtime.bigint() - start) / 1e9);
  });
  next();
}
