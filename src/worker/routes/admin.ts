import { Hono } from 'hono';
import { z } from 'zod';
import type { SiteSettings } from '../../shared/settings';
import type { AuditEntry } from '../../shared/types';
import type { AppEnv } from '../env';
import { requireAdmin } from '../middleware';
import { audit } from '../lib/audit';
import { getSettings, saveSettings } from '../lib/settings';
import { pageQuery, readJson, readQuery } from '../lib/validate';

// ---------- Cài đặt trang (chỉ admin) ----------

export const settings = new Hono<AppEnv>();
settings.use('*', requireAdmin);

const safeUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((u) => /^(\/|#|https?:\/\/|mailto:|tel:)/i.test(u), 'Đường dẫn phải bắt đầu bằng /, #, http(s)://, mailto: hoặc tel:');
const link = z.object({ label: z.string().trim().min(1).max(60), url: safeUrl });

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const settingsSchema = z.object({
  siteTitle: z.string().trim().min(1).max(120),
  tagline: z.string().max(200),
  description: z.string().max(500),
  authorName: z.string().max(80),
  authorBio: z.string().max(1000),
  avatarUrl: z.string().max(1000),
  language: z.string().min(2).max(10),
  timezone: z.string().max(60).refine(isTimeZone, 'Múi giờ không hợp lệ'),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Màu phải có dạng #RRGGBB'),
  theme: z.enum(['auto', 'light', 'dark']),
  font: z.enum(['sans', 'serif', 'mono']),
  layout: z.enum(['list', 'cards']),
  postsPerPage: z.number().int().min(1).max(50),
  navLinks: z.array(link).max(12),
  socialLinks: z.array(link).max(12),
  footerText: z.string().max(1000),
  showLoginLink: z.boolean(),
  customCss: z.string().max(50_000),
  customHeadHtml: z.string().max(20_000),
  defaultQuotaMB: z.number().int().min(0).max(1_048_576),
  globalStorageLimitMB: z.number().int().min(1).max(1_048_576),
  maxFileSizeMB: z.number().int().min(1).max(1_048_576),
}) satisfies z.ZodType<SiteSettings>;

settings.get('/', async (c) => c.json({ settings: await getSettings(c.env) }));

settings.put('/', async (c) => {
  const value = await readJson(c, settingsSchema);
  await saveSettings(c.env, value);
  audit(c, 'settings.update');
  return c.json({ settings: value });
});

// ---------- Nhật ký hệ thống (chỉ admin) ----------

export const auditLog = new Hono<AppEnv>();
auditLog.use('*', requireAdmin);

auditLog.get('/', async (c) => {
  const q = readQuery(c, z.object({ action: z.string().max(60).optional(), ...pageQuery }));
  const where = q.action ? 'WHERE action LIKE ?' : '';
  const params = q.action ? [`${q.action}%`] : [];
  const db = c.env.DB;
  const [list, count] = await db.batch([
    db
      .prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .bind(...params, q.pageSize, (q.page - 1) * q.pageSize),
    db.prepare(`SELECT COUNT(*) AS total FROM audit_logs ${where}`).bind(...params),
  ]);
  const items: AuditEntry[] = (
    list!.results as {
      id: number;
      actor_email: string | null;
      action: string;
      target: string | null;
      detail: string | null;
      ip: string | null;
      created_at: number;
    }[]
  ).map((r) => ({
    id: r.id,
    actorEmail: r.actor_email,
    action: r.action,
    target: r.target,
    detail: r.detail,
    ip: r.ip,
    createdAt: r.created_at,
  }));
  return c.json({ items, total: (count!.results[0] as { total: number }).total, page: q.page, pageSize: q.pageSize });
});
