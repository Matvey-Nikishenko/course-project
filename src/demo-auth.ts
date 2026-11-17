import { report } from './broker/demo-setup';
import {
  bootApi,
  closeDemo,
  DEMO_PASSWORD,
  http,
  insertProduct,
  resetUsers,
  upsertUser,
} from './auth/demo-support';

const EMAILS = ['auth-demo-buyer@example.com', 'auth-demo-seller@example.com'];

async function main(): Promise<void> {
  await resetUsers(EMAILS);
  const buyerId = await upsertUser(EMAILS[0], 'buyer', 50_000_000);
  const sellerId = await upsertUser(EMAILS[1], 'seller', 0);
  const productId = await insertProduct(sellerId, 'Auth demo keyboard', 1000, 5);
  const { app, base } = await bootApi();
  try {
    const login = await http(base, 'POST', '/auth/login', {
      body: { email: EMAILS[0], password: DEMO_PASSWORD },
    });
    const access = String(login.json.access_token ?? '');
    const refresh = String(login.json.refresh_token ?? '');

    const noToken = await http(base, 'GET', '/orders/1');
    const placed = await http(base, 'POST', '/orders', {
      token: access,
      headers: { 'idempotency-key': `demo-auth-${Date.now()}` },
      body: {
        buyer_id: Number(buyerId),
        items: [{ product_id: Number(productId), quantity: 1 }],
      },
    });
    const withToken = await http(base, 'GET', `/orders/${placed.json.id}`, { token: access });

    const refreshed = await http(base, 'POST', '/auth/refresh', {
      body: { refresh_token: refresh },
    });
    const access2 = String(refreshed.json.access_token ?? '');
    const refresh2 = String(refreshed.json.refresh_token ?? '');

    const logout = await http(base, 'POST', '/auth/logout', { token: access2 });
    const afterLogout = await http(base, 'GET', `/orders/${placed.json.id}`, { token: access2 });
    const refreshAfter = await http(base, 'POST', '/auth/refresh', {
      body: { refresh_token: refresh2 },
    });

    const rows = {
      login: login.status,
      'no-token': noToken.status,
      'with-token': withToken.status,
      refresh: refreshed.status,
      logout: logout.status,
      'after-logout': afterLogout.status,
      'refresh-after-logout': refreshAfter.status,
    };
    const ok =
      rows.login === 200 &&
      rows['no-token'] === 401 &&
      rows['with-token'] === 200 &&
      rows.refresh === 200 &&
      (rows.logout === 200 || rows.logout === 204) &&
      rows['after-logout'] === 401 &&
      rows['refresh-after-logout'] === 401;
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
