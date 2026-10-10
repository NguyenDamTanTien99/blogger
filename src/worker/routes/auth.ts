import { Hono } from 'hono';
import { z } from 'zod';
import { LOGIN_MAX_PER_EMAIL, LOGIN_MAX_PER_IP, LOGIN_WINDOW_MS } from '../../shared/constants';
import { hashPasswordKey, normalizeEmail, sha256, verifyPasswordKey } from '../../shared/crypto';
import type { SessionInfo } from '../../shared/types';
import type { AppEnv } from '../env';
import { currentUser, requireAuth } from '../middleware';
import { audit } from '../lib/audit';
import { tooManyRequests, unauthorized } from '../lib/http';
import { toUser, USER_COLUMNS, type UserRow } from '../lib/mappers';
import { createSession, destroySession } from '../lib/session';
import { clientIp } from '../lib/util';
import { emailField, nameField, passwordKey, readJson } from '../lib/validate';

const auth = new Hono<AppEnv>();

auth.post('/login', async (c) => {
  const body = await readJson(c, z.object({ email: emailField, key: passwordKey }));
  const email = normalizeEmail(body.email);
  const ip = clientIp(c);
  const now = Date.now();
  const db = c.env.DB;

  // Chống dò mật khẩu: giới hạn theo email và theo IP trong cửa sổ 15 phút.
  const counts = await db
    .prepare(
      `SELECT COALESCE(SUM(email = ?1), 0) AS by_email, COALESCE(SUM(ip = ?2), 0) AS by_ip
       FROM login_attempts WHERE created_at > ?3 AND (email = ?1 OR ip = ?2)`,
    )
    .bind(email, ip, now - LOGIN_WINDOW_MS)
    .first<{ by_email: number; by_ip: number }>();
  if ((counts?.by_email ?? 0) >= LOGIN_MAX_PER_EMAIL || (counts?.by_ip ?? 0) >= LOGIN_MAX_PER_IP) {
    throw tooManyRequests('Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.');
  }

  const user = await db
    .prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`)
    .bind(email)
    .first<UserRow & { password_hash: string }>();
  let ok = false;
  if (user) ok = await verifyPasswordKey(body.key, user.password_hash);
  else await sha256(body.key); // cân bằng thời gian phản hồi khi email không tồn tại

  if (!user || !ok) {
    await db.prepare('INSERT INTO login_attempts (email, ip, created_at) VALUES (?, ?, ?)').bind(email, ip, now).run();
    throw unauthorized('Email hoặc mật khẩu không đúng.');
  }
  if (user.status !== 'active') throw unauthorized('Tài khoản đã bị vô hiệu hóa. Hãy liên hệ admin.');

  await createSession(c, user.id);
  await db.batch([
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id),
    db.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email),
  ]);
  audit(c, 'auth.login', { actor: { id: user.id, email: user.email } });
  return c.json({ user: toUser({ ...user, last_login_at: now }) });
});

auth.post('/logout', async (c) => {
  await destroySession(c);
  return c.body(null, 204);
});

/** Công khai: trả về { user: null } khi chưa đăng nhập (tránh lỗi 401 vô nghĩa trên console). */
auth.get('/me', async (c) => {
  const me = c.get('user');
  if (!me) return c.json({ user: null });
  const row = await c.env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(me.id).first<UserRow>();
  return c.json({ user: row ? toUser(row) : null });
});

auth.use('*', requireAuth);

auth.patch('/me', async (c) => {
  const me = currentUser(c);
  const body = await readJson(c, z.object({ name: nameField }));
  await c.env.DB.prepare('UPDATE users SET name = ?, updated_at = ? WHERE id = ?').bind(body.name, Date.now(), me.id).run();
  const row = await c.env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(me.id).first<UserRow>();
  return c.json({ user: toUser(row!) });
});

auth.post('/password', async (c) => {
  const me = currentUser(c);
  const body = await readJson(c, z.object({ currentKey: passwordKey, newKey: passwordKey }));
  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(me.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPasswordKey(body.currentKey, row.password_hash))) {
    throw unauthorized('Mật khẩu hiện tại không đúng.');
  }
  const db = c.env.DB;
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(await hashPasswordKey(body.newKey), Date.now(), me.id),
    // Đổi mật khẩu => đăng xuất mọi thiết bị khác.
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(me.id, me.sessionId),
  ]);
  audit(c, 'auth.password_changed', { target: me.id });
  return c.body(null, 204);
});

auth.get('/sessions', async (c) => {
  const me = currentUser(c);
  const { results } = await c.env.DB.prepare(
    'SELECT id, user_agent, ip, created_at, expires_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC',
  )
    .bind(me.id, Date.now())
    .all<{ id: string; user_agent: string | null; ip: string | null; created_at: number; expires_at: number }>();
  const sessions: SessionInfo[] = results.map((s) => ({
    id: s.id.slice(0, 12),
    userAgent: s.user_agent,
    ip: s.ip,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    current: s.id === me.sessionId,
  }));
  return c.json({ sessions });
});

auth.delete('/sessions/others', async (c) => {
  const me = currentUser(c);
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(me.id, me.sessionId).run();
  audit(c, 'auth.logout_others', { target: me.id });
  return c.body(null, 204);
});

export default auth;
