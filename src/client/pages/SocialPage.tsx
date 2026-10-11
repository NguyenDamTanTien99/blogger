import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, LockKeyhole, Unplug } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import type { SocialAccountDTO, SocialProvider, SocialStatusDTO } from '../../shared/types';
import { useConfirm } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, CenterSpinner, Field, Input, PageHeader, Select } from '../components/ui';
import { apiDelete, apiGet, apiPut } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { t } from '../lib/i18n';

export const PROVIDER_NAMES: Record<SocialProvider, string> = { facebook: 'Facebook Fanpage', zalo: 'Zalo OA', tiktok: 'TikTok' };

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer" className="text-brand underline underline-offset-2">
    {children}
  </a>
);

// Hàm (không phải hằng số) để nội dung dịch theo ngôn ngữ hiện tại mỗi lần render.
const guides = (): Record<SocialProvider, { idLabel: string; secretLabel: string; steps: ReactNode[]; note: ReactNode }> => ({
  facebook: {
    idLabel: 'App ID',
    secretLabel: 'App Secret',
    steps: [
      <>
        {t('Vào')}{' '}<A href="https://developers.facebook.com/apps">developers.facebook.com/apps</A>{' '}{t('→ tạo app, chọn trường hợp sử dụng quản lý Trang (Pages).')}
      </>,
      <>{t('Thêm sản phẩm')}{' '}<b>Facebook Login</b>{' '}{t('→ mục')}{' '}<i>Valid OAuth Redirect URIs</i>{t(': dán Redirect URI bên dưới.')}</>,
      <>{t('Lấy App ID và App Secret ở')}{' '}<i>App settings → Basic</i>{t(', dán vào đây rồi bấm Lưu.')}</>,
      <>{t('Bấm')}{' '}<b>{t('Kết nối')}</b>{t(', đăng nhập và tick chọn Fanpage muốn đăng.')}</>,
    ],
    note: t('Facebook chỉ cho phép đăng tự động lên Fanpage (không phải trang cá nhân). App ở chế độ Development vẫn đăng được lên Fanpage do bạn quản lý.'),
  },
  zalo: {
    idLabel: 'App ID',
    secretLabel: 'Secret key',
    steps: [
      <>
        {t('Cần có Zalo Official Account (')}<A href="https://oa.zalo.me">oa.zalo.me</A>).
      </>,
      <>
        {t('Tạo ứng dụng tại')}{' '}<A href="https://developers.zalo.me">developers.zalo.me</A>{t(', liên kết với OA, bật quyền quản lý bài viết.')}
      </>,
      <>
        {t('Xác thực tên miền: Zalo cấp file')}{' '}<code>zalo_verifier….html</code>{' '}{t('→ thêm vào')}{' '}<i>{t('Cài đặt blog → File xác minh tên miền')}</i>.
      </>,
      <>{t('Khai báo Callback URL = Redirect URI bên dưới, nhập App ID + Secret key, bấm Lưu rồi Kết nối.')}</>,
    ],
    note: t('Đăng thành "Bài viết" trên Zalo OA (bắt buộc có ảnh bìa). Zalo không cho đăng tự động lên trang cá nhân. Token tự làm mới mỗi ngày; nếu quá 3 tháng không dùng cần kết nối lại.'),
  },
  tiktok: {
    idLabel: 'Client key',
    secretLabel: 'Client secret',
    steps: [
      <>
        {t('Tạo app tại')}{' '}<A href="https://developers.tiktok.com/apps">developers.tiktok.com</A>{t(', thêm')}{' '}<b>Login Kit</b>{' '}{t('và')}{' '}<b>Content Posting API</b>{' '}
        (scope video.upload, video.publish).
      </>,
      <>{t('Khai báo Redirect URI bên dưới trong Login Kit.')}</>,
      <>
        {t('Xác minh tên miền chứa ảnh (URL prefix): TikTok cấp file')}{' '}<code>tiktok….txt</code>{' '}{t('→ thêm vào')}{' '}<i>{t('Cài đặt blog → File xác minh tên miền')}</i>.
      </>,
      <>{t('Nhập Client key + Client secret, bấm Lưu rồi Kết nối.')}</>,
    ],
    note: t('TikTok chỉ nhận bài ảnh (JPG/WEBP) — ảnh bìa và ảnh trong bài sẽ thành bài ảnh kèm chú thích. App chưa qua kiểm duyệt của TikTok chỉ đăng được chế độ riêng tư, nên mặc định bài được gửi vào hộp thư TikTok để bạn hoàn tất trong app.'),
  },
});

export function useSocialStatus() {
  return useQuery({ queryKey: ['social'], queryFn: () => apiGet<SocialStatusDTO>('/social') });
}

export default function SocialPage() {
  usePageTitle(t('Mạng xã hội'));
  const { data } = useSocialStatus();
  const [params, setParams] = useSearchParams();
  const toast = useToast();

  // Kết quả trả về từ màn hình cấp quyền OAuth.
  useEffect(() => {
    const connected = params.get('connected') as SocialProvider | null;
    const error = params.get('error');
    if (connected) toast.success(t('Đã kết nối {v1}', { v1: PROVIDER_NAMES[connected] ?? connected }));
    if (error) toast.error(new Error(error));
    if (connected || error) setParams({}, { replace: true });
  }, [params, setParams, toast]);

  if (!data) return <CenterSpinner />;
  return (
    <div className="max-w-4xl space-y-5">
      <PageHeader
        title={t('Mạng xã hội')}
        description={t('Kết nối một lần, sau đó đăng bài lên Facebook, Zalo, TikTok ngay trong trình soạn bài viết. Trang bài viết công khai luôn có sẵn nút chia sẻ thủ công.')}
      />
      {location.protocol !== 'https:' && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {t('Bạn đang mở dashboard qua')}{' '}<b>{location.origin}</b>{' '}{t('(không phải HTTPS). Facebook và TikTok từ chối kết nối không bảo mật, và token lưu ở đây chỉ nằm trong database máy local. Hãy kết nối trên site đã deploy (https://….workers.dev/app/social).')}
        </div>
      )}
      {!data.encrypted && (
        <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" />
          <p>
            {t('Nên mã hóa token trong database: chạy')}{' '}<code className="rounded bg-amber-100 px-1 dark:bg-amber-500/20">npx wrangler secret put TOKEN_SECRET</code>{' '}
            {t('và nhập một chuỗi ngẫu nhiên dài (≥ 32 ký tự), rồi lưu lại cấu hình và kết nối lại các tài khoản.')}
          </p>
        </div>
      )}
      {data.accounts.map((a) => (
        <ProviderCard key={a.provider} account={a} />
      ))}
    </div>
  );
}

function ProviderCard({ account }: { account: SocialAccountDTO }) {
  const guide = guides()[account.provider];
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [appId, setAppId] = useState(account.appId);
  const [configId, setConfigId] = useState(account.configId);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['social'] });

  const save = async () => {
    setBusy(true);
    try {
      await apiPut(`/social/${account.provider}`, { appId, appSecret: secret || undefined, configId: configId || undefined });
      setSecret('');
      toast.success(t('Đã lưu cấu hình'));
      await refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!(await confirm({ title: t('Ngắt kết nối {v1}?', { v1: PROVIDER_NAMES[account.provider] }), message: t('Xóa cấu hình app và token đã lưu.'), confirmText: t('Ngắt kết nối'), danger: true }))) return;
    try {
      await apiDelete(`/social/${account.provider}`);
      setAppId('');
      await refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  const choosePage = async (pageId: string) => {
    try {
      await apiPut('/social/facebook/page', { pageId });
      await refresh();
      toast.success(t('Đã đổi Fanpage đăng bài'));
    } catch (err) {
      toast.error(err);
    }
  };

  const saved = !!account.appId && account.hasSecret;
  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold">{PROVIDER_NAMES[account.provider]}</h2>
        {account.connected ? (
          <Badge tone="green">{t('Đã kết nối')}{account.accountName ? `: ${account.accountName}` : ''}</Badge>
        ) : (
          <Badge>{t('Chưa kết nối')}</Badge>
        )}
        {account.connected && account.refreshExpiresAt && (
          <span className="text-xs text-zinc-500">{t('cần kết nối lại trước {date}', { date: formatDateTime(account.refreshExpiresAt) })}</span>
        )}
      </div>

      <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
        {guide.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800/50">{guide.note}</p>

      <Field label={t('Redirect URI (dán vào trang developer)')}>
        <div className="flex gap-2">
          <Input readOnly value={account.redirectUri} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button
            variant="outline"
            icon={<Copy className="size-4" />}
            onClick={() => navigator.clipboard.writeText(account.redirectUri).then(() => toast.success(t('Đã sao chép')))}
          >
            {t('Sao chép')}
          </Button>
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={guide.idLabel}>
          <Input value={appId} onChange={(e) => setAppId(e.target.value)} autoComplete="off" />
        </Field>
        <Field
          label={guide.secretLabel}
          hint={account.hasSecret && appId === account.appId ? t('Đã lưu — để trống nếu không đổi') : appId !== account.appId && account.appId ? t('Đổi App ID: bắt buộc nhập secret của app mới') : undefined}
        >
          <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="new-password" placeholder={account.hasSecret ? '••••••••' : ''} />
        </Field>
      </div>

      {account.provider === 'facebook' && (
        <Field
          label={t('Configuration ID (chỉ khi app dùng Facebook Login for Business)')}
          hint={t('App loại Business: vào Facebook Login for Business → Configurations → tạo cấu hình có quyền pages_show_list, pages_read_engagement, pages_manage_posts rồi dán ID vào đây. App thường: để trống.')}
        >
          <Input value={configId} onChange={(e) => setConfigId(e.target.value.trim())} autoComplete="off" />
        </Field>
      )}

      {account.provider === 'facebook' && account.pages.length > 0 && (
        <Field label={t('Fanpage đăng bài')}>
          <Select value={account.pageId ?? ''} onChange={(e) => choosePage(e.target.value)}>
            {account.pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" loading={busy} disabled={!appId.trim() || (!secret && (!account.hasSecret || appId !== account.appId))} onClick={save}>
          {t('Lưu cấu hình')}
        </Button>
        <Button
          icon={<Link2 className="size-4" />}
          disabled={!saved || appId !== account.appId || configId !== account.configId}
          onClick={() => window.location.assign(`/api/social/${account.provider}/connect`)}
        >
          {account.connected ? t('Kết nối lại') : t('Kết nối')}
        </Button>
        {(saved || account.connected) && (
          <Button variant="ghost" icon={<Unplug className="size-4" />} onClick={disconnect} className="hover:text-red-600">
            {t('Ngắt kết nối')}
          </Button>
        )}
      </div>
    </Card>
  );
}
