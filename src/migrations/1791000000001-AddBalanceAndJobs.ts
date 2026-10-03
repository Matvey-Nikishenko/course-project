import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBalanceAndJobs1791000000001 implements MigrationInterface {
  name = 'AddBalanceAndJobs1791000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD "balance_cents" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CHK_users_balance_cents" CHECK (balance_cents >= 0)`,
    );
    await queryRunner.query(
      `CREATE TABLE "jobs" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "kind" text NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}', "processed" integer NOT NULL DEFAULT 0, "worker_id" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_jobs_processed" CHECK (processed >= 0), CONSTRAINT "PK_jobs" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_jobs_pending" ON "jobs" ("id") WHERE processed = 0`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_jobs_pending"`);
    await queryRunner.query(`DROP TABLE "jobs"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "CHK_users_balance_cents"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balance_cents"`);
  }
}
