import { z } from 'zod';
import { PASSWORD_KEY_RE } from '../../shared/crypto';
import { translate, type Lang } from '../../shared/i18n';
import type { AppContext } from '../env';
import { badRequest } from './http';

// Thông báo lỗi của zod theo ngôn ngữ từng request (không dùng z.config toàn cục vì nhiều request chạy xen kẽ).
const LOCALES: Record<Lang, ReturnType<typeof z.locales.en>> = { vi: z.locales.vi(), en: z.locales.en() };

function parse<T extends z.ZodType>(c: AppContext, schema: T, input: unknown) {
  const lang = c.get('lang') ?? 'vi';
  const result = schema.safeParse(input, { error: LOCALES[lang].localeError });
  if (result.success) return { data: result.data as z.infer<T>, issues: [] };
  // Thông báo tự viết trong schema là câu tiếng Việt => dịch qua từ điển.
  const issues = result.error.issues.map((i) => ({ path: i.path.join('.'), message: translate(lang, i.message) }));
  return { data: null, issues };
}

export async function readJson<T extends z.ZodType>(c: AppContext, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('Dữ liệu gửi lên không phải JSON hợp lệ.');
  }
  const { data, issues } = parse(c, schema, body);
  if (issues.length) {
    const first = issues[0]!;
    throw badRequest('{field}{message}', { vars: { field: first.path ? `${first.path}: ` : '', message: first.message }, details: issues });
  }
  return data as z.infer<T>;
}

export function readQuery<T extends z.ZodType>(c: AppContext, schema: T): z.infer<T> {
  const { data, issues } = parse(c, schema, c.req.query());
  if (issues.length) throw badRequest('Tham số truy vấn không hợp lệ.', { details: issues });
  return data as z.infer<T>;
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
