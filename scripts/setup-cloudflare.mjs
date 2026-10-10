// Tạo D1 database + R2 bucket trên tài khoản Cloudflare của bạn và ghi database_id vào wrangler.jsonc.
// Chạy lại nhiều lần vẫn an toàn (tài nguyên đã có sẽ được dùng lại).
//   npm run cf:setup                 -> đặt dữ liệu ở châu Á - Thái Bình Dương (gần Việt Nam)
//   npm run cf:setup -- --location=weur
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerBin = join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const configPath = join(root, 'wrangler.jsonc');

const location = (process.argv.find((a) => a.startsWith('--location=')) ?? '--location=apac').split('=')[1];
const config = readFileSync(configPath, 'utf8');
const dbName = config.match(/"database_name"\s*:\s*"([^"]+)"/)?.[1] ?? 'webblogger-db';
const bucketName = config.match(/"bucket_name"\s*:\s*"([^"]+)"/)?.[1] ?? 'webblogger-files';

function wrangler(args, { capture = false, allowFail = false } = {}) {
  try {
    return execFileSync(process.execPath, [wranglerBin, ...args], {
      cwd: root,
      encoding: 'utf8',
      stdio: capture ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    });
  } catch (err) {
    if (allowFail) return `${err.stdout ?? ''}${err.stderr ?? ''}`;
    throw err;
  }
}

console.log('» Kiểm tra đăng nhập Cloudflare...');
const who = wrangler(['whoami'], { capture: true, allowFail: true });
if (/not authenticated|You are not authenticated/i.test(who)) {
  console.error('Bạn chưa đăng nhập. Hãy chạy: npx wrangler login');
  process.exit(1);
}

/** Lấy mảng JSON từ output (bỏ qua dòng cảnh báo/banner nếu wrangler in thêm). */
function listDatabases() {
  const out = wrangler(['d1', 'list', '--json'], { capture: true });
  const start = out.indexOf('[');
  const end = out.lastIndexOf(']');
  return start === -1 || end < start ? [] : JSON.parse(out.slice(start, end + 1));
}

console.log(`» D1 database "${dbName}"...`);
const list = listDatabases();
let databaseId = list.find((d) => d.name === dbName)?.uuid;
if (databaseId) {
  console.log(`  đã tồn tại: ${databaseId}`);
} else {
  const out = wrangler(['d1', 'create', dbName, `--location=${location}`], { capture: true });
  databaseId = out.match(/"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/i)?.[1];
  databaseId ??= listDatabases().find((d) => d.name === dbName)?.uuid;
  if (!databaseId) {
    console.error(out);
    throw new Error('Không đọc được database_id từ output của wrangler.');
  }
  console.log(`  đã tạo: ${databaseId} (location: ${location})`);
}
writeFileSync(configPath, config.replace(/("database_id"\s*:\s*")[^"]*(")/, `$1${databaseId}$2`));
console.log('  đã ghi database_id vào wrangler.jsonc');

console.log(`» R2 bucket "${bucketName}"...`);
const r2 = wrangler(['r2', 'bucket', 'create', bucketName, `--location=${location}`], { capture: true, allowFail: true });
if (/already exists|already own it/i.test(r2)) console.log('  đã tồn tại');
else if (/Created bucket|successfully created/i.test(r2)) console.log('  đã tạo');
else {
  console.error(r2);
  console.error(
    '\nKhông tạo được R2 bucket. Nếu thông báo yêu cầu kích hoạt R2: vào dashboard Cloudflare > R2 > "Purchase R2 Plan"\n' +
      '(gói miễn phí 10GB, cần thêm thẻ/PayPal để xác minh — không bị trừ tiền nếu dùng trong hạn mức), rồi chạy lại lệnh này.',
  );
  process.exit(1);
}

console.log(`
✅ Xong! Bước tiếp theo:
   1) npm run deploy                      # build + migrate D1 + deploy Worker
   2) npm run create-admin -- --remote     # tạo tài khoản admin đầu tiên
`);
