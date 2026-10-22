import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderStatusEvents1793000000001 implements MigrationInterface {
  name = 'AddOrderStatusEvents1793000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "order_status_events" (
        "order_id" bigint NOT NULL,
        "event_id" integer NOT NULL,
        "status" text NOT NULL,
        CONSTRAINT "PK_order_status_events" PRIMARY KEY ("order_id", "event_id"),
        CONSTRAINT "FK_order_status_events_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_order_status_events_event_id" CHECK (event_id > 0),
        CONSTRAINT "CHK_order_status_events_status" CHECK (status IN ('new', 'paid', 'shipped', 'cancelled'))
      )
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "order_status_events" TO app_user;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "order_status_events"`);
  }
}
