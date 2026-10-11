import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, ImagePlus, Plus, Save, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MB } from '../../shared/constants';
import type { LinkItem, SiteSettings } from '../../shared/settings';
import { useToast } from '../components/Toast';
import { Button, Card, CenterSpinner, Field, IconButton, Input, PageHeader, Select, Switch, Textarea } from '../components/ui';
import { apiGet, apiPut } from '../lib/api';
import { formatBytes } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { setBrandColor } from '../lib/theme';
import { publicFileUrl, uploadFile } from '../lib/upload';
import { t } from '../lib/i18n';

const PRESET_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#16a34a', '#0d9488', '#0f172a'];

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card className="grid gap-6 p-5 md:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function LinksEditor({ value, onChange, addLabel }: { value: LinkItem[]; onChange: (v: LinkItem[]) => void; addLabel: string }) {
  const update = (i: number, patch: Partial<LinkItem>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...value];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {value.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input className="w-36 shrink-0" placeholder={t('Nhãn')} value={l.label} onChange={(e) => update(i, { label: e.target.value })} />
          <Input placeholder={t('/about hoặc https://…')} value={l.url} onChange={(e) => update(i, { url: e.target.value })} />
          <IconButton label={t('Lên')} disabled={i === 0} onClick={() => move(i, -1)}>
            <ArrowUp className="size-4" />
          </IconButton>
          <IconButton label={t('Xuống')} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
            <ArrowDown className="size-4" />
          </IconButton>
          <IconButton label={t('Xóa')} onClick={() => onChange(value.filter((_, j) => j !== i))} className="hover:text-red-600">
            <X className="size-4" />
          </IconButton>
        </div>
      ))}
      <Button size="sm" variant="outline" icon={<Plus className="size-4" />} onClick={() => onChange([...value, { label: '', url: '' }])} disabled={value.length >= 12}>
        {addLabel}
      </Button>
    </div>
  );
}

export default function SettingsPage() {
  usePageTitle(t('Cài đặt blog'));
  const { data } = useQuery({ queryKey: ['settings'], queryFn: async () => (await apiGet<{ settings: SiteSettings }>('/settings')).settings });
  if (!data) return <CenterSpinner />;
  return <SettingsForm initial={data} />;
}

function SettingsForm({ initial }: { initial: SiteSettings }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [saving, setSaving] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => setS((cur) => ({ ...cur, [key]: value }));
  const changed = JSON.stringify(s) !== JSON.stringify(initial);

  // Xem trước màu nhấn ngay trong dashboard; hoàn tác nếu rời trang mà không lưu.
  useEffect(() => {
    setBrandColor(s.accentColor);
  }, [s.accentColor]);
  useEffect(() => () => setBrandColor((qc.getQueryData<SiteSettings>(['settings']) ?? initial).accentColor), [qc, initial]);

  const save = async () => {
    setSaving(true);
    try {
      const cleaned = {
        ...s,
        navLinks: s.navLinks.filter((l) => l.label.trim() && l.url.trim()),
        verificationFiles: s.verificationFiles.filter((f) => f.name.trim()),
        socialLinks: s.socialLinks.filter((l) => l.label.trim() && l.url.trim()),
      };
      const { settings } = await apiPut<{ settings: SiteSettings }>('/settings', cleaned);
      qc.setQueryData(['settings'], settings);
      void qc.invalidateQueries({ queryKey: ['site'] });
      setS(settings);
      toast.success(t('Đã lưu cài đặt — blog cập nhật trong vòng ~30 giây'));
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    try {
      const f = await uploadFile(file, { folderId: null, visibility: 'public' });
      set('avatarUrl', publicFileUrl(f));
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="space-y-5 pb-20">
      <PageHeader
        title={t('Cài đặt blog')}
        description={t('Tùy biến giao diện và nội dung trang blog công khai.')}
        actions={
          <>
            <a href="/" target="_blank" rel="noreferrer">
              <Button variant="outline" icon={<ExternalLink className="size-4" />}>
                Xem blog
              </Button>
            </a>
            <Button icon={<Save className="size-4" />} loading={saving} disabled={!changed} onClick={save}>
              {t('Lưu thay đổi')}
            </Button>
          </>
        }
      />

      <Section title={t('Thông tin trang')} description={t('Hiển thị ở đầu trang, tiêu đề tab và khi chia sẻ lên mạng xã hội.')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Tên blog')}>
            <Input value={s.siteTitle} onChange={(e) => set('siteTitle', e.target.value)} maxLength={120} />
          </Field>
          <Field label={t('Khẩu hiệu')}>
            <Input value={s.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={200} />
          </Field>
        </div>
        <Field label={t('Mô tả (SEO)')}>
          <Textarea rows={2} value={s.description} onChange={(e) => set('description', e.target.value)} maxLength={500} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('Tên tác giả')}>
            <Input value={s.authorName} onChange={(e) => set('authorName', e.target.value)} maxLength={80} />
          </Field>
          <Field label={t('Múi giờ')} hint={t('Ví dụ: Asia/Ho_Chi_Minh')}>
            <Input value={s.timezone} onChange={(e) => set('timezone', e.target.value)} />
          </Field>
        </div>
        <Field label={t('Giới thiệu ngắn')}>
          <Textarea rows={3} value={s.authorBio} onChange={(e) => set('authorBio', e.target.value)} maxLength={1000} />
        </Field>
        <Field label={t('Ảnh đại diện')}>
          <div className="flex items-center gap-3">
            {s.avatarUrl ? (
              <img src={s.avatarUrl} alt="" className="size-12 shrink-0 rounded-full object-cover" />
            ) : (
              <div className="size-12 shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-800" />
            )}
            <Input value={s.avatarUrl} onChange={(e) => set('avatarUrl', e.target.value)} placeholder={t('URL ảnh')} />
            <Button variant="outline" icon={<ImagePlus className="size-4" />} onClick={() => avatarInput.current?.click()}>
              {t('Tải lên')}
            </Button>
            <input
              ref={avatarInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
                e.target.value = '';
              }}
            />
          </div>
        </Field>
      </Section>

      <Section title={t('Giao diện')} description={t('Màu sắc, phông chữ và bố cục danh sách bài viết.')}>
        <Field label={t('Màu nhấn')}>
          <div className="flex flex-wrap items-center gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                onClick={() => set('accentColor', c)}
                className="size-8 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-zinc-900"
                style={{ background: c, boxShadow: s.accentColor === c ? `0 0 0 2px ${c}` : undefined }}
              />
            ))}
            <input type="color" value={s.accentColor} onChange={(e) => set('accentColor', e.target.value)} className="h-8 w-12 cursor-pointer rounded" />
            <code className="text-xs text-zinc-500">{s.accentColor}</code>
          </div>
        </Field>
        <Field label={t('Ngôn ngữ của blog')} hint={t('Áp dụng cho chữ giao diện trang công khai (menu, ngày tháng, nút chia sẻ…). Nội dung bài viết giữ nguyên.')}>
          <Select value={s.language === 'en' ? 'en' : 'vi'} onChange={(e) => set('language', e.target.value)} className="max-w-60">
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('Chế độ màu mặc định')}>
            <Select value={s.theme} onChange={(e) => set('theme', e.target.value as SiteSettings['theme'])}>
              <option value="auto">{t('Theo thiết bị')}</option>
              <option value="light">{t('Sáng')}</option>
              <option value="dark">{t('Tối')}</option>
            </Select>
          </Field>
          <Field label={t('Phông chữ')}>
            <Select value={s.font} onChange={(e) => set('font', e.target.value as SiteSettings['font'])}>
              <option value="sans">{t('Không chân (hiện đại)')}</option>
              <option value="serif">{t('Có chân (cổ điển)')}</option>
              <option value="mono">{t('Đơn cách (lập trình)')}</option>
            </Select>
          </Field>
          <Field label={t('Bố cục')}>
            <Select value={s.layout} onChange={(e) => set('layout', e.target.value as SiteSettings['layout'])}>
              <option value="list">{t('Danh sách')}</option>
              <option value="cards">{t('Thẻ có ảnh bìa')}</option>
            </Select>
          </Field>
          <Field label={t('Số bài mỗi trang')}>
            <Input type="number" min={1} max={50} value={s.postsPerPage} onChange={(e) => set('postsPerPage', Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
          </Field>
        </div>
      </Section>

      <Section title={t('Menu điều hướng')} description={t('Liên kết trên thanh đầu trang. Trang tĩnh có địa chỉ /slug (vd: /about).')}>
        <LinksEditor value={s.navLinks} onChange={(v) => set('navLinks', v)} addLabel={t('Thêm liên kết')} />
      </Section>

      <Section title={t('Chân trang & mạng xã hội')}>
        <Field label={t('Dòng chân trang')} hint={t('Để trống sẽ hiện © năm + tên tác giả.')}>
          <Input value={s.footerText} onChange={(e) => set('footerText', e.target.value)} maxLength={1000} />
        </Field>
        <LinksEditor value={s.socialLinks} onChange={(v) => set('socialLinks', v)} addLabel={t('Thêm mạng xã hội')} />
        <Switch checked={s.showLoginLink} onChange={(v) => set('showLoginLink', v)} label={t('Hiện liên kết “Đăng nhập” ở chân trang')} />
      </Section>

      <Section title={t('Nâng cao')} description={t('Chỉ admin chỉnh được. Mã ở đây chạy trên mọi trang blog công khai.')}>
        <Field label={t('CSS tùy chỉnh')} hint={t('Ví dụ: .post-item h2 { font-size: 1.5rem }')}>
          <Textarea rows={6} className="font-mono text-xs" value={s.customCss} onChange={(e) => set('customCss', e.target.value)} spellCheck={false} />
        </Field>
        <Field label={t('HTML chèn vào <head>')} hint={t('Google Analytics, xác minh Search Console, font chữ…')}>
          <Textarea rows={4} className="font-mono text-xs" value={s.customHeadHtml} onChange={(e) => set('customHeadHtml', e.target.value)} spellCheck={false} />
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('File xác minh tên miền')}</p>
          <p className="text-xs text-zinc-500">
            {t('TikTok, Zalo, Google… yêu cầu đặt một file ở gốc tên miền (vd:')}{' '}<code>zalo_verifierABC.html</code>, <code>tiktokXYZ.txt</code>{t('). Nhập tên file và nội dung họ cung cấp; file sẽ có ở địa chỉ')}{' '}<code>/{t('<tên file>')}</code>.
          </p>
          {s.verificationFiles.map((f, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <Input
                className="w-60 font-mono text-xs"
                placeholder="tiktokXYZ.txt"
                value={f.name}
                onChange={(e) => set('verificationFiles', s.verificationFiles.map((x, j) => (j === i ? { ...x, name: e.target.value.trim() } : x)))}
              />
              <Textarea
                rows={1}
                className="min-w-60 flex-1 font-mono text-xs"
                placeholder={t('Nội dung file')}
                value={f.content}
                onChange={(e) => set('verificationFiles', s.verificationFiles.map((x, j) => (j === i ? { ...x, content: e.target.value } : x)))}
              />
              <IconButton label={t('Xóa')} onClick={() => set('verificationFiles', s.verificationFiles.filter((_, j) => j !== i))} className="hover:text-red-600">
                <X className="size-4" />
              </IconButton>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            icon={<Plus className="size-4" />}
            disabled={s.verificationFiles.length >= 10}
            onClick={() => set('verificationFiles', [...s.verificationFiles, { name: '', content: '' }])}
          >
            {t('Thêm file xác minh')}
          </Button>
        </div>
      </Section>

      <Section
        title={t('Lưu trữ')}
        description={t('R2 miễn phí 10GB. Giữ tổng giới hạn ≤ 10GB để không phát sinh chi phí (vượt mức: ~$0.015/GB/tháng).')}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t('Tổng giới hạn hệ thống (MB)')} hint={formatBytes(s.globalStorageLimitMB * MB)}>
            <Input type="number" min={1} value={s.globalStorageLimitMB} onChange={(e) => set('globalStorageLimitMB', Math.max(1, Number(e.target.value) || 1))} />
          </Field>
          <Field label={t('Hạn mức mặc định user mới (MB)')} hint={formatBytes(s.defaultQuotaMB * MB)}>
            <Input type="number" min={0} value={s.defaultQuotaMB} onChange={(e) => set('defaultQuotaMB', Math.max(0, Number(e.target.value) || 0))} />
          </Field>
          <Field label={t('Kích thước tối đa mỗi tệp (MB)')} hint={formatBytes(s.maxFileSizeMB * MB)}>
            <Input type="number" min={1} value={s.maxFileSizeMB} onChange={(e) => set('maxFileSizeMB', Math.max(1, Number(e.target.value) || 1))} />
          </Field>
        </div>
      </Section>

      {changed && (
        <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <span className="text-sm">{t('Bạn có thay đổi chưa lưu')}</span>
            <Button size="sm" variant="ghost" onClick={() => setS(initial)}>
              {t('Hoàn tác')}
            </Button>
            <Button size="sm" loading={saving} onClick={save}>
              {t('Lưu')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
