import type { AppContext } from '../env';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** ID ngắn, an toàn cho URL (~95 bit ngẫu nhiên với 16 ký tự). */
export function newId(length = 16): string {
  let out = '';
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      // Bỏ các byte >= 248 để không lệch phân phối (248 = 62 * 4).
      if (b < 248 && out.length < length) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export function clientIp(c: AppContext): string {
  return c.req.header('cf-connecting-ip') ?? '127.0.0.1';
}

export function isHttps(c: AppContext): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Mẫu LIKE "chứa chuỗi"; dùng kèm `ESCAPE '\'`. */
export function likeContains(term: string): string {
  return `%${escapeLike(term)}%`;
}

/** Mẫu LIKE "bắt đầu bằng"; dùng kèm `ESCAPE '\'`. */
export function likePrefix(term: string): string {
  return `${escapeLike(term)}%`;
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
    .slice(0, 255);
  return cleaned || 'file';
}

export function sanitizeFolderName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f\\/]/g, '')
    .trim()
    .slice(0, 120);
}
