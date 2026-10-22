import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderPlacedEffects1794000000001 implements MigrationInterface {
  name = 'AddOrderPlacedEffects1794000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_placed_effects" (
        "event_id" text NOT NULL,
        "order_id" bigint NOT NULL,
        "applied_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_placed_effects" PRIMARY KEY ("event_id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_placed_deliveries" (
        "id" bigint GENERATED ALWAYS AS IDENTITY,
        "event_id" text NOT NULL,
        "received_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_placed_deliveries" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "order_placed_effects" TO app_user;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "order_placed_deliveries" TO app_user;
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_placed_deliveries"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_placed_effects"`);
  }
}
