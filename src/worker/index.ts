import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { PublicSiteInfo } from '../shared/settings';
import { runMaintenance } from './cron';
import { normalizeLang, translate } from '../shared/i18n';
import type { AppContext, AppEnv } from './env';
import { HttpError, unauthorized } from './lib/http';
import { getSettings } from './lib/settings';
import { track } from './lib/usage';
import { isHttps } from './lib/util';
import { csrfGuard, loadUser } from './middleware';
import { auditLog, settings, usageRoutes } from './routes/admin';
import auth from './routes/auth';
import drive from './routes/drive';
import notes from './routes/notes';
import posts from './routes/posts';
import social from './routes/social';
import stats from './routes/stats';
import uploads from './routes/uploads';
import users from './routes/users';
import site, { renderNotFound } from './site/routes';

const app = new Hono<AppEnv>();

// Header bảo mật cơ bản cho mọi response do Worker tạo ra + đếm request (file tĩnh không đi qua Worker nên không tính).
app.use('*', async (c, next) => {
  track(c.env, c.executionCtx, 'worker_requests');
  await next();
  const apply = (h: Headers) => {
    if (!h.has('X-Content-Type-Options')) h.set('X-Content-Type-Options', 'nosniff');
    if (!h.has('Referrer-Policy')) h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!h.has('X-Frame-Options')) h.set('X-Frame-Options', 'SAMEORIGIN');
    if (isHttps(c)) h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  };
  try {
    apply(c.res.headers);
  } catch {
    // Response lấy từ cache/assets có header bất biến -> tạo bản sao có thể sửa.
    c.res = new Response(c.res.body, c.res);
    apply(c.res.headers);
  }
});

// ---------- API ----------

const PUBLIC_API = new Set(['/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/site']);

const api = new Hono<AppEnv>();
// Ngôn ngữ thông báo: dashboard gửi X-Lang; client khác dùng Accept-Language.
api.use('*', async (c, next) => {
  c.set('lang', normalizeLang(c.req.header('x-lang') ?? c.req.header('accept-language')));
  await next();
});
api.use('*', csrfGuard, loadUser);
api.use('*', async (c, next) => {
  if (!PUBLIC_API.has(c.req.path) && !c.get('user')) throw unauthorized();
  await next();
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
});

api.get('/site', async (c) => {
  const s = await getSettings(c.env);
  const info: PublicSiteInfo = { siteTitle: s.siteTitle, accentColor: s.accentColor };
  return c.json(info);
});
api.route('/auth', auth);
api.route('/users', users);
api.route('/notes', notes);
api.route('/uploads', uploads);
api.route('/posts', posts);
api.route('/settings', settings);
api.route('/audit', auditLog);
api.route('/stats', stats);
api.route('/social', social);
api.route('/usage', usageRoutes);
api.route('/', drive); // /drive, /folders/*, /files/*

app.route('/api', api);

// ---------- Dashboard (React SPA) ----------
// /app/ và /app/assets/* được phục vụ thẳng từ static assets; Worker chỉ nhận deep link như /app/notes/123.

app.get('/app', (c) => c.redirect('/app/', 301));
app.get('/app/*', async (c) => {
  const url = new URL(c.req.url);
  if (/\.[a-z0-9]{1,8}$/i.test(url.pathname)) return c.text('Not found', 404);
  const res = await c.env.ASSETS.fetch(new URL('/app/', url).toString());
  return new Response(res.body, res);
});

// ---------- Blog công khai (SSR) ----------

app.route('/', site);

const requestLang = (c: AppContext) => c.get('lang') ?? normalizeLang(c.req.header('x-lang') ?? c.req.header('accept-language'));

app.notFound((c) =>
  c.req.path.startsWith('/api/')
    ? c.json({ error: { code: 'not_found', message: translate(requestLang(c), 'API không tồn tại.') } }, 404)
    : renderNotFound(c),
);

app.onError((err, c) => {
  const lang = requestLang(c);
  if (err instanceof HttpError) {
    return c.json({ error: { code: err.code, message: translate(lang, err.message, err.vars), details: err.details } }, err.status);
  }
  if (err instanceof HTTPException) return err.getResponse();
  console.error('Unhandled error', c.req.method, c.req.path, err);
  return c.json({ error: { code: 'internal', message: translate(lang, 'Lỗi máy chủ, vui lòng thử lại sau.') } }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
