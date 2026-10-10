import { createMiddleware } from 'hono/factory';
import type { AppEnv, SessionUser } from './env';
import { forbidden, unauthorized } from './lib/http';
import { loadSessionUser } from './lib/session';

/**
 * Chống CSRF cho mọi request thay đổi dữ liệu: Origin phải trùng host (cookie SameSite=Lax là lớp thứ 2).
 * Không có Origin thì dựa vào Sec-Fetch-Site (trình duyệt hiện đại luôn gửi một trong hai).
 */
export const csrfGuard = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = c.req.header('origin');
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        throw forbidden('Origin không hợp lệ.');
      }
      const host = c.req.header('host');
      if (originHost !== host && originHost !== new URL(c.req.url).host) throw forbidden('Yêu cầu khác nguồn bị chặn.');
    } else {
      const site = c.req.header('sec-fetch-site');
      if (site && site !== 'same-origin' && site !== 'none') throw forbidden('Yêu cầu khác nguồn bị chặn.');
    }
  }
  await next();
});

export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  c.set('user', await loadSessionUser(c));
  await next();
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get('user')) throw unauthorized();
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) throw unauthorized();
  if (user.role !== 'admin') throw forbidden('Chỉ admin mới được thực hiện thao tác này.');
  await next();
});

/** Lấy user đã đăng nhập (dùng sau requireAuth). */
export function currentUser(c: { get(key: 'user'): SessionUser | null }): SessionUser {
  const user = c.get('user');
  if (!user) throw unauthorized();
  return user;
}

export function isAdmin(user: SessionUser): boolean {
  return user.role === 'admin';
}

/** Admin được truy cập mọi dữ liệu; user chỉ được truy cập dữ liệu của chính mình. */
export function assertOwnerOrAdmin(user: SessionUser, ownerId: string): void {
  if (user.role !== 'admin' && user.id !== ownerId) throw forbidden();
}
