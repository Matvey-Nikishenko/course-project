import { report } from './broker/demo-setup';
import { bootApi, closeDemo, DEMO_PASSWORD, http, resetUsers, upsertUser } from './auth/demo-support';

const EMAILS = ['reuse-demo-buyer@example.com'];

async function main(): Promise<void> {
  await resetUsers(EMAILS);
  await upsertUser(EMAILS[0], 'buyer', 0);
  const { app, base } = await bootApi();
  try {
    const login = await http(base, 'POST', '/auth/login', {
      body: { email: EMAILS[0], password: DEMO_PASSWORD },
    });
    const refresh0 = String(login.json.refresh_token ?? '');

    const first = await http(base, 'POST', '/auth/refresh', {
      body: { refresh_token: refresh0 },
    });
    const refresh1 = String(first.json.refresh_token ?? '');

    const reuse = await http(base, 'POST', '/auth/refresh', {
      body: { refresh_token: refresh0 },
    });
    const after = await http(base, 'POST', '/auth/refresh', {
      body: { refresh_token: refresh1 },
    });

    const rows = {
      login: login.status,
      'r1-refresh': first.status,
      'r1-reuse': reuse.status,
      'r2-after-reuse': after.status,
    };
    const ok =
      rows.login === 200 &&
      rows['r1-refresh'] === 200 &&
      rows['r1-reuse'] === 401 &&
      rows['r2-after-reuse'] === 401;
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
