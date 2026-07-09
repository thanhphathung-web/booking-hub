// Nhắc việc real-time — đẩy tin ngay khi có sự kiện (phân công, sự cố nặng),
// khác digest 07:30 (gom việc theo ngày). Dùng chung 2 kênh mailer + zalo.
// Mọi hàm KHÔNG BAO GIỜ throw — kênh nào chưa cấu hình / user chưa có địa chỉ thì skip êm.
const { dbAsync } = require('../db/database');
const mailer = require('./mailer');
const zalo = require('./zalo');

const appUrl = () => process.env.APP_URL || 'http://localhost:3000';

function channelStatus() {
  return { email: mailer.isConfigured(), zalo: zalo.isConfigured() };
}

// Gửi 1 tin cho 1 user qua các kênh đã cấu hình — trả kết quả per-channel, không throw
async function notifyUser(user, subject, text) {
  const r = { username: user.username, email: null, zalo: null };
  if (!user.email)                 r.email = 'skip: chưa có email';
  else if (!mailer.isConfigured()) r.email = 'skip: mail chưa cấu hình';
  else { try { await mailer.send(user.email, subject, text); r.email = 'đã gửi'; }
         catch (e) { r.email = 'lỗi: ' + e.message; } }

  if (!user.zaloId)              r.zalo = 'skip: chưa có Zalo ID';
  else if (!zalo.isConfigured()) r.zalo = 'skip: Zalo chưa cấu hình';
  else { try { await zalo.send(user.zaloId, subject + '\n\n' + text); r.zalo = 'đã gửi'; }
         catch (e) { r.zalo = 'lỗi: ' + e.message; } }
  return r;
}

// ── Soạn nội dung (tách để test được) ─────────────────────
function buildAssignmentMsg(b, user, byName, roleLabel = 'NVDH') {
  const subject = `🧑‍✈️ [Booking Hub] Bạn được phân công tour ${b.product}`;
  const text = [
    `Chào ${user.name},`, '',
    `Bạn vừa được phân công phụ trách (${roleLabel}) tour:`,
    `• ${b.product}`,
    `• Mã đơn: ${b.bookingId}`,
    `• Ngày khởi hành: ${b.tourDate}`,
    `• Số khách: ${b.adults} người lớn${b.children ? ' + ' + b.children + ' trẻ em' : ''}`,
    byName ? `• Người phân công: ${byName}` : '',
    '', `Mở Booking Hub: ${appUrl()}`,
  ].filter(x => x !== '').join('\n');
  return { subject, text };
}

function buildIncidentMsg(b, inc, reporterName) {
  const sevLabel = inc.severity === 'CRITICAL' ? 'NGHIÊM TRỌNG' : 'CAO';
  const subject = `🚨 [Booking Hub] Sự cố ${sevLabel}: ${inc.title}`;
  const text = [
    `Sự cố mức ${sevLabel} vừa được ghi nhận:`, '',
    `• Tour: ${b.product} (${b.bookingId})`,
    `• Ngày KH: ${b.tourDate}`,
    `• NVDH: ${b.assignedTo || 'chưa phân công'}`,
    `• Tiêu đề: ${inc.title}`,
    `• Diễn biến: ${inc.description}`,
    inc.action ? `• Đã xử lý: ${inc.action}` : '',
    reporterName ? `• Người báo: ${reporterName}` : '',
    '', `Mở Booking Hub: ${appUrl()}`,
  ].filter(x => x !== '').join('\n');
  return { subject, text };
}

function buildNegativeReviewMsg(b, review) {
  const subject = `⭐ [Booking Hub] Đánh giá thấp (${review.stars}★): tour ${b.product}`;
  const text = [
    `Khách vừa gửi đánh giá thấp cần chăm sóc:`, '',
    `• Tour: ${b.product} (${b.bookingId})`,
    `• Khách: ${b.customer?.name || ''} — ${b.customer?.phone || ''}`,
    `• Số sao: ${review.stars}★${review.nps != null ? ` · NPS ${review.nps}/10` : ''}`,
    review.comment ? `• Góp ý: "${review.comment}"` : '',
    '', `Mở Booking Hub để xử lý: ${appUrl()}`,
  ].filter(x => x !== '').join('\n');
  return { subject, text };
}

function buildSvcPortalMsg(b, svc, supplier, action) {
  const ok = action === 'CONFIRMED';
  const subject = ok
    ? `🤝 [Booking Hub] NCC ${supplier.name} đã xác nhận: ${svc.desc}`
    : `⛔ [Booking Hub] NCC ${supplier.name} BÁO KHÔNG NHẬN: ${svc.desc}`;
  const text = [
    ok ? `NCC vừa xác nhận giữ chỗ qua cổng NCC:` : `NCC vừa báo KHÔNG nhận được dịch vụ — cần tìm phương án thay thế ngay:`, '',
    `• Tour: ${b.product} (${b.bookingId})`,
    `• Ngày KH: ${b.tourDate}`,
    `• Dịch vụ: ${svc.desc}`,
    `• NCC: ${supplier.name}${supplier.phone ? ' — ' + supplier.phone : ''}`,
    ok ? `• Số voucher: ${svc.voucherNo}` : `• Lý do: ${svc.declined?.reason || ''}`,
    '', `Mở Booking Hub: ${appUrl()}`,
  ].filter(x => x !== '').join('\n');
  return { subject, text };
}

function buildSupplierRequestMsg(b, svc, supplier) {
  const subject = `🤝 [Booking Hub] Yêu cầu giữ chỗ mới: ${svc.desc}`;
  const portalLink = supplier.portalKey ? `${appUrl()}/ncc?key=${supplier.portalKey}` : null;
  const text = [
    `Chào ${supplier.contact || supplier.name},`, '',
    `Chúng tôi vừa gửi 1 yêu cầu giữ chỗ mới:`,
    `• Dịch vụ: ${svc.desc}`,
    `• Ngày tour: ${b.tourDate}`,
    `• Số khách: ${(b.adults || 0) + (b.children || 0)}`,
    svc.note ? `• Ghi chú: ${svc.note}` : '',
    '',
    portalLink
      ? `Vui lòng mở cổng đối tác để xác nhận giữ chỗ và nhập số voucher:\n${portalLink}`
      : `Vui lòng liên hệ điều hành tour để xác nhận giữ chỗ.`,
  ].filter(x => x !== '').join('\n');
  return { subject, text };
}

// ── Sự kiện ───────────────────────────────────────────────
// Đánh giá tệ sau tour → báo quản lý (CEO + TPDH) để chăm sóc, đóng vòng dịch vụ
async function notifyNegativeReview(booking, review) {
  try {
    const managers = await dbAsync.find('users', { active: true, role: { $in: ['CEO', 'TPDH'] } });
    const { subject, text } = buildNegativeReviewMsg(booking, review);
    const results = [];
    for (const m of managers) results.push(await notifyUser(m, subject, text));
    return results;
  } catch (e) { return { error: e.message }; }
}

// Phân công NVDH/WC → báo người được phân công
async function notifyAssignment(booking, username, byName, roleLabel) {
  try {
    if (!username) return null;
    const user = await dbAsync.findOne('users', { username, active: true });
    if (!user) return null;
    const { subject, text } = buildAssignmentMsg(booking, user, byName, roleLabel);
    return await notifyUser(user, subject, text);
  } catch (e) { return { error: e.message }; }
}

// Sự cố HIGH/CRITICAL → báo quản lý (CEO + TPDH)
async function notifyIncident(booking, incident, reporterName) {
  try {
    if (!['HIGH', 'CRITICAL'].includes(incident.severity)) return [];
    const managers = await dbAsync.find('users', { active: true, role: { $in: ['CEO', 'TPDH'] } });
    const { subject, text } = buildIncidentMsg(booking, incident, reporterName);
    const results = [];
    for (const m of managers) results.push(await notifyUser(m, subject, text));
    return results;
  } catch (e) { return { error: e.message }; }
}

// Thêm dịch vụ gắn NCC → email cho NCC ngay (kèm link cổng nếu đã có) — skip êm nếu thiếu email/mail
async function notifySupplierNewRequest(booking, svc) {
  try {
    if (!svc.nccId) return null;
    const supplier = await dbAsync.findOne('suppliers', { nccId: svc.nccId, active: true });
    if (!supplier) return null;
    if (!supplier.email)        return { nccId: svc.nccId, email: 'skip: NCC chưa có email' };
    if (!mailer.isConfigured()) return { nccId: svc.nccId, email: 'skip: mail chưa cấu hình' };
    const { subject, text } = buildSupplierRequestMsg(booking, svc, supplier);
    try { await mailer.send(supplier.email, subject, text); return { nccId: svc.nccId, email: 'đã gửi' }; }
    catch (e) { return { nccId: svc.nccId, email: 'lỗi: ' + e.message }; }
  } catch (e) { return { error: e.message }; }
}

// NCC thao tác trên cổng NCC (xác nhận / báo không nhận) → báo quản lý (CEO + TPDH)
async function notifySvcPortal(booking, svc, supplier, action) {
  try {
    const managers = await dbAsync.find('users', { active: true, role: { $in: ['CEO', 'TPDH'] } });
    const { subject, text } = buildSvcPortalMsg(booking, svc, supplier, action);
    const results = [];
    for (const m of managers) results.push(await notifyUser(m, subject, text));
    return results;
  } catch (e) { return { error: e.message }; }
}

module.exports = {
  channelStatus, notifyUser, notifyAssignment, notifyIncident, notifyNegativeReview, notifySvcPortal,
  notifySupplierNewRequest,
  buildAssignmentMsg, buildIncidentMsg, buildNegativeReviewMsg, buildSvcPortalMsg, buildSupplierRequestMsg,
};
