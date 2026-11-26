import { diag, DiagLogLevel, SpanStatusCode } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

diag.setLogger(
  {
    verbose() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
  },
  DiagLogLevel.NONE,
);

function exporterUrl(): string | undefined {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!raw) return undefined;
  const base = raw.replace(/\/$/, '');
  return base.endsWith('/v1/traces') ? base : `${base}/v1/traces`;
}

const url = exporterUrl();
const exporter = url ? new OTLPTraceExporter({ url }) : undefined;
const processor = exporter
  ? new BatchSpanProcessor(exporter, { scheduledDelayMillis: 200 })
  : undefined;

const sdk = new NodeSDK({
  serviceName: 'marketplace-api',
  spanProcessors: processor ? [processor] : [],
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-pg': { enabled: false },
      '@opentelemetry/instrumentation-ioredis': { enabled: false },
      '@opentelemetry/instrumentation-amqplib': { enabled: false },
      '@opentelemetry/instrumentation-undici': { enabled: false },
      '@opentelemetry/instrumentation-pino': { enabled: false },
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        applyCustomAttributesOnSpan(span, _request, response) {
          const status = (response as { statusCode?: number }).statusCode;
          if (typeof status === 'number' && status >= 500) {
            span.setStatus({ code: SpanStatusCode.ERROR });
          }
        },
      },
    }),
  ],
});

sdk.start();

/** The batch exporter does not ship spans on the response. Demos call this before reading Tempo. */
export async function flushTraces(): Promise<void> {
  if (processor) await processor.forceFlush();
}
