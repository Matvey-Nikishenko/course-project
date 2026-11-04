import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndexPublishedOutbox1796000000001 implements MigrationInterface {
  name = 'IndexPublishedOutbox1796000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_outbox_published
        ON outbox (published_at)
        WHERE published_at IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_outbox_published`);
  }
}
