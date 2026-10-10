import type { Role } from './constants';

export type UserStatus = 'active' | 'disabled';
export type Visibility = 'private' | 'public';
export type PostType = 'post' | 'page';
export type PostStatus = 'draft' | 'published';

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: UserStatus;
  storageQuota: number;
  storageUsed: number;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface AdminUserDTO extends UserDTO {
  notes: number;
  files: number;
}

export interface OwnerRef {
  id: string;
  name: string;
  email: string;
}

export interface NoteSummary {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  snippet: string;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NoteDTO extends Omit<NoteSummary, 'snippet'> {
  content: string;
  updatedBy: string | null;
  updatedByName: string | null;
}

export interface FolderDTO {
  id: string;
  ownerId: string;
  parentId: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface FileDTO {
  id: string;
  ownerId: string;
  ownerName: string;
  folderId: string | null;
  name: string;
  size: number;
  contentType: string;
  visibility: Visibility;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface DriveListing {
  owner: OwnerRef;
  folder: FolderDTO | null;
  breadcrumb: { id: string; name: string }[];
  folders: FolderDTO[];
  files: FileDTO[];
}

export interface UploadSession {
  id: string;
  name: string;
  size: number;
  partSize: number;
  partCount: number;
  uploadedParts: number[];
}

export interface PostSummary {
  id: string;
  type: PostType;
  slug: string;
  title: string;
  /** Tóm tắt do admin nhập (có thể trống). */
  excerpt: string;
  /** Tóm tắt hiển thị: excerpt hoặc tự sinh từ nội dung. */
  summary: string;
  coverUrl: string;
  tags: string[];
  status: PostStatus;
  publishedAt: number | null;
  readingMinutes: number;
  authorName: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface PostDTO extends PostSummary {
  contentMd: string;
  contentHtml: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StatsDTO {
  notes: number;
  files: number;
  storageUsed: number;
  storageQuota: number;
  recentNotes: NoteSummary[];
  recentFiles: FileDTO[];
  admin?: {
    users: number;
    activeUsers: number;
    postsPublished: number;
    postsDraft: number;
    totalFiles: number;
    totalStorageUsed: number;
    pendingUploadBytes: number;
    globalStorageLimit: number;
  };
}

export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: number;
  expiresAt: number;
  current: boolean;
}

export interface AuditEntry {
  id: number;
  actorEmail: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
