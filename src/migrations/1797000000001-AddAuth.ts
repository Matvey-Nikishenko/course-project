import { MigrationInterface, QueryRunner } from 'typeorm';
import { AUTH_STATEMENTS } from '../auth/ddl';

export class AddAuth1797000000001 implements MigrationInterface {
  name = 'AddAuth1797000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of AUTH_STATEMENTS) {
      await queryRunner.query(statement);
    }
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON refresh_tokens TO app_user;
          GRANT SELECT, INSERT, UPDATE, DELETE ON access_denylist TO app_user;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS access_denylist`);
    await queryRunner.query(`DROP TABLE IF EXISTS refresh_tokens`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS password_hash`);
  }
}
