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
  /** Có giá trị khi file nằm trong thùng rác. */
  deletedAt: number | null;
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

export const SOCIAL_PROVIDERS = ['facebook', 'zalo', 'tiktok'] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export interface SocialAccountDTO {
  provider: SocialProvider;
  /** App ID (Facebook, Zalo) hoặc Client key (TikTok) — không phải bí mật. */
  appId: string;
  /** Facebook Login for Business: Configuration ID (để trống nếu dùng Facebook Login thường). */
  configId: string;
  hasSecret: boolean;
  connected: boolean;
  accountName: string | null;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
  /** Facebook: các Fanpage tài khoản quản lý và trang đang chọn để đăng. */
  pages: { id: string; name: string }[];
  pageId: string | null;
  redirectUri: string;
}

export interface SocialStatusDTO {
  accounts: SocialAccountDTO[];
  /** Đã đặt secret TOKEN_SECRET => token được mã hóa AES-GCM trong D1. */
  encrypted: boolean;
}

export type ShareStatus = 'success' | 'processing' | 'failed';

export interface SocialShareDTO {
  id: string;
  postId: string;
  provider: SocialProvider;
  status: ShareStatus;
  externalId: string | null;
  url: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export type UsageKey = 'r2Storage' | 'r2ClassA' | 'r2ClassB' | 'd1Size' | 'workerRequests';

export interface UsageMetric {
  key: UsageKey;
  used: number;
  limit: number;
  percent: number;
  /** month: cộng dồn theo tháng; day: theo ngày (UTC); now: tại thời điểm hiện tại. */
  period: 'month' | 'day' | 'now';
  /** true: vượt hạn mức sẽ bị tính tiền (R2). false: chỉ bị chặn/báo lỗi (Workers, D1 gói Free). */
  billable: boolean;
}

export interface UsageDTO {
  metrics: UsageMetric[];
  trash: { files: number; bytes: number };
  thresholds: { warn: number; clean: number; stop: number };
  strict: boolean;
  lastMaintenance: MaintenanceReport | null;
}

export interface MaintenanceReport {
  ranAt: number;
  staleUploads: number;
  expiredTrash: number;
  purgedForSpace: number;
  deletedOldFiles: number;
  orphans: number;
  prunedRows: number;
  freedBytes: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
