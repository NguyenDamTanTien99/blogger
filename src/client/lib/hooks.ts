import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AdminUserDTO } from '../../shared/types';
import { apiGet } from './api';
import { t } from './i18n';

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Danh sách user cho bộ lọc "của ai" (chỉ admin gọi được). */
export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: ['users'],
    queryFn: async () => (await apiGet<{ items: AdminUserDTO[] }>('/users')).items,
    enabled,
    staleTime: 60_000,
  });
}

export function usePageTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = t('{title} · Quản trị', { title });
    return () => {
      document.title = previous;
    };
  }, [title]);
}
