// Tạo (hoặc đặt lại mật khẩu) tài khoản admin trực tiếp trong D1 — không có trang "setup" công khai nào để bị chiếm.
//   npm run create-admin -- --local                      (database khi dev)
//   npm run create-admin -- --remote                     (database production)
//   npm run create-admin -- --remote --email=a@b.com --name="Tên"   (mật khẩu sẽ được hỏi, không hiện ra màn hình)
// Chạy lại với email đã có => đặt lại mật khẩu + bật lại quyền admin (dùng khi quên mật khẩu).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { MB, MIN_PASSWORD_LENGTH } from '../src/shared/constants';
import { derivePasswordKey, hashPasswordKey, normalizeEmail } from '../src/shared/crypto';
import { DEFAULT_SETTINGS } from '../src/shared/settings';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k!, v.join('=') || 'true'] as const;
  }),
);
const target = args.has('remote') ? '--remote' : '--local';

async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

/** Nhập mật khẩu không hiển thị ký tự. */
function askHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return ask(question);
  process.stdout.write(question);
  return new Promise((resolve) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const sql = (v: string) => `'${v.replace(/'/g, "''")}'`;

async function main() {
  console.log(`Tạo admin cho database ${target === '--remote' ? 'PRODUCTION (remote)' : 'LOCAL (dev)'}\n`);
  const email = normalizeEmail(args.get('email') ?? (await ask('Email: ')));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email không hợp lệ.');
  const name = (args.get('name') ?? (await ask('Tên hiển thị: '))) || 'Admin';
  const password = args.get('password') ?? (await askHidden(`Mật khẩu (>= ${MIN_PASSWORD_LENGTH} ký tự): `));
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`);
  if (!args.has('password')) {
    const again = await askHidden('Nhập lại mật khẩu: ');
    if (again !== password) throw new Error('Hai lần nhập mật khẩu không khớp.');
  }

  process.stdout.write('Đang băm mật khẩu (PBKDF2 600k vòng)... ');
  const hash = await hashPasswordKey(await derivePasswordKey(email, password));
  console.log('xong');

  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const now = Date.now();
  const quota = DEFAULT_SETTINGS.globalStorageLimitMB * MB;
  const statement = `INSERT INTO users (id, email, name, role, status, password_hash, storage_quota, storage_used, created_at, updated_at)
VALUES (${sql(id)}, ${sql(email)}, ${sql(name)}, 'admin', 'active', ${sql(hash)}, ${quota}, 0, ${now}, ${now})
ON CONFLICT(email) DO UPDATE SET role = 'admin', status = 'active', password_hash = excluded.password_hash, updated_at = excluded.updated_at;
DELETE FROM login_attempts WHERE email = ${sql(email)};`;

  // Ghi ra file tạm thay vì --command để tránh lỗi quoting của shell trên Windows.
  const dir = mkdtempSync(join(tmpdir(), 'webblogger-'));
  const file = join(dir, 'admin.sql');
  writeFileSync(file, statement);
  try {
    execFileSync(
      process.execPath,
      [join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), 'd1', 'execute', 'DB', target, `--file=${file}`, '--yes'],
      { cwd: root, stdio: 'inherit' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\n✅ Admin ${email} đã sẵn sàng. Đăng nhập tại /app/`);
}

main().catch((err: unknown) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
