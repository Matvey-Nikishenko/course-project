import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { Env } from '../config/env.schema';
import { TypeormService } from '../typeorm/typeorm.service';
import { hashPassword, verifyPassword } from './passwords';
import {
  ACCESS_TTL_SECONDS,
  AccessClaims,
  hashRefreshToken,
  loadSigningKeys,
  REFRESH_TTL_SECONDS,
  signAccess,
  SigningKeys,
  verifyAccess,
} from './tokens';

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
};

type RefreshRow = {
  id: string;
  user_id: string;
  family_id: string;
  used_at: Date | string | null;
  revoked_at: Date | string | null;
  expires_at: Date | string;
};

function rowsOf<T>(raw: unknown): T[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  if (Array.isArray(raw[0])) return raw[0] as T[];
  return raw as T[];
}

function unauthorized(detail: string): UnauthorizedException {
  return new UnauthorizedException({ code: 'unauthorized', detail });
}

@Injectable()
export class AuthService {
  private readonly keys: SigningKeys;
  private readonly pepper: string;

  constructor(
    private readonly typeorm: TypeormService,
    config: ConfigService<Env, true>,
  ) {
    this.keys = loadSigningKeys(process.env);
    this.pepper = config.get('REFRESH_TOKEN_PEPPER', { infer: true });
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const users = rowsOf<{ id: string; role: string; password_hash: string | null }>(
      await this.typeorm.ds.query(
        `SELECT id, role, password_hash FROM users WHERE email = $1`,
        [email],
      ),
    );
    const user = users[0];
    const ok = await verifyPassword(password, user?.password_hash ?? null);
    if (!user || !ok) throw unauthorized('invalid email or password');
    return this.issue(user.id, user.role, randomUUID());
  }

  async refresh(rawToken: string): Promise<TokenPair> {
    const hash = hashRefreshToken(this.pepper, rawToken);
    // A thrown exception rolls the transaction back. Reuse must commit the
    // family revoke, then fail the request. The 401 is raised after commit.
    const outcome = await this.typeorm.ds.transaction(async (manager) => {
      const rows = rowsOf<RefreshRow>(
        await manager.query(
          `SELECT id, user_id, family_id, used_at, revoked_at, expires_at
           FROM refresh_tokens
           WHERE token_hash = $1
           FOR UPDATE`,
          [hash],
        ),
      );
      const row = rows[0];
      if (!row) return { kind: 'reject' as const, detail: 'unknown refresh token' };
      if (row.used_at) {
        await this.revokeFamily(manager, row.family_id);
        return { kind: 'reuse' as const, familyId: row.family_id };
      }
      if (row.revoked_at) return { kind: 'reject' as const, detail: 'refresh token revoked' };
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        return { kind: 'reject' as const, detail: 'refresh token expired' };
      }
      await manager.query(`UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, [row.id]);
      const users = rowsOf<{ id: string; role: string }>(
        await manager.query(`SELECT id, role FROM users WHERE id = $1`, [row.user_id]),
      );
      const user = users[0];
      if (!user) return { kind: 'reject' as const, detail: 'unknown refresh token' };
      const pair = await this.issue(user.id, user.role, row.family_id, manager);
      return { kind: 'ok' as const, pair };
    });
    if (outcome.kind === 'reuse') {
      console.error(`refresh token reuse family_id=${outcome.familyId}`);
      throw unauthorized('refresh token reuse');
    }
    if (outcome.kind === 'reject') throw unauthorized(outcome.detail);
    return outcome.pair;
  }

  async logout(claims: AccessClaims): Promise<void> {
    await this.typeorm.ds.transaction(async (manager) => {
      await this.revokeFamily(manager, claims.familyId);
      await manager.query(
        `INSERT INTO access_denylist (jti, expires_at)
         VALUES ($1, to_timestamp($2))
         ON CONFLICT (jti) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
        [claims.jti, claims.exp],
      );
      await manager.query(`DELETE FROM access_denylist WHERE expires_at < now()`);
    });
  }

  async authenticate(token: string): Promise<AccessClaims> {
    let claims: AccessClaims;
    try {
      claims = verifyAccess(this.keys, token);
    } catch {
      throw unauthorized('invalid access token');
    }
    const denied = rowsOf<{ jti: string }>(
      await this.typeorm.ds.query(
        `SELECT jti FROM access_denylist WHERE jti = $1 AND expires_at > now()`,
        [claims.jti],
      ),
    );
    if (denied.length > 0) throw unauthorized('access token revoked');
    return claims;
  }

  private async issue(
    userId: string,
    role: string,
    familyId: string,
    manager: EntityManager | null = null,
  ): Promise<TokenPair> {
    const raw = randomBytes(32).toString('base64url');
    const hash = hashRefreshToken(this.pepper, raw);
    const exec = manager ?? this.typeorm.ds;
    await exec.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [userId, familyId, hash, REFRESH_TTL_SECONDS],
    );
    const { token } = signAccess(this.keys, { userId, role, familyId });
    return {
      access_token: token,
      refresh_token: raw,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
    };
  }

  private async revokeFamily(manager: EntityManager, familyId: string): Promise<void> {
    await manager.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
  }
}

export { hashPassword };
