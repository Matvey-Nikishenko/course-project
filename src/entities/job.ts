import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'jobs' })
@Check(`processed >= 0`)
@Index('idx_jobs_pending', ['id'], { where: 'processed = 0' })
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

  @Column({ type: 'text', name: 'worker_id', nullable: true })
  workerId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
