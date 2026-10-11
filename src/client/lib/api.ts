import type { ApiErrorBody } from '../../shared/types';
import { getLang, t } from './i18n';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** Gọi khi phiên đăng nhập hết hạn ở bất kỳ request nào. */
export function onUnauthorized(handler: () => void) {
  unauthorizedHandler = handler;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; query?: Query; signal?: AbortSignal } = {},
): Promise<T> {
  let url = `/api${path}`;
  if (init.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += `${url.includes('?') ? '&' : '?'}${s}`;
  }
  const hasBody = init.body !== undefined;
  const res = await fetch(url, {
    method: init.method ?? (hasBody ? 'POST' : 'GET'),
    headers: { 'X-Lang': getLang(), ...(hasBody ? { 'Content-Type': 'application/json' } : {}) },
    body: hasBody ? JSON.stringify(init.body) : undefined,
    credentials: 'same-origin',
    signal: init.signal,
  });
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401 && path !== '/auth/login') unauthorizedHandler?.();
    throw new ApiError(res.status, err?.code ?? 'http_error', err?.message ?? t('Lỗi máy chủ ({status}).', { status: res.status }), err?.details);
  }
  return data as T;
}

export const apiGet = <T>(path: string, query?: Query) => api<T>(path, { query });
export const apiPost = <T>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
export const apiPatch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const apiPut = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
export const apiDelete = <T = void>(path: string) => api<T>(path, { method: 'DELETE' });

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return String(err);
}
