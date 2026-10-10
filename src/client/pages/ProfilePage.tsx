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

function deviceName(ua: string | null): string {
  if (!ua) return 'Thiết bị không xác định';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Trình duyệt';
  return [browser, os].filter(Boolean).join(' · ');
}

export default function ProfilePage() {
  usePageTitle('Hồ sơ');
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
      toast.success('Đã cập nhật tên');
    } catch (err) {
      toast.error(err);
    } finally {
      setSavingName(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwError('');
    if (pw.next.length < MIN_PASSWORD_LENGTH) return setPwError(`Mật khẩu mới cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`);
    if (pw.next !== pw.confirm) return setPwError('Hai lần nhập mật khẩu mới không khớp.');
    setSavingPw(true);
    try {
      const [currentKey, newKey] = await Promise.all([derivePasswordKey(user.email, pw.current), derivePasswordKey(user.email, pw.next)]);
      await apiPost('/auth/password', { currentKey, newKey });
      setPw({ current: '', next: '', confirm: '' });
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      toast.success('Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.');
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
      toast.success('Đã đăng xuất các thiết bị khác');
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Hồ sơ của tôi" description={`${user.email} · ${user.role === 'admin' ? 'Admin' : 'User'} · Đã dùng ${formatBytes(user.storageUsed)} / ${formatBytes(user.storageQuota)}`} />

      <Card className="p-5">
        <form onSubmit={saveName} className="flex flex-wrap items-end gap-3">
          <Field label="Tên hiển thị" className="min-w-60 flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </Field>
          <Button type="submit" loading={savingName} disabled={name.trim() === user.name}>
            Lưu
          </Button>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-semibold">Đổi mật khẩu</h2>
        <form onSubmit={changePassword} className="grid gap-4 sm:grid-cols-3">
          <Field label="Mật khẩu hiện tại">
            <Input type="password" autoComplete="current-password" required value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          </Field>
          <Field label="Mật khẩu mới">
            <Input type="password" autoComplete="new-password" required value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </Field>
          <Field label="Nhập lại mật khẩu mới">
            <Input type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
          {pwError && <p className="text-sm text-red-600 sm:col-span-3">{pwError}</p>}
          <div className="sm:col-span-3">
            <Button type="submit" loading={savingPw}>
              Đổi mật khẩu
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="font-semibold">Thiết bị đang đăng nhập</h2>
          {(sessions.data?.length ?? 0) > 1 && (
            <Button size="sm" variant="outline" icon={<LogOut className="size-4" />} onClick={logoutOthers}>
              Đăng xuất thiết bị khác
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
                    {deviceName(s.userAgent)} {s.current && <Badge tone="green">Thiết bị này</Badge>}
                  </p>
                  <p className="text-xs text-zinc-500">
                    IP {s.ip ?? '?'} · đăng nhập {timeAgo(s.createdAt)} · hết hạn {formatDateTime(s.expiresAt)}
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
