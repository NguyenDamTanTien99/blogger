import { KDF_ITERATIONS, KDF_SALT_PREFIX } from './constants';

// Chạy được ở cả trình duyệt, Cloudflare Workers và Node >= 20 (đều có WebCrypto chuẩn).

const encoder = new TextEncoder();

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, '0');
  return s;
}

export async function sha256(data: string | Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const input = typeof data === 'string' ? encoder.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Khóa mật khẩu gửi lên server: base64url của 32 byte. */
export const PASSWORD_KEY_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Bước "chậm" của việc băm mật khẩu: PBKDF2-SHA256 600k vòng, salt gắn với email.
 * Server chỉ nhận kết quả này (không bao giờ thấy mật khẩu gốc) rồi băm thêm 1 lần với salt ngẫu nhiên.
 * Kẻ lấy được DB vẫn phải trả đủ 600k vòng cho mỗi lần đoán mật khẩu.
 */
export async function derivePasswordKey(email: string, password: string): Promise<string> {
  const salt = encoder.encode(KDF_SALT_PREFIX + normalizeEmail(email));
  const material = await crypto.subtle.importKey('raw', encoder.encode(password.normalize('NFKC')), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: KDF_ITERATIONS },
    material,
    256,
  );
  return toBase64Url(new Uint8Array(bits));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Bước "nhanh" phía server: SHA-256(salt ngẫu nhiên || khóa). Định dạng lưu: s256$<salt>$<digest>. */
export async function hashPasswordKey(key: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await sha256(concat(salt, fromBase64Url(key)));
  return `s256$${toBase64Url(salt)}$${toBase64Url(digest)}`;
}

export async function verifyPasswordKey(key: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, digestB64] = stored.split('$');
  if (scheme !== 's256' || !saltB64 || !digestB64) return false;
  const digest = await sha256(concat(fromBase64Url(saltB64), fromBase64Url(key)));
  return timingSafeEqual(digest, fromBase64Url(digestB64));
}
