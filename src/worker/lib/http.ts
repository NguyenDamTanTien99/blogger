import type { ContentfulStatusCode } from 'hono/utils/http-status';

export class HttpError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Bạn cần đăng nhập để tiếp tục.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Bạn không có quyền thực hiện thao tác này.') =>
  new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Không tìm thấy dữ liệu.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, 'conflict', message, details);
export const tooLarge = (message: string) => new HttpError(413, 'too_large', message);
export const tooManyRequests = (message: string) => new HttpError(429, 'rate_limited', message);
