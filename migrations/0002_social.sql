-- Kết nối mạng xã hội (Facebook Page, Zalo OA, TikTok) và lịch sử đăng bài.

-- config: thông tin app (app id/secret); tokens: access/refresh token. Cả hai được mã hóa AES-GCM nếu có secret TOKEN_SECRET.
CREATE TABLE social_accounts (
  provider   TEXT PRIMARY KEY CHECK (provider IN ('facebook', 'zalo', 'tiktok')),
  config     TEXT NOT NULL DEFAULT '',
  tokens     TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE social_shares (
  id          TEXT PRIMARY KEY,
  post_id     TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('success', 'processing', 'failed')),
  external_id TEXT,              -- id bài trên nền tảng, hoặc mã theo dõi khi đang xử lý
  url         TEXT,
  error       TEXT,
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_social_shares_post ON social_shares(post_id, created_at DESC);
