import { report } from './broker/demo-setup';
import {
  bootApi,
  closeDemo,
  DEMO_PASSWORD,
  http,
  insertProduct,
  resetUsers,
  tamperRole,
  upsertUser,
} from './auth/demo-support';

const EMAILS = ['rbac-buyer-a@example.com', 'rbac-buyer-b@example.com', 'rbac-seller@example.com'];

async function orderFor(
  base: string,
  token: string,
  buyerId: string,
  productId: string,
  key: string,
): Promise<number> {
  const placed = await http(base, 'POST', '/orders', {
    token,
    headers: { 'idempotency-key': key },
    body: {
      buyer_id: Number(buyerId),
      items: [{ product_id: Number(productId), quantity: 1 }],
    },
  });
  return Number(placed.json.id);
}

async function main(): Promise<void> {
  await resetUsers(EMAILS);
  const buyerA = await upsertUser(EMAILS[0], 'buyer', 50_000_000);
  const buyerB = await upsertUser(EMAILS[1], 'buyer', 50_000_000);
  const sellerId = await upsertUser(EMAILS[2], 'seller', 0);
  const productId = await insertProduct(sellerId, 'RBAC demo keyboard', 1000, 10);
  const { app, base } = await bootApi();
  try {
    const loginA = await http(base, 'POST', '/auth/login', {
      body: { email: EMAILS[0], password: DEMO_PASSWORD },
    });
    const loginB = await http(base, 'POST', '/auth/login', {
      body: { email: EMAILS[1], password: DEMO_PASSWORD },
    });
    const loginSeller = await http(base, 'POST', '/auth/login', {
      body: { email: EMAILS[2], password: DEMO_PASSWORD },
    });
    const tokenA = String(loginA.json.access_token ?? '');
    const tokenB = String(loginB.json.access_token ?? '');
    const tokenSeller = String(loginSeller.json.access_token ?? '');

    const ownId = await orderFor(base, tokenA, buyerA, productId, `demo-rbac-a-${Date.now()}`);
    const foreignId = await orderFor(base, tokenB, buyerB, productId, `demo-rbac-b-${Date.now()}`);

    const anon = await http(base, 'GET', `/orders/${ownId}`);
    const own = await http(base, 'GET', `/orders/${ownId}`, { token: tokenA });
    const foreign = await http(base, 'GET', `/orders/${foreignId}`, { token: tokenA });
    const denied = await http(base, 'POST', '/products', {
      token: tokenA,
      body: { title: 'Buyer must not create', price_cents: 100, stock: 1 },
    });
    const allowed = await http(base, 'POST', '/products', {
      token: tokenSeller,
      body: { title: 'Seller catalog item', price_cents: 100, stock: 1 },
    });
    const tampered = await http(base, 'POST', '/products', {
      token: tamperRole(tokenA),
      body: { title: 'Forged admin', price_cents: 100, stock: 1 },
    });

    const rows = {
      anon: anon.status,
      own: own.status,
      foreign: foreign.status,
      'role-denied': denied.status,
      'role-allowed': allowed.status,
      tampered: tampered.status,
    };
    const ok =
      rows.anon === 401 &&
      rows.own === 200 &&
      rows.foreign === 403 &&
      rows['role-denied'] === 403 &&
      (rows['role-allowed'] === 200 || rows['role-allowed'] === 201) &&
      rows.tampered === 401;
    await resetUsers(EMAILS);
    await closeDemo(app);
    report(rows, ok);
  } finally {
    await closeDemo(app).catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
