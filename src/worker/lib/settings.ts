import { DEFAULT_SETTINGS, type SiteSettings } from '../../shared/settings';

// Cache trong isolate 30s: trang blog công khai không phải đọc settings từ D1 ở mỗi request.
const TTL_MS = 30_000;
let cache: { value: SiteSettings; at: number } | null = null;

export function mergeSettings(data: unknown): SiteSettings {
  if (!data || typeof data !== 'object') return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(data as Partial<SiteSettings>) };
}

export async function getSettings(env: Env): Promise<SiteSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const row = await env.DB.prepare('SELECT data FROM settings WHERE id = 1').first<{ data: string }>();
  let parsed: unknown = null;
  try {
    parsed = row ? JSON.parse(row.data) : null;
  } catch {
    parsed = null;
  }
  const value = mergeSettings(parsed);
  cache = { value, at: Date.now() };
  return value;
}

export async function saveSettings(env: Env, value: SiteSettings): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(value), Date.now())
    .run();
  cache = { value, at: Date.now() };
}
