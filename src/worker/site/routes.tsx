/** @jsxImportSource hono/jsx */
import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import type { Child } from 'hono/jsx';
import { MB } from '../../shared/constants';
import type { AppContext, AppEnv } from '../env';
import { streamFile, type FileRow } from '../lib/files';
import { POST_SUMMARY_COLUMNS, toPost, toPostSummary, type PostRow } from '../lib/mappers';
import { loadSessionUser } from '../lib/session';
import { getSettings } from '../lib/settings';
import { likeContains } from '../lib/util';
import { absoluteUrl, AuthorBox, formatDate, Layout, Pager, PostList, TagList, type LayoutProps } from './components';

const site = new Hono<AppEnv>();

const PUBLISHED = "p.status = 'published' AND p.published_at <= ?";

function origin(c: AppContext): string {
  return new URL(c.req.url).origin;
}

async function page(c: AppContext, props: Omit<LayoutProps, 'origin' | 'children'>, body: Child, status: 200 | 404 = 200) {
  const doc = await html`<!DOCTYPE html>${(<Layout {...props} origin={origin(c)}>{body}</Layout>)}`;
  return c.html(doc, status, { 'Cache-Control': 'public, max-age=0, must-revalidate' });
}

export async function renderNotFound(c: AppContext) {
  const s = await getSettings(c.env);
  return page(
    c,
    { s, path: new URL(c.req.url).pathname, title: 'Không tìm thấy trang', noindex: true },
    <div class="empty">
      <h1>404</h1>
      <p>Trang bạn tìm không tồn tại hoặc đã bị gỡ.</p>
      <p>
        <a href="/">← Về trang chủ</a>
      </p>
    </div>,
    404,
  );
}

async function listPosts(db: D1Database, extraWhere: string, params: unknown[], limit: number, offset: number) {
  const now = Date.now();
  const [list, count] = await db.batch([
    db
      .prepare(
        `SELECT ${POST_SUMMARY_COLUMNS} FROM posts p LEFT JOIN users u ON u.id = p.author_id
         WHERE p.type = 'post' AND ${PUBLISHED} ${extraWhere} ORDER BY p.published_at DESC LIMIT ? OFFSET ?`,
      )
      .bind(now, ...params, limit, offset),
    db.prepare(`SELECT COUNT(*) AS total FROM posts p WHERE p.type = 'post' AND ${PUBLISHED} ${extraWhere}`).bind(now, ...params),
  ]);
  return {
    posts: (list!.results as PostRow[]).map(toPostSummary),
    total: (count!.results[0] as { total: number }).total,
  };
}

async function home(c: AppContext, pageNo: number) {
  const s = await getSettings(c.env);
  const { posts, total } = await listPosts(c.env.DB, '', [], s.postsPerPage, (pageNo - 1) * s.postsPerPage);
  const totalPages = Math.max(1, Math.ceil(total / s.postsPerPage));
  if (pageNo > totalPages) return renderNotFound(c);
  return page(
    c,
    {
      s,
      path: pageNo === 1 ? '/' : `/page/${pageNo}`,
      title: pageNo === 1 ? undefined : `Trang ${pageNo}`,
      jsonLd: pageNo === 1 ? { '@context': 'https://schema.org', '@type': 'Blog', name: s.siteTitle, description: s.description, url: origin(c) } : undefined,
    },
    <>
      {pageNo === 1 && (
        <section class="hero">
          {s.avatarUrl && <img src={s.avatarUrl} alt={s.authorName} width="88" height="88" />}
          <div>
            <h1>{s.siteTitle}</h1>
            {s.authorBio && <p>{s.authorBio}</p>}
          </div>
        </section>
      )}
      <h2 class="section-title">{pageNo === 1 ? 'Bài viết mới' : `Trang ${pageNo}`}</h2>
      <PostList posts={posts} s={s} />
      <Pager page={pageNo} totalPages={totalPages} base="/" />
    </>,
  );
}

site.get('/', (c) => home(c, 1));
site.get('/page/:n{[0-9]+}', async (c) => {
  const n = Number(c.req.param('n'));
  if (n <= 1) return c.redirect('/', 301);
  return home(c, n);
});

/** Bài viết/trang chỉ hiển thị khi đã xuất bản và tới giờ đăng (hỗ trợ hẹn giờ), trừ khi admin xem trước. */
async function loadPublic(c: AppContext, slug: string, type: 'post' | 'page') {
  const row = await c.env.DB.prepare(
    'SELECT p.*, u.name AS author_name FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.slug = ? AND p.type = ?',
  )
    .bind(slug, type)
    .first<PostRow>();
  if (!row) return null;
  const live = row.status === 'published' && row.published_at !== null && row.published_at <= Date.now();
  if (live) return { post: toPost(row), preview: false };
  if (c.req.query('preview') !== undefined) {
    const user = await loadSessionUser(c);
    if (user?.role === 'admin') return { post: toPost(row), preview: true };
  }
  return null;
}

site.get('/posts/:slug', async (c) => {
  const found = await loadPublic(c, c.req.param('slug'), 'post');
  if (!found) return renderNotFound(c);
  const { post, preview } = found;
  const s = await getSettings(c.env);
  const url = `${origin(c)}/posts/${post.slug}`;
  return page(
    c,
    {
      s,
      path: `/posts/${post.slug}`,
      title: post.title,
      description: post.summary,
      image: post.coverUrl || undefined,
      type: 'article',
      noindex: preview,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: post.summary,
        datePublished: post.publishedAt ? new Date(post.publishedAt).toISOString() : undefined,
        dateModified: new Date(post.updatedAt).toISOString(),
        author: { '@type': 'Person', name: post.authorName || s.authorName },
        image: post.coverUrl ? absoluteUrl(post.coverUrl, origin(c)) : undefined,
        mainEntityOfPage: url,
      },
    },
    <article>
      {preview && <div class="notice">Bản xem trước — bài này chưa được xuất bản, chỉ admin nhìn thấy.</div>}
      <header>
        <h1>{post.title}</h1>
        <div class="meta">
          {post.publishedAt && <time datetime={new Date(post.publishedAt).toISOString()}>{formatDate(post.publishedAt, s)}</time>}
          <span>{post.readingMinutes} phút đọc</span>
          {post.authorName && <span>{post.authorName}</span>}
        </div>
      </header>
      {post.coverUrl && <img class="cover-img" src={post.coverUrl} alt="" />}
      <div class="prose">{raw(post.contentHtml)}</div>
      <div style="margin-top:32px">
        <TagList tags={post.tags} />
      </div>
      <AuthorBox s={s} />
    </article>,
  );
});

site.get('/tags/:tag', async (c) => {
  const tag = decodeURIComponent(c.req.param('tag')).toLowerCase();
  const s = await getSettings(c.env);
  const pageNo = Math.max(1, Number(c.req.query('page')) || 1);
  const { posts, total } = await listPosts(c.env.DB, "AND p.tags LIKE ? ESCAPE '\\'", [likeContains(`,${tag},`)], s.postsPerPage, (pageNo - 1) * s.postsPerPage);
  return page(
    c,
    { s, path: `/tags/${encodeURIComponent(tag)}`, title: `#${tag}`, description: `Các bài viết gắn thẻ ${tag}` },
    <>
      <h1 style="margin:40px 0 0">#{tag}</h1>
      <p class="meta">{total} bài viết</p>
      <PostList posts={posts} s={s} />
      <Pager page={pageNo} totalPages={Math.ceil(total / s.postsPerPage)} base={`/tags/${encodeURIComponent(tag)}`} />
    </>,
  );
});

site.get('/search', async (c) => {
  const s = await getSettings(c.env);
  const q = (c.req.query('q') ?? '').trim().slice(0, 100);
  const pageNo = Math.max(1, Number(c.req.query('page')) || 1);
  const result = q
    ? await listPosts(
        c.env.DB,
        "AND (p.title LIKE ? ESCAPE '\\' OR p.summary LIKE ? ESCAPE '\\' OR p.content_md LIKE ? ESCAPE '\\')",
        [likeContains(q), likeContains(q), likeContains(q)],
        s.postsPerPage,
        (pageNo - 1) * s.postsPerPage,
      )
    : null;
  return page(
    c,
    { s, path: '/search', title: q ? `Tìm: ${q}` : 'Tìm kiếm', noindex: true },
    <>
      <form class="search" action="/search" method="get" role="search">
        <input type="search" name="q" value={q} placeholder="Tìm bài viết..." aria-label="Từ khóa" autofocus />
        <button type="submit">Tìm</button>
      </form>
      {result && <p class="meta">{result.total} kết quả cho “{q}”</p>}
      {result && <PostList posts={result.posts} s={s} />}
      {result && <Pager page={pageNo} totalPages={Math.ceil(result.total / s.postsPerPage)} base={`/search?q=${encodeURIComponent(q)}`} />}
    </>,
  );
});

// ---------- RSS / Sitemap / robots ----------

function xmlEscape(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[ch]!);
}

function cdata(value: string): string {
  return `<![CDATA[${value.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
}

site.get('/rss.xml', async (c) => {
  const s = await getSettings(c.env);
  const base = origin(c);
  const { results } = await c.env.DB.prepare(
    `SELECT p.slug, p.title, p.summary, p.content_html, p.published_at, p.tags FROM posts p
     WHERE p.type = 'post' AND ${PUBLISHED} ORDER BY p.published_at DESC LIMIT 20`,
  )
    .bind(Date.now())
    .all<{ slug: string; title: string; summary: string; content_html: string; published_at: number; tags: string }>();
  const items = results
    .map(
      (p) => `<item><title>${xmlEscape(p.title)}</title><link>${base}/posts/${p.slug}</link><guid isPermaLink="true">${base}/posts/${p.slug}</guid><pubDate>${new Date(p.published_at).toUTCString()}</pubDate><description>${xmlEscape(p.summary)}</description><content:encoded>${cdata(p.content_html)}</content:encoded></item>`,
    )
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${xmlEscape(s.siteTitle)}</title><link>${base}/</link><description>${xmlEscape(s.description)}</description><language>${xmlEscape(s.language)}</language><atom:link href="${base}/rss.xml" rel="self" type="application/rss+xml"/>${items}</channel></rss>`;
  return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' });
});
site.get('/feed', (c) => c.redirect('/rss.xml', 301));

site.get('/sitemap.xml', async (c) => {
  const base = origin(c);
  const { results } = await c.env.DB.prepare(
    `SELECT p.slug, p.type, p.updated_at FROM posts p WHERE ${PUBLISHED} ORDER BY p.published_at DESC LIMIT 5000`,
  )
    .bind(Date.now())
    .all<{ slug: string; type: string; updated_at: number }>();
  const urls = [`<url><loc>${base}/</loc></url>`].concat(
    results.map(
      (p) =>
        `<url><loc>${base}${p.type === 'page' ? '/' : '/posts/'}${xmlEscape(p.slug)}</loc><lastmod>${new Date(p.updated_at).toISOString()}</lastmod></url>`,
    ),
  );
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' });
});

site.get('/robots.txt', (c) =>
  c.text(`User-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /api/\nSitemap: ${origin(c)}/sitemap.xml\n`, 200, {
    'Cache-Control': 'public, max-age=86400',
  }),
);

// ---------- File công khai (ảnh trong bài viết, file chia sẻ) ----------

site.get('/f/:id/:name?', async (c) => {
  const id = c.req.param('id');
  const download = c.req.query('download') === '1';
  const cacheable = !c.req.header('range') && !c.req.header('if-none-match') && !c.req.header('if-modified-since');
  // Cache API ở edge chỉ hoạt động trên tên miền riêng; trên *.workers.dev các lệnh này không làm gì.
  const cacheKey = new Request(new URL(`/f/${id}${download ? '?download=1' : ''}`, c.req.url).toString());
  if (cacheable) {
    const hit = await caches.default.match(cacheKey);
    if (hit) return hit;
  }
  const file = await c.env.DB.prepare("SELECT * FROM files WHERE id = ? AND visibility = 'public'").bind(id).first<FileRow>();
  if (!file) return c.text('Không tìm thấy file hoặc file không còn được chia sẻ công khai.', 404);
  const res = await streamFile(c, file, { inline: !download, isPublic: true });
  if (cacheable && res.status === 200 && file.size <= 25 * MB) {
    c.executionCtx.waitUntil(caches.default.put(cacheKey, res.clone()));
  }
  return res;
});

// ---------- Trang tĩnh: /about, /contact ... (tạo trong mục Bài viết với loại "Trang") ----------

site.get('/:slug', async (c) => {
  const found = await loadPublic(c, c.req.param('slug'), 'page');
  if (!found) return renderNotFound(c);
  const { post, preview } = found;
  const s = await getSettings(c.env);
  return page(
    c,
    { s, path: `/${post.slug}`, title: post.title, description: post.summary, image: post.coverUrl || undefined, noindex: preview },
    <article>
      {preview && <div class="notice">Bản xem trước — trang này chưa được xuất bản.</div>}
      <header>
        <h1>{post.title}</h1>
      </header>
      {post.coverUrl && <img class="cover-img" src={post.coverUrl} alt="" />}
      <div class="prose">{raw(post.contentHtml)}</div>
    </article>,
  );
});

export default site;
