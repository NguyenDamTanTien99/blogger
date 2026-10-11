import type { Vars } from '../../shared/i18n';
import type { PostDTO, ShareStatus, SocialProvider } from '../../shared/types';

// Tài liệu: Facebook Pages API (Graph v25.0), Zalo OA Open API (OAuth v4, Article v2.0),
// TikTok Content Posting API (photo post). Đổi phiên bản Graph API tại đây khi Facebook ngừng hỗ trợ v25.
const FB_VERSION = 'v25.0';
const FB_GRAPH = `https://graph.facebook.com/${FB_VERSION}`;
const ZALO_OAUTH = 'https://oauth.zaloapp.com/v4/oa';
const ZALO_API = 'https://openapi.zalo.me/v2.0';
const TIKTOK_API = 'https://open.tiktokapis.com/v2';
const FB_SCOPES = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management'];

export interface AppConfig {
  appId: string;
  appSecret: string;
  /** Facebook Login for Business: dùng config_id thay cho scope. */
  configId?: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
  accountName?: string;
  /** Facebook: token của từng Fanpage (không hết hạn khi lấy từ user token dài hạn). */
  pages?: { id: string; name: string; accessToken: string }[];
  pageId?: string;
}

export interface PublishInput {
  post: PostDTO;
  postUrl: string;
  message: string;
  imageUrls: string[];
  authorName: string;
  tiktokMode: 'inbox' | 'direct';
}

export interface PublishResult {
  status: ShareStatus;
  externalId: string | null;
  url: string | null;
  error?: string | null;
}

/** Lỗi do nền tảng trả về — thông điệp được hiển thị nguyên cho admin. */
export class SocialError extends Error {
  constructor(
    message: string,
    public vars?: Vars,
  ) {
    super(message);
  }
}

type Json = Record<string, any>;

/** Đọc JSON và chuẩn hóa 3 kiểu báo lỗi khác nhau của Facebook / Zalo / TikTok. */
async function parse(res: Response): Promise<Json> {
  const text = await res.text();
  let data: Json;
  try {
    data = JSON.parse(text) as Json;
  } catch {
    throw new SocialError('Phản hồi không hợp lệ ({status}): {body}', { status: res.status, body: text.slice(0, 200) });
  }
  const err = data.error;
  // Facebook: { error: { message, code } }; TikTok: { error: { code: 'ok' | '...', message } }
  if (err && typeof err === 'object' && err.code !== 'ok' && (err.message || err.code)) {
    throw new SocialError(String(err.message || err.code));
  }
  if (typeof err === 'number' && err !== 0) {
    throw new SocialError(String(data.message || data.error_description || data.error_name || `Mã lỗi ${err}`));
  }
  if (typeof err === 'string') throw new SocialError(String(data.error_description || err));
  if (!res.ok) throw new SocialError('Lỗi HTTP {status}', { status: res.status });
  return data;
}

const form = (fields: Record<string, string>) => new URLSearchParams(fields);
const expiry = (seconds: unknown) => (Number(seconds) > 0 ? Date.now() + Number(seconds) * 1000 : undefined);

// ---------- OAuth ----------

export function authorizeUrl(
  provider: SocialProvider,
  config: AppConfig,
  redirectUri: string,
  state: string,
  codeChallenge: string,
): string {
  const url =
    provider === 'facebook'
      ? new URL(`https://www.facebook.com/${FB_VERSION}/dialog/oauth`)
      : provider === 'zalo'
        ? new URL(`${ZALO_OAUTH}/permission`)
        : new URL('https://www.tiktok.com/v2/auth/authorize/');
  const p = url.searchParams;
  p.set('redirect_uri', redirectUri);
  p.set('state', state);
  if (provider === 'facebook') {
    p.set('client_id', config.appId);
    p.set('response_type', 'code');
    if (config.configId) {
      // App loại Business dùng "Facebook Login for Business": quyền được khai báo trong Configuration.
      p.set('config_id', config.configId);
      p.set('override_default_response_type', 'true');
    } else {
      // business_management: cần để thấy Fanpage do Meta Business Suite / Business portfolio quản lý.
      p.set('scope', FB_SCOPES.join(','));
    }
    // Hỏi lại các quyền từng bị bỏ chọn (Facebook mặc định nhớ lựa chọn cũ).
    p.set('auth_type', 'rerequest');
  } else if (provider === 'zalo') {
    p.set('app_id', config.appId);
    p.set('code_challenge', codeChallenge);
  } else {
    p.set('client_key', config.appId);
    p.set('response_type', 'code');
    p.set('scope', 'user.info.basic,video.upload,video.publish');
  }
  return url.toString();
}

export async function exchangeCode(
  provider: SocialProvider,
  config: AppConfig,
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<Tokens> {
  if (provider === 'facebook') {
    const q = (params: Record<string, string>) => `${FB_GRAPH}/oauth/access_token?${form({ client_id: config.appId, client_secret: config.appSecret, ...params })}`;
    const short = await parse(await fetch(q({ redirect_uri: redirectUri, code })));
    const long = await parse(await fetch(q({ grant_type: 'fb_exchange_token', fb_exchange_token: String(short.access_token) })));
    const userToken = String(long.access_token);
    const [me, accounts] = await Promise.all([
      parse(await fetch(`${FB_GRAPH}/me?${form({ fields: 'name', access_token: userToken })}`)),
      parse(await fetch(`${FB_GRAPH}/me/accounts?${form({ fields: 'id,name,access_token', limit: '100', access_token: userToken })}`)),
    ]);
    const pages = ((accounts.data ?? []) as Json[]).map((p) => ({ id: String(p.id), name: String(p.name), accessToken: String(p.access_token) }));
    if (!pages.length) pages.push(...(await businessPages(userToken)));
    if (!pages.length) throw await explainNoPages(userToken);
    return { accessToken: userToken, expiresAt: expiry(long.expires_in), accountName: String(me.name ?? ''), pages, pageId: pages[0]!.id };
  }

  if (provider === 'zalo') {
    const data = await parse(
      await fetch(`${ZALO_OAUTH}/access_token`, {
        method: 'POST',
        headers: { secret_key: config.appSecret, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ app_id: config.appId, code, grant_type: 'authorization_code', code_verifier: codeVerifier }),
      }),
    );
    const tokens: Tokens = { accessToken: String(data.access_token), refreshToken: String(data.refresh_token), expiresAt: expiry(data.expires_in) };
    try {
      const oa = await parse(await fetch(`${ZALO_API}/oa/getoa`, { headers: { access_token: tokens.accessToken } }));
      tokens.accountName = String(oa.data?.name ?? '');
    } catch {
      /* tên OA chỉ để hiển thị */
    }
    return tokens;
  }

  const data = await parse(
    await fetch(`${TIKTOK_API}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_key: config.appId, client_secret: config.appSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
    }),
  );
  const tokens: Tokens = {
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token),
    expiresAt: expiry(data.expires_in),
    refreshExpiresAt: expiry(data.refresh_expires_in),
  };
  try {
    const info = await parse(
      await fetch(`${TIKTOK_API}/user/info/?fields=display_name`, { headers: { Authorization: `Bearer ${tokens.accessToken}` } }),
    );
    tokens.accountName = String(info.data?.user?.display_name ?? '');
  } catch {
    /* tên tài khoản chỉ để hiển thị */
  }
  return tokens;
}

/** Fanpage thuộc Business portfolio không nằm trong /me/accounts: lấy qua danh sách doanh nghiệp của user. */
async function businessPages(userToken: string): Promise<{ id: string; name: string; accessToken: string }[]> {
  try {
    const businesses = await parse(await fetch(`${FB_GRAPH}/me/businesses?${form({ fields: 'id', limit: '25', access_token: userToken })}`));
    const found = new Map<string, { id: string; name: string; accessToken: string }>();
    for (const b of ((businesses.data ?? []) as Json[]).slice(0, 10)) {
      for (const edge of ['owned_pages', 'client_pages']) {
        const res = await parse(
          await fetch(`${FB_GRAPH}/${b.id}/${edge}?${form({ fields: 'id,name,access_token', limit: '100', access_token: userToken })}`),
        ).catch(() => ({ data: [] }) as Json);
        for (const p of (res.data ?? []) as Json[]) {
          if (p.access_token) found.set(String(p.id), { id: String(p.id), name: String(p.name), accessToken: String(p.access_token) });
        }
      }
    }
    return [...found.values()];
  } catch {
    return [];
  }
}

/** Thông báo cụ thể: quyền nào bị từ chối, hay tài khoản thật sự không quản trị Fanpage nào. */
async function explainNoPages(userToken: string): Promise<SocialError> {
  try {
    const perms = await parse(await fetch(`${FB_GRAPH}/me/permissions?${form({ access_token: userToken })}`));
    const granted = new Set(((perms.data ?? []) as Json[]).filter((p) => p.status === 'granted').map((p) => String(p.permission)));
    const missing = FB_SCOPES.filter((s) => !granted.has(s));
    if (missing.length) {
      return new SocialError(
        'Chưa được cấp quyền: {perms}. Bấm Kết nối lại và đồng ý tất cả quyền (nếu quyền không hiện, kiểm tra nó đã được thêm vào use case "Manage everything on your Page").',
        { perms: missing.join(', ') },
      );
    }
  } catch {
    /* bỏ qua, dùng thông báo chung */
  }
  return new SocialError(
    'Facebook không trả về Fanpage nào. Bấm Kết nối lại, ở hộp thoại chọn "Chỉnh sửa quyền truy cập" và tick Fanpage cần đăng; đảm bảo tài khoản là quản trị viên (toàn quyền) của Fanpage.',
  );
}

/** Zalo (access token ~25 giờ) và TikTok (24 giờ) cần làm mới; token Fanpage không hết hạn. */
export function needsRefresh(provider: SocialProvider, tokens: Tokens): boolean {
  return provider !== 'facebook' && !!tokens.refreshToken && (tokens.expiresAt ?? 0) - Date.now() < 5 * 60_000;
}

export async function refreshTokens(provider: SocialProvider, config: AppConfig, tokens: Tokens): Promise<Tokens> {
  if (provider === 'zalo') {
    const data = await parse(
      await fetch(`${ZALO_OAUTH}/access_token`, {
        method: 'POST',
        headers: { secret_key: config.appSecret, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ app_id: config.appId, refresh_token: tokens.refreshToken ?? '', grant_type: 'refresh_token' }),
      }),
    );
    // Refresh token của Zalo chỉ dùng được 1 lần => luôn lưu cặp token mới.
    return { ...tokens, accessToken: String(data.access_token), refreshToken: String(data.refresh_token), expiresAt: expiry(data.expires_in) };
  }
  if (provider === 'tiktok') {
    const data = await parse(
      await fetch(`${TIKTOK_API}/oauth/token/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ client_key: config.appId, client_secret: config.appSecret, refresh_token: tokens.refreshToken ?? '', grant_type: 'refresh_token' }),
      }),
    );
    return {
      ...tokens,
      accessToken: String(data.access_token),
      refreshToken: String(data.refresh_token),
      expiresAt: expiry(data.expires_in),
      refreshExpiresAt: expiry(data.refresh_expires_in),
    };
  }
  return tokens;
}

// ---------- Đăng bài ----------

const ZALO_TAGS = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'blockquote']);

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/** HTML bài viết -> mảng body của bài viết Zalo OA: đoạn văn (HTML cơ bản) xen kẽ ảnh. */
export function zaloBody(html: string, base: string, postUrl: string): Json[] {
  const items: Json[] = [];
  for (const part of html.split(/(<img\b[^>]*>)/i)) {
    const src = part.match(/^<img\b[^>]*\bsrc="([^"]+)"/i)?.[1];
    if (src) {
      items.push({ type: 'image', url: absolute(src, base) });
      continue;
    }
    const text = part
      .replace(/<h[1-6][^>]*>/gi, '<p><strong>')
      .replace(/<\/h[1-6]>/gi, '</strong></p>')
      .replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (_m, close: string, tag: string, attrs: string) => {
        const t = tag.toLowerCase();
        if (!ZALO_TAGS.has(t)) return '';
        if (t === 'a' && !close) {
          const href = attrs.match(/href="([^"]+)"/i)?.[1];
          return href ? `<a href="${absolute(href, base)}">` : '<a>';
        }
        return `<${close}${t}>`;
      })
      .trim();
    if (text.replace(/<[^>]+>/g, '').trim()) items.push({ type: 'text', content: text });
  }
  items.push({ type: 'text', content: `<p>Đọc bài gốc: <a href="${postUrl}">${postUrl}</a></p>` });
  return items;
}

export async function publish(provider: SocialProvider, tokens: Tokens, input: PublishInput): Promise<PublishResult> {
  const { post } = input;

  if (provider === 'facebook') {
    const page = tokens.pages?.find((p) => p.id === tokens.pageId) ?? tokens.pages?.[0];
    if (!page) throw new SocialError('Chưa chọn Fanpage để đăng.');
    // Facebook tự đọc ảnh/tiêu đề từ thẻ OpenGraph của trang bài viết để tạo bản xem trước link.
    const data = await parse(
      await fetch(`${FB_GRAPH}/${page.id}/feed`, {
        method: 'POST',
        body: form({ message: input.message, link: input.postUrl, access_token: page.accessToken }),
      }),
    );
    const id = String(data.id);
    return { status: 'success', externalId: id, url: `https://www.facebook.com/${id}` };
  }

  if (provider === 'zalo') {
    const cover = input.imageUrls[0];
    if (!cover) throw new SocialError('Bài viết Zalo OA bắt buộc có ảnh bìa — hãy thêm ảnh bìa hoặc ảnh trong nội dung.');
    const created = await parse(
      await fetch(`${ZALO_API}/article/create`, {
        method: 'POST',
        headers: { access_token: tokens.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'normal',
          title: post.title.slice(0, 150),
          author: (post.authorName || input.authorName || 'Admin').slice(0, 50),
          cover: { cover_type: 'photo', photo_url: cover, status: 'show' },
          description: (input.message || post.summary || post.title).slice(0, 300),
          body: zaloBody(post.contentHtml, input.postUrl, input.postUrl),
          tracking_link: input.postUrl,
          status: 'show',
          comment: 'show',
        }),
      }),
    );
    const token = String(created.data?.token ?? '');
    if (!token) throw new SocialError('Zalo không trả về mã theo dõi bài viết.');
    // Zalo xử lý bài bất đồng bộ; nếu chưa xong thì giữ mã để kiểm tra lại sau.
    return checkStatus('zalo', tokens, token).catch(() => ({ status: 'processing' as const, externalId: token, url: null }));
  }

  // TikTok: chỉ nhận ảnh JPG/WEBP từ tên miền đã xác minh.
  const photos = input.imageUrls.filter((u) => /\.(jpe?g|webp)(?:$|[?#])/i.test(decodeURIComponent(u))).slice(0, 35);
  if (!photos.length) throw new SocialError('TikTok chỉ nhận bài ảnh định dạng JPG/WEBP — hãy dùng ảnh bìa .jpg hoặc .webp.');
  const direct = input.tiktokMode === 'direct';
  let privacy = 'SELF_ONLY';
  if (direct) {
    const creator = await parse(
      await fetch(`${TIKTOK_API}/post/publish/creator_info/query/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      }),
    );
    const options = (creator.data?.privacy_level_options ?? []) as string[];
    privacy = options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : (options[0] ?? 'SELF_ONLY');
  }
  const caption = `${input.message}\n${input.postUrl}`.slice(0, 4000);
  const data = await parse(
    await fetch(`${TIKTOK_API}/post/publish/content/init/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({
        media_type: 'PHOTO',
        post_mode: direct ? 'DIRECT_POST' : 'MEDIA_UPLOAD',
        post_info: direct
          ? { title: post.title.slice(0, 90), description: caption, privacy_level: privacy, auto_add_music: true }
          : { title: post.title.slice(0, 90), description: caption },
        source_info: { source: 'PULL_FROM_URL', photo_images: photos, photo_cover_index: 0 },
      }),
    }),
  );
  return { status: 'processing', externalId: String(data.data?.publish_id ?? ''), url: null };
}

/** Bài Zalo và TikTok được xử lý bất đồng bộ — hỏi lại trạng thái theo mã đã lưu. */
export async function checkStatus(provider: SocialProvider, tokens: Tokens, externalId: string): Promise<PublishResult> {
  if (provider === 'zalo') {
    const data = await parse(
      await fetch(`${ZALO_API}/article/verify`, {
        method: 'POST',
        headers: { access_token: tokens.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: externalId }),
      }),
    );
    const id = data.data?.id;
    return id ? { status: 'success', externalId: String(id), url: null } : { status: 'processing', externalId, url: null };
  }
  if (provider === 'tiktok') {
    const data = await parse(
      await fetch(`${TIKTOK_API}/post/publish/status/fetch/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}`, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ publish_id: externalId }),
      }),
    );
    const status = String(data.data?.status ?? '');
    if (status === 'FAILED') return { status: 'failed', externalId, url: null, error: String(data.data?.fail_reason ?? 'TikTok từ chối bài đăng') };
    if (status === 'PUBLISH_COMPLETE' || status === 'SEND_TO_USER_INBOX') return { status: 'success', externalId, url: null };
    return { status: 'processing', externalId, url: null };
  }
  return { status: 'success', externalId, url: null };
}
