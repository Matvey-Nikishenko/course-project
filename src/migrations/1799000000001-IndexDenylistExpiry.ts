import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexDenylistExpiry1799000000001 implements MigrationInterface {
  name = 'IndexDenylistExpiry1799000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_access_denylist_expires
        ON access_denylist (expires_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_access_denylist_expires`);
  }
}
