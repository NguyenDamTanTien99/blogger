// Liệt kê các câu tiếng Việt trong code chưa có bản dịch tiếng Anh (src/shared/i18n-en.ts).
//   npm run i18n:check            -> in danh sách, thoát mã 1 nếu còn thiếu
//   npm run i18n:check -- --json  -> in dạng JSON để dán vào từ điển
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = ['src/shared/i18n-en.ts', 'src/shared/settings.ts', 'src/worker/worker-configuration.d.ts'];
const VN = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    return d.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
}

/** Lấy các chuỗi literal ('..', "..", `..` không có ${}) — bỏ qua comment. */
function literals(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      i = src.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (ch === '/' && next === '*') {
      i = src.indexOf('*/', i + 2) + 2;
      if (i < 2) break;
      continue;
    }
    // Regex literal (/.../flags) đứng sau toán tử hoặc dấu mở: bỏ qua để không nhầm ký tự bên trong là chuỗi.
    if (ch === '/' && /[(,=:[!&|?{};]\s*$|return\s*$/.test(src.slice(Math.max(0, i - 12), i))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      i = j + 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      let value = '';
      let dynamic = false;
      while (j < src.length && src[j] !== ch) {
        if (src[j] === '\\') {
          const e = src[j + 1];
          value += e === 'n' ? '\n' : e;
          j += 2;
          continue;
        }
        if (ch === '`' && src[j] === '$' && src[j + 1] === '{') dynamic = true;
        if (ch !== '`' && src[j] === '\n') break;
        value += src[j];
        j++;
      }
      if (!dynamic) out.push(value);
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

const { EN } = await import(new URL('../src/shared/i18n-en.ts', import.meta.url).href).catch(async () => {
  // Node chưa hỗ trợ import .ts trực tiếp: đọc thô các khóa.
  const text = readFileSync(join(root, 'src/shared/i18n-en.ts'), 'utf8');
  const keys = {};
  for (const m of text.matchAll(/^\s*('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*:/gm)) keys[JSON.parse(m[1].startsWith("'") ? `"${m[1].slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"` : m[1])] = true;
  return { EN: keys };
});

const missing = new Map();
for (const file of walk(join(root, 'src'))) {
  const rel = relative(root, file).replace(/\\/g, '/');
  if (SKIP.includes(rel)) continue;
  for (const s of literals(readFileSync(file, 'utf8'))) {
    if (VN.test(s) && !(s in EN) && !missing.has(s)) missing.set(s, rel);
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(Object.fromEntries([...missing.keys()].map((k) => [k, ''])), null, 2));
} else {
  for (const [s, file] of missing) console.log(`${file}: ${s}`);
  console.log(missing.size ? `\n${missing.size} câu chưa dịch.` : 'Đã dịch đủ.');
}
process.exit(missing.size && !process.argv.includes('--json') ? 1 : 0);
