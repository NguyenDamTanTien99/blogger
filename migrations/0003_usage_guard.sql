-- Thùng rác cho file (xóa mềm) + bộ đếm mức sử dụng để không vượt hạn mức miễn phí của Cloudflare.

-- File bị xóa được giữ trong thùng rác (vẫn chiếm dung lượng) tới khi hết hạn hoặc khi cần giải phóng chỗ.
ALTER TABLE files ADD COLUMN deleted_at INTEGER;
CREATE INDEX idx_files_trash ON files(deleted_at) WHERE deleted_at IS NOT NULL;

-- period: 'YYYY-MM' (thao tác R2 tính theo tháng) hoặc 'YYYY-MM-DD' (request Worker tính theo ngày, giờ UTC).
CREATE TABLE usage_counters (
  period TEXT NOT NULL,
  metric TEXT NOT NULL,
  value  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (period, metric)
);
