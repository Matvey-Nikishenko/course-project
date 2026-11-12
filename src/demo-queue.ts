import { Queue, Worker } from 'bullmq';
import { report, poll } from './broker/demo-setup';
import { configValue, openRedis } from './redis/config';
import { requiredRedisUrl } from './redis/url';
import { DEMO_QUEUE, jobOptions, queueConnection, scheduleEvery } from './rating-jobs/options';

const JOB_ID = 'demo-one';
const SCHEDULER_ID = 'demo-scheduler';

async function main(): Promise<void> {
  const url = requiredRedisUrl('REDIS_QUEUE_URL');
  const redis = openRedis(url);
  const queue = new Queue(DEMO_QUEUE, { connection: queueConnection(url, false) });
  queue.on('error', () => undefined);
  const counts = { attempts: 0, completed: 0, scheduledRuns: 0 };
  let worker: Worker | null = null;
  const rows = {
    'queue-noeviction': 0,
    attempts: 0,
    completed: 0,
    added: 0,
    queued: 0,
    schedulers: 0,
    'scheduled-runs': 0,
  };
  try {
    const policy = await configValue(redis, 'maxmemory-policy');
    rows['queue-noeviction'] = policy === 'noeviction' ? 1 : 0;
    await queue.obliterate({ force: true });

    const options = jobOptions(JOB_ID);
    await queue.add('flaky', {}, options);
    rows.added += 1;
    await queue.add('flaky', {}, options);
    rows.added += 1;
    const pending = await queue.getJobCounts('waiting', 'delayed', 'active', 'prioritized');
    rows.queued = pending.waiting + pending.delayed + pending.active + pending.prioritized;

    worker = new Worker(
      DEMO_QUEUE,
      async (job) => {
        if (job.name === 'flaky') {
          counts.attempts += 1;
          if (counts.attempts < 3) throw new Error('transient');
          counts.completed += 1;
          return;
        }
        if (job.name === 'tick') counts.scheduledRuns += 1;
      },
      { connection: queueConnection(url, true), concurrency: 1 },
    );
    worker.on('error', () => undefined);
    worker.on('failed', () => undefined);

    await poll('flaky job', async () => counts.attempts >= 3 && counts.completed === 1, 20_000);
    rows.attempts = counts.attempts;
    rows.completed = counts.completed;

    await scheduleEvery(queue, SCHEDULER_ID, 400, 'tick');
    rows.schedulers = await queue.getJobSchedulersCount();
    await poll('scheduler', async () => counts.scheduledRuns >= 2, 20_000);
    rows['scheduled-runs'] = counts.scheduledRuns;
  } finally {
    if (worker) await worker.close().catch(() => undefined);
    await queue.removeJobScheduler(SCHEDULER_ID).catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close().catch(() => undefined);
    await redis.quit().catch(() => undefined);
  }
  const ok =
    rows.completed === 1 &&
    rows.added === 2 &&
    rows.queued === 1 &&
    rows['queue-noeviction'] === 1 &&
    rows.attempts >= 3 &&
    rows.schedulers >= 1 &&
    rows['scheduled-runs'] >= 2;
  report(rows, ok);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
