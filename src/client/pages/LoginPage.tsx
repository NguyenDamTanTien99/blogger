import { LockKeyhole } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useSiteInfo } from '../components/AppLayout';
import { Button, CenterSpinner, Field, Input } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useAuth } from '../lib/auth';

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const { data: site } = useSiteInfo();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (isLoading) return <CenterSpinner />;
  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-full place-items-center bg-gradient-to-br from-zinc-100 to-zinc-200 px-4 py-12 dark:from-zinc-950 dark:to-zinc-900">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-brand text-white shadow-lg">
            <LockKeyhole className="size-6" />
          </div>
          <h1 className="text-xl font-bold">{site?.siteTitle ?? 'Đăng nhập'}</h1>
          <p className="mt-1 text-sm text-zinc-500">Đăng nhập để quản lý ghi chú, tệp tin và bài viết</p>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <Field label="Email">
            <Input type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Mật khẩu">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{error}</p>}
          <Button type="submit" loading={busy} className="w-full">
            {busy ? 'Đang xác thực…' : 'Đăng nhập'}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm">
          <a href="/" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            ← Về trang blog
          </a>
        </p>
      </div>
    </div>
  );
}
