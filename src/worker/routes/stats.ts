import { Hono } from 'hono';
import { MB } from '../../shared/constants';
import type { StatsDTO } from '../../shared/types';
import type { AppEnv } from '../env';
import { currentUser, isAdmin } from '../middleware';
import type { FileRow } from '../lib/files';
import { toFile, toNoteSummary, type NoteRow } from '../lib/mappers';
import { getSettings } from '../lib/settings';

const stats = new Hono<AppEnv>();

type Row = Record<string, number | null>;

stats.get('/', async (c) => {
  const me = currentUser(c);
  const db = c.env.DB;
  const statements = [
    db.prepare('SELECT COUNT(*) AS n FROM notes WHERE owner_id = ?').bind(me.id),
    db.prepare('SELECT COUNT(*) AS n FROM files WHERE owner_id = ?').bind(me.id),
    db.prepare('SELECT storage_used, storage_quota FROM users WHERE id = ?').bind(me.id),
    db
      .prepare(
        `SELECT n.id, n.owner_id, u.name AS owner_name, n.title, substr(n.content, 1, 160) AS snippet, n.tags, n.pinned,
                n.created_at, n.updated_at
         FROM notes n JOIN users u ON u.id = n.owner_id WHERE n.owner_id = ? ORDER BY n.updated_at DESC LIMIT 5`,
      )
      .bind(me.id),
    db
      .prepare(
        'SELECT f.*, u.name AS owner_name FROM files f JOIN users u ON u.id = f.owner_id WHERE f.owner_id = ? ORDER BY f.created_at DESC LIMIT 6',
      )
      .bind(me.id),
  ];
  if (isAdmin(me)) {
    statements.push(
      db.prepare("SELECT COUNT(*) AS users, SUM(status = 'active') AS active, COALESCE(SUM(storage_used), 0) AS used FROM users"),
      db.prepare("SELECT SUM(status = 'published') AS published, SUM(status = 'draft') AS draft FROM posts"),
      db.prepare('SELECT COUNT(*) AS n FROM files'),
      db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM uploads'),
    );
  }
  const r = await db.batch(statements);
  const first = (i: number) => (r[i]!.results[0] ?? {}) as Row;

  const result: StatsDTO = {
    notes: first(0).n ?? 0,
    files: first(1).n ?? 0,
    storageUsed: first(2).storage_used ?? 0,
    storageQuota: first(2).storage_quota ?? 0,
    recentNotes: (r[3]!.results as NoteRow[]).map(toNoteSummary),
    recentFiles: (r[4]!.results as FileRow[]).map(toFile),
  };
  if (isAdmin(me)) {
    const settings = await getSettings(c.env);
    result.admin = {
      users: first(5).users ?? 0,
      activeUsers: first(5).active ?? 0,
      totalStorageUsed: first(5).used ?? 0,
      postsPublished: first(6).published ?? 0,
      postsDraft: first(6).draft ?? 0,
      totalFiles: first(7).n ?? 0,
      pendingUploadBytes: first(8).n ?? 0,
      globalStorageLimit: settings.globalStorageLimitMB * MB,
    };
  }
  return c.json(result);
});

export default stats;
