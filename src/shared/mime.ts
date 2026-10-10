const BY_EXT: Record<string, string> = {
  // Văn phòng
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  pdf: 'application/pdf',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  // Ảnh
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  // Âm thanh / video
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  // Nén
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  iso: 'application/x-iso9660-image',
};

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

const VALID_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

/** Ưu tiên MIME theo đuôi file (đáng tin hơn giá trị trình duyệt gửi lên với docx/xlsx trên Windows). */
export function guessContentType(name: string, declared?: string | null): string {
  const byExt = BY_EXT[extensionOf(name)];
  if (byExt) return byExt;
  if (declared && VALID_TYPE.test(declared) && declared.length <= 120) return declared.toLowerCase();
  return 'application/octet-stream';
}

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'word' | 'excel' | 'text' | 'archive' | 'other';

export function fileKind(name: string, contentType: string): FileKind {
  const ext = extensionOf(name);
  if (contentType === 'image/svg+xml') return 'image';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType === 'application/pdf') return 'pdf';
  if (ext === 'docx' || ext === 'doc' || ext === 'odt') return 'word';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'ods' || ext === 'csv') return 'excel';
  if (['zip', 'rar', '7z', 'gz', 'tar', 'iso'].includes(ext)) return 'archive';
  if (contentType.startsWith('text/') || ['json', 'xml', 'md', 'log', 'yml', 'yaml', 'ts', 'js', 'sql'].includes(ext))
    return 'text';
  return 'other';
}
