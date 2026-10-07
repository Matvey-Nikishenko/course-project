import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ProductsRepo } from '../../src/repos/products.repo';
import { UsersRepo } from '../../src/repos/users.repo';
import { aProduct, aUser, HTTP_BUYER_EMAIL } from '../testkit/builders';
import { PgHandle, startPg, truncateAll } from '../testkit/pg-container';

describe('E2E orders', () => {
  let pg: PgHandle;
  let app: INestApplication;

  beforeAll(async () => {
    pg = await startPg('(e2e)');
    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/configure-app');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(moduleRef.createNestApplication({ bodyParser: false }));
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pg) await pg.stop();
  });

  beforeEach(async () => {
    await truncateAll(pg.pool);
  });

  test('happy path: POST /orders → 201, GET /orders/:id → 200 same order', async () => {
    const users = new UsersRepo(pg.pool);
    const products = new ProductsRepo(pg.pool);
    await aUser()
      .withEmail(HTTP_BUYER_EMAIL)
      .withRole('buyer')
      .withBalance(50_000_000)
      .insertVia(users);
    const seller = await aUser().withRole('seller').insertVia(users);
    const product = await aProduct()
      .forSeller(seller.id)
      .withName('Keyboard')
      .withPrice(260000)
      .withStock(5)
      .insertVia(products);

    const created = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', `e2e-${Date.now()}`)
      .send({ items: [{ product_id: Number(product.id), quantity: 1 }] })
      .expect(201);

    expect(created.body).toMatchObject({
      status: 'paid',
      total_cents: 260000,
      items: [{ product_id: Number(product.id), quantity: 1, unit_price_cents: 260000 }],
    });
    expect(created.headers.location).toBe(`/orders/${created.body.id}`);

    const fetched = await request(app.getHttpServer())
      .get(`/orders/${created.body.id}`)
      .expect(200);
    expect(fetched.body).toEqual(created.body);
  });

  test('unknown order id → 404', async () => {
    const res = await request(app.getHttpServer()).get('/orders/999999').expect(404);
    expect(res.body).toMatchObject({
      status: 404,
      title: 'Not Found',
    });
  });

  test('ValidationPipe: quantity 0 → 400 before the service', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Idempotency-Key', 'e2e-bad-qty')
      .send({ items: [{ product_id: 1, quantity: 0 }] })
      .expect(400);
    expect(res.body.status).toBe(400);
  });
});
