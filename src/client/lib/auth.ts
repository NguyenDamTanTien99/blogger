import { useQuery, useQueryClient } from '@tanstack/react-query';
import { derivePasswordKey } from '../../shared/crypto';
import type { UserDTO } from '../../shared/types';
import { ApiError, apiGet, apiPost } from './api';

export const ME_KEY = ['me'] as const;

export function useAuth() {
  const qc = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return (await apiGet<{ user: UserDTO | null }>('/auth/me')).user;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
  });
  const user = data ?? null;
  return {
    user,
    isLoading: isPending,
    isAdmin: user?.role === 'admin',
    setUser: (u: UserDTO | null) => qc.setQueryData(ME_KEY, u),
    async login(email: string, password: string) {
      // Băm mật khẩu ngay trên trình duyệt; server chỉ nhận khóa dẫn xuất (xem src/shared/crypto.ts).
      const key = await derivePasswordKey(email, password);
      const { user: u } = await apiPost<{ user: UserDTO }>('/auth/login', { email, key });
      qc.clear();
      qc.setQueryData(ME_KEY, u);
      return u;
    },
    async logout() {
      try {
        await apiPost('/auth/logout');
      } finally {
        qc.clear();
        qc.setQueryData(ME_KEY, null);
      }
    },
  };
}
