import { AppError, rows } from './http.mjs';
import { newSessionToken, sha256Hex } from './sessions.mjs';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function createToken(db, userId, label) {
  const token = newSessionToken();
  const digest = await sha256Hex(token);
  const createdAt = new Date().toISOString();
  const created = rows(await db.from('lw_tokens').insertIfAbsent({
    token_digest: digest,
    user_id: userId,
    label,
    created_at: createdAt,
  }, { onConflict: 'token_digest' }).select('token_digest'));
  if (created.length !== 1) throw new AppError('token_unavailable', 503);
  return { token, label, created_at: createdAt };
}

export async function listTokens(db, userId) {
  const found = [];
  for (let offset = 0; ; offset += 500) {
    const page = rows(await db.from('lw_tokens')
      .select('token_digest,label,created_at,revoked_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + 499));
    found.push(...page);
    if (page.length < 500) break;
  }
  return found.map((row) => ({
    id: row.token_digest,
    label: row.label,
    created_at: row.created_at,
    revoked_at: row.revoked_at ?? null,
  }));
}

export async function revokeToken(db, userId, digest, now = Date.now()) {
  if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) throw new AppError('invalid_input', 400);
  const revoked = rows(await db.from('lw_tokens')
    .update({ revoked_at: new Date(now).toISOString() })
    .eq('token_digest', digest)
    .eq('user_id', userId)
    .select('token_digest'));
  if (revoked.length !== 1) throw new AppError('token_not_found', 404);
  return { ok: true };
}

export async function validateToken(db, request) {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  if (!match || !TOKEN_PATTERN.test(match[1])) throw new AppError('token_revoked', 401);
  const digest = await sha256Hex(match[1]);
  const found = rows(await db.from('lw_tokens')
    .select('token_digest,user_id,revoked_at')
    .eq('token_digest', digest)
    .limit(1));
  const row = found[0];
  if (!row || row.token_digest !== digest || row.revoked_at != null || typeof row.user_id !== 'string') {
    throw new AppError('token_revoked', 401);
  }
  return { userId: row.user_id };
}
