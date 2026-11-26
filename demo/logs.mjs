import { randomBytes } from 'node:crypto';
import { report, startApp, stopApp, traceparent, waitFor } from './app.mjs';

function layersOf(lines, id) {
  return lines.filter((line) => line.id === id && line.layer);
}

async function main() {
  const app = await startApp();
  try {
    const one = traceparent();
    const single = await fetch(`${app.url}/catalog/one`, {
      headers: { traceparent: one.header },
    });
    if (single.status !== 200) throw new Error(`catalog/one -> ${single.status}`);
    await waitFor(() => layersOf(app.lines, 'one').some((line) => line.layer === 'catalog.repo'));
    const singleLines = layersOf(app.lines, 'one');
    const traceIds = new Set(singleLines.map((line) => line.trace_id || ''));
    const layers = new Set(singleLines.map((line) => line.layer));
    const deepest = singleLines.find((line) => line.layer === 'catalog.repo');

    const burstHeaders = Array.from({ length: 8 }, () => traceparent());
    await Promise.all(
      burstHeaders.map((parent, index) =>
        fetch(`${app.url}/catalog/burst-${index}`, { headers: { traceparent: parent.header } }),
      ),
    );
    await waitFor(() => app.lines.filter((line) => line.id === 'burst-7' && line.layer === 'catalog.repo').length > 0);
    const burstLines = app.lines.filter(
      (line) => typeof line.id === 'string' && line.id.startsWith('burst-'),
    );
    const groups = new Map();
    for (const line of burstLines) {
      const key = line.trace_id || '';
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    const sizes = [...groups.values()];
    const uneven = sizes.length > 0 && sizes.every((size) => size === sizes[0]) ? 0 : 1;

    const markerAuth = `bearer-${randomBytes(8).toString('hex')}`;
    const markerPassword = `password-${randomBytes(8).toString('hex')}`;
    await fetch(`${app.url}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${markerAuth}`,
      },
      body: JSON.stringify({ email: 'secret-req@example.com', password: markerPassword }),
    });
    await waitFor(() =>
      app.lines.some((line) => line.msg === 'request' && JSON.stringify(line).includes('[Redacted]')),
    );
    const raw = JSON.stringify(app.lines);
    const requestLogged = app.lines.some(
      (line) => line.msg === 'request' && JSON.stringify(line).includes('[Redacted]'),
    );
    const leaked =
      (raw.split(markerAuth).length - 1) + (raw.split(markerPassword).length - 1);

    const values = {
      'non-json-lines': app.nonJson.length,
      layers: layers.size,
      'distinct-trace-ids': traceIds.size,
      'trace-id-matches-header': deepest?.trace_id === one.traceId ? 1 : 0,
      burst: burstHeaders.length,
      'burst-trace-ids': groups.size,
      'burst-uneven': groups.size === burstHeaders.length ? uneven : 1,
      'secret-req-logged': requestLogged ? 1 : 0,
      'secret-in-logs': leaked === 0 ? 0 : leaked,
    };
    const ok =
      values['non-json-lines'] === 0 &&
      values.layers >= 3 &&
      values['distinct-trace-ids'] === 1 &&
      values['trace-id-matches-header'] === 1 &&
      values.burst >= 8 &&
      values['burst-trace-ids'] === values.burst &&
      values['burst-uneven'] === 0 &&
      values['secret-req-logged'] === 1 &&
      values['secret-in-logs'] === 0;
    if (!ok) console.error(JSON.stringify({ singleLines, groups: [...groups], nonJson: app.nonJson, stderr: app.stderr() }));
    await stopApp(app);
    report(values, ok);
  } catch (error) {
    await stopApp(app);
    throw error;
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
