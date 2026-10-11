import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AuditEntry, Paginated } from '../../shared/types';
import { Card, CenterSpinner, EmptyState, PageHeader, Pagination, Select } from '../components/ui';
import { apiGet } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { t } from '../lib/i18n';

const ACTIONS: Record<string, string> = {
  'auth.login': 'Đăng nhập',
  'auth.password_changed': 'Đổi mật khẩu',
  'auth.logout_others': 'Đăng xuất thiết bị khác',
  'user.create': 'Tạo người dùng',
  'user.update': 'Sửa người dùng',
  'user.delete': 'Xóa người dùng',
  'settings.update': 'Sửa cài đặt blog',
  'post.create': 'Tạo bài viết',
  'post.publish': 'Xuất bản bài viết',
  'post.unpublish': 'Gỡ xuất bản',
  'post.delete': 'Xóa bài viết',
  'post.share': 'Đăng lên mạng xã hội',
  'social.configure': 'Cấu hình app mạng xã hội',
  'social.connect': 'Kết nối mạng xã hội',
  'social.disconnect': 'Ngắt kết nối mạng xã hội',
  'note.delete': 'Admin xóa ghi chú',
  'file.update': 'Admin sửa tệp',
  'file.delete': 'Admin xóa tệp',
};

const FILTERS = [
  { value: '', label: 'Tất cả sự kiện' },
  { value: 'auth', label: 'Đăng nhập & bảo mật' },
  { value: 'user', label: 'Quản lý người dùng' },
  { value: 'post', label: 'Bài viết' },
  { value: 'settings', label: 'Cài đặt' },
  { value: 'social', label: 'Mạng xã hội' },
  { value: 'file', label: 'Tệp' },
  { value: 'note', label: 'Ghi chú' },
];

export default function AuditPage() {
  usePageTitle(t('Nhật ký'));
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [action]);
  const { data, isPending } = useQuery({
    queryKey: ['audit', action, page],
    queryFn: () => apiGet<Paginated<AuditEntry>>('/audit', { action, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title={t('Nhật ký hệ thống')}
        description={t('Các thao tác quan trọng về bảo mật và quản trị (lưu 180 ngày).')}
        actions={
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-auto">
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {t(f.label)}
              </option>
            ))}
          </Select>
        }
      />
      <Card className="overflow-x-auto">
        {isPending ? (
          <CenterSpinner />
        ) : !data?.items.length ? (
          <EmptyState icon={<History className="size-5" />} title={t('Chưa có sự kiện nào')} />
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('Thời gian')}</th>
                <th className="px-4 py-2.5 font-medium">{t('Người thực hiện')}</th>
                <th className="px-4 py-2.5 font-medium">{t('Sự kiện')}</th>
                <th className="px-4 py-2.5 font-medium">{t('Đối tượng')}</th>
                <th className="px-4 py-2.5 font-medium">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.items.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-4 py-2.5 whitespace-nowrap text-zinc-500">{formatDateTime(e.createdAt)}</td>
                  <td className="px-4 py-2.5">{e.actorEmail ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{ACTIONS[e.action] ? t(ACTIONS[e.action]) : e.action}</span>
                    {e.detail && <p className="mt-0.5 max-w-md truncate font-mono text-[11px] text-zinc-400" title={e.detail}>{e.detail}</p>}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500">{e.target ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-zinc-500">{e.ip ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
