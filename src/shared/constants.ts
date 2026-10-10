export const MB = 1024 * 1024;
export const GB = 1024 * MB;

export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Mật khẩu được "kéo giãn" bằng PBKDF2 ngay trên trình duyệt (xem crypto.ts) để Worker gói Free
 * (giới hạn 10ms CPU/request) chỉ phải băm SHA-256 một lần. Đổi 2 giá trị này sẽ làm mọi mật khẩu cũ mất hiệu lực.
 */
export const KDF_ITERATIONS = 600_000;
export const KDF_SALT_PREFIX = 'webblogger:v1:';
export const MIN_PASSWORD_LENGTH = 8;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Gia hạn phiên tối đa 1 lần/ngày để tiết kiệm lượt ghi D1. */
export const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_PER_EMAIL = 10;
export const LOGIN_MAX_PER_IP = 30;

/** Upload bỏ dở quá thời gian này sẽ bị cron hủy và giải phóng quota. */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
/** R2: mọi phần (trừ phần cuối) phải bằng nhau, tối thiểu 5 MiB. Gói Free giới hạn body 100MB/request. */
export const MIN_PART_SIZE = 5 * MB;
export const MAX_PART_SIZE = 95 * MB;
export const MAX_PARTS = 10_000;

/** D1 giới hạn 2MB/row nên chặn sớm ở đây. */
export const NOTE_MAX_BYTES = 1_000_000;
export const POST_MAX_BYTES = 1_800_000;

/** Xem trước Word/Excel/text trong trình duyệt cho file tới kích thước này. */
export const PREVIEW_MAX_BYTES = 25 * MB;

/** Trang tĩnh (type = page) nằm ở /:slug nên không được trùng các route hệ thống. */
export const RESERVED_SLUGS = [
  'app', 'api', 'f', 'posts', 'tags', 'page', 'search', 'rss.xml', 'feed', 'sitemap.xml',
  'robots.txt', 'favicon.svg', 'favicon.ico', 'login', 'admin', 'assets',
];
