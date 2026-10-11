import { fromBase64Url, toBase64Url } from '../../shared/crypto';

// Lưu JSON vào D1, mã hóa AES-GCM khi có secret TOKEN_SECRET (lộ file DB cũng không lộ token mạng xã hội).
const PREFIX = 'enc1:';
const encoder = new TextEncoder();

async function keyFrom(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(env: Env, value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  if (!env.TOKEN_SECRET) return json;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(env.TOKEN_SECRET), encoder.encode(json));
  return `${PREFIX}${toBase64Url(iv)}.${toBase64Url(new Uint8Array(cipher))}`;
}

/** Trả null nếu trống, hỏng, hoặc không giải mã được (ví dụ đã đổi TOKEN_SECRET). */
export async function unseal<T>(env: Env, stored: string | null | undefined): Promise<T | null> {
  if (!stored) return null;
  try {
    if (!stored.startsWith(PREFIX)) return JSON.parse(stored) as T;
    if (!env.TOKEN_SECRET) return null;
    const [iv, data] = stored.slice(PREFIX.length).split('.');
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(iv!) },
      await keyFrom(env.TOKEN_SECRET),
      fromBase64Url(data!),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}
