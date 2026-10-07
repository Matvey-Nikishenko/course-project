import { UsersRepo } from '../../src/repos/users.repo';
import { aUser } from '../testkit/builders';
import { PgHandle, startPg, truncateAll } from '../testkit/pg-container';

describe('UsersRepo', () => {
  let pg: PgHandle;
  let repo: UsersRepo;

  beforeAll(async () => {
    pg = await startPg('(users.repo)');
    repo = new UsersRepo(pg.pool);
  });

  afterAll(async () => {
    await pg.stop();
  });

  beforeEach(async () => {
    await truncateAll(pg.pool);
  });

  test('create then findByEmail returns the same row', async () => {
    const created = await aUser().withRole('buyer').withBalance(500).insertVia(repo);
    const found = await repo.findByEmail(created.email);
    expect(found).toMatchObject({
      id: created.id,
      email: created.email,
      role: 'buyer',
      balance_cents: 500,
    });
  });

  test('second insert with the same email hits unique constraint 23505', async () => {
    const { email } = await aUser().withEmail('dup@example.com').insertVia(repo);
    await expect(aUser().withEmail(email).insertVia(repo)).rejects.toMatchObject({
      code: '23505',
    });
  });

  test('upsertByEmail ON CONFLICT updates role instead of throwing', async () => {
    const first = await repo.upsertByEmail({
      email: 'once@example.com',
      role: 'buyer',
      balanceCents: 10,
    });
    const second = await repo.upsertByEmail({
      email: 'once@example.com',
      role: 'seller',
      balanceCents: 99,
    });
    expect(second.id).toBe(first.id);
    expect(second.role).toBe('seller');
    expect(await repo.findByEmail('once@example.com')).toMatchObject({ role: 'seller' });
  });
});
