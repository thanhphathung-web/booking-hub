const util = require('util');
if (!util.isDate)   util.isDate   = (d) => d instanceof Date;
if (!util.isArray)  util.isArray  = Array.isArray;
if (!util.isRegExp) util.isRegExp = (r) => r instanceof RegExp;

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

// Health check
app.get('/api/health', (req, res) =>
  res.json({ status: 'OK', version: require('./package.json').version, time: new Date().toISOString() }));

// Trang tra cứu công khai cho khách (đường dẫn đẹp, không cần .html)
app.get('/tracuu', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'tracuu.html')));

app.get('/nvdh', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'nvdh.html')));

// ── SPA fallback — serve admin panel ─────────────────────
app.get('/{*splat}', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Email digest nhắc việc 07:30 sáng (giờ VN) ───────────
const cron = require('node-cron');
const { sendDailyDigest } = require('./src/services/digest');
cron.schedule('30 7 * * *', async () => {
  console.log('[digest] Gửi email nhắc việc buổi sáng...');
  try {
    const results = await sendDailyDigest();
    console.log('[digest]', JSON.stringify(results));
  } catch (e) { console.error('[digest] Lỗi:', e.message); }
}, { timezone: 'Asia/Ho_Chi_Minh' });

// ── Giao tiếp khách tự động 08:00 sáng (giờ VN) — nhắc T-3 + cảm ơn sau tour ──
const { runDaily: runCustomerComms } = require('./src/services/customerComms');
cron.schedule('0 8 * * *', async () => {
  console.log('[comms] Quét gửi nhắc T-3 + cảm ơn sau tour...');
  try {
    const r = await runCustomerComms();
    console.log('[comms]', JSON.stringify(r));
  } catch (e) { console.error('[comms] Lỗi:', e.message); }
}, { timezone: 'Asia/Ho_Chi_Minh' });

// ── Backup dữ liệu 02:00 sáng (giờ VN) — gửi data/ nén gzip qua email ──
cron.schedule('0 2 * * *', async () => {
  console.log('[backup] Tạo backup đêm...');
  try {
    const r = await require('./src/services/backup').sendBackupEmail();
    console.log('[backup]', JSON.stringify(r));
  } catch (e) { console.error('[backup] Lỗi:', e.message); }
}, { timezone: 'Asia/Ho_Chi_Minh' });

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 Booking Hub running on http://localhost:${PORT}`);
  console.log(`   API:   http://localhost:${PORT}/api/health`);
  console.log(`   Admin: http://localhost:${PORT}/\n`);
  await seed();
  await seedChecklists();
});

module.exports = app;
