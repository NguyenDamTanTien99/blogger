import { z } from 'zod';
import { PASSWORD_KEY_RE } from '../../shared/crypto';
import type { AppContext } from '../env';
import { badRequest } from './http';

z.config(z.locales.vi());

function issues(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

export async function readJson<T extends z.ZodType>(c: AppContext, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('Dữ liệu gửi lên không phải JSON hợp lệ.');
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const list = issues(result.error);
    const first = list[0];
    throw badRequest(first ? `${first.path ? first.path + ': ' : ''}${first.message}` : 'Dữ liệu không hợp lệ.', list);
  }
  return result.data;
}

export function readQuery<T extends z.ZodType>(c: AppContext, schema: T): z.infer<T> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) throw badRequest('Tham số truy vấn không hợp lệ.', issues(result.error));
  return result.data;
}

/** Khóa mật khẩu đã qua PBKDF2 ở trình duyệt (server không bao giờ nhận mật khẩu gốc). */
export const passwordKey = z.string().regex(PASSWORD_KEY_RE, 'Khóa mật khẩu không hợp lệ');
export const emailField = z.email('Email không hợp lệ').max(254);
export const nameField = z.string().trim().min(1, 'Không được để trống').max(80);
export const idField = z.string().regex(/^[A-Za-z0-9-]{8,40}$/, 'ID không hợp lệ');

export const pageQuery = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
