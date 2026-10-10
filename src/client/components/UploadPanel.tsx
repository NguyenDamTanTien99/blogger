import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, Pause, Play, RotateCw, X } from 'lucide-react';
import { useState } from 'react';
import { cn, formatBytes, formatSpeed } from '../lib/format';
import { uploads, useUploads, type UploadItem } from '../lib/upload';
import { ProgressBar } from './ui';

const STATUS: Record<UploadItem['status'], string> = {
  queued: 'Đang chờ',
  uploading: 'Đang tải lên',
  paused: 'Tạm dừng',
  completing: 'Đang hoàn tất',
  done: 'Hoàn tất',
  error: 'Lỗi',
  canceled: 'Đã hủy',
};

/** Bảng nổi góc dưới: theo dõi tất cả upload, vẫn chạy khi chuyển trang trong dashboard. */
export function UploadPanel() {
  const items = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  if (!items.length) return null;
  const count = (...statuses: UploadItem['status'][]) => items.filter((i) => statuses.includes(i.status)).length;
  const active = count('queued', 'uploading', 'completing');
  const paused = count('paused');
  const failed = count('error');
  const title = active
    ? `Đang tải lên ${active} file`
    : failed
      ? `${failed} file tải lên lỗi`
      : paused
        ? `Đã tạm dừng ${paused} file`
        : 'Tải lên hoàn tất';
  const finished = items.some((i) => i.status === 'done' || i.status === 'canceled');

  return (
    <div className="fixed right-3 bottom-3 z-40 w-[min(420px,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <p className="flex-1 text-sm font-semibold">{title}</p>
        {finished && (
          <button type="button" onClick={() => uploads.clearFinished()} className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Dọn danh sách
          </button>
        )}
        <button type="button" aria-label={collapsed ? 'Mở rộng' : 'Thu gọn'} onClick={() => setCollapsed((v) => !v)} className="text-zinc-500">
          {collapsed ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </button>
      </div>
      {!collapsed && (
        <ul className="max-h-80 divide-y divide-zinc-100 overflow-auto dark:divide-zinc-800">
          {items.map((item) => (
            <UploadRow key={item.key} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const fraction = item.size ? item.loaded / item.size : item.status === 'done' ? 1 : 0;
  const running = item.status === 'uploading' || item.status === 'queued';
  return (
    <li className="space-y-1.5 px-4 py-3">
      <div className="flex items-center gap-2">
        {item.status === 'done' ? (
          <CircleCheck className="size-4 shrink-0 text-emerald-500" />
        ) : item.status === 'error' ? (
          <CircleAlert className="size-4 shrink-0 text-red-500" />
        ) : null}
        <p className="min-w-0 flex-1 truncate text-sm" title={item.name}>
          {item.name}
        </p>
        {running && (
          <button type="button" title="Tạm dừng" onClick={() => uploads.pause(item.key)} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            <Pause className="size-4" />
          </button>
        )}
        {(item.status === 'paused' || item.status === 'error') && (
          <button type="button" title={item.status === 'error' ? 'Thử lại' : 'Tiếp tục'} onClick={() => uploads.resume(item.key)} className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            {item.status === 'error' ? <RotateCw className="size-4" /> : <Play className="size-4" />}
          </button>
        )}
        {!['done', 'canceled', 'completing'].includes(item.status) && (
          <button type="button" title="Hủy" onClick={() => uploads.cancel(item.key)} className="text-zinc-500 hover:text-red-600">
            <X className="size-4" />
          </button>
        )}
      </div>
      {item.status !== 'done' && item.status !== 'canceled' && (
        <ProgressBar value={fraction} tone={item.status === 'error' ? 'red' : item.status === 'paused' ? 'amber' : 'brand'} />
      )}
      <p className={cn('text-xs', item.status === 'error' ? 'text-red-600' : 'text-zinc-500')}>
        {item.status === 'error'
          ? item.error
          : `${STATUS[item.status]} · ${formatBytes(item.loaded)} / ${formatBytes(item.size)}${
              item.status === 'uploading' && item.speed ? ` · ${formatSpeed(item.speed)}` : ''
            }`}
      </p>
    </li>
  );
}
