import { useQuery } from '@tanstack/react-query';
import { FilePlus2, HardDrive, Newspaper, NotebookPen, Pin, Upload, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { NoteDTO, StatsDTO } from '../../shared/types';
import { FileIcon } from '../components/FilePreview';
import { useToast } from '../components/Toast';
import { Button, Card, CenterSpinner, PageHeader, ProgressBar } from '../components/ui';
import { apiGet, apiPost } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatBytes, timeAgo } from '../lib/format';

function Stat({ icon, label, value, sub, to }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; to?: string }) {
  const body = (
    <Card className="flex h-full items-start gap-4 p-5 transition hover:border-brand/40">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand/10 text-brand [&>svg]:size-5">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-500">{label}</p>
        <p className="mt-0.5 text-2xl font-bold tracking-tight">{value}</p>
        {sub && <div className="mt-2 text-xs text-zinc-500">{sub}</div>}
      </div>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export default function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, isPending } = useQuery({ queryKey: ['stats'], queryFn: () => apiGet<StatsDTO>('/stats') });

  const newNote = async () => {
    try {
      const { note } = await apiPost<{ note: NoteDTO }>('/notes', {});
      navigate(`/notes/${note.id}`);
    } catch (err) {
      toast.error(err);
    }
  };

  if (isPending || !data) return <CenterSpinner />;
  const usage = data.storageQuota ? data.storageUsed / data.storageQuota : 0;
  const admin = data.admin;
  const globalUsage = admin ? (admin.totalStorageUsed + admin.pendingUploadBytes) / admin.globalStorageLimit : 0;

  return (
    <>
      <PageHeader
        title={`Xin chào, ${user?.name ?? ''} 👋`}
        description="Tổng quan dữ liệu của bạn"
        actions={
          <>
            <Button variant="outline" icon={<Upload className="size-4" />} onClick={() => navigate('/files')}>
              Tải file lên
            </Button>
            <Button icon={<FilePlus2 className="size-4" />} onClick={newNote}>
              Ghi chú mới
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<NotebookPen />} label="Ghi chú" value={data.notes} to="/notes" />
        <Stat icon={<HardDrive />} label="Tệp tin" value={data.files} to="/files" />
        <Stat
          icon={<HardDrive />}
          label="Dung lượng của bạn"
          value={formatBytes(data.storageUsed)}
          sub={
            <>
              <ProgressBar value={usage} tone={usage > 0.9 ? 'red' : 'brand'} />
              <p className="mt-1">Hạn mức {formatBytes(data.storageQuota)}</p>
            </>
          }
        />
        {admin && (
          <Stat
            icon={<Users />}
            label="Người dùng"
            value={admin.users}
            sub={`${admin.activeUsers} đang hoạt động`}
            to="/users"
          />
        )}
      </div>

      {admin && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Kho lưu trữ toàn hệ thống (R2)</h2>
              <span className="text-sm text-zinc-500">{admin.totalFiles} file</span>
            </div>
            <p className="mt-3 text-2xl font-bold">
              {formatBytes(admin.totalStorageUsed)}{' '}
              <span className="text-base font-normal text-zinc-500">/ {formatBytes(admin.globalStorageLimit)}</span>
            </p>
            <ProgressBar className="mt-3" value={globalUsage} tone={globalUsage > 0.9 ? 'red' : globalUsage > 0.75 ? 'amber' : 'brand'} />
            <p className="mt-2 text-xs text-zinc-500">
              Gói miễn phí Cloudflare R2: 10 GB. Giới hạn hệ thống chỉnh trong Cài đặt blog → Lưu trữ.
              {admin.pendingUploadBytes > 0 && ` Đang giữ chỗ cho upload dở: ${formatBytes(admin.pendingUploadBytes)}.`}
            </p>
          </Card>
          <Stat
            icon={<Newspaper />}
            label="Bài viết"
            value={admin.postsPublished}
            sub={`${admin.postsDraft} bản nháp`}
            to="/posts"
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <h2 className="font-semibold">Ghi chú gần đây</h2>
            <Link to="/notes" className="text-sm text-brand">
              Xem tất cả
            </Link>
          </div>
          {data.recentNotes.length ? (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.recentNotes.map((n) => (
                <li key={n.id}>
                  <Link to={`/notes/${n.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                    {n.pinned && <Pin className="size-3.5 shrink-0 text-amber-500" />}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{n.title || 'Ghi chú không tiêu đề'}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{timeAgo(n.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-zinc-500">Chưa có ghi chú nào.</p>
          )}
        </Card>
        <Card>
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <h2 className="font-semibold">Tệp tải lên gần đây</h2>
            <Link to="/files" className="text-sm text-brand">
              Xem tất cả
            </Link>
          </div>
          {data.recentFiles.length ? (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.recentFiles.map((f) => (
                <li key={f.id}>
                  <Link
                    to={f.folderId ? `/files?folder=${f.folderId}` : '/files'}
                    className="flex items-center gap-3 px-5 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <FileIcon name={f.name} contentType={f.contentType} />
                    <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{formatBytes(f.size)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-8 text-center text-sm text-zinc-500">Chưa có tệp nào.</p>
          )}
        </Card>
      </div>
      {!isAdmin && (
        <p className="mt-6 text-center text-xs text-zinc-500">Cần thêm dung lượng? Hãy liên hệ admin để được nâng hạn mức.</p>
      )}
    </>
  );
}
