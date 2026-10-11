export interface LinkItem {
  label: string;
  url: string;
}

/** Toàn bộ phần "tùy biến" của blog — admin chỉnh trong /app/settings. */
export interface SiteSettings {
  siteTitle: string;
  tagline: string;
  description: string;
  authorName: string;
  authorBio: string;
  avatarUrl: string;
  language: string;
  timezone: string;
  accentColor: string;
  theme: 'auto' | 'light' | 'dark';
  font: 'sans' | 'serif' | 'mono';
  layout: 'list' | 'cards';
  postsPerPage: number;
  navLinks: LinkItem[];
  socialLinks: LinkItem[];
  footerText: string;
  showLoginLink: boolean;
  customCss: string;
  customHeadHtml: string;
  /** File xác minh tên miền phục vụ ở gốc site (TikTok, Zalo, Google...), vd: zalo_verifierABC.html */
  verificationFiles: { name: string; content: string }[];
  /** Quota mặc định khi tạo user mới. */
  defaultQuotaMB: number;
  /** Tổng dung lượng toàn hệ thống — mặc định 9.5GB để luôn nằm trong 10GB miễn phí của R2. */
  globalStorageLimitMB: number;
  maxFileSizeMB: number;
  /** Chặn mọi thao tác có thể phát sinh phí (giới hạn theo gói miễn phí). Tắt khi đã chấp nhận trả phí. */
  strictFreeTier: boolean;
  /** Ngưỡng % so với hạn mức miễn phí: cảnh báo / tự dọn dẹp / tạm dừng thao tác tốn phí. */
  usageWarnPercent: number;
  usageCleanPercent: number;
  usageStopPercent: number;
  /** Số ngày giữ file trong thùng rác trước khi xóa hẳn. */
  trashRetentionDays: number;
  /** > 0: khi vượt ngưỡng dọn dẹp, tự xóa file riêng tư cũ hơn N ngày (cũ nhất trước). 0 = tắt. */
  autoDeleteOldFilesDays: number;
}

export const DEFAULT_SETTINGS: SiteSettings = {
  siteTitle: 'Blog của tôi',
  tagline: 'Ghi chép · Chia sẻ · Lưu trữ',
  description: 'Blog cá nhân — nơi ghi lại những điều thú vị.',
  authorName: 'Tác giả',
  authorBio: 'Xin chào! Đây là nơi mình viết về công việc, học tập và những điều thú vị.',
  avatarUrl: '',
  language: 'vi',
  timezone: 'Asia/Ho_Chi_Minh',
  accentColor: '#2563eb',
  theme: 'auto',
  font: 'sans',
  layout: 'list',
  postsPerPage: 10,
  navLinks: [{ label: 'Trang chủ', url: '/' }],
  socialLinks: [],
  footerText: '',
  showLoginLink: true,
  customCss: '',
  customHeadHtml: '',
  verificationFiles: [],
  defaultQuotaMB: 1024,
  globalStorageLimitMB: 9728,
  maxFileSizeMB: 10240,
  strictFreeTier: true,
  usageWarnPercent: 80,
  usageCleanPercent: 90,
  usageStopPercent: 98,
  trashRetentionDays: 30,
  autoDeleteOldFilesDays: 0,
};

export interface PublicSiteInfo {
  siteTitle: string;
  accentColor: string;
}
