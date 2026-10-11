import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { sha256, toBase64Url } from '../../shared/crypto';
import { normalizeLang, translate, type Lang } from '../../shared/i18n';
import {
  SOCIAL_PROVIDERS,
  type SocialAccountDTO,
  type SocialProvider,
  type SocialShareDTO,
  type SocialStatusDTO,
} from '../../shared/types';
import type { AppContext, AppEnv } from '../env';
import { currentUser, requireAdmin } from '../middleware';
import { audit } from '../lib/audit';
import { badRequest, HttpError, notFound } from '../lib/http';
import { toPost, type PostRow } from '../lib/mappers';
import { getSettings } from '../lib/settings';
import {
  authorizeUrl,
  checkStatus,
  exchangeCode,
  needsRefresh,
  publish,
  refreshTokens,
  SocialError,
  type AppConfig,
  type PublishResult,
  type Tokens,
} from '../lib/social';
import { isHttps, newId } from '../lib/util';
import { readJson } from '../lib/validate';
import { seal, unseal } from '../lib/vault';

const social = new Hono<AppEnv>();
social.use('*', requireAdmin);

const NAMES: Record<SocialProvider, string> = { facebook: 'Facebook', zalo: 'Zalo OA', tiktok: 'TikTok' };
const OAUTH_COOKIE = 'wb_oauth';

interface Account {
  config: AppConfig | null;
  tokens: Tokens | null;
}

async function loadAccount(env: Env, provider: SocialProvider): Promise<Account> {
  const row = await env.DB.prepare('SELECT config, tokens FROM social_accounts WHERE provider = ?')
    .bind(provider)
    .first<{ config: string; tokens: string | null }>();
  return { config: await unseal<AppConfig>(env, row?.config), tokens: await unseal<Tokens>(env, row?.tokens) };
}

async function saveTokens(env: Env, provider: SocialProvider, tokens: Tokens | null) {
  await env.DB.prepare('UPDATE social_accounts SET tokens = ?, updated_at = ? WHERE provider = ?')
    .bind(tokens ? await seal(env, tokens) : null, Date.now(), provider)
    .run();
}

function providerOf(c: AppContext): SocialProvider {
  const p = c.req.param('provider') as SocialProvider;
  if (!SOCIAL_PROVIDERS.includes(p)) throw notFound('Nền tảng không được hỗ trợ.');
  return p;
}

function redirectUri(c: AppContext, provider: SocialProvider): string {
  return new URL(`/api/social/${provider}/callback`, c.req.url).toString();
}

function toAccountDTO(c: AppContext, provider: SocialProvider, acc: Account): SocialAccountDTO {
  return {
    provider,
    appId: acc.config?.appId ?? '',
    configId: acc.config?.configId ?? '',
    hasSecret: !!acc.config?.appSecret,
    connected: !!acc.tokens?.accessToken,
    accountName: acc.tokens?.accountName || null,
    expiresAt: acc.tokens?.expiresAt ?? null,
    refreshExpiresAt: acc.tokens?.refreshExpiresAt ?? null,
    pages: (acc.tokens?.pages ?? []).map(({ id, name }) => ({ id, name })),
    pageId: acc.tokens?.pageId ?? null,
    redirectUri: redirectUri(c, provider),
  };
}

/** Token còn hạn (tự làm mới với Zalo/TikTok và lưu lại cặp token mới). */
async function freshTokens(env: Env, provider: SocialProvider): Promise<Tokens> {
  const { config, tokens } = await loadAccount(env, provider);
  if (!config || !tokens?.accessToken) throw badRequest('Chưa kết nối {name}.', { vars: { name: NAMES[provider] } });
  if (tokens.refreshExpiresAt && tokens.refreshExpiresAt < Date.now()) {
    throw badRequest('Kết nối {name} đã hết hạn, hãy vào mục Mạng xã hội để kết nối lại.', { vars: { name: NAMES[provider] } });
  }
  if (!needsRefresh(provider, tokens)) return tokens;
  const next = await refreshTokens(provider, config, tokens);
  await saveTokens(env, provider, next);
  return next;
}

// ---------- Cấu hình & kết nối ----------

social.get('/', async (c) => {
  const accounts = await Promise.all(SOCIAL_PROVIDERS.map(async (p) => toAccountDTO(c, p, await loadAccount(c.env, p))));
  const status: SocialStatusDTO = { accounts, encrypted: !!c.env.TOKEN_SECRET };
  return c.json(status);
});

social.put('/facebook/page', async (c) => {
  const { pageId } = await readJson(c, z.object({ pageId: z.string().min(1).max(40) }));
  const acc = await loadAccount(c.env, 'facebook');
  if (!acc.tokens?.pages?.some((p) => p.id === pageId)) throw badRequest('Fanpage không thuộc tài khoản đã kết nối.');
  await saveTokens(c.env, 'facebook', { ...acc.tokens, pageId });
  return c.json({ account: toAccountDTO(c, 'facebook', { ...acc, tokens: { ...acc.tokens, pageId } }) });
});

social.put('/:provider', async (c) => {
  const provider = providerOf(c);
  const body = await readJson(
    c,
    z.object({
      appId: z.string().trim().min(1).max(200),
      appSecret: z.string().trim().max(500).optional(),
      configId: z.string().trim().max(100).optional(),
    }),
  );
  const current = await loadAccount(c.env, provider);
  // Secret cũ chỉ được giữ lại khi vẫn là cùng một app; đổi App ID mà dùng secret cũ sẽ bị nền tảng từ chối.
  const sameApp = current.config?.appId === body.appId;
  const appSecret = body.appSecret || (sameApp ? current.config?.appSecret : undefined);
  if (!appSecret) throw badRequest(sameApp ? 'Hãy nhập App Secret / Client Secret.' : 'Đổi App ID thì phải nhập App Secret của app mới.');
  const config: AppConfig = { appId: body.appId, appSecret, ...(provider === 'facebook' && body.configId ? { configId: body.configId } : {}) };
  // Đổi sang app khác => token cũ không còn giá trị.
  const tokens = current.config?.appId === body.appId ? current.tokens : null;
  await c.env.DB.prepare(
    `INSERT INTO social_accounts (provider, config, tokens, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET config = excluded.config, tokens = excluded.tokens, updated_at = excluded.updated_at`,
  )
    .bind(provider, await seal(c.env, config), tokens ? await seal(c.env, tokens) : null, Date.now())
    .run();
  audit(c, 'social.configure', { target: provider });
  return c.json({ account: toAccountDTO(c, provider, { config, tokens }) });
});

social.delete('/:provider', async (c) => {
  const provider = providerOf(c);
  await c.env.DB.prepare('DELETE FROM social_accounts WHERE provider = ?').bind(provider).run();
  audit(c, 'social.disconnect', { target: provider });
  return c.body(null, 204);
});

social.get('/:provider/connect', async (c) => {
  const provider = providerOf(c);
  const { config } = await loadAccount(c.env, provider);
  if (!config) throw badRequest('Hãy lưu App ID và Secret của {name} trước.', { vars: { name: NAMES[provider] } });
  const state = toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = toBase64Url(await sha256(verifier));
  const lang = normalizeLang(c.req.query('lang') ?? c.get('lang'));
  setCookie(c, OAUTH_COOKIE, `${provider}.${state}.${verifier}.${lang}`, {
    httpOnly: true,
    secure: isHttps(c),
    sameSite: 'Lax',
    path: '/api/social',
    maxAge: 600,
  });
  return c.redirect(authorizeUrl(provider, config, redirectUri(c, provider), state, challenge));
});

social.get('/:provider/callback', async (c) => {
  const provider = providerOf(c);
  const back = (params: Record<string, string>) => c.redirect(`/app/social?${new URLSearchParams(params)}`);
  const [cookieProvider, state, verifier, cookieLang] = (getCookie(c, OAUTH_COOKIE) ?? '').split('.');
  const lang = normalizeLang(cookieLang ?? c.get('lang'));
  const name = translate(lang, NAMES[provider]);
  deleteCookie(c, OAUTH_COOKIE, { path: '/api/social', secure: isHttps(c) });

  const denied = c.req.query('error_description') ?? c.req.query('error_reason') ?? c.req.query('error');
  if (denied) return back({ error: `${name}: ${denied}` });
  const code = c.req.query('code');
  if (!code || cookieProvider !== provider || !state || state !== c.req.query('state')) {
    return back({ error: translate(lang, 'Phiên kết nối không hợp lệ hoặc đã quá 10 phút, hãy thử lại.') });
  }
  const { config, tokens: previous } = await loadAccount(c.env, provider);
  if (!config) return back({ error: translate(lang, 'Chưa cấu hình ứng dụng.') });
  try {
    const tokens = await exchangeCode(provider, config, code, redirectUri(c, provider), verifier ?? '');
    // Kết nối lại Facebook: giữ Fanpage đã chọn nếu vẫn còn quyền.
    if (provider === 'facebook' && previous?.pageId && tokens.pages?.some((p) => p.id === previous.pageId)) {
      tokens.pageId = previous.pageId;
    }
    await saveTokens(c.env, provider, tokens);
    audit(c, 'social.connect', { target: provider, detail: { account: tokens.accountName } });
    return back({ connected: provider });
  } catch (err) {
    return back({ error: `${name}: ${errorText(lang, err)}` });
  }
});

// ---------- Đăng bài ----------

interface ShareRow {
  id: string;
  post_id: string;
  provider: SocialProvider;
  status: SocialShareDTO['status'];
  external_id: string | null;
  url: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

const toShare = (r: ShareRow): SocialShareDTO => ({
  id: r.id,
  postId: r.post_id,
  provider: r.provider,
  status: r.status,
  externalId: r.external_id,
  url: r.url,
  error: r.error,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Lỗi của blog (mẫu tiếng Việt) được dịch theo ngôn ngữ người dùng; lỗi gốc của nền tảng giữ nguyên. */
const errorText = (lang: Lang, err: unknown) =>
  (err instanceof SocialError || err instanceof HttpError
    ? translate(lang, err.message, err.vars)
    : err instanceof Error
      ? err.message
      : String(err)
  ).slice(0, 1000);

social.post('/share/:postId', async (c) => {
  const me = currentUser(c);
  const body = await readJson(
    c,
    z.object({
      providers: z.array(z.enum(SOCIAL_PROVIDERS)).min(1).max(3),
      message: z.string().max(5000).optional(),
      tiktokMode: z.enum(['inbox', 'direct']).default('inbox'),
    }),
  );
  const row = await c.env.DB.prepare('SELECT p.*, u.name AS author_name FROM posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.id = ?')
    .bind(c.req.param('postId'))
    .first<PostRow>();
  if (!row) throw notFound('Không tìm thấy bài viết.');
  const post = toPost(row);
  if (post.status !== 'published' || (post.publishedAt ?? 0) > Date.now()) {
    throw badRequest('Hãy xuất bản bài viết trước khi chia sẻ (mạng xã hội cần đọc được trang công khai).');
  }

  const origin = new URL(c.req.url).origin;
  const postUrl = `${origin}${post.type === 'page' ? '/' : '/posts/'}${post.slug}`;
  const contentImages = [...post.contentHtml.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]!);
  const imageUrls = [...new Set([post.coverUrl, ...contentImages].filter(Boolean).map((u) => new URL(u, origin).toString()))];
  const message = body.message?.trim() || [post.title, post.summary].filter(Boolean).join('\n\n');
  const settings = await getSettings(c.env);

  const shares: SocialShareDTO[] = [];
  for (const provider of [...new Set(body.providers)]) {
    let result: PublishResult;
    try {
      const tokens = await freshTokens(c.env, provider);
      result = await publish(provider, tokens, { post, postUrl, message, imageUrls, authorName: settings.authorName, tiktokMode: body.tiktokMode });
    } catch (err) {
      result = { status: 'failed', externalId: null, url: null, error: errorText(c.get('lang'), err) };
    }
    const now = Date.now();
    const share: ShareRow = {
      id: newId(),
      post_id: post.id,
      provider,
      status: result.status,
      external_id: result.externalId,
      url: result.url,
      error: result.error ?? null,
      created_at: now,
      updated_at: now,
    };
    await c.env.DB.prepare(
      `INSERT INTO social_shares (id, post_id, provider, status, external_id, url, error, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(share.id, share.post_id, provider, share.status, share.external_id, share.url, share.error, me.id, now, now)
      .run();
    shares.push(toShare(share));
  }
  audit(c, 'post.share', { target: post.slug, detail: shares.map((s) => `${s.provider}:${s.status}`) });
  return c.json({ shares });
});

social.get('/shares/:postId', async (c) => {
  const db = c.env.DB;
  const { results } = await db
    .prepare('SELECT * FROM social_shares WHERE post_id = ? ORDER BY created_at DESC LIMIT 50')
    .bind(c.req.param('postId'))
    .all<ShareRow>();

  // Cập nhật trạng thái các bài Zalo/TikTok đang xử lý (tối đa 3 lần gọi/lượt xem).
  for (const share of results.filter((s) => s.status === 'processing' && s.external_id).slice(0, 3)) {
    let next: PublishResult;
    try {
      next = await checkStatus(share.provider, await freshTokens(c.env, share.provider), share.external_id!);
    } catch (err) {
      if (Date.now() - share.created_at < 60 * 60_000) continue;
      next = { status: 'failed', externalId: share.external_id, url: null, error: errorText(c.get('lang'), err) };
    }
    if (next.status === share.status && next.externalId === share.external_id) continue;
    Object.assign(share, { status: next.status, external_id: next.externalId, url: next.url ?? share.url, error: next.error ?? null, updated_at: Date.now() });
    await db
      .prepare('UPDATE social_shares SET status = ?, external_id = ?, url = ?, error = ?, updated_at = ? WHERE id = ?')
      .bind(share.status, share.external_id, share.url, share.error, share.updated_at, share.id)
      .run();
  }
  return c.json({ shares: results.map(toShare) });
});

export default social;
