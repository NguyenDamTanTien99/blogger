import { Hono } from 'hono';
import { z } from 'zod';
import { MB, ROLES } from '../../shared/constants';
import { hashPasswordKey, normalizeEmail } from '../../shared/crypto';
import type { AdminUserDTO } from '../../shared/types';
import type { AppEnv } from '../env';
import { currentUser, requireAdmin } from '../middleware';
import { audit } from '../lib/audit';
import { abortUploads, deleteObjects } from '../lib/files';
import { badRequest, conflict, notFound } from '../lib/http';
import { toUser, USER_COLUMNS, type UserRow } from '../lib/mappers';
import { getSettings } from '../lib/settings';
import { newId } from '../lib/util';
import { emailField, nameField, passwordKey, readJson } from '../lib/validate';

const users = new Hono<AppEnv>();
users.use('*', requireAdmin);

const quotaMB = z.number().int().min(0).max(1024 * 1024);

users.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${USER_COLUMNS},
       (SELECT COUNT(*) FROM notes n WHERE n.owner_id = users.id) AS notes,
       (SELECT COUNT(*) FROM files f WHERE f.owner_id = users.id AND f.deleted_at IS NULL) AS files
     FROM users ORDER BY role = 'admin' DESC, created_at ASC`,
  ).all<UserRow & { notes: number; files: number }>();
  const items: AdminUserDTO[] = results.map((r) => ({ ...toUser(r), notes: r.notes, files: r.files }));
  return c.json({ items });
});

users.post('/', async (c) => {
  const body = await readJson(
    c,
    z.object({
      email: emailField,
      name: nameField,
      role: z.enum(ROLES),
      key: passwordKey,
      storageQuotaMB: quotaMB.optional(),
    }),
  );
  const email = normalizeEmail(body.email);
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) throw conflict('Email này đã được sử dụng.');

  const settings = await getSettings(c.env);
  const quota = (body.storageQuotaMB ?? settings.defaultQuotaMB) * MB;
  const id = newId();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, role, status, password_hash, storage_quota, storage_used, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, 0, ?, ?)`,
  )
    .bind(id, email, body.name, body.role, await hashPasswordKey(body.key), quota, now, now)
    .run();
  audit(c, 'user.create', { target: email, detail: { role: body.role, quotaMB: quota / MB } });
  const row = await c.env.DB.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
  return c.json({ user: toUser(row!) }, 201);
});

async function otherActiveAdmins(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active' AND id != ?")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

users.patch('/:id', async (c) => {
  const me = currentUser(c);
  const id = c.req.param('id');
  const body = await readJson(
    c,
    z.object({
      email: emailField.optional(),
      name: nameField.optional(),
      role: z.enum(ROLES).optional(),
      status: z.enum(['active', 'disabled']).optional(),
      storageQuotaMB: quotaMB.optional(),
      key: passwordKey.optional(),
    }),
  );
  const db = c.env.DB;
  const target = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
  if (!target) throw notFound('Không tìm thấy người dùng.');

  const email = body.email ? normalizeEmail(body.email) : target.email;
  if (email !== target.email) {
    // Salt của khóa mật khẩu gắn với email => đổi email bắt buộc đặt lại mật khẩu cùng lúc.
    if (!body.key) throw badRequest('Đổi email cần đặt lại mật khẩu cho người dùng.');
    const taken = await db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').bind(email, id).first();
    if (taken) throw conflict('Email này đã được sử dụng.');
  }

  const losingAdmin =
    target.role === 'admin' && target.status === 'active' && (body.role === 'user' || body.status === 'disabled');
  if (losingAdmin && (await otherActiveAdmins(db, id)) === 0) {
    throw conflict('Không thể hạ quyền hoặc khóa admin cuối cùng của hệ thống.');
  }
  if (id === me.id && body.status === 'disabled') throw badRequest('Bạn không thể tự khóa tài khoản của mình.');

  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  set('updated_at', Date.now());
  if (email !== target.email) set('email', email);
  if (body.name !== undefined) set('name', body.name);
  if (body.role !== undefined) set('role', body.role);
  if (body.status !== undefined) set('status', body.status);
  if (body.storageQuotaMB !== undefined) set('storage_quota', body.storageQuotaMB * MB);
  if (body.key !== undefined) set('password_hash', await hashPasswordKey(body.key));

  const statements = [db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id)];
  // Khóa tài khoản / đặt lại mật khẩu / đổi quyền => buộc đăng nhập lại.
  if (body.status === 'disabled' || body.key !== undefined || (body.role && body.role !== target.role)) {
    if (id === me.id) statements.push(db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(id, me.sessionId));
    else statements.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  }
  await db.batch(statements);

  audit(c, 'user.update', {
    target: target.email,
    detail: { ...body, key: body.key ? '(đã đặt lại)' : undefined },
  });
  const row = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
  return c.json({ user: toUser(row!) });
});

users.delete('/:id', async (c) => {
  const me = currentUser(c);
  const id = c.req.param('id');
  if (id === me.id) throw badRequest('Bạn không thể tự xóa tài khoản của mình.');
  const db = c.env.DB;
  const target = await db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
  if (!target) throw notFound('Không tìm thấy người dùng.');
  if (target.role === 'admin' && (await otherActiveAdmins(db, id)) === 0) {
    throw conflict('Không thể xóa admin cuối cùng của hệ thống.');
  }

  // Xóa dữ liệu trên R2 trước, sau đó xóa user (ghi chú, thư mục, file, phiên... tự xóa theo ON DELETE CASCADE).
  const [files, uploads] = await db.batch([
    db.prepare('SELECT r2_key FROM files WHERE owner_id = ?').bind(id),
    db.prepare('SELECT r2_key, r2_upload_id FROM uploads WHERE owner_id = ?').bind(id),
  ]);
  await deleteObjects(c.env.BUCKET, (files!.results as { r2_key: string }[]).map((f) => f.r2_key));
  await abortUploads(c.env.BUCKET, uploads!.results as { r2_key: string; r2_upload_id: string | null }[]);
  await db.prepare('DELETE FROM users WHERE id = ?').bind(id).run();

  audit(c, 'user.delete', { target: target.email, detail: { files: files!.results.length } });
  return c.body(null, 204);
});

export default users;
