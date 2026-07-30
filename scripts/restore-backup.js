// Khôi phục dữ liệu từ file backup .json.gz (tạo bởi src/services/backup.js) vào Postgres.
// Cách dùng:  node scripts/restore-backup.js booking-hub-backup-2026-07-05.json.gz
// XOÁ SẠCH từng bảng rồi ghi lại từ backup, trong 1 transaction (fail giữa chừng → rollback,
// dữ liệu hiện tại không bị mất). Chạy xong không cần khởi động lại server (Postgres không cache
// trong process như NeDB trước đây).
require('dotenv').config();
const fs = require('fs');
const zlib = require('zlib');
const { pool } = require('../src/db/pool');
const { ensureSchema, SCHEMA, COLLECTIONS } = require('../src/db/database');

const input = process.argv[2];
if (!input) { console.error('Cách dùng: node scripts/restore-backup.js <file.json.gz>'); process.exit(1); }

const bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(input)).toString('utf8'));
if (bundle.app !== 'booking-hub') { console.error('File không phải backup Booking Hub'); process.exit(1); }

async function run() {
  await ensureSchema();
  console.log(`Backup tạo lúc: ${bundle.createdAt} — ${Object.keys(bundle.files).length} collection`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [file, content] of Object.entries(bundle.files)) {
      const coll = file.replace(/\.db$/, '');
      if (!COLLECTIONS.includes(coll)) { console.log('  ⚠ bỏ qua (không rõ collection):', file); continue; }
      const lines = String(content).split('\n').map((l) => l.trim()).filter(Boolean);
      await client.query(`DELETE FROM "${SCHEMA}"."${coll}"`);
      for (const line of lines) {
        const doc = JSON.parse(line);
        await client.query(`INSERT INTO "${SCHEMA}"."${coll}" (doc) VALUES ($1)`, [doc]);
      }
      console.log('  ✅', file, `(${lines.length} docs)`);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  console.log('\nXong — đã khôi phục vào Postgres.');
  await pool.end();
}

run().catch((e) => { console.error('Khôi phục lỗi (đã rollback, dữ liệu cũ còn nguyên):', e.message); process.exit(1); });
