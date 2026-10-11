import { useSyncExternalStore } from 'react';
import type { FileDTO, UploadSession, Visibility } from '../../shared/types';
import { ApiError, apiDelete, apiGet, apiPost, errorMessage } from './api';
import { getLang, t } from './i18n';

export interface UploadTarget {
  folderId: string | null;
  ownerId?: string;
  visibility?: Visibility;
}

const RESUME_KEY = 'wb-uploads';

function readResume(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(RESUME_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function writeResume(update: (map: Record<string, string>) => void) {
  try {
    const map = readResume();
    update(map);
    localStorage.setItem(RESUME_KEY, JSON.stringify(map));
  } catch {
    /* localStorage bị chặn: chỉ mất khả năng tải tiếp sau khi tải lại trang */
  }
}

/** Cùng file + cùng nơi lưu => dùng lại phiên upload cũ (tải tiếp phần còn thiếu). */
function fingerprint(file: File, target: UploadTarget): string {
  return [file.name, file.size, file.lastModified, target.folderId ?? '', target.ownerId ?? ''].join('|');
}

function partLength(s: UploadSession, n: number): number {
  return n < s.partCount ? s.partSize : s.size - s.partSize * (s.partCount - 1);
}

const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Gửi 1 phần bằng XHR (fetch chưa báo được tiến trình upload). Blob.slice không đọc file vào RAM. */
function putPart(url: string, blob: Blob, signal: AbortSignal, onProgress: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Lang', getLang());
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let message = t('Lỗi máy chủ ({status}).', { status: xhr.status });
      try {
        message = (JSON.parse(xhr.responseText) as { error: { message: string } }).error.message;
      } catch {
        /* không phải JSON */
      }
      reject(new ApiError(xhr.status, 'upload_failed', message));
    };
    xhr.onerror = () => reject(new Error(t('Mất kết nối mạng.')));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/** Tải các phần còn thiếu: chạy song song, tự thử lại (backoff) khi lỗi mạng/5xx. */
async function sendParts(
  file: File,
  session: UploadSession,
  opts: { signal: AbortSignal; concurrency?: number; onProgress: (bytes: number) => void },
): Promise<void> {
  const done = new Set(session.uploadedParts);
  const queue: number[] = [];
  for (let n = 1; n <= session.partCount; n++) if (!done.has(n)) queue.push(n);
  let completed = [...done].reduce((sum, n) => sum + partLength(session, n), 0);
  const inflight = new Map<number, number>();
  const report = () => opts.onProgress(completed + [...inflight.values()].reduce((a, b) => a + b, 0));
  report();

  // Một phần lỗi hẳn => hủy luôn các phần đang chạy song song.
  const local = new AbortController();
  const stop = () => local.abort();
  opts.signal.addEventListener('abort', stop, { once: true });

  const worker = async () => {
    while (queue.length) {
      const n = queue.shift()!;
      const start = (n - 1) * session.partSize;
      const blob = file.slice(start, start + partLength(session, n));
      for (let attempt = 0; ; attempt++) {
        if (local.signal.aborted) throw new DOMException('Aborted', 'AbortError');
        try {
          inflight.set(n, 0);
          await putPart(`/api/uploads/${session.id}/parts/${n}`, blob, local.signal, (loaded) => {
            inflight.set(n, loaded);
            report();
          });
          inflight.delete(n);
          completed += blob.size;
          report();
          break;
        } catch (err) {
          inflight.delete(n);
          report();
          const clientError = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;
          if (isAbort(err) || clientError || attempt >= 5) throw err;
          await sleep(Math.min(30_000, 1000 * 2 ** attempt));
        }
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 3, queue.length)) }, () => worker().catch((err) => {
      local.abort();
      throw err;
    })));
  } finally {
    opts.signal.removeEventListener('abort', stop);
  }
}

function createSession(file: File, target: UploadTarget): Promise<UploadSession> {
  return apiPost<UploadSession>('/uploads', {
    name: file.name,
    size: file.size,
    type: file.type || undefined,
    folderId: target.folderId,
    ownerId: target.ownerId,
    visibility: target.visibility,
  });
}

/** Hoàn tất; nếu lần gọi trước đã thành công nhưng mất phản hồi thì lấy lại file theo ID. */
async function completeSession(id: string): Promise<FileDTO> {
  try {
    return (await apiPost<{ file: FileDTO }>(`/uploads/${id}/complete`)).file;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return (await apiGet<{ file: FileDTO }>(`/files/${id}`)).file;
    throw err;
  }
}

/** Upload một lần, không hiện trong hàng đợi (dùng cho ảnh trong trình soạn thảo, ảnh đại diện...). */
export async function uploadFile(file: File, target: UploadTarget, onProgress?: (fraction: number) => void): Promise<FileDTO> {
  const session = await createSession(file, target);
  try {
    await sendParts(file, session, {
      signal: new AbortController().signal,
      onProgress: (bytes) => onProgress?.(file.size ? bytes / file.size : 1),
    });
  } catch (err) {
    void apiDelete(`/uploads/${session.id}`).catch(() => undefined);
    throw err;
  }
  return completeSession(session.id);
}

export function publicFileUrl(file: Pick<FileDTO, 'id' | 'name'>): string {
  return `/f/${file.id}/${encodeURIComponent(file.name)}`;
}

// ---------- Hàng đợi upload (giữ tiến trình khi chuyển trang trong dashboard) ----------

export type UploadStatus = 'queued' | 'uploading' | 'paused' | 'completing' | 'done' | 'error' | 'canceled';

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  status: UploadStatus;
  loaded: number;
  speed: number;
  error?: string;
}

interface Entry {
  item: UploadItem;
  file: File;
  target: UploadTarget;
  run: number;
  controller?: AbortController;
  sessionId?: string;
  samples: { t: number; b: number }[];
}

const statusOf = (e: Entry): UploadStatus => e.item.status;

class UploadManager {
  private entries: Entry[] = [];
  private snapshot: UploadItem[] = [];
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  maxParallelFiles = 2;
  onFileUploaded: ((file: FileDTO) => void) | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private emit(now = false) {
    const flush = () => {
      this.timer = null;
      this.snapshot = this.entries.map((e) => ({ ...e.item }));
      for (const l of this.listeners) l();
    };
    if (now) {
      if (this.timer) clearTimeout(this.timer);
      flush();
    } else if (!this.timer) {
      this.timer = setTimeout(flush, 150);
    }
  }

  private find(key: string) {
    return this.entries.find((e) => e.item.key === key);
  }

  add(files: File[], target: UploadTarget) {
    for (const file of files) {
      this.entries.push({
        item: { key: crypto.randomUUID(), name: file.name, size: file.size, status: 'queued', loaded: 0, speed: 0 },
        file,
        target,
        run: 0,
        samples: [],
      });
    }
    this.emit(true);
    this.pump();
  }

  pause(key: string) {
    const e = this.find(key);
    if (!e || !['queued', 'uploading'].includes(e.item.status)) return;
    e.item.status = 'paused';
    e.item.speed = 0;
    e.controller?.abort();
    this.emit(true);
    this.pump();
  }

  resume(key: string) {
    const e = this.find(key);
    if (!e || !['paused', 'error'].includes(e.item.status)) return;
    e.item.status = 'queued';
    e.item.error = undefined;
    this.emit(true);
    this.pump();
  }

  cancel(key: string) {
    const e = this.find(key);
    if (!e || ['done', 'canceled'].includes(e.item.status)) return;
    e.item.status = 'canceled';
    e.controller?.abort();
    if (e.sessionId) void apiDelete(`/uploads/${e.sessionId}`).catch(() => undefined);
    writeResume((map) => {
      delete map[fingerprint(e.file, e.target)];
    });
    this.emit(true);
    this.pump();
  }

  clearFinished() {
    this.entries = this.entries.filter((e) => !['done', 'canceled'].includes(e.item.status));
    this.emit(true);
  }

  hasActive(): boolean {
    return this.entries.some((e) => ['queued', 'uploading', 'completing'].includes(e.item.status));
  }

  private pump() {
    let slots = this.maxParallelFiles - this.entries.filter((e) => ['uploading', 'completing'].includes(e.item.status)).length;
    for (const e of this.entries) {
      if (slots <= 0) break;
      if (e.item.status === 'queued') {
        slots--;
        void this.start(e);
      }
    }
  }

  private sample(e: Entry) {
    const now = performance.now();
    e.samples.push({ t: now, b: e.item.loaded });
    while (e.samples.length > 2 && now - e.samples[0]!.t > 5000) e.samples.shift();
    const first = e.samples[0]!;
    e.item.speed = now - first.t > 500 ? ((e.item.loaded - first.b) * 1000) / (now - first.t) : e.item.speed;
  }

  private async start(e: Entry) {
    const run = ++e.run;
    const controller = new AbortController();
    e.controller = controller;
    e.item.status = 'uploading';
    e.samples = [];
    this.emit(true);
    const fp = fingerprint(e.file, e.target);
    try {
      let resumed: UploadSession | null = null;
      const previous = e.sessionId ?? readResume()[fp];
      if (previous) {
        resumed = await apiGet<UploadSession>(`/uploads/${previous}`).catch(() => null);
        if (resumed && resumed.size !== e.file.size) resumed = null;
      }
      const session = resumed ?? (await createSession(e.file, e.target));
      e.sessionId = session.id;
      writeResume((map) => {
        map[fp] = session.id;
      });

      await sendParts(e.file, session, {
        signal: controller.signal,
        onProgress: (bytes) => {
          if (e.run !== run) return;
          e.item.loaded = bytes;
          this.sample(e);
          this.emit();
        },
      });
      if (e.run !== run) return;
      e.item.status = 'completing';
      this.emit(true);
      const file = await completeSession(session.id);
      e.item.status = 'done';
      e.item.loaded = e.item.size;
      e.item.speed = 0;
      writeResume((map) => {
        delete map[fp];
      });
      this.onFileUploaded?.(file);
    } catch (err) {
      // pause()/cancel() có thể đổi trạng thái trong lúc đang chờ => đọc lại, đừng tin narrowing của TS.
      const status = statusOf(e);
      if (e.run === run && status !== 'paused' && status !== 'canceled') {
        e.item.status = 'error';
        e.item.error = errorMessage(err);
        e.item.speed = 0;
      }
    } finally {
      if (e.controller === controller) e.controller = undefined;
      this.emit(true);
      this.pump();
    }
  }
}

export const uploads = new UploadManager();

export function useUploads(): UploadItem[] {
  return useSyncExternalStore(uploads.subscribe, uploads.getSnapshot);
}
