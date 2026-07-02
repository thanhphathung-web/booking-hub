const router = require('express').Router();
const { dbAsync } = require('../db/database');
const { requireAuth, requirePerm } = require('../middleware/auth');

// Booking status flow:
// NEW → CONFIRMED (Cty1) → IN_PROGRESS → COMPLETED | CANCELLED

function genBookingId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.floor(Math.random()*9000)+1000;
  return `ORD-${ymd}-${rand}`;
}

// ── GET /api/bookings ─────────────────────────────────────
router.get('/', ...requirePerm('bookings:read'), async (req, res) => {
  try {
    const q = {};
    if (req.query.status)     q.status     = req.query.status;
    if (req.query.type)       q.type       = req.query.type;
    if (req.query.assignedTo) q.assignedTo = req.query.assignedTo;
    if (req.query.paid !== undefined && req.query.paid !== '') {
      q['payment.paid'] = req.query.paid === 'true';
    }
    // createdAt range
    if (req.query.from || req.query.to) {
      q.createdAt = {};
      if (req.query.from) q.createdAt.$gte = req.query.from + 'T00:00:00.000Z';
      if (req.query.to)   q.createdAt.$lte = req.query.to   + 'T23:59:59.999Z';
    } else if (req.query.days) {
      const days = parseInt(req.query.days);
      if (days > 0) q.createdAt = { $gte: new Date(Date.now() - days * 86400000).toISOString() };
    }
    // tourDate range
    if (req.query.tourFrom || req.query.tourTo) {
      q.tourDate = {};
      if (req.query.tourFrom) q.tourDate.$gte = req.query.tourFrom;
      if (req.query.tourTo)   q.tourDate.$lte = req.query.tourTo;
    }
    if (req.query.search) {
      const escaped = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      q.$or = [{ bookingId: re }, { 'customer.name': re }, { 'customer.phone': re }, { product: re }];
    }

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const total = await dbAsync.count('bookings', q);
    const bookings = await dbAsync.findPage('bookings', q, { createdAt: -1 }, (page-1)*limit, limit);
    res.json({ bookings, total, page, limit, pages: Math.ceil(total/limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/bookings/stats ───────────────────────────────
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const base = {};
    if (req.query.from || req.query.to) {
      base.createdAt = {};
      if (req.query.from) base.createdAt.$gte = req.query.from + 'T00:00:00.000Z';
      if (req.query.to)   base.createdAt.$lte = req.query.to   + 'T23:59:59.999Z';
    } else {
      const days = parseInt(req.query.days);
      if (days > 0) base.createdAt = { $gte: new Date(Date.now() - days * 86400000).toISOString() };
    }

    const in3days = new Date(Date.now() + 3*86400000).toISOString().slice(0,10);
    const today   = new Date().toISOString().slice(0,10);
    const [total, newB, confirmed, inProgress, completed, cancelled, wellness, unpaid, urgent] = await Promise.all([
      dbAsync.count('bookings', { ...base }),
      dbAsync.count('bookings', { ...base, status: 'NEW' }),
      dbAsync.count('bookings', { ...base, status: 'CONFIRMED' }),
      dbAsync.count('bookings', { ...base, status: 'IN_PROGRESS' }),
      dbAsync.count('bookings', { ...base, status: 'COMPLETED' }),
      dbAsync.count('bookings', { ...base, status: 'CANCELLED' }),
      dbAsync.count('bookings', { ...base, type: 'WELLNESS' }),
      dbAsync.count('bookings', { ...base, 'payment.paid': false, status: { $nin: ['CANCELLED','COMPLETED'] } }),
      dbAsync.count('bookings', { tourDate: { $gte: today, $lte: in3days }, status: { $nin: ['CANCELLED','COMPLETED'] }, assignedTo: null }),
    ]);
    res.json({ total, new: newB, confirmed, inProgress, completed, cancelled, wellness, unpaid, urgent });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/bookings/:id ─────────────────────────────────
router.get('/:id', ...requirePerm('bookings:read'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    res.json({ booking });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/bookings ────────────────────────────────────
// Called by Cty2 website OR admin form
router.post('/', ...requirePerm('bookings:create'), async (req, res) => {
  try {
    const { product, tourDate, adults=1, children=0, customer, specialReqs='', type='STANDARD', wellness={} } = req.body;
    if (!product || !tourDate || !customer?.name || !customer?.phone)
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc: product, tourDate, customer.name, customer.phone' });

    const bookingId = genBookingId();
    const now = new Date().toISOString();
    const booking = {
      bookingId, product, tourDate, adults, children,
      customer: { name: customer.name, phone: customer.phone, email: customer.email || '' },
      specialReqs, type: type.toUpperCase(),
      wellness: type.toUpperCase() === 'WELLNESS' ? wellness : {},
      status: 'NEW',
      statusHistory: [{ status: 'NEW', by: req.user.username, at: now }],
      assignedTo: null,    // NVDH Cty1
      wcAssigned: null,    // WC Cty3 (for wellness)
      payment: { amount: req.body.payment?.amount || 0, paid: req.body.payment?.paid || false },
      source: req.body.source || 'ADMIN',  // ADMIN | CTY2_API | PLATFORM
      notes: [],
      createdAt: now,
      updatedAt: now,
      createdBy: req.user.username,
    };

    const saved = await dbAsync.insert('bookings', booking);
    await dbAsync.insert('activity', { type:'BOOKING_CREATED', bookingId, by: req.user.username, at: now });
    res.status(201).json({ booking: saved, message: 'Booking đã được tạo' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/bookings/:id/status ───────────────────────
router.patch('/:id/status', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const { status, note } = req.body;
    const VALID = ['NEW','CONFIRMED','IN_PROGRESS','COMPLETED','CANCELLED'];
    if (!VALID.includes(status))
      return res.status(400).json({ error: `Status không hợp lệ. Dùng: ${VALID.join(', ')}` });

    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });

    const now = new Date().toISOString();
    const histEntry = { status, by: req.user.username, at: now };
    if (note) histEntry.note = note;

    await dbAsync.update('bookings',
      { bookingId: req.params.id },
      { $set: { status, updatedAt: now }, $push: { statusHistory: histEntry } }
    );

    await dbAsync.insert('activity', { type:'STATUS_CHANGED', bookingId: req.params.id,
      from: booking.status, to: status, by: req.user.username, at: now });

    const updated = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    res.json({ message: `Đã cập nhật status → ${status}`, booking: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/bookings/:id/assign ───────────────────────
router.patch('/:id/assign', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const { assignedTo, wcAssigned } = req.body;
    const now = new Date().toISOString();
    const upd = { updatedAt: now };
    if (assignedTo) upd.assignedTo = assignedTo;
    if (wcAssigned) upd.wcAssigned = wcAssigned;
    await dbAsync.update('bookings', { bookingId: req.params.id }, { $set: upd });
    res.json({ message: 'Đã phân công', bookingId: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/bookings/:id/note ───────────────────────────
router.post('/:id/note', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Note không được trống' });
    const entry = { text, by: req.user.username, name: req.user.name, at: new Date().toISOString() };
    await dbAsync.update('bookings', { bookingId: req.params.id }, { $push: { notes: entry } });
    res.json({ message: 'Đã thêm note' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/bookings/:id/brief ───────────────────────────
// Generate Booking Brief text for Cty1
router.get('/:id/brief', ...requirePerm('bookings:read'), async (req, res) => {
  try {
    const b = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!b) return res.status(404).json({ error: 'Không tìm thấy booking' });

    const deadline = new Date(Date.now() + 4*3600000).toLocaleString('vi-VN');
    const brief = [
      '═══════════════════════════════════════',
      'BOOKING BRIEF — HỆ THỐNG CTY 2',
      '═══════════════════════════════════════',
      `Mã đơn     : ${b.bookingId}`,
      `Tour       : ${b.product}`,
      `Ngày KH    : ${b.tourDate}`,
      `Số khách   : ${b.adults} người lớn${b.children > 0 ? ` + ${b.children} trẻ em` : ''}`,
      '───────────────────────────────────────',
      'THÔNG TIN TRƯỞNG ĐOÀN:',
      `Họ tên     : ${b.customer.name}`,
      `SĐT        : ${b.customer.phone}`,
      `Email      : ${b.customer.email || 'Không có'}`,
      '───────────────────────────────────────',
      `Yêu cầu ĐB : ${b.specialReqs || 'Không có'}`,
      `Loại đơn   : ${b.type}`,
      `Thanh toán : ${b.payment.paid ? '✅ Đã TT đủ' : `⚠️ ${b.payment.amount.toLocaleString('vi-VN')}đ`}`,
      ...(b.type === 'WELLNESS' ? [
        '───────────────────────────────────────',
        'WELLNESS INFO:',
        `Gói khám   : ${b.wellness.package || 'Chưa xác định'}`,
        `WC phụ trách: ${b.wcAssigned || 'Chưa phân công'}`,
        `NCC y tế   : ${b.wellness.ncc || 'Chưa xác định'}`,
      ] : []),
      '───────────────────────────────────────',
      `⏰ DEADLINE CONFIRM: ${deadline}`,
      `Nguồn      : ${b.source}`,
      '═══════════════════════════════════════',
      'Vui lòng reply xác nhận hoặc báo không khả thi.',
    ].join('\n');

    res.json({ bookingId: b.bookingId, brief, customer: b.customer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
