import { trace } from '@opentelemetry/api';
import pino from 'pino';
import { requestContext } from './context';

/**
 * One logger. trace_id comes from the active span, so a log line and the span
 * of the same request share a key. userId, tenant and idempotencyKey come from
 * AsyncLocalStorage. redact only hides paths that are listed: a nested field
 * with no path stays visible, which is why the auth body paths are explicit.
 */
export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: undefined,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.body.password',
        'req.body.currentPassword',
        'req.body.newPassword',
        'password',
        '*.password',
      ],
      censor: '[Redacted]',
    },
    mixin() {
      const store = requestContext.getStore();
      const traceId = trace.getActiveSpan()?.spanContext().traceId;
      return {
        ...(traceId ? { trace_id: traceId } : {}),
        ...(store?.userId ? { userId: store.userId } : {}),
        ...(store?.tenant ? { tenant: store.tenant } : {}),
        ...(store?.idempotencyKey ? { idempotencyKey: store.idempotencyKey } : {}),
      };
    },
  },
  pino.destination({ fd: 1, sync: true }),
);
