import dataSource from './data-source';
import { User } from './entities/user';
import { pgErrorCode, withSerializationRetry } from './retry';

const EMAIL = 'buyer-dmytro@example.com';
const START = 1_000_000;

let arrived = 0;

async function bumpBalance(): Promise<void> {
  await dataSource.transaction('REPEATABLE READ', async (manager) => {
    const rows: { balance_cents: number }[] = await manager.query(
      `SELECT balance_cents FROM users WHERE email = $1`,
      [EMAIL],
    );
    const current = Number(rows[0].balance_cents);
    const wave = ++arrived;
    if (wave <= 2) {
      while (arrived < 2) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await manager.query(`UPDATE users SET balance_cents = $1 WHERE email = $2`, [
      current + 1,
      EMAIL,
    ]);
  });
}

async function main(): Promise<void> {
  await dataSource.initialize();
  const userRepo = dataSource.getRepository(User);
  const user = await userRepo.findOneByOrFail({ email: EMAIL });
  user.balanceCents = START;
  await userRepo.save(user);

  let retries = 0;
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    const line = args.map(String).join(' ');
    if (/40001|40P01/.test(line)) retries += 1;
    originalLog.apply(console, args);
  };

  await Promise.all([
    withSerializationRetry(() => bumpBalance(), { label: 'rmw-a' }),
    withSerializationRetry(() => bumpBalance(), { label: 'rmw-b' }),
  ]);

  console.log = originalLog;

  const [{ balance_cents }] = await dataSource.query<{ balance_cents: number }[]>(
    `SELECT balance_cents FROM users WHERE email = $1`,
    [EMAIL],
  );
  const finalBalance = Number(balance_cents);
  console.log(`caught retryable codes: ${retries}`);
  console.log(`final balance_cents: ${finalBalance} (expected ${START + 2})`);

  const ok = retries >= 1 && finalBalance === START + 2;
  await dataSource.destroy();
  if (!ok) {
    console.error('retry demo failed: missing 40001/40P01 or lost update');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  console.error(pgErrorCode(err));
  process.exit(1);
});
