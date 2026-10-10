// Module nặng (~100KB) nên chỉ được tải khi mở ghi chú/bài viết (xem useMarkdown()).
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { Marked } from 'marked';

const languages = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown, php, plaintext,
  powershell, python, rust, sql, swift, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(languages)) hljs.registerLanguage(name, lang);
hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['html', 'svg', 'vue'], { languageName: 'xml' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['cs'], { languageName: 'csharp' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['ps1', 'ps'], { languageName: 'powershell' });
hljs.registerAliases(['txt', 'text'], { languageName: 'plaintext' });

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      const body =
        language && hljs.getLanguage(language)
          ? hljs.highlight(text, { language, ignoreIllegals: true }).value
          : escapeHtml(text);
      return `<pre><code class="hljs${language ? ` language-${escapeHtml(language)}` : ''}">${body}</code></pre>\n`;
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && /^https?:/i.test(node.getAttribute('href') ?? '')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Markdown -> HTML (chưa lọc). Dùng để lưu HTML bài viết do admin soạn. */
export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false });
}

/** Markdown -> HTML đã lọc XSS. Dùng cho mọi nội dung hiển thị trong dashboard (ghi chú của người khác...). */
export function renderSafe(source: string): string {
  return DOMPurify.sanitize(renderMarkdown(source), { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form'] });
}

export function htmlToText(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}
