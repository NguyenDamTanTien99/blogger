import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Newspaper, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Paginated, PostSummary } from '../../shared/types';
import { Menu } from '../components/Menu';
import { useConfirm } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, CenterSpinner, EmptyState, Input, PageHeader, Pagination } from '../components/ui';
import { apiDelete, apiGet } from '../lib/api';
import { cn, formatDateTime, timeAgo } from '../lib/format';
import { useDebounced, usePageTitle } from '../lib/hooks';

const TABS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'published', label: 'Đã xuất bản' },
  { id: 'draft', label: 'Bản nháp' },
  { id: 'page', label: 'Trang tĩnh' },
] as const;

export function publicPostUrl(p: Pick<PostSummary, 'type' | 'slug' | 'status' | 'publishedAt'>): string {
  const path = p.type === 'page' ? `/${p.slug}` : `/posts/${p.slug}`;
  const live = p.status === 'published' && (p.publishedAt ?? 0) <= Date.now();
  return live ? path : `${path}?preview`;
}

export default function PostsPage() {
  usePageTitle('Bài viết');
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim());
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const navigate = useNavigate();

  useEffect(() => setPage(1), [tab, q]);

  const query = {
    q,
    page,
    pageSize: 20,
    status: tab === 'published' || tab === 'draft' ? tab : undefined,
    type: tab === 'page' ? 'page' : undefined,
  };
  const { data, isPending } = useQuery({
    queryKey: ['posts', query],
    queryFn: () => apiGet<Paginated<PostSummary>>('/posts', query),
    placeholderData: keepPreviousData,
  });

  const remove = async (p: PostSummary) => {
    if (!(await confirm({ title: 'Xóa bài viết?', message: `“${p.title}” sẽ bị xóa vĩnh viễn khỏi blog.`, confirmText: 'Xóa', danger: true }))) return;
    try {
      await apiDelete(`/posts/${p.id}`);
      toast.success('Đã xóa bài viết');
      void qc.invalidateQueries({ queryKey: ['posts'] });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader
        title="Bài viết"
        description="Viết và xuất bản lên blog công khai. Trang tĩnh (Giới thiệu, Liên hệ…) có địa chỉ dạng /ten-trang."
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => navigate('/posts/new')}>
            Viết bài mới
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg bg-zinc-200/60 p-0.5 dark:bg-zinc-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium',
                tab === t.id ? 'bg-white shadow-sm dark:bg-zinc-950' : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
          <Input className="pl-9" placeholder="Tìm theo tiêu đề hoặc thẻ…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <Card>
        {isPending ? (
          <CenterSpinner />
        ) : !data?.items.length ? (
          <EmptyState
            icon={<Newspaper className="size-5" />}
            title="Chưa có bài viết"
            description="Bài viết đầu tiên của bạn sẽ xuất hiện ở đây."
            action={<Button onClick={() => navigate('/posts/new')}>Viết bài mới</Button>}
          />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.items.map((p) => {
              const scheduled = p.status === 'published' && (p.publishedAt ?? 0) > Date.now();
              return (
                <li key={p.id} className="flex items-center gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <Link to={`/posts/${p.id}`} className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{p.title}</span>
                      {p.type === 'page' && <Badge>Trang</Badge>}
                      {scheduled ? (
                        <Badge tone="amber">Hẹn giờ</Badge>
                      ) : p.status === 'published' ? (
                        <Badge tone="green">Đã xuất bản</Badge>
                      ) : (
                        <Badge tone="gray">Nháp</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {p.type === 'page' ? `/${p.slug}` : `/posts/${p.slug}`} ·{' '}
                      {p.publishedAt ? `đăng ${formatDateTime(p.publishedAt)}` : `sửa ${timeAgo(p.updatedAt)}`}
                      {p.tags.length > 0 && ` · ${p.tags.map((t) => `#${t}`).join(' ')}`}
                    </p>
                  </Link>
                  <Menu
                    items={[
                      { label: 'Chỉnh sửa', icon: <Pencil />, onSelect: () => navigate(`/posts/${p.id}`) },
                      { label: p.status === 'published' ? 'Xem trên blog' : 'Xem trước', icon: <ExternalLink />, onSelect: () => window.open(publicPostUrl(p), '_blank') },
                      { label: 'Xóa', icon: <Trash2 />, onSelect: () => remove(p), danger: true },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
    </>
  );
}
