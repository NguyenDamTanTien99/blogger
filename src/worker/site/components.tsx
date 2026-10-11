/** @jsxImportSource hono/jsx */
import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import type { SiteSettings } from '../../shared/settings';
import type { PostSummary } from '../../shared/types';
import { normalizeLang, translate, type Vars } from '../../shared/i18n';
import { siteCss } from './styles';

/** Hàm dịch theo ngôn ngữ blog (admin chọn trong Cài đặt). */
export const tr = (s: SiteSettings) => (text: string, vars?: Vars) => translate(normalizeLang(s.language), text, vars);

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
  const t = tr(s);
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
            <nav class="links" aria-label={t("Điều hướng chính")}>
              {s.navLinks.map((l) => (
                <a href={safeHref(l.url)} aria-current={l.url === p.path ? 'page' : undefined}>
                  {l.label}
                </a>
              ))}
            </nav>
            <div class="tools">
              <a class="icon-btn" href="/search" aria-label={t("Tìm kiếm")} title={t("Tìm kiếm")}>
                <SearchIcon />
              </a>
              <button class="icon-btn" id="theme-toggle" type="button" aria-label={t("Đổi giao diện sáng/tối")} title={t("Sáng/Tối")}>
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
              {s.showLoginLink && <a href="/app/">{t("Đăng nhập")}</a>}
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
      <span>{tr(s)("{n} phút đọc", { n: post.readingMinutes })}</span>
    </div>
  );
}

export function PostList({ posts, s }: { posts: PostSummary[]; s: SiteSettings }) {
  if (!posts.length) {
    return (
      <div class="empty">
        <p>{tr(s)("Chưa có bài viết nào.")}</p>
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

export function Pager({ page, totalPages, base, s }: { page: number; totalPages: number; base: string; s: SiteSettings }) {
  const t = tr(s);
  if (totalPages <= 1) return null;
  const href = (n: number) => (base === '/' ? (n === 1 ? '/' : `/page/${n}`) : `${base}${base.includes('?') ? '&' : '?'}page=${n}`);
  return (
    <nav class="pager" aria-label={t("Phân trang")}>
      {page > 1 ? <a href={href(page - 1)}>← {t("Mới hơn")}</a> : <span />}
      {page < totalPages ? <a href={href(page + 1)}>{t("Cũ hơn")} →</a> : <span />}
    </nav>
  );
}

// Nút "Chia sẻ" dùng bảng chia sẻ của điện thoại (Zalo, TikTok, Messenger...) — chỉ hiện khi trình duyệt hỗ trợ.
const SHARE_JS = `(function(){var s=document.querySelector('[data-share]');if(s&&navigator.share){s.hidden=false;s.addEventListener('click',function(){navigator.share({title:s.getAttribute('data-title'),url:s.getAttribute('data-url')}).catch(function(){})})}var c=document.querySelector('[data-copy]');if(c)c.addEventListener('click',function(){navigator.clipboard.writeText(c.getAttribute('data-copy')).then(function(){c.textContent=c.getAttribute('data-done')})})})();`;

/** Chia sẻ thủ công — dùng được với tài khoản cá nhân (API chỉ cho đăng tự động lên Fanpage / Zalo OA / TikTok). */
export function ShareBar({ url, title, s }: { url: string; title: string; s: SiteSettings }) {
  const t = tr(s);
  return (
    <div class="share">
      <span>{t("Chia sẻ:")}</span>
      <a class="share-btn" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noopener">
        Facebook
      </a>
      <button class="share-btn" type="button" data-share data-url={url} data-title={title} hidden>
        {t("Zalo, TikTok, Messenger…")}
      </button>
      <button class="share-btn" type="button" data-copy={url} data-done={t("Đã sao chép ✓")}>
        {t("Sao chép link")}
      </button>
      <script>{raw(SHARE_JS)}</script>
    </div>
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
