// Chép các file tĩnh gốc (static/) vào thư mục assets mà Worker phục vụ (dist/client).
// `_headers` phải nằm ở gốc thư mục assets nên không thể để Vite copy (Vite chỉ ghi vào dist/client/app).
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist', 'client');
mkdirSync(out, { recursive: true });
cpSync(join(root, 'static'), out, { recursive: true });
console.log('static/ -> dist/client/');
