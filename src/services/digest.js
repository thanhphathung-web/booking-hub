// Email digest nhắc việc buổi sáng — 1 email tổng hợp cho mỗi user, không gửi lẻ từng item
// composeDigest tách riêng khỏi kênh gửi để sau này đẩy thêm Zalo OA chỉ cần thay mailer
const { dbAsync } = require('../db/database');
const { getRunningBookings, tasksFor } = require('./tasks');
const mailer = require('./mailer');
const zalo = require('./zalo');

function fmtTask(t) {
  return `- [${t.code}] ${t.title}\n    ${t.bookingId} · ${t.product} · Khởi hành ${t.tourDate}${t.deadline ? ` · Hạn ${t.deadline}` : ''}`;
}

function composeDigest(user, tasks, today) {
  const overdue  = tasks.filter(t => t.overdue);
  const dueToday = tasks.filter(t => t.dueToday);
  const in3days  = new Date(new Date(today).getTime() + 3 * 86400000).toISOString().slice(0, 10);
  const upcoming = tasks.filter(t => !t.overdue && !t.dueToday && t.deadline && t.deadline <= in3days);
  const rest     = tasks.length - overdue.length - dueToday.length - upcoming.length;

  const lines = [`Chào ${user.name},`, '',
    `Bạn có ${tasks.length} việc cần xử lý${overdue.length ? ` (${overdue.length} QUÁ HẠN)` : ''}:`];
  if (overdue.length)  lines.push('', '⏰ QUÁ HẠN:',           ...overdue.map(fmtTask));
  if (dueToday.length) lines.push('', '📌 HÔM NAY:',           ...dueToday.map(fmtTask));
  if (upcoming.length) lines.push('', '📅 SẮP TỚI (3 ngày):',  ...upcoming.map(fmtTask));
  if (rest > 0)        lines.push('', `…và ${rest} việc khác chưa đến hạn.`);
  lines.push('', `Mở Booking Hub: ${process.env.APP_URL || 'http://localhost:3000'}`,
    '—', 'Booking Hub · email nhắc việc tự động 07:30');

  const subject = overdue.length
    ? `⏰ [Booking Hub] ${overdue.length} việc QUÁ HẠN, ${tasks.length} việc cần xử lý`
    : `📋 [Booking Hub] ${tasks.length} việc cần xử lý hôm nay`;
  return { subject, text: lines.join('\n') };
}

// Soạn digest cho mọi user active có việc — dùng cho cả preview lẫn gửi thật
async function buildAllDigests() {
  const users = await dbAsync.find('users', { active: true }, { username: 1 });
  const bookings = await getRunningBookings();
  const today = new Date().toISOString().slice(0, 10);

  return users.map(u => {
    const tasks = tasksFor(u, bookings, today);
    if (!tasks.length) return null;
    return { username: u.username, name: u.name, role: u.role,
      email: u.email || null, zaloId: u.zaloId || null, taskCount: tasks.length,
      ...composeDigest(u, tasks, today) };
  }).filter(Boolean);
}

// Gửi qua cả 2 kênh — kênh nào chưa cấu hình / user chưa có địa chỉ thì skip êm
async function sendDailyDigest() {
  const digests = await buildAllDigests();
  const results = [];
  for (const d of digests) {
    const r = { username: d.username, tasks: d.taskCount, email: null, zalo: null };

    if (!d.email)                    r.email = 'skip: chưa có email';
    else if (!mailer.isConfigured()) r.email = 'skip: SMTP chưa cấu hình';
    else {
      try { await mailer.send(d.email, d.subject, d.text); r.email = 'đã gửi'; }
      catch (e) { r.email = 'lỗi: ' + e.message; }
    }

    if (!d.zaloId)                 r.zalo = 'skip: chưa có Zalo ID';
    else if (!zalo.isConfigured()) r.zalo = 'skip: Zalo OA chưa cấu hình';
    else {
      try { await zalo.send(d.zaloId, d.subject + '\n\n' + d.text); r.zalo = 'đã gửi'; }
      catch (e) { r.zalo = 'lỗi: ' + e.message; }
    }

    results.push(r);
  }
  return results;
}

module.exports = { buildAllDigests, sendDailyDigest };
