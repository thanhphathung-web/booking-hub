// Khôi phục dữ liệu từ file backup .json.gz (tạo bởi src/services/backup.js)
// Cách dùng:  node scripts/restore-backup.js booking-hub-backup-2026-07-05.json.gz
// - Ghi các file vào data/ (file hiện có được đổi tên .bak-<timestamp> trước khi ghi đè)
// - Chạy khi server ĐÃ TẮT, xong khởi động lại
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const input = process.argv[2];
if (!input) { console.error('Cách dùng: node scripts/restore-backup.js <file.json.gz>'); process.exit(1); }

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
const bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(input)).toString('utf8'));
if (bundle.app !== 'booking-hub') { console.error('File không phải backup Booking Hub'); process.exit(1); }

console.log(`Backup tạo lúc: ${bundle.createdAt} — ${Object.keys(bundle.files).length} file`);
fs.mkdirSync(DATA_DIR, { recursive: true });
const stamp = Date.now();
for (const [name, content] of Object.entries(bundle.files)) {
  const target = path.join(DATA_DIR, name);
  if (fs.existsSync(target)) fs.renameSync(target, `${target}.bak-${stamp}`);
  fs.writeFileSync(target, content, 'utf8');
  console.log('  ✅', name, `(${(Buffer.byteLength(content) / 1024).toFixed(1)} KB)`);
}
console.log('\nXong. File cũ giữ tại *.bak-' + stamp + '. Khởi động lại server để dùng dữ liệu khôi phục.');
