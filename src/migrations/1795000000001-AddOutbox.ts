import { MigrationInterface, QueryRunner } from 'typeorm';
import { OUTBOX_STATEMENTS } from '../outbox/ddl';

export class AddOutbox1795000000001 implements MigrationInterface {
  name = 'AddOutbox1795000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of OUTBOX_STATEMENTS) {
      await queryRunner.query(statement);
    }
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON outbox TO app_user;
          GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO app_user;
          GRANT SELECT, INSERT, UPDATE, DELETE ON processed_messages TO app_user;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS processed_messages`);
    await queryRunner.query(`DROP TABLE IF EXISTS idempotency_keys`);
    await queryRunner.query(`DROP TABLE IF EXISTS outbox`);
  }
}
