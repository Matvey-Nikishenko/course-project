import { MigrationInterface, QueryRunner } from 'typeorm';
import { FILE_STATEMENTS } from '../uploads/ddl';

export class AddFiles1798000000001 implements MigrationInterface {
  name = 'AddFiles1798000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const statement of FILE_STATEMENTS) {
      await queryRunner.query(statement);
    }
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON files TO app_user;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS files`);
  }
}
