-- WebBlogger schema v1 (Cloudflare D1 / SQLite). Thời gian lưu dạng unix milliseconds, dung lượng dạng bytes.
-- D1 bật ràng buộc khóa ngoại mặc định nên ON DELETE CASCADE có hiệu lực.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  password_hash TEXT NOT NULL,
  storage_quota INTEGER NOT NULL,
  storage_used  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

-- id = SHA-256(token cookie): lộ DB cũng không chiếm được phiên đăng nhập.
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT,
  ip         TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  ip         TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts_email ON login_attempts(email, created_at);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip, created_at);

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  tags       TEXT NOT NULL DEFAULT '',          -- dạng ",tag1,tag2," để lọc bằng LIKE
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);
CREATE INDEX idx_notes_owner ON notes(owner_id, pinned DESC, updated_at DESC);
CREATE INDEX idx_notes_updated ON notes(pinned DESC, updated_at DESC);

CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_folders_unique ON folders(owner_id, COALESCE(parent_id, ''), name COLLATE NOCASE);
CREATE INDEX idx_folders_parent ON folders(parent_id);

-- Object trên R2 dùng key "u/<owner>/<file id>" nên đổi tên/di chuyển file không cần copy dữ liệu.
CREATE TABLE files (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id    TEXT REFERENCES folders(id) ON DELETE SET NULL,
  r2_key       TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  visibility   TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  description  TEXT NOT NULL DEFAULT '',
  created_by   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_files_owner_folder ON files(owner_id, folder_id, created_at DESC);
CREATE INDEX idx_files_created ON files(created_at DESC);

-- Upload đang diễn ra. Tổng `size` ở đây được tính vào quota (giữ chỗ) cho tới khi hoàn tất/hủy.
CREATE TABLE uploads (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by   TEXT NOT NULL,
  folder_id    TEXT,
  r2_key       TEXT NOT NULL UNIQUE,
  r2_upload_id TEXT,                              -- NULL khi file đủ nhỏ để upload 1 lần
  name         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  visibility   TEXT NOT NULL DEFAULT 'private',
  part_size    INTEGER NOT NULL,
  part_count   INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL
);
CREATE INDEX idx_uploads_owner ON uploads(owner_id);
CREATE INDEX idx_uploads_expires ON uploads(expires_at);

CREATE TABLE upload_parts (
  upload_id   TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  etag        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  PRIMARY KEY (upload_id, part_number)
);

-- Nội dung bài viết lưu cả markdown (để sửa) và HTML đã render sẵn (để trang công khai trả về ngay, 0 CPU).
CREATE TABLE posts (
  id              TEXT PRIMARY KEY,
  author_id       TEXT REFERENCES users(id) ON DELETE SET NULL,
  type            TEXT NOT NULL DEFAULT 'post' CHECK (type IN ('post', 'page')),
  slug            TEXT NOT NULL UNIQUE,
  title           TEXT NOT NULL,
  excerpt         TEXT NOT NULL DEFAULT '',             -- tóm tắt admin tự viết (có thể trống)
  summary         TEXT NOT NULL DEFAULT '',             -- tóm tắt hiển thị = excerpt hoặc tự sinh từ nội dung
  content_md      TEXT NOT NULL DEFAULT '',
  content_html    TEXT NOT NULL DEFAULT '',
  cover_url       TEXT NOT NULL DEFAULT '',
  tags            TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at    INTEGER,
  reading_minutes INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_posts_public ON posts(type, status, published_at DESC);

CREATE TABLE settings (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    TEXT,
  actor_email TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT,
  ip          TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC);
