import type { AppContext } from '../env';
import { clientIp } from './util';

interface AuditOptions {
  target?: string | null;
  detail?: unknown;
  actor?: { id: string; email: string };
}

/** Ghi nhật ký bảo mật/quản trị. Chạy nền (waitUntil) nên không làm chậm response. */
export function audit(c: AppContext, action: string, options: AuditOptions = {}): void {
  const actor = options.actor ?? c.get('user');
  const detail = options.detail === undefined ? null : JSON.stringify(options.detail).slice(0, 2000);
  const stmt = c.env.DB.prepare(
    'INSERT INTO audit_logs (actor_id, actor_email, action, target, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(actor?.id ?? null, actor?.email ?? null, action, options.target ?? null, detail, clientIp(c), Date.now());
  c.executionCtx.waitUntil(
    stmt.run().then(
      () => undefined,
      (err: unknown) => console.error('audit log failed', err),
    ),
  );
}
