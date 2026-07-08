// Tự động hoá giao tiếp khách theo vòng đời tour:
//   1. confirm   — khi booking CONFIRMED: xác nhận đặt tour
//   2. reminder  — T-3: nhắc lịch khởi hành (điểm hẹn, đồ mang)
//   3. thankyou  — sau tour: cảm ơn + xin đánh giá/NPS
// Kênh: email khách (customer.email) qua mailer. Zalo khách KHÔNG gửi tự động được
// (OA chỉ nhắn cho follower) → UI cho copy text + deep link Zalo thủ công.
// Mọi hàm KHÔNG throw; chưa có email / mail chưa cấu hình → skip êm. Dedupe qua booking.comms.
const { dbAsync } = require('../db/database');
const mailer = require('./mailer');
const { collectedOf } = require('./payments');

const appUrl = () => process.env.APP_URL || 'http://localhost:3000';
const vnd = n => Number(n || 0).toLocaleString('vi-VN');
const paxLabel = b => `${b.adults} người lớn${b.children ? ' + ' + b.children + ' trẻ em' : ''}`;

function buildConfirm(b) {
  const collected = collectedOf(b);
  const remaining = Math.max(0, (b.payment?.amount || 0) - collected);
  const payLine = b.payment?.paid ? 'Đã thanh toán đủ'
    : collected > 0 ? `Đã cọc ${vnd(collected)}đ — còn ${vnd(remaining)}đ`
    : `Chưa thanh toán — ${vnd(b.payment?.amount)}đ`;
  const subject = `✅ Xác nhận đặt tour ${b.product} — ${b.bookingId}`;
  const text = [
    `Xin chào ${b.customer.name},`, '',
    'Chúng tôi xác nhận đơn đặt tour của bạn:',
    `• Tour: ${b.product}`,
    `• Ngày khởi hành: ${b.tourDate}`,
    `• Số khách: ${paxLabel(b)}`,
    `• Mã đơn: ${b.bookingId}`,
    `• Thanh toán: ${payLine}`,
    b.specialReqs ? `• Yêu cầu đặc biệt: ${b.specialReqs}` : '',
    '', `Tra cứu đơn bất cứ lúc nào: ${appUrl()}/tracuu (nhập mã đơn + SĐT)`,
    'Cảm ơn bạn đã tin tưởng. Hẹn gặp bạn trong chuyến đi!',
  ].filter(x => x !== '').join('\n');
  return { subject, text };
}

function buildReminder(b) {
  const firstAct = b.itinerary?.days?.[0]?.activities?.[0];
  const meet = firstAct ? `${firstAct.time ? firstAct.time + ' — ' : ''}${firstAct.desc}` : '(NVDH sẽ báo cụ thể trước giờ đón)';
  const subject = `⏰ Nhắc lịch khởi hành tour ${b.product} — còn 3 ngày`;
  const text = [
    `Xin chào ${b.customer.name},`, '',
    `Tour "${b.product}" của bạn sẽ khởi hành ngày ${b.tourDate} (còn 3 ngày).`, '',
    `• Điểm hẹn / giờ đón: ${meet}`,
    `• Mã đơn: ${b.bookingId} · Số khách: ${paxLabel(b)}`,
    '', 'Đồ cần mang: giấy tờ tuỳ thân, thuốc cá nhân, trang phục phù hợp thời tiết.',
    b.assignedTo ? 'NVDH phụ trách sẽ liên hệ bạn trước giờ khởi hành.' : '',
    '', `Tra cứu đơn: ${appUrl()}/tracuu`,
    'Chúc bạn có chuyến đi tuyệt vời!',
  ].filter(x => x !== '').join('\n');
  return { subject, text };
}

function buildThankYou(b) {
  const subject = `🙏 Cảm ơn bạn đã đồng hành — tour ${b.product}`;
  const text = [
    `Xin chào ${b.customer.name},`, '',
    `Cảm ơn bạn đã tham gia tour "${b.product}" (${b.tourDate}).`,
    'Rất mong bạn đã có những trải nghiệm đáng nhớ!', '',
    'Bạn vui lòng dành 1 phút đánh giá chất lượng tour (chọn sao + mức độ giới thiệu) để chúng tôi phục vụ tốt hơn:',
    `👉 ${appUrl()}/danhgia?ma=${b.bookingId}`,
    'Phản hồi của bạn là món quà quý giá với chúng tôi.', '',
    'Hẹn gặp lại bạn trong những hành trình tiếp theo — ưu đãi đặc biệt dành cho khách quay lại!',
  ].join('\n');
  return { subject, text };
}

const BUILDERS = { confirm: buildConfirm, reminder: buildReminder, thankyou: buildThankYou };
const SENT_FIELD = { confirm: 'confirmSent', reminder: 'reminderSent', thankyou: 'thankYouSent' };
const TYPE_LABEL = { confirm: 'Xác nhận đặt tour', reminder: 'Nhắc lịch T-3', thankyou: 'Cảm ơn + đánh giá' };

// Gửi 1 touchpoint qua email khách, ghi log + dedupe vào booking.comms. Không throw.
async function sendComm(b, type, by = 'system') {
  const build = BUILDERS[type];
  if (!build) return { type, result: 'skip: loại không hợp lệ' };
  const { subject, text } = build(b);
  const to = b.customer?.email || '';
  const entry = { type, channel: 'email', to: to || null, at: new Date().toISOString(), by, result: '' };
  if (!to)                         entry.result = 'skip: khách chưa có email';
  else if (!mailer.isConfigured()) entry.result = 'skip: mail chưa cấu hình';
  else { try { await mailer.send(to, subject, text); entry.result = 'đã gửi'; }
         catch (e) { entry.result = 'lỗi: ' + e.message; } }

  const comms = b.comms || {};
  comms.log = comms.log || [];
  comms.log.push(entry);
  if (entry.result === 'đã gửi') comms[SENT_FIELD[type]] = entry.at;
  await dbAsync.update('bookings', { bookingId: b.bookingId }, { $set: { comms } });
  b.comms = comms;
  return entry;
}

// Cron hằng ngày: gửi nhắc T-3 + cảm ơn sau tour (dedupe; giới hạn cửa sổ chống blast)
async function runDaily() {
  const today = new Date().toISOString().slice(0, 10);
  const in3 = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const past7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const results = { reminder: [], thankyou: [] };

  // Nhắc T-3: tour khởi hành đúng today+3, chưa gửi, còn hoạt động
  const rem = await dbAsync.find('bookings', { tourDate: in3, status: { $nin: ['CANCELLED', 'COMPLETED'] } });
  for (const b of rem) { if (b.comms?.reminderSent) continue; results.reminder.push(await sendComm(b, 'reminder', 'cron')); }

  // Cảm ơn: tour COMPLETED, kết thúc trong 7 ngày gần đây (chống blast toàn bộ lịch sử), chưa gửi
  const done = await dbAsync.find('bookings', { status: 'COMPLETED', tourDate: { $gte: past7, $lte: today } });
  for (const b of done) { if (b.comms?.thankYouSent) continue; results.thankyou.push(await sendComm(b, 'thankyou', 'cron')); }

  return results;
}

module.exports = { BUILDERS, SENT_FIELD, TYPE_LABEL, buildConfirm, buildReminder, buildThankYou, sendComm, runDaily };
