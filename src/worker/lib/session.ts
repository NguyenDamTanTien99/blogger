import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SESSION_REFRESH_AFTER_MS, SESSION_TTL_MS, type Role } from '../../shared/constants';
import { sha256, toBase64Url, toHex } from '../../shared/crypto';
import type { AppContext, SessionUser } from '../env';
import { clientIp, isHttps } from './util';

// Trên HTTPS dùng tiền tố __Host- (bắt buộc Secure, Path=/, không Domain) để chống cookie injection từ subdomain.
const SECURE_NAME = '__Host-wb_session';
const DEV_NAME = 'wb_session';

function readToken(c: AppContext): string | undefined {
  const token = getCookie(c, SECURE_NAME) ?? getCookie(c, DEV_NAME);
  return token && token.length <= 64 ? token : undefined;
}

function writeCookie(c: AppContext, token: string) {
  const secure = isHttps(c);
  setCookie(c, secure ? SECURE_NAME : DEV_NAME, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

async function sessionId(token: string): Promise<string> {
  return toHex(await sha256(token));
}

export async function createSession(c: AppContext, userId: string): Promise<void> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await c.env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(await sessionId(token), userId, now, now + SESSION_TTL_MS, (c.req.header('user-agent') ?? '').slice(0, 300), clientIp(c))
    .run();
  writeCookie(c, token);
}

export async function destroySession(c: AppContext): Promise<void> {
  const token = readToken(c);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sessionId(token)).run();
  deleteCookie(c, SECURE_NAME, { path: '/', secure: true });
  deleteCookie(c, DEV_NAME, { path: '/' });
}

interface SessionRow {
  sid: string;
  expires_at: number;
  id: string;
  email: string;
  name: string;
  role: Role;
  status: string;
  storage_quota: number;
  storage_used: number;
}

/** 1 lượt đọc D1 cho mỗi request có cookie. Phiên bị thu hồi/khóa tài khoản có hiệu lực ngay lập tức. */
export async function loadSessionUser(c: AppContext): Promise<SessionUser | null> {
  const token = readToken(c);
  if (!token) return null;
  const id = await sessionId(token);
  const now = Date.now();
  const row = await c.env.DB.prepare(
    `SELECT s.id AS sid, s.expires_at, u.id, u.email, u.name, u.role, u.status, u.storage_quota, u.storage_used
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(id, now)
    .first<SessionRow>();
  if (!row || row.status !== 'active') return null;

  // Sliding expiration: gia hạn tối đa 1 lần/ngày.
  if (now + SESSION_TTL_MS - row.expires_at > SESSION_REFRESH_AFTER_MS) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(now + SESSION_TTL_MS, id).run(),
    );
    writeCookie(c, token);
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    storageQuota: row.storage_quota,
    storageUsed: row.storage_used,
    sessionId: row.sid,
  };
}
