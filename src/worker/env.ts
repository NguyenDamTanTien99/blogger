import type { Context } from 'hono';
import type { Role } from '../shared/constants';
import type { Lang } from '../shared/i18n';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  storageQuota: number;
  storageUsed: number;
  sessionId: string;
}

declare global {
  interface Env {
    /** Secret (wrangler secret put TOKEN_SECRET) để mã hóa token mạng xã hội trong D1. Tùy chọn nhưng nên đặt. */
    TOKEN_SECRET?: string;
  }
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser | null; lang: Lang };
};

export type AppContext = Context<AppEnv>;
