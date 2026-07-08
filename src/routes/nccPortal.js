const router = require('express').Router();
const { dbAsync } = require('../db/database');
const notifier = require('../services/notifier');

// Cổng NCC — nhà cung cấp tự xác nhận dịch vụ/voucher, KHÔNG cần đăng nhập
// Bảo mật: mỗi NCC có portalKey ngẫu nhiên (CEO/TPDH tạo, gửi 1 lần, tạo lại = thu hồi);
// POST để key không lộ trên log; rate limit theo IP; chỉ trả trường an toàn
// (tuyệt đối không lộ tên/SĐT khách, tiền, checklist, ghi chú nội bộ).

const PORTAL_LIMIT = 60;
const PORTAL_WINDOW = 15 * 60 * 1000;
const portalHits = new Map(); // ip → {count, resetAt}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of portalHits) if (v.resetAt < now) portalHits.delete(k);
}, 10 * 60 * 1000).unref();

function rateLimit(req, res, next) {
  const rec = portalHits.get(req.ip) || { count: 0, resetAt: Date.now() + PORTAL_WINDOW };
  if (Date.now() > rec.resetAt) { rec.count = 0; rec.resetAt = Date.now() + PORTAL_WINDOW; }
  rec.count++;
  portalHits.set(req.ip, rec);
  if (rec.count > PORTAL_LIMIT)
    return res.status(429).json({ error: 'Quá nhiều lượt truy cập — vui lòng thử lại sau 15 phút' });
  next();
}

async function supplierByKey(key) {
  const k = String(key || '').trim();
  if (k.length < 16) return null; // key hợp lệ luôn dài — chặn dò key ngắn
  return dbAsync.findOne('suppliers', { portalKey: k, active: true });
}

const CATEGORY_LABELS = {
  XE: '🚌 Xe', KHACHSAN: '🏨 Khách sạn', ANUONG: '🍜 Ăn uống', VE: '🎫 Vé',
  BAOHIEM: '🛡 Bảo hiểm', YTE: '⚕️ Y tế', KHAC: '📦 Khác',
};

// Trường an toàn của 1 dịch vụ cho NCC xem
function safeService(b, s) {
  return {
    bookingId: b.bookingId, product: b.product, tourDate: b.tourDate,
    pax: (b.adults || 0) + (b.children || 0),
    svcId: s.svcId, category: s.category, categoryLabel: CATEGORY_LABELS[s.category] || s.category,
    desc: s.desc, note: s.note || '', status: s.status,
    voucherNo: s.voucherNo || '', requestedAt: (s.at || '').slice(0, 10),
    confirmedAt: s.confirmedAt ? s.confirmedAt.slice(0, 10) : null,
    declined: s.declined ? { reason: s.declined.reason, at: s.declined.at.slice(0, 10) } : null,
  };
}

// Gom dịch vụ gắn NCC này trên các booking còn "sống" (chưa COMPLETED/CANCELLED)
async function servicesOf(nccId) {
  const bookings = await dbAsync.find('bookings',
    { status: { $in: ['NEW', 'CONFIRMED', 'IN_PROGRESS'] } }, { tourDate: 1 });
  const pending = [], confirmed = [];
  for (const b of bookings) {
    for (const s of (b.services || [])) {
      if (s.nccId !== nccId || s.status === 'CANCELLED') continue;
      (s.status === 'REQUESTED' ? pending : confirmed).push(safeService(b, s));
    }
  }
  return { pending, confirmed };
}

// ── POST /api/ncc-portal/me — NCC xem việc của mình ───────
router.post('/me', rateLimit, async (req, res) => {
  try {
    const supplier = await supplierByKey(req.body.key);
    if (!supplier) return res.status(404).json({ error: 'Link không hợp lệ hoặc đã bị thu hồi — liên hệ điều hành tour' });
    const { pending, confirmed } = await servicesOf(supplier.nccId);
    res.json({
      supplier: { name: supplier.name, category: supplier.category, contact: supplier.contact || '' },
      pending, confirmed,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Tìm booking + service thuộc đúng NCC, còn thao tác được
async function findActionable(supplier, bookingId, svcId) {
  const b = await dbAsync.findOne('bookings', { bookingId: String(bookingId || '').trim() });
  if (!b) return { error: 'Không tìm thấy booking' };
  if (['COMPLETED', 'CANCELLED'].includes(b.status)) return { error: 'Tour đã đóng — không thao tác được nữa' };
  const services = b.services || [];
  const svc = services.find(x => x.svcId === svcId && x.nccId === supplier.nccId);
  if (!svc) return { error: 'Không tìm thấy dịch vụ của bạn trên booking này' };
  if (svc.status !== 'REQUESTED') return { error: 'Dịch vụ này không còn ở trạng thái chờ xác nhận' };
  return { b, services, svc };
}

// ── POST /api/ncc-portal/confirm — NCC xác nhận giữ chỗ ───
router.post('/confirm', rateLimit, async (req, res) => {
  try {
    const supplier = await supplierByKey(req.body.key);
    if (!supplier) return res.status(404).json({ error: 'Link không hợp lệ hoặc đã bị thu hồi' });
    const voucherNo = String(req.body.voucherNo || '').trim();
    if (!voucherNo) return res.status(400).json({ error: 'Vui lòng nhập số voucher / mã xác nhận' });

    const found = await findActionable(supplier, req.body.bookingId, req.body.svcId);
    if (found.error) return res.status(409).json({ error: found.error });
    const { b, services, svc } = found;

    const now = new Date().toISOString();
    svc.status = 'CONFIRMED';
    svc.voucherNo = voucherNo.slice(0, 100);
    svc.confirmedBy = 'ncc:' + supplier.nccId;
    svc.confirmedName = supplier.name + ' (cổng NCC)';
    svc.confirmedAt = now;
    if (req.body.note) svc.note = String(req.body.note).trim().slice(0, 500);
    delete svc.declined; // từng báo không nhận → giờ xác nhận thì gỡ cờ

    await dbAsync.update('bookings', { bookingId: b.bookingId }, { $set: { services, updatedAt: now } });
    await dbAsync.insert('activity', { type: 'SVC_PORTAL_CONFIRMED', bookingId: b.bookingId,
      to: `${svc.desc}|${voucherNo}`, by: 'ncc:' + supplier.nccId, at: now });
    notifier.notifySvcPortal(b, svc, supplier, 'CONFIRMED').catch(() => {});
    res.json({ message: `Đã xác nhận giữ chỗ — voucher ${voucherNo}`, service: safeService(b, svc) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/ncc-portal/decline — NCC báo không nhận được ─
// KHÔNG đổi status (vẫn REQUESTED để chặn Go/No-Go) — chỉ cắm cờ đỏ + báo ngay điều hành
router.post('/decline', rateLimit, async (req, res) => {
  try {
    const supplier = await supplierByKey(req.body.key);
    if (!supplier) return res.status(404).json({ error: 'Link không hợp lệ hoặc đã bị thu hồi' });
    const reason = String(req.body.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Vui lòng cho biết lý do (hết chỗ, hết xe...)' });

    const found = await findActionable(supplier, req.body.bookingId, req.body.svcId);
    if (found.error) return res.status(409).json({ error: found.error });
    const { b, services, svc } = found;

    const now = new Date().toISOString();
    svc.declined = { reason: reason.slice(0, 300), at: now };

    await dbAsync.update('bookings', { bookingId: b.bookingId }, { $set: { services, updatedAt: now } });
    await dbAsync.insert('activity', { type: 'SVC_PORTAL_DECLINED', bookingId: b.bookingId,
      to: `${svc.desc}|${reason.slice(0, 100)}`, by: 'ncc:' + supplier.nccId, at: now });
    notifier.notifySvcPortal(b, svc, supplier, 'DECLINED').catch(() => {});
    res.json({ message: 'Đã ghi nhận — điều hành tour sẽ liên hệ lại ngay', service: safeService(b, svc) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
