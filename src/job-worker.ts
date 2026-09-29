import { DataSource, EntityManager } from 'typeorm';
import { Job } from './entities/job';

export const WORK_MS = 40;

async function claimJob(manager: EntityManager, kind: string): Promise<Job | null> {
  return manager
    .createQueryBuilder(Job, 'j')
    .setLock('pessimistic_write')
    .setOnLocked('skip_locked')
    .where('j.processed = 0')
    .andWhere('j.kind = :kind', { kind })
    .orderBy('j.id', 'ASC')
    .take(1)
    .getOne();
}

export async function runWorker(
  ds: DataSource,
  workerId: string,
  kind: string,
  workMs = WORK_MS,
): Promise<number> {
  let done = 0;
  for (;;) {
    const taken = await ds.transaction(async (manager) => {
      const job = await claimJob(manager, kind);
      if (!job) return null;
      // Hold the row lock for the whole "send receipt" window. If this process
      // dies before COMMIT, the lock vanishes and another worker can take the job.
      await new Promise((resolve) => setTimeout(resolve, workMs));
      job.processed += 1;
      job.workerId = workerId;
      await manager.save(job);
      return job;
    });

    if (taken) {
      done += 1;
      continue;
    }

    // SKIP LOCKED returning empty means "none free right now", not "queue empty".
    const pending = await ds.getRepository(Job).count({ where: { processed: 0, kind } });
    if (pending === 0) return done;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
