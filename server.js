// Railway không route IPv6 ra ngoài — ép Node ưu tiên IPv4 khi resolve DNS
// (không có dòng này: kết nối smtp.gmail.com chọn IPv6 → ENETUNREACH)
require('dns').setDefaultResultOrder('ipv4first');

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const seed           = require('./src/db/seed');
const seedChecklists = require('./src/db/seed_checklists');

const app  = express();
const PORT = process.env.PORT || 3000;
// Railway có nhiều lớp edge proxy — trust cả chain để req.ip = IP thật của client
// (trust proxy 1 sẽ lấy nhầm IP edge node, đổi theo từng request → rate limit không khoá được)
app.set('trust proxy', true);

// ── Middleware ────────────────────────────────────────────
app.use(cors());
// Security headers cơ bản (không dùng CSP vì SPA inline script + Tailwind CDN)
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');       // chặn MIME sniffing
  res.set('X-Frame-Options', 'SAMEORIGIN');           // chặn nhúng iframe trang khác (clickjacking)
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https')
    res.set('Strict-Transport-Security', 'max-age=15552000'); // 180 ngày — chỉ khi đã HTTPS
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Phải chạy cả khi Vercel require() app này làm serverless function (không đi qua app.listen()
// bên dưới) — đặt ở module scope, mọi request chờ xong mới vào route. Idempotent (seed tự no-op
// nếu đã có user/checklist) nên an toàn chạy lại mỗi cold start.
const readyPromise = Promise.resolve()
  .then(() => seed())
  .then(() => seedChecklists())
  .catch((e) => console.error('seed lỗi:', e.message));
app.use((req, res, next) => { readyPromise.then(() => next()); });

// ── API Routes ────────────────────────────────────────────
app.use('/api/auth',     require('./src/routes/auth'));
app.use('/api/bookings', require('./src/routes/bookings'));
app.use('/api/users',      require('./src/routes/users'));
app.use('/api/checklists', require('./src/routes/checklists'));
app.use('/api/digest',     require('./src/routes/digest'));
app.use('/api/products',   require('./src/routes/products'));
app.use('/api/suppliers',  require('./src/routes/suppliers'));
app.use('/api/reports',    require('./src/routes/reports'));
app.use('/api/zalo',       require('./src/routes/zalo'));
app.use('/api/webhook',    require('./src/routes/webhook'));
app.use('/api/backup',     require('./src/routes/backup'));
app.use('/api/customers',  require('./src/routes/customers'));
app.use('/api/lookup',     require('./src/routes/lookup'));
app.use('/api/notify',     require('./src/routes/notify'));
app.use('/api/departures', require('./src/routes/departures'));
app.use('/api/reviews',    require('./src/routes/reviews'));
app.use('/api/ncc-portal', require('./src/routes/nccPortal'));
app.use('/api/cron',       require('./src/routes/cron'));

// Health check — dùng làm target cho uptime monitor ngoài (UptimeRobot...)
const errorLog = require('./src/services/errorLog');
const { dbAsync } = require('./src/db/database');
const { requirePerm } = require('./src/middleware/auth');

app.get('/api/health', async (req, res) => {
  let dbOk = true;
  try { await dbAsync.count('users', {}); } catch (e) { dbOk = false; }
  const mem = process.memoryUsage();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'OK' : 'DEGRADED',
    version: require('./package.json').version,
    time: new Date().toISOString(),
    uptimeSec: Math.round(process.uptime()),
    node: process.version,
    db: dbOk ? 'ok' : 'lỗi',
    rssMB: Math.round(mem.rss / 1048576),
    errors: errorLog.unresolvedCount(),
  });
});

// Lỗi hệ thống gần nhất — CEO xem khi cần chẩn đoán
app.get('/api/errors', ...requirePerm('users:manage'), (req, res) => {
  res.json({ total: errorLog.count(), unresolved: errorLog.unresolvedCount(),
    errors: errorLog.recent(parseInt(req.query.limit) || 50) });
});

// Route thử lỗi — chỉ bật khi ENABLE_TEST_ERROR=1 (smoke test), không tồn tại ở production
if (process.env.ENABLE_TEST_ERROR === '1')
  app.get('/api/health/boom', async () => { throw new Error('boom test error'); });

// Trang tra cứu công khai cho khách (đường dẫn đẹp, không cần .html)
app.get('/tracuu', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'tracuu.html')));

app.get('/nvdh', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'nvdh.html')));

// Trang khách gửi đánh giá / NPS sau tour (link trong email cảm ơn)
app.get('/danhgia', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'danhgia.html')));

// Cổng NCC — nhà cung cấp tự xác nhận dịch vụ (link riêng per NCC, CEO/TPDH gửi 1 lần)
app.get('/ncc', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'ncc.html')));

// Sổ tay hướng dẫn sử dụng cho nhân viên (tĩnh, không chứa dữ liệu)
app.get('/huongdan', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'huongdan.html')));

// ── SPA fallback — serve admin panel ─────────────────────
app.get('/{*splat}', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Lưới an toàn: bắt lỗi không được xử lý trong route/middleware ──
app.use((err, req, res, next) => {
  errorLog.capture(err, { source: 'express', url: req.originalUrl, method: req.method });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Lỗi hệ thống — đã ghi nhận, vui lòng thử lại' });
});

// ── Không để tiến trình chết âm thầm ─────────────────────
process.on('unhandledRejection', (reason) => errorLog.capture(reason, { source: 'unhandledRejection' }));
process.on('uncaughtException',  (err)    => errorLog.capture(err,    { source: 'uncaughtException' }));

// ── Cron nội bộ (node-cron) — CHỈ chạy khi host truyền thống (Railway/local), process sống liên
// tục. Trên Vercel serverless việc này vô tác dụng (process không tồn tại giữa các request) →
// lịch thật trên Vercel nằm ở `vercel.json` "crons" gọi vào src/routes/cron.js. Không xoá khối này
// vì vẫn cần cho local dev / host khác nếu quay lại.
if (!process.env.VERCEL) {
  const cron = require('node-cron');
  const { sendDailyDigest } = require('./src/services/digest');
  cron.schedule('30 7 * * *', async () => {
    console.log('[digest] Gửi email nhắc việc buổi sáng...');
    try {
      const results = await sendDailyDigest();
      console.log('[digest]', JSON.stringify(results));
    } catch (e) { console.error('[digest] Lỗi:', e.message); }
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  const { runDaily: runCustomerComms } = require('./src/services/customerComms');
  cron.schedule('0 8 * * *', async () => {
    console.log('[comms] Quét gửi nhắc T-3 + cảm ơn sau tour...');
    try {
      const r = await runCustomerComms();
      console.log('[comms]', JSON.stringify(r));
    } catch (e) { console.error('[comms] Lỗi:', e.message); }
  }, { timezone: 'Asia/Ho_Chi_Minh' });

  cron.schedule('0 2 * * *', async () => {
    console.log('[backup] Tạo backup đêm...');
    try {
      const r = await require('./src/services/backup').sendBackupEmail();
      console.log('[backup]', JSON.stringify(r));
    } catch (e) { console.error('[backup] Lỗi:', e.message); }
  }, { timezone: 'Asia/Ho_Chi_Minh' });
}

// ── Start (chỉ khi chạy trực tiếp `node server.js` — Vercel require() app làm serverless function,
// không gọi listen) ──────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🚀 Booking Hub running on http://localhost:${PORT}`);
    console.log(`   API:   http://localhost:${PORT}/api/health`);
    console.log(`   Admin: http://localhost:${PORT}/\n`);
  });
}

module.exports = app;
