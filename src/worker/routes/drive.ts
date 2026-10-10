import { Hono } from 'hono';
import { z } from 'zod';
import type { DriveListing, OwnerRef } from '../../shared/types';
import type { AppContext, AppEnv, SessionUser } from '../env';
import { currentUser, isAdmin } from '../middleware';
import { audit } from '../lib/audit';
import { streamFile, type FileRow } from '../lib/files';
import { badRequest, conflict, notFound } from '../lib/http';
import { toFile, toFolder, type FolderRow } from '../lib/mappers';
import { likeContains, newId, sanitizeFileName, sanitizeFolderName } from '../lib/util';
import { pageQuery, readJson, readQuery } from '../lib/validate';

// Mount tại /api (không có tiền tố riêng) nên KHÔNG dùng drive.use('*') — xác thực đã chặn ở router API.
const drive = new Hono<AppEnv>();

const FILE_SELECT = 'SELECT f.*, u.name AS owner_name FROM files f JOIN users u ON u.id = f.owner_id';

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

export async function loadFolder(db: D1Database, user: SessionUser, id: string): Promise<FolderRow> {
  const row = await db.prepare('SELECT * FROM folders WHERE id = ?').bind(id).first<FolderRow>();
  if (!row || (!isAdmin(user) && row.owner_id !== user.id)) throw notFound('Không tìm thấy thư mục.');
  return row;
}

export async function loadFile(db: D1Database, user: SessionUser, id: string): Promise<FileRow> {
  const row = await db.prepare(`${FILE_SELECT} WHERE f.id = ?`).bind(id).first<FileRow>();
  if (!row || (!isAdmin(user) && row.owner_id !== user.id)) throw notFound('Không tìm thấy file.');
  return row;
}

/** Xóa bản cache của file công khai (Cache API chỉ có hiệu lực khi dùng tên miền riêng). */
export function purgePublicCache(c: AppContext, fileId: string) {
  const key = new Request(new URL(`/f/${fileId}`, c.req.url).toString());
  c.executionCtx.waitUntil(caches.default.delete(key).then(() => undefined, () => undefined));
}

// ---------- Duyệt thư mục ----------

drive.get('/drive', async (c) => {
  const me = currentUser(c);
  const q = readQuery(c, z.object({ folder: z.string().max(40).optional(), owner: z.string().max(40).optional() }));
  const db = c.env.DB;
  const folder = q.folder ? await loadFolder(db, me, q.folder) : null;
  const ownerId = folder ? folder.owner_id : isAdmin(me) && q.owner ? q.owner : me.id;
  const owner = await db.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(ownerId).first<OwnerRef>();
  if (!owner) throw notFound('Không tìm thấy người dùng.');

  const parent = folder?.id ?? null;
  const [crumbs, folders, files] = await db.batch([
    db
      .prepare(
        `WITH RECURSIVE chain(id, parent_id, name, depth) AS (
           SELECT id, parent_id, name, 0 FROM folders WHERE id = ?
           UNION ALL
           SELECT f.id, f.parent_id, f.name, chain.depth + 1 FROM folders f JOIN chain ON f.id = chain.parent_id
           WHERE chain.depth < 64
         ) SELECT id, name FROM chain ORDER BY depth DESC`,
      )
      .bind(parent ?? ''),
    db.prepare('SELECT * FROM folders WHERE owner_id = ? AND parent_id IS ? ORDER BY name COLLATE NOCASE').bind(ownerId, parent),
    db.prepare(`${FILE_SELECT} WHERE f.owner_id = ? AND f.folder_id IS ? ORDER BY f.created_at DESC LIMIT 2000`).bind(ownerId, parent),
  ]);
  const listing: DriveListing = {
    owner,
    folder: folder ? toFolder(folder) : null,
    breadcrumb: crumbs!.results as { id: string; name: string }[],
    folders: (folders!.results as FolderRow[]).map(toFolder),
    files: (files!.results as FileRow[]).map(toFile),
  };
  return c.json(listing);
});

// ---------- Thư mục ----------

/** Toàn bộ thư mục của một người (dựng cây ở client cho hộp thoại "Di chuyển tới"). */
drive.get('/folders', async (c) => {
  const me = currentUser(c);
  const requested = c.req.query('owner');
  const owner = isAdmin(me) && requested ? requested : me.id;
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM folders WHERE owner_id = ? ORDER BY name COLLATE NOCASE LIMIT 5000',
  )
    .bind(owner)
    .all<FolderRow>();
  return c.json({ folders: results.map(toFolder) });
});

drive.post('/folders', async (c) => {
  const me = currentUser(c);
  const body = await readJson(
    c,
    z.object({ name: z.string().max(200), parentId: z.string().max(40).nullish(), ownerId: z.string().max(40).optional() }),
  );
  const name = sanitizeFolderName(body.name);
  if (!name) throw badRequest('Tên thư mục không hợp lệ.');
  const db = c.env.DB;
  const parent = body.parentId ? await loadFolder(db, me, body.parentId) : null;
  const ownerId = parent ? parent.owner_id : isAdmin(me) && body.ownerId ? body.ownerId : me.id;
  const id = newId();
  const now = Date.now();
  try {
    await db
      .prepare('INSERT INTO folders (id, owner_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, ownerId, parent?.id ?? null, name, now, now)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Đã có thư mục cùng tên ở vị trí này.');
    if (err instanceof Error && /FOREIGN KEY/i.test(err.message)) throw badRequest('Người dùng không tồn tại.');
    throw err;
  }
  const row = await db.prepare('SELECT * FROM folders WHERE id = ?').bind(id).first<FolderRow>();
  return c.json({ folder: toFolder(row!) }, 201);
});

drive.patch('/folders/:id', async (c) => {
  const me = currentUser(c);
  const body = await readJson(c, z.object({ name: z.string().max(200).optional(), parentId: z.string().max(40).nullish() }));
  const db = c.env.DB;
  const folder = await loadFolder(db, me, c.req.param('id'));
  let parentId = folder.parent_id;
  if (body.parentId !== undefined) {
    parentId = body.parentId ?? null;
    if (parentId) {
      const parent = await loadFolder(db, me, parentId);
      if (parent.owner_id !== folder.owner_id) throw badRequest('Chỉ di chuyển được trong cùng kho của một người dùng.');
      // Không cho chuyển thư mục vào chính nó hoặc thư mục con của nó.
      const cycle = await db
        .prepare(
          `WITH RECURSIVE sub(id) AS (
             SELECT id FROM folders WHERE id = ?1
             UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id
           ) SELECT 1 AS hit FROM sub WHERE id = ?2 LIMIT 1`,
        )
        .bind(folder.id, parentId)
        .first();
      if (cycle) throw badRequest('Không thể chuyển thư mục vào bên trong chính nó.');
    }
  }
  const name = body.name !== undefined ? sanitizeFolderName(body.name) : folder.name;
  if (!name) throw badRequest('Tên thư mục không hợp lệ.');
  try {
    await db
      .prepare('UPDATE folders SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?')
      .bind(name, parentId, Date.now(), folder.id)
      .run();
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('Đã có thư mục cùng tên ở vị trí này.');
    throw err;
  }
  const row = await db.prepare('SELECT * FROM folders WHERE id = ?').bind(folder.id).first<FolderRow>();
  return c.json({ folder: toFolder(row!) });
});

drive.delete('/folders/:id', async (c) => {
  const me = currentUser(c);
  const db = c.env.DB;
  const folder = await loadFolder(db, me, c.req.param('id'));
  const used = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM folders WHERE parent_id = ?1) + (SELECT COUNT(*) FROM files WHERE folder_id = ?1) AS n`,
    )
    .bind(folder.id)
    .first<{ n: number }>();
  if ((used?.n ?? 0) > 0) throw conflict('Thư mục không trống. Hãy xóa hoặc di chuyển nội dung bên trong trước.');
  await db.prepare('DELETE FROM folders WHERE id = ?').bind(folder.id).run();
  return c.body(null, 204);
});

// ---------- File ----------

drive.get('/files', async (c) => {
  const me = currentUser(c);
  const q = readQuery(c, z.object({ q: z.string().max(200).optional(), owner: z.string().max(40).optional(), ...pageQuery }));
  const where: string[] = [];
  const params: unknown[] = [];
  if (!isAdmin(me)) {
    where.push('f.owner_id = ?');
    params.push(me.id);
  } else if (q.owner) {
    where.push('f.owner_id = ?');
    params.push(q.owner);
  }
  const term = q.q?.trim();
  if (term) {
    where.push("(f.name LIKE ? ESCAPE '\\' OR f.description LIKE ? ESCAPE '\\')");
    params.push(likeContains(term), likeContains(term));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = c.env.DB;
  const [list, count] = await db.batch([
    db
      .prepare(`${FILE_SELECT} ${whereSql} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`)
      .bind(...params, q.pageSize, (q.page - 1) * q.pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM files f ${whereSql}`).bind(...params),
  ]);
  return c.json({
    items: (list!.results as FileRow[]).map(toFile),
    total: (count!.results[0] as { total: number }).total,
    page: q.page,
    pageSize: q.pageSize,
  });
});

drive.get('/files/:id', async (c) => {
  const me = currentUser(c);
  return c.json({ file: toFile(await loadFile(c.env.DB, me, c.req.param('id'))) });
});

drive.patch('/files/:id', async (c) => {
  const me = currentUser(c);
  const body = await readJson(
    c,
    z.object({
      name: z.string().max(255).optional(),
      folderId: z.string().max(40).nullish(),
      visibility: z.enum(['private', 'public']).optional(),
      description: z.string().max(2000).optional(),
    }),
  );
  const db = c.env.DB;
  const file = await loadFile(db, me, c.req.param('id'));
  let folderId = file.folder_id;
  if (body.folderId !== undefined) {
    folderId = body.folderId ?? null;
    if (folderId) {
      const folder = await loadFolder(db, me, folderId);
      if (folder.owner_id !== file.owner_id) throw badRequest('Chỉ di chuyển được trong cùng kho của một người dùng.');
    }
  }
  const name = body.name !== undefined ? sanitizeFileName(body.name) : file.name;
  await db
    .prepare('UPDATE files SET name = ?, folder_id = ?, visibility = ?, description = ?, updated_at = ? WHERE id = ?')
    .bind(name, folderId, body.visibility ?? file.visibility, body.description ?? file.description, Date.now(), file.id)
    .run();
  if (file.visibility === 'public' && body.visibility === 'private') purgePublicCache(c, file.id);
  if (file.owner_id !== me.id) audit(c, 'file.update', { target: file.id, detail: { owner: file.owner_name, ...body } });
  return c.json({ file: toFile(await loadFile(db, me, file.id)) });
});

drive.delete('/files/:id', async (c) => {
  const me = currentUser(c);
  const db = c.env.DB;
  const file = await loadFile(db, me, c.req.param('id'));
  await c.env.BUCKET.delete(file.r2_key);
  await db.batch([
    db.prepare('DELETE FROM files WHERE id = ?').bind(file.id),
    db.prepare('UPDATE users SET storage_used = MAX(0, storage_used - ?) WHERE id = ?').bind(file.size, file.owner_id),
  ]);
  if (file.visibility === 'public') purgePublicCache(c, file.id);
  if (file.owner_id !== me.id) audit(c, 'file.delete', { target: file.id, detail: { owner: file.owner_name, name: file.name } });
  return c.body(null, 204);
});

drive.get('/files/:id/content', async (c) => {
  const me = currentUser(c);
  const file = await loadFile(c.env.DB, me, c.req.param('id'));
  return streamFile(c, file, { inline: c.req.query('download') !== '1', isPublic: false });
});

export default drive;
