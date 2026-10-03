import dataSource from './data-source';
import { Job } from './entities/job';
import { runWorker, WORK_MS } from './job-worker';

const JOBS = 24;
const WORKERS = 3;
const KIND = 'worker_demo';

async function main(): Promise<void> {
  await dataSource.initialize();
  const jobRepo = dataSource.getRepository(Job);

  const queued = Array.from({ length: JOBS }, (_, i) =>
    jobRepo.create({ kind: KIND, payload: { n: i }, processed: 0, attempts: 0 }),
  );
  await jobRepo.save(queued);

  const workerIds = Array.from({ length: WORKERS }, (_, i) => `w${i + 1}`);
  const started = Date.now();
  const perWorker = await Promise.all(workerIds.map((id) => runWorker(dataSource, id, KIND)));
  const elapsedMs = Date.now() - started;

  const processedTwice = await jobRepo
    .createQueryBuilder('j')
    .where('j.processed > 1')
    .getCount();
  const totalProcessed = perWorker.reduce((a, b) => a + b, 0);
  const sequentialMs = totalProcessed * WORK_MS;

  console.log(`workers: ${WORKERS}`);
  console.log(
    `distribution: ${workerIds.map((id, i) => `${id}=${perWorker[i]}`).join(' ')}`,
  );
  console.log(`processed twice: ${processedTwice}`);
  console.log(`processed total: ${totalProcessed}`);
  console.log(`elapsed_ms: ${elapsedMs}`);
  console.log(`sequential_ms: ${sequentialMs}`);

  const workersUsed = perWorker.filter((n) => n > 0).length;
  const ok = processedTwice === 0 && workersUsed >= 2 && elapsedMs < sequentialMs;
  await dataSource.destroy();
  if (!ok) {
    console.error('worker pool invariant failed');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
