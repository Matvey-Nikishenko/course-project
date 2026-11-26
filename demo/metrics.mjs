import { report, startApp, stopApp } from './app.mjs';

function samples(text, name) {
  const found = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith(name)) continue;
    const rest = line.slice(name.length);
    if (!rest.startsWith('{')) continue;
    const end = rest.indexOf('}');
    if (end < 0) continue;
    const labels = {};
    for (const match of rest.slice(1, end).matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"])*)"/g)) {
      labels[match[1]] = match[2].replace(/\\"/g, '"');
    }
    const value = Number(rest.slice(end + 1).trim());
    found.push({ labels, value });
  }
  return found;
}

async function scrape(url) {
  const res = await fetch(`${url}/metrics`);
  if (!res.ok) throw new Error(`metrics ${res.status}`);
  return res.text();
}

function total(text) {
  return samples(text, 'http_requests_total').reduce((sum, sample) => sum + sample.value, 0);
}

function errors(text) {
  return samples(text, 'http_requests_total')
    .filter((sample) => /^5\d\d$/.test(sample.labels.status ?? ''))
    .reduce((sum, sample) => sum + sample.value, 0);
}

function aboveTop(text, route) {
  const counts = samples(text, 'http_request_duration_seconds_count').filter(
    (sample) => sample.labels.route === route,
  );
  const buckets = samples(text, 'http_request_duration_seconds_bucket').filter(
    (sample) => sample.labels.route === route && sample.labels.le !== '+Inf',
  );
  if (counts.length === 0 || buckets.length === 0) return -1;
  const top = Math.max(...buckets.map((sample) => Number(sample.labels.le)));
  const inTop = buckets
    .filter((sample) => Number(sample.labels.le) === top)
    .reduce((sum, sample) => sum + sample.value, 0);
  const count = counts.reduce((sum, sample) => sum + sample.value, 0);
  return count - inTop;
}

async function main() {
  const app = await startApp();
  try {
    const warm = await fetch(`${app.url}/catalog/warmup`);
    if (warm.status !== 200) throw new Error(`warmup ${warm.status}`);
    const before = await scrape(app.url);
    const seriesBefore = samples(before, 'http_requests_total').length;
    const route =
      samples(before, 'http_requests_total').find((sample) =>
        (sample.labels.route ?? '').includes('catalog'),
      )?.labels.route ?? '';

    for (let i = 0; i < 100; i += 1) {
      const res = await fetch(`${app.url}/catalog/id-${i}`);
      if (res.status !== 200) throw new Error(`id-${i} ${res.status}`);
    }
    const afterIds = await scrape(app.url);
    const seriesAfter = samples(afterIds, 'http_requests_total').length;

    const counterBefore = total(afterIds);
    const errorsBefore = errors(afterIds);
    let sentOk = 0;
    let sentFail = 0;
    for (let i = 0; i < 40; i += 1) {
      const res = await fetch(`${app.url}/catalog/ok-${i}`);
      if (res.status >= 500) sentFail += 1;
      else sentOk += 1;
    }
    for (let i = 0; i < 10; i += 1) {
      const res = await fetch(`${app.url}/catalog/fail`);
      if (res.status >= 500) sentFail += 1;
      else sentOk += 1;
    }
    const done = await scrape(app.url);
    const counterDelta = total(done) - counterBefore;
    const errorsDelta = errors(done) - errorsBefore;
    const above = aboveTop(done, route);

    const values = {
      'sent-ok': sentOk,
      'sent-fail': sentFail,
      'counter-delta': counterDelta,
      'errors-delta': errorsDelta,
      'above-top-bucket': above,
      'series-before': seriesBefore,
      'series-after': seriesAfter,
    };
    const ok =
      sentOk + sentFail >= 50 &&
      counterDelta === sentOk + sentFail &&
      errorsDelta === sentFail &&
      above === 0 &&
      seriesAfter === seriesBefore &&
      sentFail === 10;
    if (!ok) {
      console.error(`route=${route}`);
      console.error(samples(done, 'http_requests_total').map((sample) => JSON.stringify(sample)).join('\n'));
    }
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
