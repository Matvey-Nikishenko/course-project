import { InternalServerErrorException } from '@nestjs/common';
import { SpanStatusCode, trace } from '@opentelemetry/api';
import { logger } from '../observability/logger';

const log = logger.child({ layer: 'catalog.repo' });
const tracer = trace.getTracer('marketplace-api');

export type CatalogCard = { id: string };

/** Repository layer. The nested span is the one a trace demo expects beside the server span. */
export class CatalogRepo {
  load(id: string): Promise<CatalogCard> {
    return tracer.startActiveSpan('catalog.repo.load', async (span) => {
      try {
        log.info({ id }, 'load');
        if (id === 'fail') {
          throw new InternalServerErrorException({
            code: 'catalog-failed',
            detail: 'catalog read failed',
          });
        }
        return { id };
      } catch (error) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
