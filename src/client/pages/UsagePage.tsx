import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gauge, ShieldCheck, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { SiteSettings } from '../../shared/settings';
import type { MaintenanceReport, UsageDTO, UsageKey, UsageMetric } from '../../shared/types';
import { useConfirm } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, CenterSpinner, Field, Input, PageHeader, ProgressBar, Switch } from '../components/ui';
import { apiGet, apiPost, apiPut } from '../lib/api';
import { formatBytes, formatDateTime } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { t } from '../lib/i18n';

const LABELS: Record<UsageKey, { title: string; desc: string; bytes: boolean }> = {
  r2Storage: { title: 'Dung lượng R2', desc: 'Tổng dung lượng file (kể cả thùng rác và upload đang dở).', bytes: true },
  r2ClassA: { title: 'Thao tác ghi R2 (tháng này)', desc: 'Upload, ghép file, liệt kê. Miễn phí 1 triệu lượt/tháng.', bytes: false },
  r2ClassB: { title: 'Thao tác đọc R2 (tháng này)', desc: 'Xem, tải file, ảnh công khai. Miễn phí 10 triệu lượt/tháng.', bytes: false },
  d1Size: { title: 'Database D1', desc: 'Ghi chú, bài viết, người dùng, nhật ký. Tối đa 500 MB ở gói Free.', bytes: true },
  workerRequests: { title: 'Request Worker (hôm nay, UTC)', desc: 'API và trang blog. 100.000/ngày; file tĩnh của dashboard không tính.', bytes: false },
};

export function useUsage(enabled = true) {
  return useQuery({ queryKey: ['usage'], queryFn: () => apiGet<UsageDTO>('/usage'), enabled, staleTime: 60_000 });
}

/** Mức độ của một chỉ số so với các ngưỡng. */
export function levelOf(m: UsageMetric, th: UsageDTO['thresholds']): 'ok' | 'warn' | 'clean' | 'stop' {
  if (m.percent >= th.stop) return 'stop';
  if (m.percent >= th.clean) return 'clean';
  if (m.percent >= th.warn) return 'warn';
  return 'ok';
}

function MetricCard({ m, th }: { m: UsageMetric; th: UsageDTO['thresholds'] }) {
  const meta = LABELS[m.key];
  const level = levelOf(m, th);
  const fmt = (n: number) => (meta.bytes ? formatBytes(n) : n.toLocaleString());
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{t(meta.title)}</p>
        {m.billable ? <Badge tone="amber">{t('Có thể tính phí')}</Badge> : <Badge>{t('Chỉ bị chặn')}</Badge>}
      </div>
      <p className="text-2xl font-bold">
        {m.percent}% <span className="text-sm font-normal text-zinc-500">{fmt(m.used)} / {fmt(m.limit)}</span>
      </p>
      <ProgressBar value={m.percent / 100} tone={level === 'ok' ? 'brand' : level === 'warn' ? 'amber' : 'red'} />
      <p className="text-xs text-zinc-500">{t(meta.desc)}</p>
    </Card>
  );
}

function ReportView({ r }: { r: MaintenanceReport }) {
  const rows: [string, number][] = [
    ['Upload bỏ dở đã hủy', r.staleUploads],
    ['Tệp hết hạn trong thùng rác', r.expiredTrash],
    ['Tệp thùng rác xóa để giải phóng chỗ', r.purgedForSpace],
    ['Tệp cũ tự xóa', r.deletedOldFiles],
    ['Object mồ côi trên R2', r.orphans],
    ['Dòng dữ liệu phụ đã thu gọn', r.prunedRows],
  ];
  return (
    <div className="space-y-1 text-sm">
      <p className="text-xs text-zinc-500">
        {t('Lần chạy: {time} · giải phóng {size}', { time: formatDateTime(r.ranAt), size: formatBytes(r.freedBytes) })}
      </p>
      {rows.map(([label, n]) => (
        <div key={label} className="flex justify-between border-b border-zinc-100 py-1 last:border-0 dark:border-zinc-800">
          <span>{t(label)}</span>
          <span className="font-medium">{n}</span>
        </div>
      ))}
    </div>
  );
}

export default function UsagePage() {
  usePageTitle(t('Hạn mức & dọn dẹp'));
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const usage = useUsage();
  const settings = useQuery({ queryKey: ['settings'], queryFn: async () => (await apiGet<{ settings: SiteSettings }>('/settings')).settings });
  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!usage.data || !settings.data) return <CenterSpinner />;
  const s = draft ?? settings.data;
  const set = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => setDraft({ ...s, [key]: value });
  const u = usage.data;

  const runNow = async () => {
    setRunning(true);
    try {
      await apiPost<{ report: MaintenanceReport }>('/usage/maintenance');
      toast.success(t('Đã dọn dẹp xong'));
      for (const key of ['usage', 'stats', 'me', 'drive', 'trash']) void qc.invalidateQueries({ queryKey: [key] });
    } catch (err) {
      toast.error(err);
    } finally {
      setRunning(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    if (draft.autoDeleteOldFilesDays > 0 && settings.data.autoDeleteOldFilesDays === 0) {
      const ok = await confirm({
        title: t('Bật tự xóa tệp cũ?'),
        message: t('Khi kho chạm ngưỡng dọn dẹp và thùng rác không đủ, hệ thống sẽ XÓA HẲN các tệp riêng tư cũ hơn {days} ngày (cũ nhất trước). Không thể khôi phục.', { days: draft.autoDeleteOldFilesDays }),
        confirmText: t('Bật'),
        danger: true,
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const { settings: saved } = await apiPut<{ settings: SiteSettings }>('/settings', draft);
      qc.setQueryData(['settings'], saved);
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['usage'] });
      toast.success(t('Đã lưu'));
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const pct = (key: 'usageWarnPercent' | 'usageCleanPercent' | 'usageStopPercent', label: string, hint: string) => (
    <Field label={t(label)} hint={t(hint)}>
      <Input type="number" min={10} max={100} value={s[key]} onChange={(e) => set(key, Math.min(100, Math.max(10, Number(e.target.value) || 10)))} />
    </Field>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('Hạn mức & dọn dẹp')}
        description={t('Theo dõi mức dùng so với gói miễn phí của Cloudflare. Hệ thống tự dọn dẹp mỗi giờ và tạm dừng thao tác có thể tính phí khi chạm ngưỡng.')}
        actions={
          <Button icon={<Sparkles className="size-4" />} loading={running} onClick={runNow}>
            {t('Dọn dẹp ngay')}
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {u.metrics.map((m) => (
          <MetricCard key={m.key} m={m} th={u.thresholds} />
        ))}
        <Card className="space-y-2 p-4">
          <div className="flex items-center gap-2 font-medium">
            <Trash2 className="size-4" /> {t('Thùng rác')}
          </div>
          <p className="text-2xl font-bold">{formatBytes(u.trash.bytes)}</p>
          <p className="text-xs text-zinc-500">{t('{n} tệp có thể giải phóng ngay.', { n: u.trash.files })}</p>
          <Link to="/files?trash=1" className="text-sm text-brand">
            {t('Mở thùng rác →')}
          </Link>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="space-y-5 p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-emerald-500" />
            <h2 className="font-semibold">{t('Chính sách bảo vệ')}</h2>
          </div>
          <Switch
            checked={s.strictFreeTier}
            onChange={(v) => set('strictFreeTier', v)}
            label={t('Chế độ miễn phí tuyệt đối: chặn mọi thao tác có thể phát sinh phí')}
          />
          {!s.strictFreeTier && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
              {t('Đã tắt: R2 có thể tính phí khi vượt hạn mức (khoảng 0,015 USD/GB/tháng, 4,5 USD/triệu lượt ghi, 0,36 USD/triệu lượt đọc).')}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-3">
            {pct('usageWarnPercent', 'Ngưỡng cảnh báo (%)', 'Hiện cảnh báo trên Tổng quan.')}
            {pct('usageCleanPercent', 'Ngưỡng dọn dẹp (%)', 'Tự dọn thùng rác về dưới ngưỡng cảnh báo.')}
            {pct('usageStopPercent', 'Ngưỡng tạm dừng (%)', 'Chặn upload/tải file tới tháng sau.')}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('Giữ tệp trong thùng rác (ngày)')}>
              <Input type="number" min={1} value={s.trashRetentionDays} onChange={(e) => set('trashRetentionDays', Math.max(1, Number(e.target.value) || 1))} />
            </Field>
            <Field
              label={t('Tự xóa tệp riêng tư cũ hơn (ngày)')}
              hint={t('0 = tắt (khuyến nghị). Chỉ chạy khi chạm ngưỡng dọn dẹp mà thùng rác không đủ; không bao giờ xóa tệp công khai, ghi chú, bài viết.')}
            >
              <Input type="number" min={0} value={s.autoDeleteOldFilesDays} onChange={(e) => set('autoDeleteOldFilesDays', Math.max(0, Number(e.target.value) || 0))} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button loading={saving} disabled={!draft} onClick={save}>
              {t('Lưu chính sách')}
            </Button>
            {draft && (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                {t('Hoàn tác')}
              </Button>
            )}
          </div>
        </Card>

        <Card className="space-y-3 p-5">
          <div className="flex items-center gap-2">
            <Gauge className="size-5 text-brand" />
            <h2 className="font-semibold">{t('Lần dọn dẹp gần nhất')}</h2>
          </div>
          {u.lastMaintenance ? <ReportView r={u.lastMaintenance} /> : <p className="text-sm text-zinc-500">{t('Chưa có lần dọn dẹp nào cần ghi nhận.')}</p>}
          <p className="text-xs text-zinc-500">
            {t('Thao tác R2 và request được đếm ước lượng bởi chính hệ thống; số liệu chính xác xem trong dashboard Cloudflare.')}
          </p>
        </Card>
      </div>
    </div>
  );
}
