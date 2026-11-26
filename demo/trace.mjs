import { report, startApp, stopApp, traceparent, waitFor } from './app.mjs';

function hexOf(value) {
  if (!value) return '';
  const text = String(value);
  if (/^[0-9a-f]{16,32}$/i.test(text)) return text.toLowerCase();
  try {
    const decoded = Buffer.from(text, 'base64').toString('hex');
    if (/^[0-9a-f]+$/i.test(decoded) && decoded.length >= 16) return decoded.toLowerCase();
  } catch {
    // not base64
  }
  return text.toLowerCase();
}

function statusError(status) {
  if (!status) return false;
  const code = status.code ?? status.statusCode ?? status;
  return code === 2 || code === 'STATUS_CODE_ERROR' || code === 'ERROR';
}

function spansFrom(body) {
  const spans = [];
  for (const batch of body.batches ?? []) {
    const groups = batch.scopeSpans ?? batch.instrumentationLibrarySpans ?? [];
    for (const group of groups) {
      for (const span of group.spans ?? []) {
        spans.push({
          traceId: hexOf(span.traceId),
          spanId: hexOf(span.spanId),
          parentSpanId: hexOf(span.parentSpanId),
          error: statusError(span.status),
        });
      }
    }
  }
  for (const trace of body.data ?? []) {
    for (const span of trace.spans ?? []) {
      const tags = new Map((span.tags ?? []).map((tag) => [tag.key, tag.value]));
      const parent = (span.references ?? []).find((ref) => ref.refType === 'CHILD_OF');
      spans.push({
        traceId: hexOf(span.traceID),
        spanId: hexOf(span.spanID),
        parentSpanId: hexOf(parent?.spanID),
        error:
          tags.get('otel.status_code') === 'ERROR' ||
          tags.get('error') === true ||
          tags.get('http.status_code') === 500 ||
          tags.get('http.response.status_code') === 500,
      });
    }
  }
  return spans;
}

async function fetchTrace(traceId) {
  const base = (process.env.TRACE_API_URL || 'http://127.0.0.1:22904').replace(/\/$/, '');
  const deadline = Date.now() + 20_000;
  let last = '';
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/traces/${traceId}`, {
      headers: { accept: 'application/json' },
    }).catch(() => null);
    if (res?.ok) {
      const text = await res.text();
      last = text;
      try {
        const spans = spansFrom(JSON.parse(text));
        if (spans.length > 0) return spans;
      } catch {
        last = text.slice(0, 400);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  console.error(last.slice(0, 500));
  return [];
}

async function main() {
  const app = await startApp();
  try {
    const parent = traceparent();
    const res = await fetch(`${app.url}/catalog/fail`, {
      headers: { traceparent: parent.header },
    });
    if (res.status !== 500) throw new Error(`catalog/fail -> ${res.status}`);
    await waitFor(() => app.lines.some((line) => line.id === 'fail' && line.layer === 'catalog.repo'));
    const flushed = await fetch(`${app.url}/observability/flush`, { method: 'POST' });
    if (flushed.status !== 204) throw new Error(`flush -> ${flushed.status}`);
    const spans = await fetchTrace(parent.traceId);
    const ids = new Set(spans.map((span) => span.spanId));
    const orphans = spans.filter(
      (span) =>
        span.parentSpanId &&
        span.parentSpanId !== parent.spanId &&
        !ids.has(span.parentSpanId),
    ).length;
    const logLine = app.lines.find((line) => line.id === 'fail' && line.layer === 'catalog.repo');
    const values = {
      spans: spans.length,
      'orphan-spans': orphans,
      'trace-matches-header': spans.length > 0 && spans.every((span) => span.traceId === parent.traceId) ? 1 : 0,
      'trace-matches-log': logLine?.trace_id === parent.traceId ? 1 : 0,
      'span-status-error': spans.some((span) => span.error) ? 1 : 0,
    };
    const ok =
      values.spans >= 2 &&
      values['orphan-spans'] === 0 &&
      values['trace-matches-header'] === 1 &&
      values['trace-matches-log'] === 1 &&
      values['span-status-error'] === 1;
    if (!ok) console.error(JSON.stringify(spans, null, 2));
    await stopApp(app);
    report(values, ok);
  } catch (error) {
    await stopApp(app);
    throw error;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
