// Backup toàn bộ dữ liệu Postgres (schema "booking") thành 1 file .json.gz
// Gửi qua email mỗi đêm (cron trong server.js).
// Khôi phục: node scripts/restore-backup.js <file.json.gz>
// Định dạng bundle giữ NGUYÊN như thời NeDB ({app, createdAt, files: {'<collection>.db': '<NDJSON>'}})
// dù nguồn giờ là Postgres — tương thích ngược với backup cũ + không phải sửa test.
const zlib = require('zlib');
const mailer = require('./mailer');
const { pool } = require('../db/pool');
const { SCHEMA, COLLECTIONS } = require('../db/database');

const MAX_EMAIL_BYTES = 35 * 1024 * 1024; // Resend giới hạn ~40MB/request

// Trả về { filename, buffer } — bundle JSON của mọi collection trong Postgres, nén gzip
async function createBackupArchive() {
  const files = {};
  for (const coll of COLLECTIONS) {
    const { rows } = await pool.query(`SELECT doc FROM "${SCHEMA}"."${coll}" ORDER BY id`);
    files[`${coll}.db`] = rows.map((r) => JSON.stringify(r.doc)).join('\n');
  }
  const bundle = JSON.stringify({
    app: 'booking-hub', createdAt: new Date().toISOString(), files,
  });
  return {
    filename: `booking-hub-backup-${new Date().toISOString().slice(0, 10)}.json.gz`,
    buffer: zlib.gzipSync(Buffer.from(bundle, 'utf8')),
  };
}

async function sendBackupEmail() {
  if (!mailer.isConfigured())
    return { sent: false, reason: 'Email chưa cấu hình (RESEND_API_KEY / SMTP)' };
  const to = process.env.BACKUP_EMAIL || process.env.SMTP_USER;
  if (!to) return { sent: false, reason: 'Chưa có BACKUP_EMAIL / SMTP_USER để nhận backup' };

  const { filename, buffer } = await createBackupArchive();
  if (buffer.length > MAX_EMAIL_BYTES) {
    await mailer.send(to, '⚠️ [Booking Hub] Backup quá lớn để gửi email',
      `File backup ${filename} nặng ${(buffer.length / 1048576).toFixed(1)}MB — vượt giới hạn email.\n`
      + 'Tải thủ công tại: Audit Log → 💾 Tải backup, và cân nhắc chuyển backup sang object storage.');
    return { sent: false, reason: 'File quá lớn — đã gửi email cảnh báo' };
  }

  await mailer.send(to, `💾 [Booking Hub] Backup dữ liệu ${new Date().toISOString().slice(0, 10)}`,
    [`Backup tự động toàn bộ dữ liệu Booking Hub (${(buffer.length / 1024).toFixed(1)} KB).`,
      '', 'Khôi phục khi cần:', '1. Tải file đính kèm về thư mục dự án',
      `2. Chạy: node scripts/restore-backup.js ${filename}`, '3. Khởi động lại server',
      '', 'Giữ lại vài bản gần nhất. Email này gửi lúc 02:00 mỗi ngày.'].join('\n'),
    [{ filename, content: buffer }]);
  return { sent: true, to, filename, bytes: buffer.length };
}

module.exports = { createBackupArchive, sendBackupEmail };
