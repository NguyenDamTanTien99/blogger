import { GB, MB } from '../../shared/constants';
import type { SiteSettings } from '../../shared/settings';
import type { UsageMetric } from '../../shared/types';
import type { AppContext } from '../env';
import { overBudget } from './http';
import { getSettings } from './settings';

/**
 * Hạn mức miễn phí của Cloudflare. Chỉ R2 tính tiền khi vượt (đã kích hoạt gói R2);
 * Workers và D1 gói Free chỉ trả lỗi khi vượt — vẫn theo dõi để site không bị gián đoạn.
 */
export const FREE_TIER = {
  r2Storage: 10 * GB,
  r2ClassA: 1_000_000,
  r2ClassB: 10_000_000,
  d1Size: 500 * MB,
  workerRequests: 100_000,
} as const;

type Metric = 'r2_class_a' | 'r2_class_b' | 'worker_requests';

const monthKey = () => new Date().toISOString().slice(0, 7);
const dayKey = () => new Date().toISOString().slice(0, 10);

// Gộp bộ đếm trong isolate rồi ghi D1 theo lô: tránh mỗi request tốn 1 lượt ghi.
const pending = new Map<string, number>();
let lastFlush = Date.now();

/** Cộng vào bộ đếm chờ ghi (dùng trong cron, nơi không có ctx của request). */
export function addUsage(metric: Metric, n = 1): void {
  const key = `${metric === 'worker_requests' ? dayKey() : monthKey()}|${metric}`;
  pending.set(key, (pending.get(key) ?? 0) + n);
}

export function track(env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }, metric: Metric, n = 1): void {
  addUsage(metric, n);
  let total = 0;
  for (const v of pending.values()) total += v;
  if (total >= 50 || Date.now() - lastFlush > 30_000) ctx.waitUntil(flushUsage(env));
}

export async function flushUsage(env: Env): Promise<void> {
  if (!pending.size) return;
  const entries = [...pending.entries()];
  pending.clear();
  lastFlush = Date.now();
  try {
    await env.DB.batch(
      entries.map(([key, value]) => {
        const [period, metric] = key.split('|');
        return env.DB.prepare(
          `INSERT INTO usage_counters (period, metric, value) VALUES (?, ?, ?)
           ON CONFLICT(period, metric) DO UPDATE SET value = value + excluded.value`,
        ).bind(period, metric, value);
      }),
    );
  } catch (err) {
    console.error('usage flush failed', err);
  }
}

function pendingOf(metric: Metric): number {
  const key = `${metric === 'worker_requests' ? dayKey() : monthKey()}|${metric}`;
  return pending.get(key) ?? 0;
}

export interface UsageSnapshot {
  r2Storage: number;
  r2ClassA: number;
  r2ClassB: number;
  d1Size: number;
  workerRequests: number;
  at: number;
}

let cached: UsageSnapshot | null = null;

/** Mức sử dụng hiện tại (cache 60 giây trong isolate; fresh = đọc lại ngay). */
export async function getUsage(env: Env, fresh = false): Promise<UsageSnapshot> {
  if (!fresh && cached && Date.now() - cached.at < 60_000) {
    return {
      ...cached,
      r2ClassA: cached.r2ClassA + pendingOf('r2_class_a'),
      r2ClassB: cached.r2ClassB + pendingOf('r2_class_b'),
      workerRequests: cached.workerRequests + pendingOf('worker_requests'),
    };
  }
  const [storage, counters] = await env.DB.batch([
    env.DB.prepare(
      'SELECT (SELECT COALESCE(SUM(storage_used), 0) FROM users) + (SELECT COALESCE(SUM(size), 0) FROM uploads) AS bytes',
    ),
    env.DB.prepare('SELECT period, metric, value FROM usage_counters WHERE period IN (?, ?)').bind(monthKey(), dayKey()),
  ]);
  const value = (metric: Metric) =>
    ((counters!.results as { metric: string; value: number }[]).find((r) => r.metric === metric)?.value ?? 0);
  cached = {
    r2Storage: (storage!.results[0] as { bytes: number }).bytes,
    r2ClassA: value('r2_class_a'),
    r2ClassB: value('r2_class_b'),
    d1Size: Number((storage!.meta as { size_after?: number }).size_after ?? 0),
    workerRequests: value('worker_requests'),
    at: Date.now(),
  };
  return getUsage(env);
}

/** Giới hạn dung lượng thực tế: giới hạn admin đặt, và (chế độ miễn phí) không vượt ngưỡng tạm dừng của 10 GB. */
export function storageLimit(s: SiteSettings): number {
  const configured = s.globalStorageLimitMB * MB;
  return s.strictFreeTier ? Math.min(configured, Math.floor((FREE_TIER.r2Storage * s.usageStopPercent) / 100)) : configured;
}

export function metrics(u: UsageSnapshot, s: SiteSettings): UsageMetric[] {
  const pct = (used: number, limit: number) => Math.round((used / limit) * 1000) / 10;
  const m = (key: UsageMetric['key'], used: number, limit: number, period: UsageMetric['period'], billable: boolean): UsageMetric => ({
    key,
    used,
    limit,
    percent: pct(used, limit),
    period,
    billable,
  });
  return [
    m('r2Storage', u.r2Storage, s.strictFreeTier ? FREE_TIER.r2Storage : s.globalStorageLimitMB * MB, 'now', true),
    m('r2ClassA', u.r2ClassA, FREE_TIER.r2ClassA, 'month', true),
    m('r2ClassB', u.r2ClassB, FREE_TIER.r2ClassB, 'month', true),
    m('d1Size', u.d1Size, FREE_TIER.d1Size, 'now', false),
    m('workerRequests', u.workerRequests, FREE_TIER.workerRequests, 'day', false),
  ];
}

/**
 * Gọi trước mỗi thao tác R2 tốn phí: ghi nhận vào bộ đếm, và ở chế độ miễn phí thì từ chối
 * khi đã chạm ngưỡng tạm dừng (mặc định 98% hạn mức tháng) — không bao giờ phát sinh phí.
 * Class A = ghi (put, upload part, tạo/hoàn tất multipart, list); Class B = đọc (get, head). Xóa miễn phí.
 */
export async function guardR2(c: AppContext, cls: 'A' | 'B', count = 1): Promise<void> {
  const s = await getSettings(c.env);
  if (s.strictFreeTier) {
    const u = await getUsage(c.env);
    const used = cls === 'A' ? u.r2ClassA : u.r2ClassB;
    const limit = cls === 'A' ? FREE_TIER.r2ClassA : FREE_TIER.r2ClassB;
    if (((used + count) / limit) * 100 >= s.usageStopPercent) {
      throw overBudget(
        cls === 'A'
          ? 'Đã dùng gần hết hạn mức ghi dữ liệu miễn phí của R2 tháng này. Upload tạm dừng để tránh phát sinh phí và sẽ mở lại vào đầu tháng sau (UTC).'
          : 'Đã dùng gần hết hạn mức đọc dữ liệu miễn phí của R2 tháng này. Tải file tạm dừng để tránh phát sinh phí và sẽ mở lại vào đầu tháng sau (UTC).',
      );
    }
  }
  track(c.env, c.executionCtx, cls === 'A' ? 'r2_class_a' : 'r2_class_b', count);
}
