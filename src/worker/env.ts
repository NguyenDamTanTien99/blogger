import type { Context } from 'hono';
import type { Role } from '../shared/constants';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  storageQuota: number;
  storageUsed: number;
  sessionId: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser | null };
};

export type AppContext = Context<AppEnv>;
