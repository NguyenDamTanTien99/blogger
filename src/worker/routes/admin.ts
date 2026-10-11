import { Hono } from 'hono';
import { z } from 'zod';
import type { SiteSettings } from '../../shared/settings';
import type { AuditEntry, MaintenanceReport, UsageDTO } from '../../shared/types';
import { runMaintenance } from '../cron';
import { getUsage, metrics } from '../lib/usage';
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
  language: z.enum(['vi', 'en']),
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
  verificationFiles: z
    .array(
      z.object({
        name: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\.(txt|html)$/, 'Tên file chỉ gồm chữ, số, _ . - và kết thúc bằng .txt hoặc .html'),
        content: z.string().max(5000),
      }),
    )
    .max(10),
  defaultQuotaMB: z.number().int().min(0).max(1_048_576),
  globalStorageLimitMB: z.number().int().min(1).max(1_048_576),
  maxFileSizeMB: z.number().int().min(1).max(1_048_576),
  strictFreeTier: z.boolean(),
  usageWarnPercent: z.number().int().min(10).max(100),
  usageCleanPercent: z.number().int().min(10).max(100),
  usageStopPercent: z.number().int().min(10).max(100),
  trashRetentionDays: z.number().int().min(1).max(3650),
  autoDeleteOldFilesDays: z.number().int().min(0).max(36500),
})
  .refine((s) => s.usageWarnPercent <= s.usageCleanPercent && s.usageCleanPercent <= s.usageStopPercent, {
    message: 'Ngưỡng phải theo thứ tự: cảnh báo ≤ dọn dẹp ≤ tạm dừng.',
  }) satisfies z.ZodType<SiteSettings>;

settings.get('/', async (c) => c.json({ settings: await getSettings(c.env) }));

settings.put('/', async (c) => {
  const value = await readJson(c, settingsSchema);
  await saveSettings(c.env, value);
  audit(c, 'settings.update');
  return c.json({ settings: value });
});

// ---------- Hạn mức miễn phí & dọn dẹp (chỉ admin) ----------

export const usageRoutes = new Hono<AppEnv>();
usageRoutes.use('*', requireAdmin);

usageRoutes.get('/', async (c) => {
  const [s, u] = await Promise.all([getSettings(c.env), getUsage(c.env, true)]);
  const db = c.env.DB;
  const [trash, last] = await db.batch([
    db.prepare('SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM files WHERE deleted_at IS NOT NULL'),
    db.prepare("SELECT detail FROM audit_logs WHERE action IN ('usage.maintenance', 'usage.auto_delete') ORDER BY created_at DESC LIMIT 1"),
  ]);
  let lastMaintenance: MaintenanceReport | null = null;
  try {
    const detail = (last!.results[0] as { detail: string } | undefined)?.detail;
    lastMaintenance = detail ? (JSON.parse(detail) as MaintenanceReport) : null;
  } catch {
    lastMaintenance = null;
  }
  const dto: UsageDTO = {
    metrics: metrics(u, s),
    trash: trash!.results[0] as { files: number; bytes: number },
    thresholds: { warn: s.usageWarnPercent, clean: s.usageCleanPercent, stop: s.usageStopPercent },
    strict: s.strictFreeTier,
    lastMaintenance,
  };
  return c.json(dto);
});

usageRoutes.post('/maintenance', async (c) => {
  const report = await runMaintenance(c.env, true);
  audit(c, 'usage.manual_cleanup', { detail: report });
  return c.json({ report });
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
