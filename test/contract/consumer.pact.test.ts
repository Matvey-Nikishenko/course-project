import path from 'node:path';
import { MatchersV3, PactV3 } from '@pact-foundation/pact';

const { like, regex } = MatchersV3;

describe('Pact consumer: web-app ↔ marketplace-api', () => {
  const provider = new PactV3({
    consumer: 'web-app',
    provider: 'marketplace-api',
    dir: path.resolve(process.cwd(), 'pacts'),
  });

  test('GET /orders/1 when order 1 exists', async () => {
    provider
      .given('order 1 exists')
      .uponReceiving('a request for order 1')
      .withRequest({ method: 'GET', path: '/orders/1' })
      .willRespondWith({
        status: 200,
        headers: {
          'Content-Type': regex('application/json.*', 'application/json; charset=utf-8'),
        },
        body: {
          id: like(1),
          items: like([
            {
              product_id: like(1),
              quantity: like(1),
              unit_price_cents: like(260000),
            },
          ]),
          total_cents: like(260000),
          status: like('paid'),
          created_at: like('2026-01-15T12:00:00.000Z'),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/orders/1`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: number; status: string };
      expect(body.id).toEqual(expect.any(Number));
      expect(['new', 'paid', 'cancelled']).toContain(body.status);
    });
  });
});
