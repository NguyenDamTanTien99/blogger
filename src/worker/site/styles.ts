import type { SiteSettings } from '../../shared/settings';

const FONTS: Record<SiteSettings['font'], string> = {
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
  serif: 'Charter, "Bitstream Charter", Georgia, Cambria, "Times New Roman", "Noto Serif", serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

/** CSS của blog công khai — nhúng inline (≈3KB sau nén) nên trang hiển thị ngay, không chờ file CSS. */
export function siteCss(s: SiteSettings): string {
  return `
:root{--accent:${s.accentColor};--bg:#fff;--fg:#1f2937;--muted:#6b7280;--border:#e5e7eb;--card:#f8fafc;--code:#f3f4f6;--font:${FONTS[s.font]};--maxw:${s.layout === 'cards' ? '1040px' : '760px'};color-scheme:light}
[data-theme=dark]{--bg:#0b1120;--fg:#e5e7eb;--muted:#94a3b8;--border:#1e293b;--card:#111a2e;--code:#0f172a;color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font-family:var(--font);font-size:17px;line-height:1.75;text-rendering:optimizeLegibility}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
img{max-width:100%;height:auto}
.container{max-width:var(--maxw);margin:0 auto;padding:0 20px}
header.site{position:sticky;top:0;z-index:10;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:saturate(180%) blur(10px)}
header.site .bar{display:flex;align-items:center;gap:12px;min-height:60px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:1.1rem;color:var(--fg)}
.brand:hover{text-decoration:none}
.brand img{width:32px;height:32px;border-radius:50%;object-fit:cover}
nav.links{display:flex;flex-wrap:wrap;gap:2px;margin-left:auto}
nav.links a{color:var(--muted);padding:6px 10px;border-radius:8px;font-size:.94rem}
nav.links a:hover,nav.links a[aria-current=page]{color:var(--fg);background:var(--card);text-decoration:none}
.tools{display:flex;gap:8px}
.icon-btn{display:inline-grid;place-items:center;width:36px;height:36px;border:1px solid var(--border);border-radius:10px;background:transparent;color:var(--fg);cursor:pointer}
.icon-btn:hover{background:var(--card);text-decoration:none}
.icon-btn svg{width:18px;height:18px}
.hero{display:flex;align-items:center;gap:20px;padding:48px 0 16px}
.hero img{width:88px;height:88px;border-radius:50%;object-fit:cover;flex:none;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent)}
.hero h1{margin:0;font-size:2rem;line-height:1.2;letter-spacing:-.02em}
.hero p{margin:6px 0 0;color:var(--muted)}
.section-title{margin:32px 0 0;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.post-list{list-style:none;margin:8px 0;padding:0}
.post-item{padding:22px 0;border-bottom:1px solid var(--border)}
.post-item h2{margin:0 0 6px;font-size:1.35rem;line-height:1.35;letter-spacing:-.01em}
.post-item h2 a,.card h2 a{color:var(--fg)}
.post-item h2 a:hover,.card h2 a:hover{color:var(--accent);text-decoration:none}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;color:var(--muted);font-size:.86rem}
.excerpt{margin:8px 0 10px;color:color-mix(in srgb,var(--fg) 78%,var(--bg))}
.tags{display:flex;flex-wrap:wrap;gap:6px}
.tag{display:inline-block;padding:1px 10px;border-radius:999px;font-size:.78rem;background:color-mix(in srgb,var(--accent) 12%,transparent);color:var(--accent)}
.tag:hover{text-decoration:none;background:color-mix(in srgb,var(--accent) 20%,transparent)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:22px;margin:24px 0}
.card{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:16px;overflow:hidden;background:var(--card);transition:transform .15s,box-shadow .15s}
.card:hover{transform:translateY(-2px);box-shadow:0 10px 30px -12px rgb(0 0 0/.25)}
.card .cover{display:block;aspect-ratio:16/9;background:linear-gradient(135deg,color-mix(in srgb,var(--accent) 35%,var(--card)),color-mix(in srgb,var(--accent) 8%,var(--card)))}
.card .cover img{width:100%;height:100%;object-fit:cover;display:block}
.card .body{padding:16px 18px 18px}
.card h2{margin:0 0 6px;font-size:1.12rem;line-height:1.4}
.pager{display:flex;justify-content:space-between;gap:12px;margin:32px 0}
.pager a{padding:8px 16px;border:1px solid var(--border);border-radius:10px;color:var(--fg)}
.pager a:hover{background:var(--card);text-decoration:none}
article{max-width:760px;margin-inline:auto}
article header{margin:40px 0 8px}
article header h1{margin:0 0 12px;font-size:2.3rem;line-height:1.22;letter-spacing:-.02em}
.cover-img{display:block;width:100%;margin:24px 0;border-radius:16px}
.prose{overflow-wrap:anywhere}
.prose h1,.prose h2,.prose h3,.prose h4{line-height:1.3;letter-spacing:-.01em;scroll-margin-top:80px}
.prose h2{margin:2em 0 .6em;font-size:1.55rem}
.prose h3{margin:1.6em 0 .5em;font-size:1.25rem}
.prose img,.prose video,.prose iframe{display:block;max-width:100%;margin:1.2em auto;border-radius:12px}
.prose blockquote{margin:1.4em 0;padding:.4em 1.1em;border-left:4px solid var(--accent);background:var(--card);color:var(--muted);border-radius:0 10px 10px 0}
.prose code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.86em;padding:.15em .4em;border-radius:6px;background:var(--code)}
.prose pre{margin:1.4em 0;padding:16px 18px;overflow-x:auto;line-height:1.6;border:1px solid var(--border);border-radius:12px;background:var(--code)}
.prose pre code{padding:0;background:none;font-size:.84em}
.prose table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:1.4em 0}
.prose th,.prose td{padding:8px 12px;border:1px solid var(--border);text-align:left}
.prose th{background:var(--card)}
.prose hr{margin:2.4em 0;border:0;border-top:1px solid var(--border)}
.prose ul,.prose ol{padding-left:1.4em}
.prose li+li{margin-top:.3em}
.prose input[type=checkbox]{margin-right:.4em}
.share{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:28px 0 0;color:var(--muted);font-size:.9rem}
.share-btn{padding:6px 14px;border:1px solid var(--border);border-radius:999px;background:transparent;color:var(--fg);font:inherit;font-size:.86rem;cursor:pointer}
.share-btn:hover{border-color:var(--accent);color:var(--accent);text-decoration:none}
.share-btn[hidden]{display:none}
.author-box{display:flex;align-items:center;gap:16px;margin:48px 0 0;padding:18px 20px;border:1px solid var(--border);border-radius:16px;background:var(--card)}
.author-box img{width:56px;height:56px;border-radius:50%;object-fit:cover;flex:none}
.author-box p{margin:2px 0 0;color:var(--muted);font-size:.94rem;line-height:1.6}
.search{display:flex;gap:8px;margin:28px 0 8px}
.search input{flex:1;min-width:0;padding:10px 14px;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--fg);font:inherit}
.search input:focus{outline:2px solid color-mix(in srgb,var(--accent) 50%,transparent);outline-offset:1px}
.search button{padding:10px 18px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;cursor:pointer}
.notice{margin:16px 0;padding:10px 14px;border-radius:10px;background:color-mix(in srgb,#f59e0b 16%,transparent);color:#b45309}
.empty{padding:72px 0;text-align:center;color:var(--muted)}
.empty h1{color:var(--fg)}
footer.site{margin-top:64px;padding:28px 0 40px;border-top:1px solid var(--border);color:var(--muted);font-size:.9rem}
footer.site .row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
footer.site nav{display:flex;flex-wrap:wrap;gap:14px}
footer.site a{color:var(--muted)}footer.site a:hover{color:var(--fg)}
.hljs-comment,.hljs-quote{color:#6a737d;font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-doctag,.hljs-type{color:#d73a49}
.hljs-string,.hljs-regexp,.hljs-attr,.hljs-template-tag{color:#032f62}
.hljs-number,.hljs-symbol,.hljs-bullet,.hljs-variable,.hljs-template-variable,.hljs-link{color:#005cc5}
.hljs-title,.hljs-section,.hljs-title.function_{color:#6f42c1}
.hljs-built_in,.hljs-name,.hljs-tag,.hljs-selector-id,.hljs-selector-class{color:#22863a}
.hljs-meta{color:#735c0f}.hljs-deletion{color:#b31d28;background:#ffeef0}.hljs-addition{color:#22863a;background:#f0fff4}
[data-theme=dark] .hljs-comment,[data-theme=dark] .hljs-quote{color:#8b949e}
[data-theme=dark] .hljs-keyword,[data-theme=dark] .hljs-selector-tag,[data-theme=dark] .hljs-literal,[data-theme=dark] .hljs-doctag,[data-theme=dark] .hljs-type{color:#ff7b72}
[data-theme=dark] .hljs-string,[data-theme=dark] .hljs-regexp,[data-theme=dark] .hljs-attr,[data-theme=dark] .hljs-template-tag{color:#a5d6ff}
[data-theme=dark] .hljs-number,[data-theme=dark] .hljs-symbol,[data-theme=dark] .hljs-bullet,[data-theme=dark] .hljs-variable,[data-theme=dark] .hljs-template-variable,[data-theme=dark] .hljs-link{color:#79c0ff}
[data-theme=dark] .hljs-title,[data-theme=dark] .hljs-section,[data-theme=dark] .hljs-title.function_{color:#d2a8ff}
[data-theme=dark] .hljs-built_in,[data-theme=dark] .hljs-name,[data-theme=dark] .hljs-tag,[data-theme=dark] .hljs-selector-id,[data-theme=dark] .hljs-selector-class{color:#7ee787}
[data-theme=dark] .hljs-meta{color:#e3b341}
@media (max-width:640px){body{font-size:16px}.hero{padding-top:32px}.hero img{width:64px;height:64px}.hero h1{font-size:1.6rem}article header h1{font-size:1.75rem}nav.links{margin-left:0;width:100%;order:3;padding-bottom:8px}.tools{margin-left:auto}}
`;
}
