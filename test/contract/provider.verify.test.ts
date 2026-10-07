import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Verifier } from '@pact-foundation/pact';
import { Pool } from 'pg';
import { PgHandle, startPg } from '../testkit/pg-container';

const PROVIDER_PORT = 31601;
const PROVIDER = 'marketplace-api';
const PROVIDER_VERSION = process.env.PROVIDER_VERSION ?? '1.0.0';
const PACT_FILE = path.resolve(process.cwd(), 'pacts', 'web-app-marketplace-api.json');

async function seedOrder1(pool: Pool): Promise<void> {
  await pool.query(`
    INSERT INTO users (id, email, role, balance_cents)
    OVERRIDING SYSTEM VALUE
    VALUES
      (1, 'buyer-kateryna@example.com', 'buyer', 100000000),
      (2, 'seller-anna@example.com', 'seller', 0)
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO products (id, seller_id, name, description, price, stock)
    OVERRIDING SYSTEM VALUE
    VALUES (1, 2, 'Keyboard', 'mechanical', 260000, 10)
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO orders (id, buyer_id, status, total, created_at)
    OVERRIDING SYSTEM VALUE
    VALUES (1, 1, 'paid', 260000, '2026-01-15T12:00:00Z')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
    OVERRIDING SYSTEM VALUE
    VALUES (1, 1, 1, 1, 260000)
    ON CONFLICT (order_id, product_id) DO NOTHING
  `);
}

describe('Pact provider verification: marketplace-api', () => {
  let pg: PgHandle;
  let app: INestApplication;

  beforeAll(async () => {
    pg = await startPg('(pact-provider)');
    const { createApp } = await import('../../src/configure-app');
    app = await createApp();
    await app.listen(PROVIDER_PORT);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await pg.stop();
  });

  test('every interaction has a matching body', async () => {
    const brokerUrl = process.env.PACT_BROKER_URL;
    const fromBroker = Boolean(brokerUrl);
    if (!fromBroker) {
      expect(fs.existsSync(PACT_FILE)).toBe(true);
    }

    const output = await new Verifier({
      provider: PROVIDER,
      providerBaseUrl: `http://127.0.0.1:${PROVIDER_PORT}`,
      providerVersion: PROVIDER_VERSION,
      providerVersionBranch: 'main',
      publishVerificationResult: fromBroker,
      ...(fromBroker
        ? {
            pactBrokerUrl: brokerUrl,
            ...(process.env.PACT_BROKER_TOKEN
              ? { pactBrokerToken: process.env.PACT_BROKER_TOKEN }
              : {}),
            consumerVersionSelectors: [{ latest: true }],
          }
        : { pactUrls: [PACT_FILE] }),
      stateHandlers: {
        'order 1 exists': async () => {
          await seedOrder1(pg.pool);
        },
      },
      logLevel: 'warn',
    }).verifyProvider();

    console.log('verifier:', output);
  });
});
