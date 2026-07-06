const router = require('express').Router();
const { dbAsync } = require('../db/database');

// Tra cứu booking công khai cho KHÁCH — không cần đăng nhập
// Bảo mật: phải khớp cả mã đơn + SĐT; POST để SĐT không lộ trên URL/log;
// rate limit theo IP chống dò; chỉ trả về trường an toàn cho khách

const STATUS_LABELS = {
  NEW:         'Đã tiếp nhận — đang chờ xác nhận',
  CONFIRMED:   'Đã xác nhận — đang chuẩn bị tour',
  IN_PROGRESS: 'Tour đang diễn ra',
  COMPLETED:   'Đã hoàn thành',
  CANCELLED:   'Đã huỷ',
};

const LOOKUP_LIMIT = 20;
const LOOKUP_WINDOW = 15 * 60 * 1000;
const lookupHits = new Map(); // ip → {count, resetAt}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of lookupHits) if (v.resetAt < now) lookupHits.delete(k);
}, 10 * 60 * 1000).unref();

function rateLimit(req, res, next) {
  const rec = lookupHits.get(req.ip) || { count: 0, resetAt: Date.now() + LOOKUP_WINDOW };
  if (Date.now() > rec.resetAt) { rec.count = 0; rec.resetAt = Date.now() + LOOKUP_WINDOW; }
  rec.count++;
  lookupHits.set(req.ip, rec);
  if (rec.count > LOOKUP_LIMIT)
    return res.status(429).json({ error: 'Quá nhiều lượt tra cứu — vui lòng thử lại sau 15 phút' });
  next();
}

// ── POST /api/lookup ──────────────────────────────────────
router.post('/', rateLimit, async (req, res) => {
  try {
    const bookingId = String(req.body.bookingId || '').trim().toUpperCase();
    const phone = String(req.body.phone || '').replace(/\D/g, '');
    if (!bookingId || !phone)
      return res.status(400).json({ error: 'Vui lòng nhập cả mã đơn và số điện thoại' });

    const b = await dbAsync.findOne('bookings', { bookingId });
    const bPhone = String(b?.customer?.phone || '').replace(/\D/g, '');
    if (!b || !bPhone || bPhone !== phone)
      return res.status(404).json({ error: 'Không tìm thấy booking khớp mã đơn và số điện thoại này' });

    // Chỉ trả trường an toàn — tuyệt đối không lộ checklist/chi phí/ghi chú nội bộ
    res.json({ booking: {
      bookingId: b.bookingId,
      product: b.product,
      tourDate: b.tourDate,
      adults: b.adults, children: b.children,
      type: b.type,
      customerName: b.customer.name,
      status: b.status,
      statusLabel: STATUS_LABELS[b.status] || b.status,
      payment: { amount: b.payment?.amount || 0, paid: !!b.payment?.paid },
      specialReqs: b.specialReqs || '',
      timeline: (b.statusHistory || []).map(h => ({
        status: h.status, statusLabel: STATUS_LABELS[h.status] || h.status, at: h.at.slice(0, 10) })),
      createdAt: (b.createdAt || '').slice(0, 10),
    } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
