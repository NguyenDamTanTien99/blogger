// Kiểm thử end-to-end API trên server đang chạy (mặc định `wrangler dev` ở http://localhost:8787).
//   npx wrangler dev --port 8787 --var UPLOAD_PART_SIZE_MB:5     (part nhỏ để test multipart nhanh)
//   npm run test:smoke
// Biến môi trường: BASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD
import { createHash, randomBytes } from 'node:crypto';
import { derivePasswordKey } from '../src/shared/crypto';

const BASE = process.env.BASE_URL ?? 'http://localhost:8787';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin12345';

type Json = any;

class Client {
  cookie = '';

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const isBinary = body instanceof Uint8Array;
    const res = await fetch(BASE + path, {
      method,
      redirect: 'manual',
      headers: {
        Origin: BASE,
        ...(body !== undefined && !isBinary ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : isBinary ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const eq = pair!.indexOf('=');
      const name = pair!.slice(0, eq);
      const value = pair!.slice(eq + 1);
      if (name.includes('wb_session')) this.cookie = value ? `${name}=${value}` : '';
    }
    return res;
  }

  async json(method: string, path: string, body?: unknown): Promise<{ status: number; data: Json }> {
    const res = await this.req(method, path, body);
    const text = await res.text();
    let data: Json = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, data };
  }

  async login(email: string, password: string) {
    return this.json('POST', '/api/auth/login', { email, key: await derivePasswordKey(email, password) });
  }

  async upload(file: Uint8Array, name: string, extra: Record<string, unknown> = {}) {
    const init = await this.json('POST', '/api/uploads', { name, size: file.length, ...extra });
    if (init.status !== 201) return init;
    const { id, partSize, partCount } = init.data;
    for (let n = 1; n <= partCount; n++) {
      const chunk = file.subarray((n - 1) * partSize, Math.min(file.length, n * partSize));
      const res = await this.req('PUT', `/api/uploads/${id}/parts/${n}`, chunk, { 'Content-Type': 'application/octet-stream' });
      if (res.status !== 200) return { status: res.status, data: await res.text() };
    }
    const done = await this.json('POST', `/api/uploads/${id}/complete`);
    return { ...done, partCount };
  }
}

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.log(`  ✗ ${name}`, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400));
  }
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function main() {
  const anon = new Client();
  const admin = new Client();
  const user = new Client();
  const stamp = Date.now().toString(36);
  const userEmail = `user-${stamp}@example.com`;
  const userPassword = 'User12345!';

  console.log('Trang công khai');
  const home = await anon.req('GET', '/');
  check('GET / -> 200 HTML', home.status === 200 && (await home.text()).includes('<!DOCTYPE html>'));
  check('GET /robots.txt', (await anon.req('GET', '/robots.txt')).status === 200);
  check('GET /api/site công khai', (await anon.json('GET', '/api/site')).status === 200);
  check('GET /api/notes khi chưa đăng nhập -> 401', (await anon.json('GET', '/api/notes')).status === 401);
  check('GET /api/auth/me khi chưa đăng nhập -> user null', (await anon.json('GET', '/api/auth/me')).data.user === null);
  check('trang không tồn tại -> 404', (await anon.req('GET', '/khong-ton-tai-' + stamp)).status === 404);

  console.log('Đăng nhập & phân quyền');
  check('sai mật khẩu -> 401', (await anon.login(ADMIN_EMAIL, 'wrong-password')).status === 401);
  const loginRes = await admin.login(ADMIN_EMAIL, ADMIN_PASSWORD);
  check('admin đăng nhập', loginRes.status === 200 && loginRes.data.user.role === 'admin', loginRes);
  check('admin /me', (await admin.json('GET', '/api/auth/me')).data.user?.email === ADMIN_EMAIL);

  const created = await admin.json('POST', '/api/users', {
    email: userEmail,
    name: 'Người dùng thử',
    role: 'user',
    key: await derivePasswordKey(userEmail, userPassword),
    storageQuotaMB: 50,
  });
  check('admin tạo user', created.status === 201, created);
  const userId: string = created.data.user?.id;
  check('trùng email -> 409', (await admin.json('POST', '/api/users', { email: userEmail, name: 'x', role: 'user', key: await derivePasswordKey(userEmail, 'abcdefgh1') })).status === 409);
  check('user đăng nhập', (await user.login(userEmail, userPassword)).status === 200);
  check('user gọi API admin -> 403', (await user.json('GET', '/api/users')).status === 403);
  check('user sửa settings -> 403', (await user.json('PUT', '/api/settings', {})).status === 403);
  check('user tạo bài viết -> 403', (await user.json('POST', '/api/posts', { title: 'x' })).status === 403);

  const csrf = await user.req('POST', '/api/notes', { title: 'csrf' }, { Origin: 'https://evil.example' });
  check('CSRF: Origin lạ -> 403', csrf.status === 403);

  console.log('Ghi chú');
  const note = await user.json('POST', '/api/notes', { title: 'Ghi chú đầu tiên', content: '# Xin chào\nNội dung **markdown**', tags: ['Công việc', 'demo'] });
  check('user tạo note', note.status === 201 && note.data.note.tags.includes('công việc'), note);
  const noteId: string = note.data.note.id;
  const adminNote = await admin.json('POST', '/api/notes', { title: 'Note riêng của admin' });
  check('user không xem được note của admin -> 404', (await user.json('GET', `/api/notes/${adminNote.data.note.id}`)).status === 404);
  const adminList = await admin.json('GET', `/api/notes?owner=${userId}`);
  check('admin thấy note của user', adminList.data.items?.some((n: Json) => n.id === noteId), adminList);
  const edited = await admin.json('PATCH', `/api/notes/${noteId}`, { content: 'Admin đã sửa', baseUpdatedAt: note.data.note.updatedAt });
  check('admin sửa note của user', edited.status === 200 && edited.data.note.updatedByName === 'Admin', edited);
  const stale = await user.json('PATCH', `/api/notes/${noteId}`, { content: 'bản cũ', baseUpdatedAt: note.data.note.updatedAt });
  check('ghi đè bản cũ -> 409 conflict', stale.status === 409);
  check('tìm kiếm note', (await user.json('GET', '/api/notes?q=' + encodeURIComponent('Admin đã'))).data.total === 1);
  check('lọc theo thẻ', (await user.json('GET', '/api/notes?tag=demo')).data.total === 1);

  console.log('File & thư mục');
  const folder = await user.json('POST', '/api/folders', { name: 'Tài liệu' });
  check('tạo thư mục', folder.status === 201, folder);
  check('trùng tên thư mục -> 409', (await user.json('POST', '/api/folders', { name: 'tài liệu' })).status === 409);
  const small = new TextEncoder().encode('Xin chào từ WebBlogger! '.repeat(100));
  const up1 = await user.upload(small, 'bao-cao.docx', { folderId: folder.data.folder.id });
  check('upload file nhỏ (1 phần)', up1.status === 201 && up1.data.file.contentType.includes('wordprocessingml'), up1);
  const smallId: string = up1.data.file.id;

  const big = new Uint8Array(randomBytes(12 * 1024 * 1024 + 12345));
  const up2 = await user.upload(big, 'video lớn.mp4');
  check(`upload multipart (${(up2 as Json).partCount} phần)`, up2.status === 201 && (up2 as Json).partCount >= 3, up2);
  const bigId: string = up2.data.file.id;

  const dl = await user.req('GET', `/api/files/${bigId}/content?download=1`);
  const dlBytes = new Uint8Array(await dl.arrayBuffer());
  check('tải xuống đúng nội dung (sha256)', dl.status === 200 && sha(dlBytes) === sha(big), { status: dl.status, len: dlBytes.length });
  check('Content-Disposition attachment + tên UTF-8', (dl.headers.get('content-disposition') ?? '').includes("filename*=UTF-8''video%20l%E1%BB%9Bn.mp4"));
  const ranged = await user.req('GET', `/api/files/${bigId}/content`, undefined, { Range: 'bytes=100-199' });
  const rangedBytes = new Uint8Array(await ranged.arrayBuffer());
  check('Range request -> 206 + đúng 100 byte', ranged.status === 206 && rangedBytes.length === 100 && sha(rangedBytes) === sha(big.subarray(100, 200)), {
    status: ranged.status,
    cr: ranged.headers.get('content-range'),
  });
  const etag = dl.headers.get('etag')!;
  check('ETag -> 304', (await user.req('GET', `/api/files/${bigId}/content`, undefined, { 'If-None-Match': etag })).status === 304);

  const listing = await user.json('GET', `/api/drive?folder=${folder.data.folder.id}`);
  check('duyệt thư mục', listing.data.files?.length === 1 && listing.data.breadcrumb?.[0]?.name === 'Tài liệu', listing);
  const me = await user.json('GET', '/api/stats');
  check('quota đã dùng được cập nhật', me.data.storageUsed === small.length + big.length, me.data);

  check('file riêng tư: không xem được qua /f/', (await anon.req('GET', `/f/${smallId}`)).status === 404);
  check('user khác (admin) xem được file', (await admin.req('GET', `/api/files/${smallId}/content`)).status === 200);
  const pub = await user.json('PATCH', `/api/files/${smallId}`, { visibility: 'public', name: 'báo cáo.docx' });
  check('chia sẻ công khai + đổi tên', pub.status === 200 && pub.data.file.visibility === 'public');
  const pubRes = await anon.req('GET', `/f/${smallId}/bao-cao.docx`);
  check('file công khai tải được không cần đăng nhập', pubRes.status === 200 && (await pubRes.arrayBuffer()).byteLength === small.length);

  const svg = await user.upload(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'evil.svg');
  const svgRes = await admin.req('GET', `/api/files/${svg.data.file.id}/content`);
  check('SVG/HTML bị ép tải xuống + CSP sandbox', (svgRes.headers.get('content-disposition') ?? '').startsWith('attachment') && (svgRes.headers.get('content-security-policy') ?? '').includes('sandbox'));

  const tooBig = await user.json('POST', '/api/uploads', { name: 'huge.bin', size: 60 * 1024 * 1024 });
  check('vượt quota -> 413', tooBig.status === 413, tooBig);

  // Body dạng stream => không có Content-Length (như HTTP/2): server vẫn phải ép đúng số byte.
  const streamUp = await user.json('POST', '/api/uploads', { name: 'stream.bin', size: 1000 });
  const putStream = (bytes: number) =>
    fetch(`${BASE}/api/uploads/${streamUp.data.id}/parts/1`, {
      method: 'PUT',
      headers: { Origin: BASE, Cookie: user.cookie, 'Content-Type': 'application/octet-stream' },
      body: new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(new Uint8Array(bytes));
          ctrl.close();
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
  check('phần thiếu byte (không Content-Length) -> 400', (await putStream(999)).status === 400);
  check('phần đủ byte (không Content-Length) -> 200', (await putStream(1000)).status === 200);
  await user.json('DELETE', `/api/uploads/${streamUp.data.id}`);
  check('xóa thư mục không trống -> 409', (await user.json('DELETE', `/api/folders/${folder.data.folder.id}`)).status === 409);

  console.log('Bài viết & blog');
  const post = await admin.json('POST', '/api/posts', {
    title: 'Xin chào thế giới',
    contentMd: '## Mở đầu\nĐây là bài viết đầu tiên.',
    contentHtml: '<h2>Mở đầu</h2><p>Đây là bài viết đầu tiên.</p>',
    tags: ['Giới thiệu'],
    status: 'published',
  });
  check('tạo & xuất bản bài viết', post.status === 201 && post.data.post.slug.startsWith('xin-chao-the-gioi'), post);
  const slug: string = post.data.post.slug;
  const postPage = await anon.req('GET', `/posts/${slug}`);
  check('trang bài viết SSR', postPage.status === 200 && (await postPage.text()).includes('Đây là bài viết đầu tiên'));
  check('trang chủ liệt kê bài', (await (await anon.req('GET', '/')).text()).includes('Xin chào thế giới'));
  check('trang thẻ', (await (await anon.req('GET', '/tags/gi%E1%BB%9Bi%20thi%E1%BB%87u')).text()).includes('Xin chào thế giới'));
  check('RSS', (await (await anon.req('GET', '/rss.xml')).text()).includes(`/posts/${slug}`));
  check('sitemap', (await (await anon.req('GET', '/sitemap.xml')).text()).includes(`/posts/${slug}`));
  check('tìm kiếm blog', (await (await anon.req('GET', '/search?q=' + encodeURIComponent('đầu tiên'))).text()).includes('Xin chào thế giới'));

  const draft = await admin.json('POST', '/api/posts', { title: 'Bản nháp bí mật', type: 'page', slug: 'about-' + stamp });
  check('trang nháp ẩn với khách', (await anon.req('GET', `/${draft.data.post.slug}`)).status === 404);
  check('admin xem trước bản nháp', (await admin.req('GET', `/${draft.data.post.slug}?preview`)).status === 200);
  check('slug hệ thống bị chặn', (await admin.json('POST', '/api/posts', { title: 'x', type: 'page', slug: 'api' })).status === 400);

  console.log('Cài đặt & dọn dẹp');
  const settings = await admin.json('GET', '/api/settings');
  const saved = await admin.json('PUT', '/api/settings', { ...settings.data.settings, siteTitle: 'Blog Test ' + stamp, accentColor: '#16a34a' });
  check('lưu cài đặt', saved.status === 200, saved);
  check('cài đặt hiển thị trên blog', (await (await anon.req('GET', '/')).text()).includes('Blog Test ' + stamp));
  await admin.json('PUT', '/api/settings', settings.data.settings);
  check('link javascript: bị chặn', (await admin.json('PUT', '/api/settings', { ...settings.data.settings, navLinks: [{ label: 'x', url: 'javascript:alert(1)' }] })).status === 400);

  check('admin không tự hạ quyền khi là admin cuối', (await admin.json('PATCH', `/api/users/${loginRes.data.user.id}`, { role: 'user' })).status === 409);
  const disabled = await admin.json('PATCH', `/api/users/${userId}`, { status: 'disabled' });
  check('khóa user', disabled.status === 200 && disabled.data.user.status === 'disabled');
  check('user bị khóa mất phiên ngay', (await user.json('GET', '/api/auth/me')).data.user === null && (await user.json('GET', '/api/notes')).status === 401);
  const del = await admin.json('DELETE', `/api/users/${userId}`);
  check('xóa user (kèm file trên R2)', del.status === 204, del);
  check('file của user đã bị xóa', (await admin.req('GET', `/api/files/${bigId}/content`)).status === 404);
  await admin.json('DELETE', `/api/posts/${post.data.post.id}`);
  await admin.json('DELETE', `/api/posts/${draft.data.post.id}`);
  await admin.json('DELETE', `/api/notes/${adminNote.data.note.id}`);
  check('nhật ký có ghi sự kiện', (await admin.json('GET', '/api/audit')).data.total > 0);
  check('đăng xuất', (await admin.req('POST', '/api/auth/logout')).status === 204 && (await admin.json('GET', '/api/auth/me')).data.user === null);

  console.log(failures ? `\n❌ ${failures} kiểm tra thất bại` : '\n✅ Tất cả kiểm tra đều đạt');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
