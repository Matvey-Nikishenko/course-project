import { JobsOptions, Queue } from 'bullmq';

export const RATING_QUEUE = 'rating';
export const DEMO_QUEUE = 'demo-rating';

/** Age, not `true`: removing the job on completion frees the jobId and the dedup is gone. */
export const JOB_KEEP_SECONDS = 3600;

export function jobOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: 5,
    backoff: { type: 'exponential', delay: 100, jitter: 0.5 },
    removeOnComplete: { age: JOB_KEEP_SECONDS },
    removeOnFail: { age: JOB_KEEP_SECONDS },
  };
}

export async function scheduleEvery(
  queue: Queue,
  id: string,
  everyMs: number,
  name: string,
): Promise<void> {
  await queue.upsertJobScheduler(
    id,
    { every: everyMs },
    {
      name,
      data: {},
      opts: { removeOnComplete: { age: JOB_KEEP_SECONDS } },
    },
  );
}

export function queueConnection(url: string, worker: boolean): { url: string; maxRetriesPerRequest: number | null } {
  return { url, maxRetriesPerRequest: worker ? null : 1 };
}
