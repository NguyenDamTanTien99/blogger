import { Hono } from 'hono';
import { z } from 'zod';
import { NOTE_MAX_BYTES } from '../../shared/constants';
import { normalizeTags, tagsFromDb, tagsToDb } from '../../shared/text';
import type { AppEnv, SessionUser } from '../env';
import { assertOwnerOrAdmin, currentUser, isAdmin, requireAuth } from '../middleware';
import { audit } from '../lib/audit';
import { conflict, notFound, tooLarge } from '../lib/http';
import { toNote, toNoteSummary, type NoteRow } from '../lib/mappers';
import { likeContains, newId, utf8Length } from '../lib/util';
import { pageQuery, readJson, readQuery } from '../lib/validate';

const notes = new Hono<AppEnv>();
notes.use('*', requireAuth);

const NOTE_SELECT = `SELECT n.*, u.name AS owner_name, e.name AS updated_by_name
  FROM notes n JOIN users u ON u.id = n.owner_id LEFT JOIN users e ON e.id = n.updated_by`;

async function loadNote(db: D1Database, user: SessionUser, id: string): Promise<NoteRow> {
  const row = await db.prepare(`${NOTE_SELECT} WHERE n.id = ?`).bind(id).first<NoteRow>();
  if (!row) throw notFound('Không tìm thấy ghi chú.');
  // User thường không được biết note của người khác có tồn tại hay không.
  if (!isAdmin(user) && row.owner_id !== user.id) throw notFound('Không tìm thấy ghi chú.');
  return row;
}

function checkSize(content: string | undefined) {
  if (content !== undefined && utf8Length(content) > NOTE_MAX_BYTES) {
    throw tooLarge('Ghi chú quá dài (tối đa ~1MB). Hãy tách thành nhiều ghi chú hoặc đính kèm file.');
  }
}

notes.get('/', async (c) => {
  const me = currentUser(c);
  const q = readQuery(
    c,
    z.object({
      q: z.string().max(200).optional(),
      tag: z.string().max(40).optional(),
      owner: z.string().max(40).optional(),
      ...pageQuery,
    }),
  );
  const where: string[] = [];
  const params: unknown[] = [];
  if (!isAdmin(me)) {
    where.push('n.owner_id = ?');
    params.push(me.id);
  } else if (q.owner) {
    where.push('n.owner_id = ?');
    params.push(q.owner);
  }
  const term = q.q?.trim();
  if (term) {
    where.push("(n.title LIKE ? ESCAPE '\\' OR n.content LIKE ? ESCAPE '\\')");
    params.push(likeContains(term), likeContains(term));
  }
  if (q.tag) {
    where.push("n.tags LIKE ? ESCAPE '\\'");
    params.push(likeContains(`,${q.tag.toLowerCase()},`));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = c.env.DB;
  const [list, count] = await db.batch([
    db
      .prepare(
        `SELECT n.id, n.owner_id, u.name AS owner_name, n.title, substr(n.content, 1, 240) AS snippet,
                n.tags, n.pinned, n.created_at, n.updated_at
         FROM notes n JOIN users u ON u.id = n.owner_id ${whereSql}
         ORDER BY n.pinned DESC, n.updated_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, q.pageSize, (q.page - 1) * q.pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM notes n ${whereSql}`).bind(...params),
  ]);
  return c.json({
    items: (list!.results as NoteRow[]).map(toNoteSummary),
    total: (count!.results[0] as { total: number }).total,
    page: q.page,
    pageSize: q.pageSize,
  });
});

/** Danh sách thẻ đang dùng (để lọc nhanh). */
notes.get('/tags', async (c) => {
  const me = currentUser(c);
  const owner = isAdmin(me) ? c.req.query('owner') : me.id;
  const stmt = owner
    ? c.env.DB.prepare("SELECT tags FROM notes WHERE owner_id = ? AND tags != ''").bind(owner)
    : c.env.DB.prepare("SELECT tags FROM notes WHERE tags != ''");
  const { results } = await stmt.all<{ tags: string }>();
  const counts = new Map<string, number>();
  for (const r of results) for (const t of tagsFromDb(r.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  return c.json({ tags });
});

const noteBody = z.object({
  title: z.string().max(300).optional(),
  content: z.string().optional(),
  tags: z.array(z.string().max(60)).max(50).optional(),
  pinned: z.boolean().optional(),
});

notes.post('/', async (c) => {
  const me = currentUser(c);
  const body = await readJson(c, noteBody);
  checkSize(body.content);
  const id = newId();
  const now = Date.now();
  await c.env.DB.prepare(
    `INSERT INTO notes (id, owner_id, title, content, tags, pinned, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, me.id, body.title ?? '', body.content ?? '', tagsToDb(normalizeTags(body.tags ?? [])), body.pinned ? 1 : 0, now, now, me.id)
    .run();
  return c.json({ note: toNote(await loadNote(c.env.DB, me, id)) }, 201);
});

notes.get('/:id', async (c) => {
  const me = currentUser(c);
  return c.json({ note: toNote(await loadNote(c.env.DB, me, c.req.param('id'))) });
});

notes.patch('/:id', async (c) => {
  const me = currentUser(c);
  const body = await readJson(c, noteBody.extend({ baseUpdatedAt: z.number().int().optional() }));
  checkSize(body.content);
  const current = await loadNote(c.env.DB, me, c.req.param('id'));
  assertOwnerOrAdmin(me, current.owner_id);
  // Chống ghi đè khi 2 người (ví dụ admin và chủ note) cùng sửa một lúc.
  if (body.baseUpdatedAt !== undefined && body.baseUpdatedAt !== current.updated_at) {
    throw conflict('Ghi chú vừa được cập nhật ở nơi khác. Hãy tải lại để xem bản mới nhất.', {
      details: { note: toNote(current) },
    });
  }
  const now = Math.max(Date.now(), current.updated_at + 1);
  await c.env.DB.prepare(
    'UPDATE notes SET title = ?, content = ?, tags = ?, pinned = ?, updated_at = ?, updated_by = ? WHERE id = ?',
  )
    .bind(
      body.title ?? current.title,
      body.content ?? current.content ?? '',
      body.tags ? tagsToDb(normalizeTags(body.tags)) : current.tags,
      body.pinned === undefined ? current.pinned : body.pinned ? 1 : 0,
      now,
      me.id,
      current.id,
    )
    .run();
  return c.json({ note: toNote(await loadNote(c.env.DB, me, current.id)) });
});

notes.delete('/:id', async (c) => {
  const me = currentUser(c);
  const note = await loadNote(c.env.DB, me, c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM notes WHERE id = ?').bind(note.id).run();
  if (note.owner_id !== me.id) audit(c, 'note.delete', { target: note.id, detail: { owner: note.owner_name, title: note.title } });
  return c.body(null, 204);
});

export default notes;
