import { abortUploads } from './lib/files';

const DAY = 24 * 60 * 60 * 1000;

/** Chạy hằng ngày (triggers.crons): giải phóng quota của upload bỏ dở và dọn dữ liệu hết hạn. */
export async function runCleanup(env: Env): Promise<void> {
  const now = Date.now();
  const { results: stale } = await env.DB.prepare(
    'SELECT id, r2_key, r2_upload_id FROM uploads WHERE expires_at < ? LIMIT 90',
  )
    .bind(now)
    .all<{ id: string; r2_key: string; r2_upload_id: string | null }>();
  await abortUploads(env.BUCKET, stale);

  const statements = [
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM login_attempts WHERE created_at < ?').bind(now - DAY),
    env.DB.prepare('DELETE FROM audit_logs WHERE created_at < ?').bind(now - 180 * DAY),
  ];
  if (stale.length) {
    statements.push(
      env.DB.prepare(`DELETE FROM uploads WHERE id IN (${stale.map(() => '?').join(',')})`).bind(...stale.map((u) => u.id)),
    );
  }
  await env.DB.batch(statements);
  console.log(`cleanup: aborted ${stale.length} stale uploads`);
}
