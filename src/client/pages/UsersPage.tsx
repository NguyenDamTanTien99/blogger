import { useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Trash2, UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { MB, MIN_PASSWORD_LENGTH, type Role } from '../../shared/constants';
import { derivePasswordKey, normalizeEmail } from '../../shared/crypto';
import type { AdminUserDTO } from '../../shared/types';
import { Menu } from '../components/Menu';
import { Modal, useConfirm } from '../components/Modal';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, CenterSpinner, EmptyState, Field, Input, PageHeader, ProgressBar, Select } from '../components/ui';
import { apiDelete, apiPatch, apiPost, errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatBytes, timeAgo } from '../lib/format';
import { usePageTitle, useUsers } from '../lib/hooks';

type Editing = { mode: 'create' } | { mode: 'edit'; user: AdminUserDTO };

export default function UsersPage() {
  usePageTitle('Người dùng');
  const { user: me } = useAuth();
  const { data, isPending } = useUsers(true);
  const [editing, setEditing] = useState<Editing | null>(null);
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['users'] });
    void qc.invalidateQueries({ queryKey: ['stats'] });
  };

  const toggleStatus = async (u: AdminUserDTO) => {
    const disabling = u.status === 'active';
    if (disabling && !(await confirm({ title: `Khóa tài khoản ${u.name}?`, message: 'Người này sẽ bị đăng xuất ngay và không thể đăng nhập cho tới khi được mở khóa.', confirmText: 'Khóa', danger: true }))) return;
    try {
      await apiPatch(`/users/${u.id}`, { status: disabling ? 'disabled' : 'active' });
      toast.success(disabling ? 'Đã khóa tài khoản' : 'Đã mở khóa tài khoản');
      refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  const remove = async (u: AdminUserDTO) => {
    const ok = await confirm({
      title: `Xóa vĩnh viễn ${u.name}?`,
      message: (
        <>
          Toàn bộ <b>{u.notes} ghi chú</b> và <b>{u.files} tệp ({formatBytes(u.storageUsed)})</b> của {u.email} sẽ bị xóa và không thể khôi phục.
        </>
      ),
      confirmText: 'Xóa vĩnh viễn',
      danger: true,
    });
    if (!ok) return;
    try {
      await apiDelete(`/users/${u.id}`);
      toast.success('Đã xóa người dùng');
      refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader
        title="Người dùng"
        description="Admin quản lý toàn bộ người dùng, ghi chú và tệp. User chỉ thấy dữ liệu của chính mình."
        actions={
          <Button icon={<UserPlus className="size-4" />} onClick={() => setEditing({ mode: 'create' })}>
            Thêm người dùng
          </Button>
        }
      />
      <Card className="overflow-x-auto">
        {isPending ? (
          <CenterSpinner />
        ) : !data?.length ? (
          <EmptyState icon={<Users className="size-5" />} title="Chưa có người dùng" />
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="px-4 py-2.5 font-medium">Người dùng</th>
                <th className="px-4 py-2.5 font-medium">Vai trò</th>
                <th className="px-4 py-2.5 font-medium">Dung lượng</th>
                <th className="px-4 py-2.5 font-medium">Dữ liệu</th>
                <th className="px-4 py-2.5 font-medium">Đăng nhập</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.map((u) => {
                const usage = u.storageQuota ? u.storageUsed / u.storageQuota : 0;
                return (
                  <tr key={u.id} className={u.status === 'disabled' ? 'opacity-60' : undefined}>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {u.name} {u.id === me?.id && <span className="text-xs text-zinc-400">(bạn)</span>}
                      </p>
                      <p className="text-xs text-zinc-500">{u.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={u.role === 'admin' ? 'brand' : 'gray'}>{u.role === 'admin' ? 'Admin' : 'User'}</Badge>
                        {u.status === 'disabled' && <Badge tone="red">Đã khóa</Badge>}
                      </div>
                    </td>
                    <td className="w-48 px-4 py-3">
                      <ProgressBar value={usage} tone={usage > 0.9 ? 'red' : 'brand'} />
                      <p className="mt-1 text-xs text-zinc-500">
                        {formatBytes(u.storageUsed)} / {formatBytes(u.storageQuota)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">
                      {u.notes} ghi chú · {u.files} tệp
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-500">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'Chưa đăng nhập'}</td>
                    <td className="px-2">
                      <Menu
                        items={[
                          { label: 'Chỉnh sửa / đặt lại mật khẩu', icon: <Pencil />, onSelect: () => setEditing({ mode: 'edit', user: u }) },
                          {
                            label: u.status === 'active' ? 'Khóa tài khoản' : 'Mở khóa',
                            icon: <KeyRound />,
                            onSelect: () => toggleStatus(u),
                            hidden: u.id === me?.id,
                          },
                          { label: 'Xóa vĩnh viễn', icon: <Trash2 />, onSelect: () => remove(u), danger: true, hidden: u.id === me?.id },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      {editing && <UserDialog editing={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </>
  );
}

function UserDialog({ editing, onClose, onSaved }: { editing: Editing; onClose: () => void; onSaved: () => void }) {
  const existing = editing.mode === 'edit' ? editing.user : null;
  const toast = useToast();
  const [email, setEmail] = useState(existing?.email ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [role, setRole] = useState<Role>(existing?.role ?? 'user');
  const [quotaMB, setQuotaMB] = useState(existing ? Math.round(existing.storageQuota / MB) : 1024);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const emailChanged = !!existing && normalizeEmail(email) !== existing.email;
  const needPassword = !existing || emailChanged;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if ((needPassword || password) && password.length < MIN_PASSWORD_LENGTH) {
      setError(emailChanged ? `Đổi email cần đặt mật khẩu mới (>= ${MIN_PASSWORD_LENGTH} ký tự).` : `Mật khẩu cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`);
      return;
    }
    if (password !== password2) {
      setError('Hai lần nhập mật khẩu không khớp.');
      return;
    }
    setBusy(true);
    try {
      // Khóa mật khẩu được dẫn xuất theo email của chính người dùng đó.
      const key = password ? await derivePasswordKey(email, password) : undefined;
      if (existing) {
        await apiPatch(`/users/${existing.id}`, {
          name,
          role,
          storageQuotaMB: quotaMB,
          ...(emailChanged ? { email } : {}),
          ...(key ? { key } : {}),
        });
        toast.success('Đã cập nhật người dùng');
      } else {
        await apiPost('/users', { email, name, role, key, storageQuotaMB: quotaMB });
        toast.success('Đã tạo người dùng');
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? `Chỉnh sửa ${existing.name}` : 'Thêm người dùng'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" form="user-form" loading={busy}>
            {existing ? 'Lưu thay đổi' : 'Tạo người dùng'}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Họ tên">
            <Input required value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Email đăng nhập">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Vai trò">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="user">User — ghi chú & tệp của riêng mình</option>
              <option value="admin">Admin — quản lý mọi thứ</option>
            </Select>
          </Field>
          <Field label="Hạn mức lưu trữ (MB)" hint={formatBytes(quotaMB * MB)}>
            <Input type="number" min={0} step={256} value={quotaMB} onChange={(e) => setQuotaMB(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
        </div>
        <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="mb-3 text-sm font-medium">
            {existing ? (emailChanged ? 'Mật khẩu mới (bắt buộc khi đổi email)' : 'Đặt lại mật khẩu (để trống nếu không đổi)') : 'Mật khẩu'}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input type="password" autoComplete="new-password" placeholder="Mật khẩu" value={password} onChange={(e) => setPassword(e.target.value)} required={needPassword} />
            <Input type="password" autoComplete="new-password" placeholder="Nhập lại" value={password2} onChange={(e) => setPassword2(e.target.value)} required={needPassword} />
          </div>
          {existing && password && <p className="mt-2 text-xs text-zinc-500">Người dùng sẽ bị đăng xuất khỏi mọi thiết bị.</p>}
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>}
      </form>
    </Modal>
  );
}
