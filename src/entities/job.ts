import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const JOB_MAX_ATTEMPTS = 5;

@Entity({ name: 'jobs' })
@Check(`processed >= 0`)
@Check(`attempts >= 0`)
@Index('idx_jobs_pending', ['id'], { where: 'processed = 0 AND attempts < 5' })
export class Job {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'text' })
  kind!: string;

  @Column({ type: 'jsonb', default: {} })
  payload!: Record<string, unknown>;

  // Incremented in the same transaction as the work. SKIP LOCKED keeps this at 1.
  @Column({ type: 'int', default: 0 })
  processed!: number;

  // Survives a failed processing tx: incremented in a follow-up UPDATE after rollback.
  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', name: 'worker_id', nullable: true })
  workerId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
