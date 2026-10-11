import { tagsFromDb } from '../../shared/text';
import type { FileDTO, FolderDTO, NoteDTO, NoteSummary, PostDTO, PostSummary, UserDTO } from '../../shared/types';
import type { FileRow } from './files';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  storage_quota: number;
  storage_used: number;
  created_at: number;
  last_login_at: number | null;
}

export const USER_COLUMNS =
  'id, email, name, role, status, storage_quota, storage_used, created_at, last_login_at';

export function toUser(r: UserRow): UserDTO {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    storageQuota: r.storage_quota,
    storageUsed: r.storage_used,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  };
}

export interface NoteRow {
  id: string;
  owner_id: string;
  owner_name: string | null;
  title: string;
  content?: string;
  snippet?: string;
  tags: string;
  pinned: number;
  created_at: number;
  updated_at: number;
  updated_by?: string | null;
  updated_by_name?: string | null;
}

export function toNoteSummary(r: NoteRow): NoteSummary {
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerName: r.owner_name ?? '',
    title: r.title,
    snippet: r.snippet ?? '',
    tags: tagsFromDb(r.tags),
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toNote(r: NoteRow): NoteDTO {
  const { snippet: _snippet, ...summary } = toNoteSummary(r);
  return {
    ...summary,
    content: r.content ?? '',
    updatedBy: r.updated_by ?? null,
    updatedByName: r.updated_by_name ?? null,
  };
}

export interface FolderRow {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  created_at: number;
  updated_at: number;
}

export function toFolder(r: FolderRow): FolderDTO {
  return {
    id: r.id,
    ownerId: r.owner_id,
    parentId: r.parent_id,
    name: r.name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toFile(r: FileRow): FileDTO {
  return {
    id: r.id,
    ownerId: r.owner_id,
    ownerName: r.owner_name ?? '',
    folderId: r.folder_id,
    name: r.name,
    size: r.size,
    contentType: r.content_type,
    visibility: r.visibility,
    description: r.description,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    deletedAt: r.deleted_at ?? null,
  };
}

export interface PostRow {
  id: string;
  type: 'post' | 'page';
  slug: string;
  title: string;
  excerpt: string;
  summary: string;
  cover_url: string;
  tags: string;
  status: 'draft' | 'published';
  published_at: number | null;
  reading_minutes: number;
  author_name: string | null;
  created_at: number;
  updated_at: number;
  content_md?: string;
  content_html?: string;
}

export const POST_SUMMARY_COLUMNS =
  'p.id, p.type, p.slug, p.title, p.excerpt, p.summary, p.cover_url, p.tags, p.status, p.published_at, p.reading_minutes, p.created_at, p.updated_at, u.name AS author_name';

export function toPostSummary(r: PostRow): PostSummary {
  return {
    id: r.id,
    type: r.type,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    summary: r.summary,
    coverUrl: r.cover_url,
    tags: tagsFromDb(r.tags),
    status: r.status,
    publishedAt: r.published_at,
    readingMinutes: r.reading_minutes,
    authorName: r.author_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toPost(r: PostRow): PostDTO {
  return { ...toPostSummary(r), contentMd: r.content_md ?? '', contentHtml: r.content_html ?? '' };
}
