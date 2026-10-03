import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddJobAttempts1792000000001 implements MigrationInterface {
  name = 'AddJobAttempts1792000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "jobs" ADD "attempts" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(
      `ALTER TABLE "jobs" ADD CONSTRAINT "CHK_jobs_attempts" CHECK (attempts >= 0)`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_jobs_pending"`);
    await queryRunner.query(
      `CREATE INDEX "idx_jobs_pending" ON "jobs" ("id") WHERE processed = 0 AND attempts < 5`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."idx_jobs_pending"`);
    await queryRunner.query(
      `CREATE INDEX "idx_jobs_pending" ON "jobs" ("id") WHERE processed = 0`,
    );
    await queryRunner.query(`ALTER TABLE "jobs" DROP CONSTRAINT "CHK_jobs_attempts"`);
    await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN "attempts"`);
  }
}
