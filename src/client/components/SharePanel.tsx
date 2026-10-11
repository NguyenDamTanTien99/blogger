import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, ExternalLink, Send } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { PostDTO, SocialProvider, SocialShareDTO } from '../../shared/types';
import { apiGet, apiPost } from '../lib/api';
import { timeAgo } from '../lib/format';
import { PROVIDER_NAMES, useSocialStatus } from '../pages/SocialPage';
import { useToast } from './Toast';
import { Badge, Button, Card, Select, Textarea } from './ui';
import { t } from '../lib/i18n';

const STATUS = {
  success: { tone: 'green', label: 'Đã đăng' },
  processing: { tone: 'amber', label: 'Đang xử lý' },
  failed: { tone: 'red', label: 'Lỗi' },
} as const;

/** Đăng bài đã lưu lên Facebook Fanpage / Zalo OA / TikTok, kèm nút chia sẻ thủ công. */
export function SharePanel({ post }: { post: PostDTO }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: status } = useSocialStatus();
  const [selected, setSelected] = useState<SocialProvider[]>([]);
  const [message, setMessage] = useState('');
  const [tiktokMode, setTiktokMode] = useState<'inbox' | 'direct'>('inbox');
  const [busy, setBusy] = useState(false);
  const history = useQuery({
    queryKey: ['shares', post.id],
    queryFn: async () => (await apiGet<{ shares: SocialShareDTO[] }>(`/social/shares/${post.id}`)).shares,
    // Zalo/TikTok xử lý bất đồng bộ: tự hỏi lại khi còn bài đang xử lý.
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'processing') ? 15_000 : false),
  });

  const live = post.status === 'published' && (post.publishedAt ?? 0) <= Date.now();
  const url = `${location.origin}${post.type === 'page' ? '/' : '/posts/'}${post.slug}`;
  const connected = status?.accounts.filter((a) => a.connected) ?? [];

  const toggle = (p: SocialProvider) => setSelected((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const share = async () => {
    setBusy(true);
    try {
      const { shares } = await apiPost<{ shares: SocialShareDTO[] }>(`/social/share/${post.id}`, { providers: selected, message, tiktokMode });
      const failed = shares.filter((s) => s.status === 'failed');
      if (failed.length) toast.error(new Error(failed.map((s) => `${PROVIDER_NAMES[s.provider]}: ${s.error}`).join(' · ')));
      if (failed.length < shares.length) toast.success(t('Đã gửi bài lên mạng xã hội'));
      setSelected([]);
      void qc.invalidateQueries({ queryKey: ['shares', post.id] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-medium">{t('Đăng lên mạng xã hội')}</p>
      {!live ? (
        <p className="text-xs text-zinc-500">{t('Xuất bản bài viết trước — mạng xã hội cần đọc được trang công khai.')}</p>
      ) : !connected.length ? (
        <p className="text-xs text-zinc-500">
          {t('Chưa kết nối tài khoản nào.')}{' '}
          <Link to="/social" className="text-brand underline">
            {t('Kết nối Facebook, Zalo, TikTok')}
          </Link>
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            {connected.map((a) => (
              <label key={a.provider} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selected.includes(a.provider)} onChange={() => toggle(a.provider)} />
                {PROVIDER_NAMES[a.provider]}
                {a.accountName && <span className="truncate text-xs text-zinc-500">({a.provider === 'facebook' ? a.pages.find((p) => p.id === a.pageId)?.name : a.accountName})</span>}
              </label>
            ))}
          </div>
          <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('Nội dung kèm theo (mặc định: tiêu đề + tóm tắt)')} />
          {selected.includes('tiktok') && (
            <Select value={tiktokMode} onChange={(e) => setTiktokMode(e.target.value as 'inbox' | 'direct')} className="text-xs">
              <option value="inbox">{t('TikTok: gửi vào hộp thư, hoàn tất trong app')}</option>
              <option value="direct">{t('TikTok: đăng thẳng (app cần qua kiểm duyệt)')}</option>
            </Select>
          )}
          <Button className="w-full" icon={<Send className="size-4" />} loading={busy} disabled={!selected.length} onClick={share}>
            {t('Đăng lên {n} nền tảng', { n: selected.length || '' })}
          </Button>
          <p className="text-[11px] text-zinc-500">{t('Dùng bản đã lưu của bài viết.')}</p>
        </>
      )}

      <div className="flex flex-wrap gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">
          <Button size="sm" variant="outline" icon={<ExternalLink className="size-3.5" />}>
            {t('Chia sẻ thủ công lên Facebook')}
          </Button>
        </a>
        <Button size="sm" variant="outline" icon={<Copy className="size-3.5" />} onClick={() => navigator.clipboard.writeText(url).then(() => toast.success(t('Đã sao chép link')))}>
          {t('Sao chép link')}
        </Button>
      </div>

      {!!history.data?.length && (
        <ul className="space-y-2 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
          {history.data.map((s) => (
            <li key={s.id} className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="font-medium">{PROVIDER_NAMES[s.provider]}</span>
                <Badge tone={STATUS[s.status].tone}>{t(STATUS[s.status].label)}</Badge>
                <span className="ml-auto text-zinc-400">{timeAgo(s.createdAt)}</span>
              </div>
              {s.error && <p className="text-red-600">{s.error}</p>}
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer" className="text-brand underline">
                  {t('Xem bài đã đăng')}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
