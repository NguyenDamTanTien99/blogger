import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { ConfirmProvider } from './components/Modal';
import { ToastProvider } from './components/Toast';
import { CenterSpinner, EmptyState } from './components/ui';
import { ApiError, onUnauthorized } from './lib/api';
import { ME_KEY, useAuth } from './lib/auth';
import { uploads } from './lib/upload';
import LoginPage from './pages/LoginPage';
import { LangProvider, t } from './lib/i18n';
import './styles.css';

// Mỗi trang là một chunk riêng => tải lần đầu nhẹ, admin mới tải phần quản trị.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const NotesPage = lazy(() => import('./pages/NotesPage'));
const FilesPage = lazy(() => import('./pages/FilesPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const PostsPage = lazy(() => import('./pages/PostsPage'));
const PostEditorPage = lazy(() => import('./pages/PostEditorPage'));
const UsersPage = lazy(() => import('./pages/UsersPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const AuditPage = lazy(() => import('./pages/AuditPage'));
const SocialPage = lazy(() => import('./pages/SocialPage'));
const UsagePage = lazy(() => import('./pages/UsagePage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

onUnauthorized(() => queryClient.setQueryData(ME_KEY, null));
uploads.onFileUploaded = () => {
  for (const key of ['drive', 'files', 'me', 'stats']) void queryClient.invalidateQueries({ queryKey: [key] });
};

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <CenterSpinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return children;
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <EmptyState title={t('Không có quyền truy cập')} description={t('Trang này chỉ dành cho admin.')} />;
  return children;
}

function NotFoundView() {
  return <EmptyState title={t('Không tìm thấy trang')} description={t('Đường dẫn không tồn tại trong trang quản trị.')} />;
}

const router = createBrowserRouter(
  [
    { path: '/login', element: <LoginPage /> },
    {
      path: '/',
      element: (
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      ),
      children: [
        { index: true, element: <DashboardPage /> },
        { path: 'notes', element: <NotesPage /> },
        { path: 'notes/:id', element: <NotesPage /> },
        { path: 'files', element: <FilesPage /> },
        { path: 'profile', element: <ProfilePage /> },
        { path: 'posts', element: <AdminOnly><PostsPage /></AdminOnly> },
        { path: 'posts/:id', element: <AdminOnly><PostEditorPage /></AdminOnly> },
        { path: 'users', element: <AdminOnly><UsersPage /></AdminOnly> },
        { path: 'settings', element: <AdminOnly><SettingsPage /></AdminOnly> },
        { path: 'audit', element: <AdminOnly><AuditPage /></AdminOnly> },
        { path: 'social', element: <AdminOnly><SocialPage /></AdminOnly> },
        { path: 'usage', element: <AdminOnly><UsagePage /></AdminOnly> },
        { path: '*', element: <NotFoundView /> },
      ],
    },
  ],
  { basename: '/app' },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LangProvider>
        <ToastProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
          </ConfirmProvider>
        </ToastProvider>
      </LangProvider>
    </QueryClientProvider>
  </StrictMode>,
);
