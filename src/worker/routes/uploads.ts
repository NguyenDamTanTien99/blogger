import { Hono } from 'hono';
import { z } from 'zod';
import { MAX_PART_SIZE, MAX_PARTS, MB, MIN_PART_SIZE, UPLOAD_TTL_MS } from '../../shared/constants';
import { guessContentType } from '../../shared/mime';
import { formatBytes } from '../../shared/text';
import type { UploadSession } from '../../shared/types';
import type { AppEnv, SessionUser } from '../env';
import { currentUser, isAdmin, requireAuth } from '../middleware';
import { r2KeyFor, type FileRow } from '../lib/files';
import { badRequest, HttpError, notFound, tooLarge } from '../lib/http';
import { toFile } from '../lib/mappers';
import { getSettings } from '../lib/settings';
import { newId, sanitizeFileName } from '../lib/util';
import { readJson } from '../lib/validate';
import { loadFolder } from './drive';

/**
 * Luồng upload (hỗ trợ file tới 10GB trên gói Free):
 *   1. POST   /uploads               -> giữ chỗ quota, tạo multipart upload trên R2
 *   2. PUT    /uploads/:id/parts/:n  -> gửi từng phần (<= 95MB vì giới hạn body 100MB), chạy song song, thử lại được
 *   3. POST   /uploads/:id/complete  -> ghép các phần, tạo bản ghi file
 *   GET /uploads/:id trả về các phần đã xong để TIẾP TỤC sau khi mất mạng/tải lại trang.
 */
const uploads = new Hono<AppEnv>();
uploads.use('*', requireAuth);

interface UploadRow {
  id: string;
  owner_id: string;
  created_by: string;
  folder_id: string | null;
  r2_key: string;
  r2_upload_id: string | null;
  name: string;
  size: number;
  content_type: string;
  visibility: 'private' | 'public';
  part_size: number;
  part_count: number;
  created_at: number;
  expires_at: number;
}

function partSize(env: Env): number {
  const mb = Number(env.UPLOAD_PART_SIZE_MB) || 50;
  return Math.min(MAX_PART_SIZE, Math.max(MIN_PART_SIZE, Math.round(mb * MB)));
}

async function loadUpload(db: D1Database, user: SessionUser, id: string): Promise<UploadRow> {
  const row = await db.prepare('SELECT * FROM uploads WHERE id = ?').bind(id).first<UploadRow>();
  if (!row || (row.created_by !== user.id && !isAdmin(user))) throw notFound('Phiên upload không tồn tại hoặc đã hết hạn.');
  return row;
}

async function uploadedParts(db: D1Database, id: string) {
  const { results } = await db
    .prepare('SELECT part_number, etag, size FROM upload_parts WHERE upload_id = ? ORDER BY part_number')
    .bind(id)
    .all<{ part_number: number; etag: string; size: number }>();
  return results;
}

uploads.post('/', async (c) => {
  const me = currentUser(c);
  const body = await readJson(
    c,
    z.object({
      name: z.string().min(1).max(500),
      size: z.number().int().min(0),
      type: z.string().max(200).optional(),
      folderId: z.string().max(40).nullish(),
      ownerId: z.string().max(40).optional(),
      visibility: z.enum(['private', 'public']).optional(),
    }),
  );
  const db = c.env.DB;
  const settings = await getSettings(c.env);
  const maxFile = settings.maxFileSizeMB * MB;
  if (body.size > maxFile) throw tooLarge(`File vượt quá giới hạn ${formatBytes(maxFile)} mỗi file.`);

  // Admin có thể tải lên vào kho của user khác (file thuộc về user đó và tính vào quota của họ).
  const folder = body.folderId ? await loadFolder(db, me, body.folderId) : null;
  const ownerId = folder ? folder.owner_id : isAdmin(me) && body.ownerId ? body.ownerId : me.id;

  const size = body.size;
  const pSize = partSize(c.env);
  const partCount = Math.max(1, Math.ceil(size / pSize));
  if (partCount > MAX_PARTS) throw tooLarge('File quá lớn so với kích thước mỗi phần đã cấu hình.');

  const id = newId();
  const now = Date.now();
  const name = sanitizeFileName(body.name);
  const contentType = guessContentType(name, body.type);
  const key = r2KeyFor(ownerId, id);
  const globalLimit = settings.globalStorageLimitMB * MB;

  // Kiểm tra quota và giữ chỗ trong CÙNG một câu lệnh => không bị vượt quota khi upload song song.
  const inserted = await db
    .prepare(
      `INSERT INTO uploads (id, owner_id, created_by, folder_id, r2_key, r2_upload_id, name, size, content_type,
                            visibility, part_size, part_count, created_at, expires_at)
       SELECT ?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13
       WHERE (SELECT storage_used FROM users WHERE id = ?2 AND status = 'active')
             + (SELECT COALESCE(SUM(size), 0) FROM uploads WHERE owner_id = ?2) + ?7
             <= (SELECT storage_quota FROM users WHERE id = ?2)
         AND (SELECT COALESCE(SUM(storage_used), 0) FROM users)
             + (SELECT COALESCE(SUM(size), 0) FROM uploads) + ?7 <= ?14`,
    )
    .bind(id, ownerId, me.id, folder?.id ?? null, key, name, size, contentType, body.visibility ?? 'private', pSize, partCount, now, now + UPLOAD_TTL_MS, globalLimit)
    .run();

  if (!inserted.meta.changes) {
    const usage = await db
      .prepare(
        `SELECT u.storage_used + (SELECT COALESCE(SUM(size), 0) FROM uploads WHERE owner_id = u.id) AS used, u.storage_quota AS quota,
                (SELECT COALESCE(SUM(storage_used), 0) FROM users) + (SELECT COALESCE(SUM(size), 0) FROM uploads) AS total
         FROM users u WHERE u.id = ?`,
      )
      .bind(ownerId)
      .first<{ used: number; quota: number; total: number }>();
    if (!usage) throw notFound('Không tìm thấy người dùng sở hữu.');
    if (usage.used + size > usage.quota) {
      throw tooLarge(
        `Không đủ dung lượng: đã dùng ${formatBytes(usage.used)} / ${formatBytes(usage.quota)}, file cần ${formatBytes(size)}.`,
      );
    }
    throw tooLarge(
      `Vượt giới hạn lưu trữ toàn hệ thống (${formatBytes(globalLimit)}). Admin có thể tăng giới hạn trong Cài đặt.`,
    );
  }

  if (partCount > 1) {
    try {
      const mpu = await c.env.BUCKET.createMultipartUpload(key, { httpMetadata: { contentType } });
      await db.prepare('UPDATE uploads SET r2_upload_id = ? WHERE id = ?').bind(mpu.uploadId, id).run();
    } catch (err) {
      await db.prepare('DELETE FROM uploads WHERE id = ?').bind(id).run();
      throw err;
    }
  }

  const session: UploadSession = { id, name, size, partSize: pSize, partCount, uploadedParts: [] };
  return c.json(session, 201);
});

uploads.get('/:id', async (c) => {
  const me = currentUser(c);
  const up = await loadUpload(c.env.DB, me, c.req.param('id'));
  const parts = await uploadedParts(c.env.DB, up.id);
  const session: UploadSession = {
    id: up.id,
    name: up.name,
    size: up.size,
    partSize: up.part_size,
    partCount: up.part_count,
    uploadedParts: parts.map((p) => p.part_number),
  };
  return c.json(session);
});

uploads.put('/:id/parts/:n', async (c) => {
  const me = currentUser(c);
  const db = c.env.DB;
  const up = await loadUpload(db, me, c.req.param('id'));
  const n = Number(c.req.param('n'));
  if (!Number.isInteger(n) || n < 1 || n > up.part_count) throw badRequest('Số thứ tự phần không hợp lệ.');
  const expected = n < up.part_count ? up.part_size : up.size - up.part_size * (up.part_count - 1);
  // Content-Length có thể vắng (HTTP/2, HTTP/3); khi đó FixedLengthStream bên dưới vẫn bắt buộc đúng số byte.
  const declared = c.req.header('content-length');
  if (declared !== undefined && Number(declared) !== expected) {
    throw badRequest(`Phần ${n} phải có đúng ${expected} bytes.`);
  }

  const httpMetadata = { contentType: up.content_type };
  let etag: string;
  try {
    const body = c.req.raw.body;
    if (expected === 0 || !body) {
      if (expected !== 0) throw badRequest('Thiếu dữ liệu.');
      etag = (await c.env.BUCKET.put(up.r2_key, new Uint8Array(0), { httpMetadata }))!.etag;
    } else {
      // FixedLengthStream: R2 biết trước độ dài, dữ liệu chảy thẳng client -> R2, không đệm trong Worker.
      const { readable, writable } = new FixedLengthStream(expected);
      const pipe = body.pipeTo(writable);
      if (up.r2_upload_id) {
        const mpu = c.env.BUCKET.resumeMultipartUpload(up.r2_key, up.r2_upload_id);
        const [part] = await Promise.all([mpu.uploadPart(n, readable), pipe]);
        etag = part.etag;
      } else {
        const [object] = await Promise.all([c.env.BUCKET.put(up.r2_key, readable, { httpMetadata }), pipe]);
        etag = object!.etag;
      }
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('upload part failed', up.id, n, err);
    throw badRequest(`Tải phần ${n} thất bại, vui lòng thử lại.`);
  }

  await db.batch([
    db
      .prepare('INSERT OR REPLACE INTO upload_parts (upload_id, part_number, etag, size) VALUES (?, ?, ?, ?)')
      .bind(up.id, n, etag, expected),
    db.prepare('UPDATE uploads SET expires_at = ? WHERE id = ?').bind(Date.now() + UPLOAD_TTL_MS, up.id),
  ]);
  return c.json({ partNumber: n, etag });
});

uploads.post('/:id/complete', async (c) => {
  const me = currentUser(c);
  const db = c.env.DB;
  const up = await loadUpload(db, me, c.req.param('id'));
  const parts = await uploadedParts(db, up.id);
  if (parts.length !== up.part_count) {
    throw badRequest(`Còn ${up.part_count - parts.length} phần chưa tải lên.`);
  }

  let size: number;
  if (up.r2_upload_id) {
    const mpu = c.env.BUCKET.resumeMultipartUpload(up.r2_key, up.r2_upload_id);
    const object = await mpu.complete(parts.map((p) => ({ partNumber: p.part_number, etag: p.etag })));
    size = object.size;
  } else {
    const head = await c.env.BUCKET.head(up.r2_key);
    if (!head) throw badRequest('Không tìm thấy dữ liệu đã tải lên, vui lòng tải lại.');
    size = head.size;
  }
  if (size !== up.size) {
    await c.env.BUCKET.delete(up.r2_key);
    await db.prepare('DELETE FROM uploads WHERE id = ?').bind(up.id).run();
    throw badRequest('Kích thước file sau khi ghép không khớp. Vui lòng tải lại.');
  }

  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO files (id, owner_id, folder_id, r2_key, name, size, content_type, visibility, description, created_by, created_at, updated_at)
         VALUES (?1, ?2, (SELECT id FROM folders WHERE id = ?3 AND owner_id = ?2), ?4, ?5, ?6, ?7, ?8, '', ?9, ?10, ?10)`,
      )
      .bind(up.id, up.owner_id, up.folder_id, up.r2_key, up.name, size, up.content_type, up.visibility, up.created_by, now),
    db.prepare('UPDATE users SET storage_used = storage_used + ? WHERE id = ?').bind(size, up.owner_id),
    db.prepare('DELETE FROM uploads WHERE id = ?').bind(up.id),
  ]);

  const file = await db
    .prepare('SELECT f.*, u.name AS owner_name FROM files f JOIN users u ON u.id = f.owner_id WHERE f.id = ?')
    .bind(up.id)
    .first<FileRow>();
  return c.json({ file: toFile(file!) }, 201);
});

uploads.delete('/:id', async (c) => {
  const me = currentUser(c);
  const db = c.env.DB;
  const up = await loadUpload(db, me, c.req.param('id'));
  try {
    if (up.r2_upload_id) await c.env.BUCKET.resumeMultipartUpload(up.r2_key, up.r2_upload_id).abort();
    else await c.env.BUCKET.delete(up.r2_key);
  } catch (err) {
    console.warn('abort failed', up.id, err);
  }
  await db.prepare('DELETE FROM uploads WHERE id = ?').bind(up.id).run();
  return c.body(null, 204);
});

export default uploads;
