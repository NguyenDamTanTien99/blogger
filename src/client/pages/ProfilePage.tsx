import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Laptop, LogOut, Smartphone } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MIN_PASSWORD_LENGTH } from '../../shared/constants';
import { derivePasswordKey } from '../../shared/crypto';
import type { SessionInfo, UserDTO } from '../../shared/types';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, CenterSpinner, Field, Input, PageHeader } from '../components/ui';
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatBytes, formatDateTime, timeAgo } from '../lib/format';
import { usePageTitle } from '../lib/hooks';
import { t } from '../lib/i18n';

function deviceName(ua: string | null): string {
  if (!ua) return t('Thiết bị không xác định');
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : t('Trình duyệt');
  return [browser, os].filter(Boolean).join(' · ');
}

export default function ProfilePage() {
  usePageTitle(t('Hồ sơ'));
  const { user, setUser } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: async () => (await apiGet<{ sessions: SessionInfo[] }>('/auth/sessions')).sessions,
  });

  if (!user) return <CenterSpinner />;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setSavingName(true);
    try {
      const { user: u } = await apiPatch<{ user: UserDTO }>('/auth/me', { name });
      setUser(u);
      toast.success(t('Đã cập nhật tên'));
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingName(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError('');
    if (pw.next.length < MIN_PASSWORD_LENGTH) return setPwError(t('Mật khẩu mới cần ít nhất {MIN_PASSWORD_LENGTH} ký tự.', { MIN_PASSWORD_LENGTH }));
    if (pw.next !== pw.confirm) return setPwError(t('Hai lần nhập mật khẩu mới không khớp.'));
    setSavingPw(true);
    try {
      const [currentKey, newKey] = await Promise.all([derivePasswordKey(user.email, pw.current), derivePasswordKey(user.email, pw.next)]);
      await apiPost('/auth/password', { currentKey, newKey });
      setPw({ current: '', next: '', confirm: '' });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success(t('Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.'));
    } catch (err) {
      setPwError(errorMessage(err));
    } finally {
      setSavingPw(false);
    }
  };

  const logoutOthers = async () => {
    try {
      await apiDelete('/auth/sessions/others');
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success(t('Đã đăng xuất các thiết bị khác'));
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title={t('Hồ sơ của tôi')} description={t('{email} · {v2} · Đã dùng {v3} / {v4}', { email: user.email, v2: user.role === 'admin' ? 'Admin' : 'User', v3: formatBytes(user.storageUsed), v4: formatBytes(user.storageQuota) })} />

      <Card className="p-5">
        <form onSubmit={saveName} className="flex flex-wrap items-end gap-3">
          <Field label={t('Tên hiển thị')} className="min-w-60 flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <Button type="submit" loading={savingName} disabled={name.trim() === user.name}>
            {t('Lưu')}
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-semibold">{t('Đổi mật khẩu')}</h2>
        <form onSubmit={changePassword} className="grid gap-4 sm:grid-cols-3">
          <Field label={t('Mật khẩu hiện tại')}>
            <Input type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label={t('Mật khẩu mới')}>
            <Input type="password" autoComplete="new-password" required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label={t('Nhập lại mật khẩu mới')}>
            <Input type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
          {pwError && <p className="text-sm text-red-600 sm:col-span-3">{pwError}</p>}
          <div className="sm:col-span-3">
            <Button type="submit" loading={savingPw}>
              {t('Đổi mật khẩu')}
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="font-semibold">{t('Thiết bị đang đăng nhập')}</h2>
          {(sessions.data?.length ?? 0) > 1 && (
            <Button size="sm" variant="outline" icon={<LogOut className="size-4" />} onClick={logoutOthers}>
              {t('Đăng xuất thiết bị khác')}
            </Button>
          )}
        </div>
        {sessions.isPending ? (
          <CenterSpinner />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-5 py-3">
                {/Mobile|Android|iPhone/.test(s.userAgent ?? '') ? <Smartphone className="size-5 text-zinc-400" /> : <Laptop className="size-5 text-zinc-400" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {deviceName(s.userAgent)} {s.current && <Badge tone="green">{t('Thiết bị này')}</Badge>}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {t('IP {ip} · đăng nhập {login} · hết hạn {expires}', { ip: s.ip ?? '?', login: timeAgo(s.createdAt), expires: formatDateTime(s.expiresAt) })}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
