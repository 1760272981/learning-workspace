import { AppError, applicationPath, errorJson, json, readJson, requireTrustedOrigin, rows } from './http.mjs';
import { canonicalUsername, validatePassword } from './validate.mjs';
import { hashPassword, verifyPassword, verifyPasswordAgainstDummy } from './passwords.mjs';
import { SESSION_TTL_MS, clearSessionCookie, createSession, revokeSession, sessionCookie, validateSession } from './sessions.mjs';
import { consume } from './limiter.mjs';
import { createToken, listTokens, revokeToken, validateToken } from './tokens.mjs';
import { handleLearningStore } from './handler.ts';

const SESSION_TTL_SECONDS = Math.floor(SESSION_TTL_MS / 1000);
const encoder = new TextEncoder();
const BUSINESS_ACTIONS = new Set(['store', 'submit', 'mark', 'verify', 'delete', 'updates', 'update', 'accept']);

class SessionRequired extends Error {
  constructor(state) {
    super('login_required');
    this.state = state;
  }
}

const retryAfter = (result) => ({ 'retry-after': String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) });

function unauthorized(state) {
  return state === 'invalid'
    ? errorJson('session_expired', 401, { 'set-cookie': clearSessionCookie() })
    : errorJson('login_required', 401);
}

async function requireSession(db, request) {
  const result = await validateSession(db, request);
  if (result.state !== 'valid') throw new SessionRequired(result.state);
  return result.session;
}

async function loadUser(db, userId) {
  const found = rows(await db.from('lw_users').select('id,username').eq('id', userId).limit(1));
  if (found.length !== 1 || typeof found[0]?.username !== 'string') throw new AppError('session_expired', 401);
  return { id: found[0].id, username: found[0].username };
}

async function requireIdentity(db, request) {
  if (request.headers.has('authorization')) {
    const token = await validateToken(db, request);
    return loadUser(db, token.userId);
  }
  const session = await requireSession(db, request);
  return loadUser(db, session.userId);
}

function boundedPassword(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || encoder.encode(raw).length > 256) {
    throw new AppError('invalid_input', 400);
  }
  return raw;
}

async function cleanupExpiredSessions(db, userId) {
  try {
    const found = rows(await db.from('lw_sessions').select('token_digest,expires_at').eq('user_id', userId).limit(100));
    const now = Date.now();
    for (const row of found) {
      const expiresAt = Date.parse(row.expires_at);
      if (Number.isFinite(expiresAt) && expiresAt <= now) {
        await db.from('lw_sessions').delete().eq('token_digest', row.token_digest).eq('user_id', userId);
      }
    }
  } catch {
    // 清理是尽力而为，不因历史会话堆积阻断本次登录。
  }
}

async function register(db, request) {
  const body = await readJson(request);
  const username = canonicalUsername(body?.username);
  const password = validatePassword(body?.password);
  const limit = await consume(db, 'register', username);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));

  const existing = rows(await db.from('lw_users').select('id').eq('username', username).limit(1));
  if (existing.length > 0) return errorJson('username_taken', 409);

  const derived = await hashPassword(password);
  const id = crypto.randomUUID();
  const created = rows(await db.from('lw_users').insertIfAbsent({
    id,
    username,
    password_salt: derived.salt,
    password_hash: derived.hash,
    password_iterations: derived.iterations,
    created_at: new Date().toISOString(),
  }, { onConflict: 'username' }).select('id,username'));

  if (created.length !== 1) {
    const winner = rows(await db.from('lw_users').select('id').eq('username', username).limit(1));
    if (winner.length === 1) return errorJson('username_taken', 409);
    return errorJson('registration_unconfirmed', 503);
  }

  const { token } = await createSession(db, id);
  return json({ user: { id, username } }, 201, { 'set-cookie': sessionCookie(token, SESSION_TTL_SECONDS) });
}

async function login(db, request) {
  const body = await readJson(request);
  const username = canonicalUsername(body?.username);
  const limit = await consume(db, 'login', username);
  if (!limit.allowed) return errorJson('rate_limited', 429, retryAfter(limit));

  const password = boundedPassword(body?.password);
  const found = rows(await db.from('lw_users')
    .select('id,username,password_salt,password_hash,password_iterations').eq('username', username).limit(1));

  if (found.length !== 1) {
    await verifyPasswordAgainstDummy(password);
    return errorJson('invalid_credentials', 401);
  }

  const user = found[0];
  const ok = await verifyPassword(password, {
    salt: user.password_salt, hash: user.password_hash, iterations: user.password_iterations,
  });
  if (!ok) return errorJson('invalid_credentials', 401);

  await cleanupExpiredSessions(db, user.id);
  const { token } = await createSession(db, user.id);
  return json({ user: { id: user.id, username: user.username } }, 200, { 'set-cookie': sessionCookie(token, SESSION_TTL_SECONDS) });
}

async function logout(db, request) {
  const result = await validateSession(db, request);
  if (result.state === 'valid' && result.session) {
    try {
      await revokeSession(db, result.session.digest);
    } catch {
      return errorJson('logout_unconfirmed', 503);
    }
  }
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}

function tokenLabel(body) {
  const label = typeof body?.label === 'string' ? body.label.trim() : '';
  if (!label || [...label].length > 80) throw new AppError('invalid_input', 400);
  return label;
}

async function route(db, request, origin) {
  requireTrustedOrigin(request, origin);
  const path = applicationPath(request);

  if (path === '/api/health' && request.method === 'GET') return json({ ok: true });
  if (path === '/api/register' && request.method === 'POST') return register(db, request);
  if (path === '/api/login' && request.method === 'POST') return login(db, request);
  if (path === '/api/logout' && request.method === 'POST') return logout(db, request);

  if (path === '/api/me' && request.method === 'GET') {
    const user = await requireIdentity(db, request);
    return json({ user });
  }

  if (path === '/api/tokens' && request.method === 'GET') {
    const session = await requireSession(db, request);
    return json({ tokens: await listTokens(db, session.userId) });
  }
  if (path === '/api/tokens' && request.method === 'POST') {
    const session = await requireSession(db, request);
    const label = tokenLabel(await readJson(request));
    return json(await createToken(db, session.userId, label), 201);
  }
  const tokenRoute = path.match(/^\/api\/tokens\/([0-9a-f]{64})$/);
  if (tokenRoute && request.method === 'DELETE') {
    const session = await requireSession(db, request);
    return json(await revokeToken(db, session.userId, tokenRoute[1]));
  }

  const businessPath = path.match(/^\/api\/(store|submit|mark|verify|delete|updates|update|accept)$/);
  const queryAction = path === '/' ? new URL(request.url).searchParams.get('action') : null;
  const action = businessPath?.[1] || queryAction;
  if (action && BUSINESS_ACTIONS.has(action)) {
    // 用户验收只认网页会话身份，个人令牌（agent）不能代记验收
    const user = action === 'accept'
      ? await loadUser(db, (await requireSession(db, request)).userId)
      : await requireIdentity(db, request);
    return handleLearningStore({ request, db, ownerId: user.id });
  }

  if (['/api/me', '/api/logout', '/api/register', '/api/login', '/api/tokens'].includes(path) || businessPath) {
    throw new AppError('method_not_allowed', 405);
  }
  throw new AppError('not_found', 404);
}

export function createApplication({ db, origin }) {
  return async function handle(ctx) {
    try {
      return await route(db, ctx.request, typeof origin === 'function' ? origin() : origin);
    } catch (error) {
      if (error instanceof SessionRequired) return unauthorized(error.state);
      if (error instanceof AppError) return errorJson(error.code, error.status);
      return errorJson('service_unavailable', 503);
    }
  };
}
