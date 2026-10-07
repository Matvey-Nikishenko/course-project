import { Queryable } from './queryable';

export type UserRow = {
  id: string;
  email: string;
  role: 'buyer' | 'seller';
  balance_cents: number;
};

export class UsersRepo {
  constructor(private readonly db: Queryable) {}

  async create(input: {
    email: string;
    role: 'buyer' | 'seller';
    balanceCents?: number;
  }): Promise<UserRow> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users (email, role, balance_cents)
       VALUES ($1, $2, $3)
       RETURNING id, email, role, balance_cents`,
      [input.email, input.role, input.balanceCents ?? 0],
    );
    return rows[0];
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT id, email, role, balance_cents FROM users WHERE email = $1`,
      [email],
    );
    return rows[0] ?? null;
  }

  /** SQL-only: unique email is upserted, not failed. A mock of create() cannot show this. */
  async upsertByEmail(input: {
    email: string;
    role: 'buyer' | 'seller';
    balanceCents?: number;
  }): Promise<UserRow> {
    const { rows } = await this.db.query<UserRow>(
      `INSERT INTO users (email, role, balance_cents)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role
       RETURNING id, email, role, balance_cents`,
      [input.email, input.role, input.balanceCents ?? 0],
    );
    return rows[0];
  }
}
