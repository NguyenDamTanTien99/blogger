import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Vars } from '../../shared/i18n';

/** message là câu mẫu tiếng Việt (có thể chứa {bien}); được dịch theo ngôn ngữ của request khi trả về. */
export class HttpError extends Error {
  public vars?: Vars;
  public details?: unknown;
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    opts: { vars?: Vars; details?: unknown } = {},
  ) {
    super(message);
    this.vars = opts.vars;
    this.details = opts.details;
  }
}

type Opts = { vars?: Vars; details?: unknown };

export const badRequest = (message: string, opts?: Opts) => new HttpError(400, 'bad_request', message, opts);
export const unauthorized = (message = 'Bạn cần đăng nhập để tiếp tục.') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Bạn không có quyền thực hiện thao tác này.') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Không tìm thấy dữ liệu.') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, opts?: Opts) => new HttpError(409, 'conflict', message, opts);
export const tooLarge = (message: string, opts?: Opts) => new HttpError(413, 'too_large', message, opts);
export const tooManyRequests = (message: string) => new HttpError(429, 'rate_limited', message);
/** Tạm dừng một thao tác để không vượt hạn mức miễn phí (tránh phát sinh phí). */
export const overBudget = (message: string, opts?: Opts) => new HttpError(503, 'over_budget', message, opts);
