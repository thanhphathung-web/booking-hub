const router = require('express').Router();
const { dbAsync } = require('../db/database');
const { requireAuth, requirePerm } = require('../middleware/auth');

// NCC (nhà cung cấp) — chia sẻ 3 công ty
// ratings: [{ score 1-5, note, bookingId?, by, name, at }] — đầu vào từ PT-05 / đánh giá tuần

const NCC_CATEGORIES = ['XE', 'KHACHSAN', 'ANUONG', 'VE', 'BAOHIEM', 'YTE', 'KHAC'];

function withAvgRating(s) {
  const ratings = s.ratings || [];
  const avg = ratings.length ? Math.round(ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length * 10) / 10 : null;
  // portalKey = bí mật đăng nhập cổng NCC — không bao giờ trả trong list/detail thường
  const { portalKey, ...rest } = s;
  return { ...rest, avgRating: avg, ratingCount: ratings.length, hasPortal: !!portalKey };
}

// ── GET /api/suppliers ────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = {};
    if (req.query.category) q.category = req.query.category;
    if (req.query.active === 'true') q.active = true;
    const suppliers = await dbAsync.find('suppliers', q, { name: 1 });
    res.json({ suppliers: suppliers.map(withAvgRating) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/suppliers (CEO/TPDH) ────────────────────────
router.post('/', ...requirePerm('ncc:manage'), async (req, res) => {
  try {
    const { name, category = 'KHAC', phone = '', email = '', contact = '', address = '', notes = '' } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Thiếu tên NCC' });
    if (!NCC_CATEGORIES.includes(category))
      return res.status(400).json({ error: `Loại NCC không hợp lệ. Dùng: ${NCC_CATEGORIES.join(', ')}` });

    const now = new Date().toISOString();
    const supplier = await dbAsync.insert('suppliers', {
      nccId: 'NCC-' + Date.now().toString(36).toUpperCase(),
      name: name.trim(), category,
      phone: phone.trim(), email: email.trim(), contact: contact.trim(),
      address: address.trim(), notes: notes.trim(),
      ratings: [], active: true,
      createdAt: now, updatedAt: now, createdBy: req.user.username,
    });
    res.status(201).json({ supplier: withAvgRating(supplier), message: 'Đã thêm NCC' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/suppliers/:id (CEO/TPDH) ───────────────────
router.patch('/:id', ...requirePerm('ncc:manage'), async (req, res) => {
  try {
    const supplier = await dbAsync.findOne('suppliers', { nccId: req.params.id });
    if (!supplier) return res.status(404).json({ error: 'Không tìm thấy NCC' });

    const upd = { updatedAt: new Date().toISOString() };
    if (req.body.name) upd.name = String(req.body.name).trim();
    if (req.body.category) {
      if (!NCC_CATEGORIES.includes(req.body.category)) return res.status(400).json({ error: 'Loại NCC không hợp lệ' });
      upd.category = req.body.category;
    }
    for (const f of ['phone', 'email', 'contact', 'address', 'notes']) {
      if (req.body[f] !== undefined) upd[f] = String(req.body[f]).trim();
    }
    await dbAsync.update('suppliers', { nccId: req.params.id }, { $set: upd });
    const updated = await dbAsync.findOne('suppliers', { nccId: req.params.id });
    res.json({ supplier: withAvgRating(updated), message: 'Đã cập nhật NCC' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/suppliers/:id/toggle (CEO/TPDH) ────────────
router.patch('/:id/toggle', ...requirePerm('ncc:manage'), async (req, res) => {
  try {
    const supplier = await dbAsync.findOne('suppliers', { nccId: req.params.id });
    if (!supplier) return res.status(404).json({ error: 'Không tìm thấy NCC' });
    await dbAsync.update('suppliers', { nccId: req.params.id },
      { $set: { active: !supplier.active, updatedAt: new Date().toISOString() } });
    res.json({ message: `Đã ${supplier.active ? 'ngừng hợp tác' : 'kích hoạt lại'} NCC`, active: !supplier.active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/suppliers/:id/rating ────────────────────────
// Mọi role đều chấm được (NVDH chấm sau tour — PT-05, TPDH đánh giá tuần)
router.post('/:id/rating', requireAuth, async (req, res) => {
  try {
    const score = Number(req.body.score);
    if (!score || score < 1 || score > 5) return res.status(400).json({ error: 'Điểm phải từ 1 đến 5' });
    const supplier = await dbAsync.findOne('suppliers', { nccId: req.params.id });
    if (!supplier) return res.status(404).json({ error: 'Không tìm thấy NCC' });

    const entry = {
      score, note: (req.body.note || '').trim(), bookingId: req.body.bookingId || null,
      by: req.user.username, name: req.user.name, at: new Date().toISOString(),
    };
    await dbAsync.update('suppliers', { nccId: req.params.id },
      { $set: { updatedAt: entry.at }, $push: { ratings: entry } });
    res.status(201).json({ message: `Đã chấm ${score}★ cho ${supplier.name}` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/suppliers/:id/portal-key (CEO/TPDH) ─────────
// Tạo link cổng NCC (/ncc?key=...) — lần đầu tạo key, regenerate=true tạo key mới (thu hồi link cũ).
// Đây là endpoint DUY NHẤT trả portalKey ra ngoài.
router.post('/:id/portal-key', ...requirePerm('ncc:manage'), async (req, res) => {
  try {
    const supplier = await dbAsync.findOne('suppliers', { nccId: req.params.id });
    if (!supplier) return res.status(404).json({ error: 'Không tìm thấy NCC' });

    let key = supplier.portalKey;
    if (!key || req.body.regenerate === true) {
      key = require('crypto').randomBytes(18).toString('base64url'); // 24 ký tự URL-safe
      await dbAsync.update('suppliers', { nccId: req.params.id },
        { $set: { portalKey: key, updatedAt: new Date().toISOString() } });
      await dbAsync.insert('activity', { type: 'NCC_PORTAL_KEY', bookingId: null,
        to: req.params.id, by: req.user.username, at: new Date().toISOString() });
    }
    const base = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
    const portalUrl = `${base}/ncc?key=${key}`;

    // sendEmail=true → gửi thẳng link cho NCC qua email (skip êm nếu thiếu email/mail)
    let emailResult = null;
    if (req.body.sendEmail === true) {
      const mailer = require('../services/mailer');
      if (!supplier.email)             emailResult = 'skip: NCC chưa có email — thêm email trong ✏️ Sửa';
      else if (!mailer.isConfigured()) emailResult = 'skip: mail chưa cấu hình';
      else {
        try {
          await mailer.send(supplier.email, `🤝 [Booking Hub] Link cổng đối tác cho ${supplier.name}`, [
            `Chào ${supplier.contact || supplier.name},`, '',
            `Đây là link cổng đối tác riêng của bạn — mở là thấy các dịch vụ chúng tôi đang đặt,`,
            `bấm xác nhận giữ chỗ và nhập số voucher trực tiếp:`, '',
            portalUrl, '',
            `Link dành riêng cho bạn, vui lòng không chia sẻ.`,
          ].join('\n'));
          emailResult = `đã gửi tới ${supplier.email}`;
        } catch (e) { emailResult = 'lỗi: ' + e.message; }
      }
    }
    res.json({ portalKey: key, portalUrl, emailResult,
      message: req.body.regenerate ? 'Đã tạo link mới — link cũ hết hiệu lực' : 'Link cổng NCC' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/suppliers/:id (CEO only) ──────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  try {
    await dbAsync.remove('suppliers', { nccId: req.params.id }, {});
    res.json({ message: 'Đã xoá NCC' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
