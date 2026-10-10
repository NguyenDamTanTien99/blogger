/** "Xin chào Đà Nẵng!" -> "xin-chao-da-nang" */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** Chuẩn hóa danh sách thẻ: cắt khoảng trắng, chữ thường, bỏ trùng, tối đa 20 thẻ. */
export function normalizeTags(input: string[] | string): string[] {
  const list = Array.isArray(input) ? input : input.split(',');
  const seen = new Set<string>();
  for (const raw of list) {
    const tag = raw.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 40);
    if (tag) seen.add(tag);
    if (seen.size >= 20) break;
  }
  return [...seen];
}

/** Lưu dạng ",a,b," để truy vấn `LIKE '%,a,%'` chính xác từng thẻ. */
export function tagsToDb(tags: string[]): string {
  return tags.length ? `,${tags.join(',')},` : '';
}

export function tagsFromDb(value: string | null | undefined): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : value >= 100 ? 0 : digits)} ${units[i]}`;
}

/** Ước lượng phút đọc (~200 từ/phút). */
export function readingMinutes(markdown: string): number {
  const words = markdown.replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
