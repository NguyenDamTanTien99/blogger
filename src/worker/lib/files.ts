import type { AppContext } from '../env';
import { notFound } from './http';

export interface FileRow {
  id: string;
  owner_id: string;
  owner_name?: string;
  folder_id: string | null;
  r2_key: string;
  name: string;
  size: number;
  content_type: string;
  visibility: 'private' | 'public';
  description: string;
  created_at: number;
  updated_at: number;
  deleted_at?: number | null;
}

export function r2KeyFor(ownerId: string, fileId: string): string {
  return `u/${ownerId}/${fileId}`;
}

// Chỉ những loại an toàn mới được hiển thị inline cùng origin. SVG/HTML luôn bị ép tải xuống
// vì có thể chứa script (chống XSS từ file do user khác tải lên).
const INLINE_SAFE =
  /^(image\/(png|jpeg|gif|webp|avif|bmp|x-icon)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf|text\/plain)$/;

function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function responseHeaders(file: FileRow, wantInline: boolean, isPublic: boolean): Headers {
  let type = file.content_type || 'application/octet-stream';
  // Mọi văn bản đều trả về dạng text/plain để trình duyệt không bao giờ thực thi nó.
  if (type.startsWith('text/') || type === 'application/json' || type === 'application/xml') type = 'text/plain';
  const inline = wantInline && INLINE_SAFE.test(type);
  const headers = new Headers();
  headers.set('Content-Type', type === 'text/plain' ? 'text/plain; charset=utf-8' : type);
  headers.set('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', file.name));
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'SAMEORIGIN');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', isPublic ? 'public, max-age=300' : 'private, no-cache');
  headers.set('Cross-Origin-Resource-Policy', isPublic ? 'cross-origin' : 'same-origin');
  // Trình xem PDF của Chrome không chạy được trong sandbox; PDF vốn không truy cập được origin của trang.
  if (type !== 'application/pdf') {
    headers.set(
      'Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    );
  }
  return headers;
}

/** Stream thẳng từ R2 (không đệm vào RAM của Worker). Hỗ trợ Range → tải tiếp/tua video, và ETag → 304. */
export async function streamFile(
  c: AppContext,
  file: FileRow,
  options: { inline: boolean; isPublic: boolean },
): Promise<Response> {
  const headers = responseHeaders(file, options.inline, options.isPublic);
  const reqHeaders = c.req.raw.headers;
  const hasRange = reqHeaders.has('range');

  let object: R2Object | R2ObjectBody | null;
  try {
    object = await c.env.BUCKET.get(file.r2_key, { range: reqHeaders, onlyIf: reqHeaders });
  } catch (err) {
    if (!hasRange) throw err;
    headers.set('Content-Range', `bytes */${file.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (!object) throw notFound('Dữ liệu của file không còn trên kho lưu trữ.');

  headers.set('ETag', object.httpEtag);
  headers.set('Last-Modified', object.uploaded.toUTCString());

  if (!('body' in object) || !object.body) {
    const notModified = reqHeaders.has('if-none-match') || reqHeaders.has('if-modified-since');
    return new Response(null, { status: notModified ? 304 : 412, headers });
  }

  const range = object.range;
  if (hasRange && range) {
    let offset: number;
    let length: number;
    if ('suffix' in range) {
      length = Math.min(range.suffix, object.size);
      offset = object.size - length;
    } else {
      offset = range.offset ?? 0;
      length = range.length ?? object.size - offset;
    }
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

export interface PurgeTarget {
  id: string;
  r2_key: string;
  owner_id: string;
  size: number;
}

/** Xóa hẳn file: object trên R2 (thao tác xóa của R2 miễn phí) + bản ghi + trả lại dung lượng cho chủ sở hữu. */
export async function purgeFiles(env: Env, files: PurgeTarget[]): Promise<number> {
  let freed = 0;
  for (let i = 0; i < files.length; i += 90) {
    const chunk = files.slice(i, i + 90);
    await env.BUCKET.delete(chunk.map((f) => f.r2_key));
    const perOwner = new Map<string, number>();
    for (const f of chunk) perOwner.set(f.owner_id, (perOwner.get(f.owner_id) ?? 0) + f.size);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM files WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk.map((f) => f.id)),
      ...[...perOwner].map(([owner, bytes]) =>
        env.DB.prepare('UPDATE users SET storage_used = MAX(0, storage_used - ?) WHERE id = ?').bind(bytes, owner),
      ),
    ]);
    freed += chunk.reduce((sum, f) => sum + f.size, 0);
  }
  return freed;
}

/** Xóa nhiều object (R2 cho phép 1000 key/lần gọi). */
export async function deleteObjects(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000));
  }
}

export async function abortUploads(bucket: R2Bucket, uploads: { r2_key: string; r2_upload_id: string | null }[]) {
  for (const u of uploads) {
    try {
      if (u.r2_upload_id) await bucket.resumeMultipartUpload(u.r2_key, u.r2_upload_id).abort();
      else await bucket.delete(u.r2_key);
    } catch (err) {
      console.warn('abort upload failed', u.r2_key, err);
    }
  }
}
