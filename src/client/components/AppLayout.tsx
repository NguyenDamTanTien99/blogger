import { useQuery } from '@tanstack/react-query';
import {
  ExternalLink,
  HardDrive,
  History,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Newspaper,
  NotebookPen,
  Settings,
  Sun,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { Suspense, useEffect, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import type { PublicSiteInfo } from '../../shared/settings';
import { apiGet } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn, formatBytes } from '../lib/format';
import { setBrandColor, useTheme, type ThemeMode } from '../lib/theme';
import { uploads } from '../lib/upload';
import { UploadPanel } from './UploadPanel';
import { Badge, CenterSpinner, ProgressBar } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  end?: boolean;
}

const MAIN_NAV: NavItem[] = [
  { to: '/', label: 'Tổng quan', icon: LayoutDashboard, end: true },
  { to: '/notes', label: 'Ghi chú', icon: NotebookPen },
  { to: '/files', label: 'Tệp tin', icon: HardDrive },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/posts', label: 'Bài viết', icon: Newspaper },
  { to: '/users', label: 'Người dùng', icon: Users },
  { to: '/settings', label: 'Cài đặt blog', icon: Settings },
  { to: '/audit', label: 'Nhật ký', icon: History },
];

export function useSiteInfo() {
  return useQuery({ queryKey: ['site'], queryFn: () => apiGet<PublicSiteInfo>('/site'), staleTime: 5 * 60_000 });
}

function NavGroup({ title, items }: { title?: string; items: NavItem[] }) {
  return (
    <div className="space-y-0.5">
      {title && <p className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">{title}</p>}
      {items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
              isActive
                ? 'bg-brand/10 text-brand'
                : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100',
            )
          }
        >
          <Icon className="size-[18px]" />
          {label}
        </NavLink>
      ))}
    </div>
  );
}

const THEMES: { mode: ThemeMode; icon: typeof Sun; label: string }[] = [
  { mode: 'light', icon: Sun, label: 'Sáng' },
  { mode: 'dark', icon: Moon, label: 'Tối' },
  { mode: 'auto', icon: Monitor, label: 'Theo hệ thống' },
];

interface SidebarProps {
  theme: ThemeMode;
  onTheme: (mode: ThemeMode) => void;
  onNavigate?: () => void;
}

function Sidebar({ theme, onTheme, onNavigate }: SidebarProps) {
  const { user, isAdmin, logout } = useAuth();
  const { data: site } = useSiteInfo();
  const navigate = useNavigate();
  if (!user) return null;
  const usage = user.storageQuota ? user.storageUsed / user.storageQuota : 0;

  return (
    <div className="flex h-full flex-col gap-2 p-3" onClick={(e) => (e.target as HTMLElement).closest('a') && onNavigate?.()}>
      <div className="flex items-center gap-2 px-2 py-2">
        <div className="grid size-8 place-items-center rounded-lg bg-brand text-sm font-bold text-white">
          {(site?.siteTitle ?? 'B').charAt(0).toUpperCase()}
        </div>
        <span className="min-w-0 flex-1 truncate font-semibold">{site?.siteTitle ?? 'Blog'}</span>
        <a href="/" target="_blank" rel="noreferrer" title="Xem blog" className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
          <ExternalLink className="size-4" />
        </a>
      </div>

      <nav className="flex-1 overflow-y-auto">
        <NavGroup items={MAIN_NAV} />
        {isAdmin && <NavGroup title="Quản trị" items={ADMIN_NAV} />}
      </nav>

      <div className="space-y-1.5 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
        <div className="flex justify-between text-xs text-zinc-500">
          <span>Dung lượng</span>
          <span>
            {formatBytes(user.storageUsed)} / {formatBytes(user.storageQuota)}
          </span>
        </div>
        <ProgressBar value={usage} tone={usage > 0.9 ? 'red' : usage > 0.75 ? 'amber' : 'brand'} />
      </div>

      <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
        {THEMES.map(({ mode: m, icon: Icon, label }) => (
          <button
            key={m}
            type="button"
            title={label}
            onClick={() => onTheme(m)}
            className={cn(
              'grid flex-1 place-items-center rounded-md py-1.5',
              theme === m ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100' : 'text-zinc-500',
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded-lg px-1 py-1">
        <NavLink to="/profile" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200">
            <UserRound className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <Badge tone={isAdmin ? 'brand' : 'gray'}>{isAdmin ? 'Admin' : 'User'}</Badge>
          </div>
        </NavLink>
        <button
          type="button"
          title="Đăng xuất"
          aria-label="Đăng xuất"
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
          className="grid size-9 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </div>
  );
}

export function AppLayout() {
  const { data: site } = useSiteInfo();
  const { mode, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (site) setBrandColor(site.accentColor);
  }, [site]);
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (uploads.hasActive()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r border-zinc-200 bg-white lg:block dark:border-zinc-800 dark:bg-zinc-900">
        <Sidebar theme={mode} onTheme={setMode} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-white shadow-xl dark:bg-zinc-900">
            <button type="button" aria-label="Đóng menu" onClick={() => setOpen(false)} className="absolute top-4 right-3 text-zinc-500">
              <X className="size-5" />
            </button>
            <Sidebar theme={mode} onTheme={setMode} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-zinc-200 bg-white px-4 lg:hidden dark:border-zinc-800 dark:bg-zinc-900">
          <button type="button" aria-label="Mở menu" onClick={() => setOpen(true)} className="-ml-1 text-zinc-600 dark:text-zinc-300">
            <MenuIcon className="size-5" />
          </button>
          <span className="truncate font-semibold">{site?.siteTitle ?? 'Blog'}</span>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <Suspense fallback={<CenterSpinner />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      <UploadPanel />
    </div>
  );
}
