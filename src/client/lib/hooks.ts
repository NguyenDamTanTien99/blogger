import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import type { AdminUserDTO } from '../../shared/types';
import { apiGet } from './api';

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
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
    document.title = `${title} · Quản trị`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
