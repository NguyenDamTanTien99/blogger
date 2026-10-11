import { MB } from '../shared/constants';
import type { MaintenanceReport } from '../shared/types';
import { abortUploads, purgeFiles, type PurgeTarget } from './lib/files';
import { getSettings } from './lib/settings';
import { addUsage, flushUsage, FREE_TIER, getUsage } from './lib/usage';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Giới hạn mỗi lượt để không vượt 50 truy vấn D1 / lần chạy của gói Free; cron chạy mỗi giờ nên sẽ xử lý tiếp. */
const BATCH = 270;

/** Chọn các file đầu danh sách cho tới khi đủ số byte cần giải phóng. */
function takeUntil(rows: PurgeTarget[], bytesNeeded: number): PurgeTarget[] {
  const picked: PurgeTarget[] = [];
  let sum = 0;
  for (const r of rows) {
    if (sum >= bytesNeeded) break;
    picked.push(r);
    sum += r.size;
  }
  return picked;
}

/** Object trên R2 không còn bản ghi tương ứng (ví dụ upload lỗi giữa chừng): xóa để không tốn dung lượng. */
async function cleanOrphans(env: Env, maxPages: number): Promise<number> {
  let cursor: string | undefined;
  let removed = 0;
  for (let page = 0; page < maxPages; page++) {
    const list = await env.BUCKET.list({ prefix: 'u/', cursor, limit: 1000 });
    addUsage('r2_class_a');
    // Bỏ qua object mới hơn 1 ngày: có thể là upload đang chạy chưa kịp ghi bản ghi.
    const keys = list.objects.filter((o) => Date.now() - o.uploaded.getTime() > DAY).map((o) => o.key);
    if (keys.length) {
      const { results } = await env.DB.prepare(
        `SELECT j.value AS k FROM json_each(?) j
         WHERE NOT EXISTS (SELECT 1 FROM files f WHERE f.r2_key = j.value)
           AND NOT EXISTS (SELECT 1 FROM uploads u WHERE u.r2_key = j.value)`,
      )
        .bind(JSON.stringify(keys))
        .all<{ k: string }>();
      if (results.length) await env.BUCKET.delete(results.map((r) => r.k));
      removed += results.length;
    }
    if (!list.truncated) break;
    cursor = list.cursor;
  }
  return removed;
}

/**
 * Bảo trì định kỳ (mỗi giờ) và khi admin bấm "Dọn dẹp ngay".
 * Thứ tự dọn từ an toàn nhất: upload bỏ dở -> thùng rác hết hạn -> (gần ngưỡng) thùng rác còn lại
 * -> (chỉ khi admin bật) file riêng tư cũ nhất. Không bao giờ tự xóa ghi chú, bài viết hay file công khai.
 */
export async function runMaintenance(env: Env, force = false): Promise<MaintenanceReport> {
  const now = Date.now();
  const s = await getSettings(env);
  const db = env.DB;
  const report: MaintenanceReport = {
    ranAt: now,
    staleUploads: 0,
    expiredTrash: 0,
    purgedForSpace: 0,
    deletedOldFiles: 0,
    orphans: 0,
    prunedRows: 0,
    freedBytes: 0,
  };

  // 1. Upload bỏ dở quá hạn: hủy multipart trên R2 (miễn phí) và trả lại quota đang giữ chỗ.
  const { results: stale } = await db
    .prepare('SELECT id, r2_key, r2_upload_id FROM uploads WHERE expires_at < ? LIMIT 90')
    .bind(now)
    .all<{ id: string; r2_key: string; r2_upload_id: string | null }>();
  await abortUploads(env.BUCKET, stale);
  report.staleUploads = stale.length;

  const routine = await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(now - DAY),
    db.prepare('DELETE FROM audit_logs WHERE created_at < ?').bind(now - 180 * DAY),
    db.prepare('DELETE FROM usage_counters WHERE period < ?').bind(new Date(now - 400 * DAY).toISOString().slice(0, 7)),
    ...(stale.length ? [db.prepare(`DELETE FROM uploads WHERE id IN (${stale.map(() => '?').join(',')})`).bind(...stale.map((u) => u.id))] : []),
  ]);
  report.prunedRows += routine.slice(0, 4).reduce((n, r) => n + (r.meta.changes ?? 0), 0);

  // 2. Thùng rác quá thời gian lưu giữ.
  const { results: expired } = await db
    .prepare('SELECT id, r2_key, owner_id, size FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ? ORDER BY deleted_at LIMIT ?')
    .bind(now - s.trashRetentionDays * DAY, BATCH)
    .all<PurgeTarget>();
  report.freedBytes += await purgeFiles(env, expired);
  report.expiredTrash = expired.length;

  // 3. Dung lượng R2 chạm ngưỡng dọn dẹp: giải phóng về dưới ngưỡng cảnh báo.
  const limit = s.strictFreeTier ? FREE_TIER.r2Storage : s.globalStorageLimitMB * MB;
  let usage = await getUsage(env, true);
  if ((usage.r2Storage / limit) * 100 >= s.usageCleanPercent) {
    let needed = usage.r2Storage - (limit * s.usageWarnPercent) / 100;
    const { results: trash } = await db
      .prepare('SELECT id, r2_key, owner_id, size FROM files WHERE deleted_at IS NOT NULL ORDER BY deleted_at LIMIT ?')
      .bind(BATCH)
      .all<PurgeTarget>();
    const fromTrash = takeUntil(trash, needed);
    const freed = await purgeFiles(env, fromTrash);
    report.purgedForSpace = fromTrash.length;
    report.freedBytes += freed;
    needed -= freed;

    if (needed > 0 && s.autoDeleteOldFilesDays > 0) {
      // Chỉ khi admin bật: xóa file RIÊNG TƯ cũ nhất (file công khai có thể đang dùng trong bài viết).
      const { results: old } = await db
        .prepare(
          `SELECT id, r2_key, owner_id, size FROM files
           WHERE deleted_at IS NULL AND visibility = 'private' AND created_at < ? ORDER BY created_at LIMIT ?`,
        )
        .bind(now - s.autoDeleteOldFilesDays * DAY, BATCH)
        .all<PurgeTarget>();
      const victims = takeUntil(old, needed);
      report.freedBytes += await purgeFiles(env, victims);
      report.deletedOldFiles = victims.length;
    }
    usage = await getUsage(env, true);
  }

  // 4. Database D1 gần đầy (500MB): thu gọn dữ liệu phụ, không đụng tới ghi chú/bài viết/file.
  if ((usage.d1Size / FREE_TIER.d1Size) * 100 >= s.usageCleanPercent) {
    const pruned = await db.batch([
      db.prepare('DELETE FROM audit_logs WHERE created_at < ?').bind(now - 30 * DAY),
      db.prepare('DELETE FROM social_shares WHERE created_at < ?').bind(now - 90 * DAY),
      db.prepare('DELETE FROM login_attempts'),
    ]);
    report.prunedRows += pruned.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }

  // 5. Dọn object mồ côi: mỗi ngày một lần (03:xx UTC) hoặc khi chạy tay — lệnh list của R2 tốn thao tác Class A.
  const classAPercent = (usage.r2ClassA / FREE_TIER.r2ClassA) * 100;
  if ((force || new Date(now).getUTCHours() === 3) && (!s.strictFreeTier || classAPercent < s.usageCleanPercent)) {
    report.orphans = await cleanOrphans(env, 2);
  }

  await flushUsage(env);
  const acted = report.staleUploads + report.expiredTrash + report.purgedForSpace + report.deletedOldFiles + report.orphans > 0;
  if (acted || force) {
    await db
      .prepare('INSERT INTO audit_logs (actor_id, actor_email, action, target, detail, ip, created_at) VALUES (NULL, NULL, ?, NULL, ?, NULL, ?)')
      .bind(report.deletedOldFiles ? 'usage.auto_delete' : 'usage.maintenance', JSON.stringify(report), now)
      .run();
  }
  console.log('maintenance', JSON.stringify(report));
  return report;
}
