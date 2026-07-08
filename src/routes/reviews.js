const router = require('express').Router();
const { dbAsync } = require('../db/database');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { isNegative, computeStats, genReviewId } = require('../services/reviews');
const notifier = require('../services/notifier');

// Đánh giá / NPS sau tour.
// - Khách gửi qua trang công khai /danhgia (KHÔNG auth): khớp mã đơn + SĐT, tour đã COMPLETED,
//   mỗi booking 1 review. Đánh giá tệ (≤2★ / NPS detractor) → báo CEO/TPDH + ghi note vào booking.
// - Review mặc định CHƯA duyệt (published=false); CEO/TPDH duyệt mới hiển thị công khai.
// - Quản lý: CEO/TPDH duyệt/ẩn/trả lời/xoá; mọi role (bookings:read) xem danh sách nội bộ.

const MANAGE_ROLES = ['CEO', 'TPDH'];
const norm = s => String(s || '').replace(/\D/g, '');

// ── Rate limit riêng cho submit công khai (chống spam) ────
const HITS = new Map();
const LIMIT = 10, WINDOW = 15 * 60 * 1000;
setInterval(() => { const now = Date.now(); for (const [k, v] of HITS) if (v.resetAt < now) HITS.delete(k); }, 10 * 60 * 1000).unref();
function rateLimit(req, res, next) {
  const rec = HITS.get(req.ip) || { count: 0, resetAt: Date.now() + WINDOW };
  if (Date.now() > rec.resetAt) { rec.count = 0; rec.resetAt = Date.now() + WINDOW; }
  rec.count++; HITS.set(req.ip, rec);
  if (rec.count > LIMIT) return res.status(429).json({ error: 'Quá nhiều lượt gửi — vui lòng thử lại sau 15 phút' });
  next();
}

// ── POST /api/reviews (công khai — khách gửi đánh giá) ────
router.post('/', rateLimit, async (req, res) => {
  try {
    const bookingId = String(req.body.bookingId || '').trim().toUpperCase();
    const phone = norm(req.body.phone);
    const stars = parseInt(req.body.stars);
    const nps = req.body.nps === '' || req.body.nps == null ? null : parseInt(req.body.nps);
    const comment = String(req.body.comment || '').trim().slice(0, 2000);

    if (!bookingId || !phone) return res.status(400).json({ error: 'Vui lòng nhập mã đơn và số điện thoại' });
    if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Vui lòng chọn số sao từ 1 đến 5' });
    if (nps != null && !(nps >= 0 && nps <= 10)) return res.status(400).json({ error: 'Điểm giới thiệu phải từ 0 đến 10' });

    const b = await dbAsync.findOne('bookings', { bookingId });
    if (!b || norm(b.customer?.phone) !== phone)
      return res.status(404).json({ error: 'Không tìm thấy booking khớp mã đơn và số điện thoại' });
    if (b.status !== 'COMPLETED')
      return res.status(409).json({ error: 'Chỉ có thể đánh giá sau khi tour hoàn thành' });
    if (await dbAsync.findOne('reviews', { bookingId }))
      return res.status(409).json({ error: 'Đơn này đã được đánh giá — cảm ơn bạn!' });

    const now = new Date().toISOString();
    const review = {
      reviewId: genReviewId(), bookingId, productId: b.productId || null, productName: b.product,
      customerName: b.customer?.name || '', phone,
      stars, nps, comment,
      published: false, reply: null, followUp: { needed: false, done: false },
      source: 'PUBLIC', createdAt: now, updatedAt: now,
    };
    review.followUp.needed = isNegative(review);
    const saved = await dbAsync.insert('reviews', review);
    await dbAsync.insert('activity', { type: 'REVIEW_SUBMITTED', bookingId, to: `${stars}★`, by: 'customer', at: now });

    // Đánh giá tệ → đóng vòng: ghi note nội bộ + báo quản lý ngay (fire-and-forget, không chặn khách)
    if (review.followUp.needed) {
      const note = { text: `⚠️ Đánh giá thấp từ khách: ${stars}★${nps != null ? ` · NPS ${nps}` : ''}${comment ? ` — "${comment}"` : ''}`,
        by: 'system', name: 'Hệ thống đánh giá', at: now };
      dbAsync.update('bookings', { bookingId }, { $push: { notes: note } }).catch(() => {});
      notifier.notifyNegativeReview(b, review).catch(() => {});
    }
    res.status(201).json({ message: 'Cảm ơn bạn đã đánh giá!', reviewId: saved.reviewId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reviews/public (công khai — review đã duyệt) ─
// Chỉ trường an toàn: che bớt tên khách (giữ chữ đầu), không lộ SĐT/mã đơn
router.get('/public', async (req, res) => {
  try {
    const q = { published: true };
    if (req.query.productId) q.productId = req.query.productId;
    const list = await dbAsync.find('reviews', q, { createdAt: -1 });
    const reviews = list.map(r => ({
      productName: r.productName, stars: r.stars, comment: r.comment,
      customerName: maskName(r.customerName), date: (r.createdAt || '').slice(0, 10),
      reply: r.reply ? { text: r.reply.text, at: (r.reply.at || '').slice(0, 10) } : null,
    }));
    res.json({ reviews, stats: computeStats(list) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
function maskName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  if (parts.length <= 1) return (parts[0] || 'Khách').slice(0, 1) + '***';
  return parts.slice(0, -1).join(' ') + ' ' + parts[parts.length - 1].slice(0, 1) + '.';
}

// ── GET /api/reviews (nội bộ — mọi role đọc) ──────────────
// ?published=true|false &productId= &negative=true
router.get('/', ...requirePerm('bookings:read'), async (req, res) => {
  try {
    const q = {};
    if (req.query.published === 'true')  q.published = true;
    if (req.query.published === 'false') q.published = false;
    if (req.query.productId) q.productId = req.query.productId;
    if (req.query.negative === 'true') q['followUp.needed'] = true;
    const reviews = await dbAsync.find('reviews', q, { createdAt: -1 });
    res.json({ reviews, stats: computeStats(reviews) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reviews/stats (nội bộ) — tổng hợp + theo sản phẩm ──
router.get('/stats', ...requirePerm('bookings:read'), async (req, res) => {
  try {
    const all = await dbAsync.find('reviews', {});
    const byProductMap = {};
    for (const r of all) {
      const key = r.productId || r.productName;
      (byProductMap[key] = byProductMap[key] || { productName: r.productName, productId: r.productId || null, list: [] }).list.push(r);
    }
    const byProduct = Object.values(byProductMap)
      .map(g => ({ productName: g.productName, productId: g.productId, ...computeStats(g.list) }))
      .sort((a, b) => (b.avgStars || 0) - (a.avgStars || 0));
    res.json({ overall: computeStats(all), byProduct,
      pendingPublish: all.filter(r => !r.published).length,
      needFollowUp: all.filter(r => r.followUp?.needed && !r.followUp?.done).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/reviews/:id (CEO/TPDH) — duyệt/ẩn/trả lời/đánh dấu đã xử lý ──
router.patch('/:id', requireAuth, async (req, res) => {
  if (!MANAGE_ROLES.includes(req.user.role)) return res.status(403).json({ error: 'Chỉ CEO / TPDH quản lý đánh giá' });
  try {
    const r = await dbAsync.findOne('reviews', { reviewId: req.params.id });
    if (!r) return res.status(404).json({ error: 'Không tìm thấy đánh giá' });
    const now = new Date().toISOString();
    const upd = { updatedAt: now };
    if (req.body.published !== undefined) upd.published = !!req.body.published;
    if (req.body.reply !== undefined) {
      const text = String(req.body.reply || '').trim();
      upd.reply = text ? { text, by: req.user.username, name: req.user.name, at: now } : null;
    }
    if (req.body.followUpDone !== undefined)
      upd.followUp = { ...(r.followUp || { needed: false }), done: !!req.body.followUpDone };
    await dbAsync.update('reviews', { reviewId: req.params.id }, { $set: upd });
    const updated = await dbAsync.findOne('reviews', { reviewId: req.params.id });
    res.json({ review: updated, message: 'Đã cập nhật đánh giá' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/reviews/:id (CEO only) ────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  try {
    await dbAsync.remove('reviews', { reviewId: req.params.id }, {});
    res.json({ message: 'Đã xoá đánh giá' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
