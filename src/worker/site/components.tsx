/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import type { SiteSettings } from '../../shared/settings';
import type { PostSummary } from '../../shared/types';
import { siteCss } from './styles';

// Chạy trước khi vẽ trang để không bị "nháy" sai theme.
const THEME_INIT = `(function(){try{var d=document.documentElement,t=localStorage.getItem('wb-theme')||d.getAttribute('data-default')||'auto';if(t==='auto')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.setAttribute('data-theme',t)}catch(e){}})();`;
const THEME_TOGGLE = `document.getElementById('theme-toggle').addEventListener('click',function(){var d=document.documentElement,n=d.getAttribute('data-theme')==='dark'?'light':'dark';d.setAttribute('data-theme',n);try{localStorage.setItem('wb-theme',n)}catch(e){}});`;

export function safeHref(url: string): string {
  return /^(\/|#|https?:\/\/|mailto:|tel:)/i.test(url.trim()) ? url.trim() : '#';
}

export function absoluteUrl(url: string, origin: string): string {
  try {
    return new URL(url, origin).toString();
  } catch {
    return origin;
  }
}

export function formatDate(ts: number, s: SiteSettings): string {
  try {
    return new Intl.DateTimeFormat(s.language || 'vi', { day: 'numeric', month: 'long', year: 'numeric', timeZone: s.timezone }).format(ts);
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);
const ThemeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" />
  </svg>
);

export interface LayoutProps {
  s: SiteSettings;
  origin: string;
  path: string;
  title?: string;
  description?: string;
  image?: string;
  type?: 'website' | 'article';
  jsonLd?: Record<string, unknown>;
  noindex?: boolean;
  children: Child;
}

export function Layout(p: LayoutProps) {
  const { s } = p;
  const fullTitle = p.title ? `${p.title} · ${s.siteTitle}` : s.tagline ? `${s.siteTitle} — ${s.tagline}` : s.siteTitle;
  const description = p.description || s.description;
  const canonical = p.origin + p.path;
  const year = new Date().getFullYear();
  return (
    <html lang={s.language || 'vi'} data-default={s.theme}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{fullTitle}</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonical} />
        {p.noindex && <meta name="robots" content="noindex" />}
        <meta property="og:site_name" content={s.siteTitle} />
        <meta property="og:title" content={p.title ?? s.siteTitle} />
        <meta property="og:description" content={description} />
        <meta property="og:type" content={p.type ?? 'website'} />
        <meta property="og:url" content={canonical} />
        {p.image && <meta property="og:image" content={absoluteUrl(p.image, p.origin)} />}
        <meta name="twitter:card" content={p.image ? 'summary_large_image' : 'summary'} />
        <meta name="theme-color" content={s.accentColor} />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="alternate" type="application/rss+xml" title={s.siteTitle} href="/rss.xml" />
        <script>{raw(THEME_INIT)}</script>
        <style>{raw(siteCss(s))}</style>
        {s.customCss && <style>{raw(s.customCss)}</style>}
        {p.jsonLd && <script type="application/ld+json">{raw(JSON.stringify(p.jsonLd).replace(/</g, '\\u003c'))}</script>}
        {s.customHeadHtml && raw(s.customHeadHtml)}
      </head>
      <body>
        <header class="site">
          <div class="container bar">
            <a class="brand" href="/">
              {s.avatarUrl && <img src={s.avatarUrl} alt="" width="32" height="32" />}
              <span>{s.siteTitle}</span>
            </a>
            <nav class="links" aria-label="Điều hướng chính">
              {s.navLinks.map((l) => (
                <a href={safeHref(l.url)} aria-current={l.url === p.path ? 'page' : undefined}>
                  {l.label}
                </a>
              ))}
            </nav>
            <div class="tools">
              <a class="icon-btn" href="/search" aria-label="Tìm kiếm" title="Tìm kiếm">
                <SearchIcon />
              </a>
              <button class="icon-btn" id="theme-toggle" type="button" aria-label="Đổi giao diện sáng/tối" title="Sáng/Tối">
                <ThemeIcon />
              </button>
            </div>
          </div>
        </header>
        <main class="container">{p.children}</main>
        <footer class="site">
          <div class="container row">
            <div>{s.footerText || `© ${year} ${s.authorName || s.siteTitle}`}</div>
            <nav>
              {s.socialLinks.map((l) => (
                <a href={safeHref(l.url)} rel="me noopener" target={l.url.startsWith('http') ? '_blank' : undefined}>
                  {l.label}
                </a>
              ))}
              <a href="/rss.xml">RSS</a>
              {s.showLoginLink && <a href="/app/">Đăng nhập</a>}
            </nav>
          </div>
        </footer>
        <script>{raw(THEME_TOGGLE)}</script>
      </body>
    </html>
  );
}

export function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div class="tags">
      {tags.map((t) => (
        <a class="tag" href={`/tags/${encodeURIComponent(t)}`}>
          #{t}
        </a>
      ))}
    </div>
  );
}

function PostMeta({ post, s }: { post: PostSummary; s: SiteSettings }) {
  return (
    <div class="meta">
      {post.publishedAt && <time datetime={new Date(post.publishedAt).toISOString()}>{formatDate(post.publishedAt, s)}</time>}
      <span>{post.readingMinutes} phút đọc</span>
    </div>
  );
}

export function PostList({ posts, s }: { posts: PostSummary[]; s: SiteSettings }) {
  if (!posts.length) {
    return (
      <div class="empty">
        <p>Chưa có bài viết nào.</p>
      </div>
    );
  }
  if (s.layout === 'cards') {
    return (
      <div class="cards">
        {posts.map((post) => (
          <article class="card">
            <a class="cover" href={`/posts/${post.slug}`} aria-hidden="true" tabindex={-1}>
              {post.coverUrl && <img src={post.coverUrl} alt="" loading="lazy" />}
            </a>
            <div class="body">
              <h2>
                <a href={`/posts/${post.slug}`}>{post.title}</a>
              </h2>
              <PostMeta post={post} s={s} />
              {post.summary && <p class="excerpt">{post.summary}</p>}
              <TagList tags={post.tags} />
            </div>
          </article>
        ))}
      </div>
    );
  }
  return (
    <ul class="post-list">
      {posts.map((post) => (
        <li class="post-item">
          <h2>
            <a href={`/posts/${post.slug}`}>{post.title}</a>
          </h2>
          <PostMeta post={post} s={s} />
          {post.summary && <p class="excerpt">{post.summary}</p>}
          <TagList tags={post.tags} />
        </li>
      ))}
    </ul>
  );
}

export function Pager({ page, totalPages, base }: { page: number; totalPages: number; base: string }) {
  if (totalPages <= 1) return null;
  const href = (n: number) => (base === '/' ? (n === 1 ? '/' : `/page/${n}`) : `${base}${base.includes('?') ? '&' : '?'}page=${n}`);
  return (
    <nav class="pager" aria-label="Phân trang">
      {page > 1 ? <a href={href(page - 1)}>← Mới hơn</a> : <span />}
      {page < totalPages ? <a href={href(page + 1)}>Cũ hơn →</a> : <span />}
    </nav>
  );
}

export function AuthorBox({ s }: { s: SiteSettings }) {
  if (!s.authorName && !s.authorBio) return null;
  return (
    <aside class="author-box">
      {s.avatarUrl && <img src={s.avatarUrl} alt={s.authorName} width="56" height="56" />}
      <div>
        <strong>{s.authorName}</strong>
        {s.authorBio && <p>{s.authorBio}</p>}
      </div>
    </aside>
  );
}
