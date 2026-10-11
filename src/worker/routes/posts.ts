import { Hono } from 'hono';
import { z } from 'zod';
import { POST_MAX_BYTES, RESERVED_SLUGS } from '../../shared/constants';
import { normalizeTags, readingMinutes, slugify, tagsToDb } from '../../shared/text';
import type { AppEnv } from '../env';
import { currentUser, requireAdmin } from '../middleware';
import { audit } from '../lib/audit';
import { badRequest, conflict, notFound, tooLarge } from '../lib/http';
import { POST_SUMMARY_COLUMNS, toPost, toPostSummary, type PostRow } from '../lib/mappers';
import { likeContains, likePrefix, newId, utf8Length } from '../lib/util';
import { pageQuery, readJson, readQuery } from '../lib/validate';

const posts = new Hono<AppEnv>();
posts.use('*', requireAdmin);

const postFields = {
  title: z.string().trim().min(1, 'Tiêu đề không được để trống').max(300),
  slug: z.string().max(120),
  type: z.enum(['post', 'page']),
  excerpt: z.string().max(1000),
  contentMd: z.string(),
  // HTML được render sẵn ở trình duyệt của admin => trang công khai không tốn CPU render markdown.
  contentHtml: z.string(),
  coverUrl: z.string().max(1000),
  tags: z.array(z.string().max(60)).max(50),
  status: z.enum(['draft', 'published']),
  publishedAt: z.number().int().nullable(),
};
const createSchema = z.object(postFields).partial().required({ title: true });
const updateSchema = z.object(postFields).partial().extend({ baseUpdatedAt: z.number().int().optional() });

/** Tóm tắt tự sinh: bỏ tiêu đề, code, ảnh, cú pháp markdown; lấy ~220 ký tự đầu. */
function autoExcerpt(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function checkSize(md: string, html: string) {
  if (utf8Length(md) + utf8Length(html) > POST_MAX_BYTES) {
    throw tooLarge('Bài viết quá dài (tối đa ~1.8MB gồm cả HTML). Hãy dùng ảnh/file đính kèm thay vì nhúng dữ liệu.');
  }
}

/** Slug tự sinh sẽ thêm hậu tố -2, -3...; slug do admin nhập mà bị trùng thì báo lỗi. */
async function resolveSlug(
  db: D1Database,
  input: { explicit?: string; title: string; type: 'post' | 'page' },
  excludeId = '',
): Promise<string> {
  const explicit = input.explicit !== undefined && input.explicit.trim() !== '';
  const base = slugify(explicit ? input.explicit! : input.title) || 'bai-viet';
  if (input.type === 'page' && RESERVED_SLUGS.includes(base)) {
    throw badRequest('Đường dẫn "/{slug}" được hệ thống sử dụng, hãy chọn slug khác.', { vars: { slug: base } });
  }
  const { results } = await db
    .prepare("SELECT slug FROM posts WHERE (slug = ? OR slug LIKE ? ESCAPE '\\') AND id != ?")
    .bind(base, likePrefix(`${base}-`), excludeId)
    .all<{ slug: string }>();
  const taken = new Set(results.map((r) => r.slug));
  if (!taken.has(base)) return base;
  if (explicit) throw conflict('Slug "{slug}" đã được dùng cho bài khác.', { vars: { slug: base } });
  for (let i = 2; i < 1000; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${newId(6).toLowerCase()}`;
}

async function loadPost(db: D1Database, id: string): Promise<PostRow> {
  const row = await db
    .prepare('SELECT p.*, u.name AS author_name FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.id = ?')
    .bind(id)
    .first<PostRow>();
  if (!row) throw notFound('Không tìm thấy bài viết.');
  return row;
}

posts.get('/', async (c) => {
  const q = readQuery(
    c,
    z.object({
      status: z.enum(['draft', 'published']).optional(),
      type: z.enum(['post', 'page']).optional(),
      q: z.string().max(200).optional(),
      ...pageQuery,
    }),
  );
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.status) {
    where.push('p.status = ?');
    params.push(q.status);
  }
  if (q.type) {
    where.push('p.type = ?');
    params.push(q.type);
  }
  const term = q.q?.trim();
  if (term) {
    where.push("(p.title LIKE ? ESCAPE '\\' OR p.tags LIKE ? ESCAPE '\\')");
    params.push(likeContains(term), likeContains(term));
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = c.env.DB;
  const [list, count] = await db.batch([
    db
      .prepare(
        `SELECT ${POST_SUMMARY_COLUMNS} FROM posts p LEFT JOIN users u ON u.id = p.author_id ${whereSql}
         ORDER BY COALESCE(p.published_at, p.updated_at) DESC LIMIT ? OFFSET ?`,
      )
      .bind(...params, q.pageSize, (q.page - 1) * q.pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM posts p ${whereSql}`).bind(...params),
  ]);
  return c.json({
    items: (list!.results as PostRow[]).map(toPostSummary),
    total: (count!.results[0] as { total: number }).total,
    page: q.page,
    pageSize: q.pageSize,
  });
});

posts.get('/:id', async (c) => c.json({ post: toPost(await loadPost(c.env.DB, c.req.param('id'))) }));

posts.post('/', async (c) => {
  const me = currentUser(c);
  const body = await readJson(c, createSchema);
  const md = body.contentMd ?? '';
  const html = body.contentHtml ?? '';
  checkSize(md, html);
  const type = body.type ?? 'post';
  const status = body.status ?? 'draft';
  const db = c.env.DB;
  const slug = await resolveSlug(db, { explicit: body.slug, title: body.title, type });
  const now = Date.now();
  const publishedAt = body.publishedAt ?? (status === 'published' ? now : null);
  const excerpt = body.excerpt?.trim() ?? '';
  const id = newId();
  await db
    .prepare(
      `INSERT INTO posts (id, author_id, type, slug, title, excerpt, summary, content_md, content_html, cover_url, tags, status,
                          published_at, reading_minutes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, me.id, type, slug, body.title, excerpt, excerpt || autoExcerpt(md), md, html, body.coverUrl ?? '',
      tagsToDb(normalizeTags(body.tags ?? [])), status, publishedAt, readingMinutes(md), now, now,
    )
    .run();
  audit(c, 'post.create', { target: slug, detail: { status } });
  return c.json({ post: toPost(await loadPost(db, id)) }, 201);
});

posts.patch('/:id', async (c) => {
  const body = await readJson(c, updateSchema);
  const db = c.env.DB;
  const cur = await loadPost(db, c.req.param('id'));
  if (body.baseUpdatedAt !== undefined && body.baseUpdatedAt !== cur.updated_at) {
    throw conflict('Bài viết vừa được cập nhật ở tab/thiết bị khác. Hãy tải lại trang.');
  }
  const md = body.contentMd ?? cur.content_md ?? '';
  const html = body.contentHtml ?? cur.content_html ?? '';
  checkSize(md, html);
  const type = body.type ?? cur.type;
  const title = body.title ?? cur.title;
  const slug =
    body.slug !== undefined && body.slug !== cur.slug
      ? await resolveSlug(db, { explicit: body.slug, title, type }, cur.id)
      : type === 'page' && RESERVED_SLUGS.includes(cur.slug)
        ? await resolveSlug(db, { explicit: cur.slug, title, type }, cur.id)
        : cur.slug;
  const status = body.status ?? cur.status;
  let publishedAt = body.publishedAt !== undefined ? body.publishedAt : cur.published_at;
  if (status === 'published' && publishedAt === null) publishedAt = Date.now();
  const now = Math.max(Date.now(), cur.updated_at + 1);
  const excerpt = body.excerpt !== undefined ? body.excerpt.trim() : cur.excerpt;
  await db
    .prepare(
      `UPDATE posts SET type = ?, slug = ?, title = ?, excerpt = ?, summary = ?, content_md = ?, content_html = ?, cover_url = ?,
                        tags = ?, status = ?, published_at = ?, reading_minutes = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      type, slug, title, excerpt, excerpt || autoExcerpt(md),
      md, html, body.coverUrl ?? cur.cover_url,
      body.tags ? tagsToDb(normalizeTags(body.tags)) : cur.tags,
      status, publishedAt, readingMinutes(md), now, cur.id,
    )
    .run();
  if (status !== cur.status) audit(c, status === 'published' ? 'post.publish' : 'post.unpublish', { target: slug });
  return c.json({ post: toPost(await loadPost(db, cur.id)) });
});

posts.delete('/:id', async (c) => {
  const db = c.env.DB;
  const post = await loadPost(db, c.req.param('id'));
  await db.prepare('DELETE FROM posts WHERE id = ?').bind(post.id).run();
  audit(c, 'post.delete', { target: post.slug, detail: { title: post.title } });
  return c.body(null, 204);
});

export default posts;
