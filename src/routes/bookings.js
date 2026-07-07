const router = require('express').Router();
const { dbAsync } = require('../db/database');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { ensureChecklist, recomputeDeadlines } = require('../db/tourChecklist');
const { getRunningBookings, tasksFor } = require('../services/tasks');
const { createBooking } = require('../services/createBooking');
const { receiptsTotal, collectedOf, recomputePaid } = require('../services/payments');
const { assessReadiness } = require('../services/readiness');

// Booking status flow:
// NEW → CONFIRMED (Cty1) → IN_PROGRESS → COMPLETED | CANCELLED

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
    const in7days = new Date(Date.now() + 7*86400000).toISOString().slice(0,10);
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
    // Tour khởi hành trong 3 ngày tới mà khách chưa thanh toán đủ — kế toán cần đòi gấp
    const dueSoonUnpaid = await dbAsync.count('bookings',
      { tourDate: { $gte: today, $lte: in3days }, status: { $nin: ['CANCELLED','COMPLETED'] }, 'payment.paid': false });
    // Tour khởi hành trong 7 ngày tới còn dịch vụ NCC chưa xác nhận — nguy cơ "tưởng đã đặt"
    const soonBookings = await dbAsync.find('bookings',
      { tourDate: { $gte: today, $lte: in7days }, status: { $nin: ['CANCELLED','COMPLETED'] } });
    const unconfirmedSoon = soonBookings.filter(b =>
      (b.services || []).some(s => s.status === 'REQUESTED')).length;
    res.json({ total, new: newB, confirmed, inProgress, completed, cancelled, wellness, unpaid, urgent, dueSoonUnpaid, unconfirmedSoon });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/bookings/my-tasks ────────────────────────────
// Checklist item chưa xong của user đang đăng nhập, gom từ mọi booking đang chạy
router.get('/my-tasks', requireAuth, async (req, res) => {
  try {
    const bookings = await getRunningBookings();
    const today = new Date().toISOString().slice(0, 10);
    const tasks = tasksFor(req.user, bookings, today);
    res.json({
      tasks,
      overdue:  tasks.filter(t => t.overdue).length,
      dueToday: tasks.filter(t => t.dueToday).length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Helpers: số ngày tour + khoảng ngày ───────────────────
// Ưu tiên durationDays của sản phẩm; không có thì đoán từ tên ("Tour Đà Lạt 3N2Đ" → 3); mặc định 1
async function getDurationDays(b) {
  if (b.productId) {
    const p = await dbAsync.findOne('products', { productId: b.productId });
    if (p?.durationDays) return p.durationDays;
  }
  const m = String(b.product || '').match(/(\d+)\s*N/i);
  return m ? Math.max(1, Math.min(30, parseInt(m[1]))) : 1;
}

function addDaysYmd(ymd, n) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── GET /api/bookings/calendar ────────────────────────────
// Booking cho lịch tháng — gồm cả tour bắt đầu trước nhưng kéo dài vào tháng
router.get('/calendar', ...requirePerm('bookings:read'), async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month
      : new Date().toISOString().slice(0, 7);
    const monthStart = month + '-01';
    const monthEnd = addDaysYmd(addDaysYmd(monthStart, 32).slice(0, 7) + '-01', -1);
    const bookings = await dbAsync.find('bookings', {
      status: { $ne: 'CANCELLED' },
      tourDate: { $gte: addDaysYmd(monthStart, -30), $lte: monthEnd }, // đệm 30 ngày cho tour dài
    }, { tourDate: 1 });

    const items = [];
    for (const b of bookings) {
      const days = await getDurationDays(b);
      const endDate = addDaysYmd(b.tourDate, days - 1);
      if (endDate < monthStart) continue; // kết thúc trước tháng đang xem
      items.push({ bookingId: b.bookingId, product: b.product, tourDate: b.tourDate,
        endDate, days, status: b.status, type: b.type, assignedTo: b.assignedTo,
        pax: (b.adults || 0) + (b.children || 0) });
    }
    res.json({ month, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/bookings/:id ─────────────────────────────────
router.get('/:id', ...requirePerm('bookings:read'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    const ensured = ensureChecklist(booking);
    if (ensured) {
      await dbAsync.update('bookings', { bookingId: booking.bookingId }, { $set: { checklist: ensured } });
      booking.checklist = ensured;
    }
    res.json({ booking });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/bookings ────────────────────────────────────
// Admin form (website CTY2 dùng /api/webhook/bookings với API key)
router.post('/', ...requirePerm('bookings:create'), async (req, res) => {
  try {
    const saved = await createBooking(req.body, req.user.username);
    res.status(201).json({ booking: saved, message: 'Booking đã được tạo' });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// ── PATCH /api/bookings/:id ───────────────────────────────
// Sửa thông tin booking (khách đổi ngày, sai SĐT...). Đổi tourDate → tính lại deadline checklist chưa done
router.patch('/:id', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    if (['COMPLETED', 'CANCELLED'].includes(booking.status))
      return res.status(409).json({ error: `Booking đã ${booking.status} — không sửa được nữa` });

    const upd = {};
    if (req.body.product) upd.product = String(req.body.product).trim();
    if (req.body.tourDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.tourDate))
        return res.status(400).json({ error: 'tourDate phải dạng YYYY-MM-DD' });
      upd.tourDate = req.body.tourDate;
    }
    if (req.body.adults   !== undefined) upd.adults   = Math.max(1, parseInt(req.body.adults) || 1);
    if (req.body.children !== undefined) upd.children = Math.max(0, parseInt(req.body.children) || 0);
    if (req.body.specialReqs !== undefined) upd.specialReqs = String(req.body.specialReqs).trim();
    if (req.body.customer) {
      upd.customer = { ...booking.customer };
      for (const f of ['name', 'phone', 'email']) {
        if (req.body.customer[f] !== undefined) upd.customer[f] = String(req.body.customer[f]).trim();
      }
      if (!upd.customer.name || !upd.customer.phone)
        return res.status(400).json({ error: 'Tên và SĐT khách không được trống' });
    }
    if (req.body.wellness && booking.type === 'WELLNESS')
      upd.wellness = { ...booking.wellness, ...req.body.wellness };
    if (Object.keys(upd).length === 0) return res.status(400).json({ error: 'Không có gì để cập nhật' });

    // Đổi ngày khởi hành → deadline checklist chưa done phải chạy theo
    if (upd.tourDate && upd.tourDate !== booking.tourDate) {
      const recomputed = recomputeDeadlines({ ...booking, tourDate: upd.tourDate });
      if (recomputed) upd.checklist = recomputed;
    }

    const now = new Date().toISOString();
    upd.updatedAt = now;
    await dbAsync.update('bookings', { bookingId: req.params.id }, { $set: upd });
    await dbAsync.insert('activity', { type: 'BOOKING_UPDATED', bookingId: req.params.id,
      to: Object.keys(upd).filter(k => k !== 'updatedAt' && k !== 'checklist').join(','),
      by: req.user.username, at: now });

    const updated = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    res.json({ booking: updated, message: 'Đã cập nhật booking' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/bookings/:id/payment ───────────────────────
// Cập nhật thanh toán — chỉ CEO/Kế toán (finance:payment)
router.patch('/:id/payment', ...requirePerm('finance:payment'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });

    const payment = { ...booking.payment };
    if (req.body.amount !== undefined) {
      const amt = Number(req.body.amount);
      if (isNaN(amt) || amt < 0) return res.status(400).json({ error: 'Số tiền không hợp lệ' });
      payment.amount = amt;
    }
    if (req.body.paid !== undefined) payment.paid = !!req.body.paid;
    // Đã có receipts thì paid luôn suy ra từ tổng đã thu — không toggle tay được nữa
    if ((payment.receipts || []).length) recomputePaid(payment);

    const now = new Date().toISOString();
    await dbAsync.update('bookings', { bookingId: req.params.id },
      { $set: { payment, updatedAt: now } });
    await dbAsync.insert('activity', { type: 'PAYMENT_UPDATED', bookingId: req.params.id,
      to: `${payment.amount}|${payment.paid ? 'paid' : 'unpaid'}`, by: req.user.username, at: now });
    res.json({ payment, message: payment.paid ? 'Đã đánh dấu thanh toán đủ' : 'Đã cập nhật thanh toán' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/bookings/:id/payments ───────────────────────
// Ghi nhận 1 lần thu tiền khách (cọc / trả nốt) — CEO/Kế toán (finance:payment)
const PAY_METHODS = ['CASH', 'BANK', 'CARD', 'OTHER'];

router.post('/:id/payments', ...requirePerm('finance:payment'), async (req, res) => {
  try {
    const { amount, method = 'BANK', note = '', date } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
    if (!PAY_METHODS.includes(method))
      return res.status(400).json({ error: `Hình thức không hợp lệ. Dùng: ${PAY_METHODS.join(', ')}` });
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return res.status(400).json({ error: 'Ngày thu phải dạng YYYY-MM-DD' });

    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    if (booking.status === 'CANCELLED')
      return res.status(409).json({ error: 'Booking đã huỷ — không ghi nhận thu tiền' });

    const now = new Date().toISOString();
    const payment = { ...booking.payment };
    payment.receipts = payment.receipts || [];
    const receipt = {
      rcptId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      amount: amt, method, date: date || now.slice(0, 10), note: String(note).trim(),
      by: req.user.username, name: req.user.name, at: now,
    };
    payment.receipts.push(receipt);
    recomputePaid(payment);

    await dbAsync.update('bookings', { bookingId: req.params.id },
      { $set: { payment, updatedAt: now } });
    await dbAsync.insert('activity', { type: 'PAYMENT_RECEIVED', bookingId: req.params.id,
      to: `${amt}|${method}`, by: req.user.username, at: now });

    const collected = receiptsTotal(payment);
    res.status(201).json({
      message: payment.paid ? '✅ Đã thu đủ tiền booking' : 'Đã ghi nhận thu tiền',
      receipt, payment, collected,
      remaining: Math.max(0, (payment.amount || 0) - collected),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/bookings/:id/payments/:rcptId ─────────────
// Xoá 1 lần thu ghi nhầm — CEO/Kế toán (finance:payment)
router.delete('/:id/payments/:rcptId', ...requirePerm('finance:payment'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    const receipts = booking.payment?.receipts || [];
    const entry = receipts.find(x => x.rcptId === req.params.rcptId);
    if (!entry) return res.status(404).json({ error: 'Không tìm thấy lần thu này' });

    const now = new Date().toISOString();
    const payment = { ...booking.payment, receipts: receipts.filter(x => x.rcptId !== req.params.rcptId) };
    recomputePaid(payment);
    await dbAsync.update('bookings', { bookingId: req.params.id },
      { $set: { payment, updatedAt: now } });
    await dbAsync.insert('activity', { type: 'PAYMENT_DELETED', bookingId: req.params.id,
      from: `${entry.amount}|${entry.method}`, by: req.user.username, at: now });
    res.json({ message: 'Đã xoá lần thu', payment, collected: receiptsTotal(payment) });
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

    // Điểm chặn duy nhất: không đóng booking khi TPDH chưa duyệt Closing Report
    if (status === 'COMPLETED') {
      const pt08 = (booking.checklist || []).find(i => i.code === 'PT-08');
      if (pt08 && !pt08.done)
        return res.status(409).json({ error: 'Chưa thể đóng booking: TPDH cần duyệt Tour Closing Report (tick PT-08) trước' });
    }

    const now = new Date().toISOString();
    const histEntry = { status, by: req.user.username, at: now };
    if (note) histEntry.note = note;

    // Sinh thêm giai đoạn checklist tương ứng status mới
    const setFields = { status, updatedAt: now };
    const ensured = ensureChecklist({ ...booking, status });
    if (ensured) setFields.checklist = ensured;

    await dbAsync.update('bookings',
      { bookingId: req.params.id },
      { $set: setFields, $push: { statusHistory: histEntry } }
    );

    await dbAsync.insert('activity', { type:'STATUS_CHANGED', bookingId: req.params.id,
      from: booking.status, to: status, by: req.user.username, at: now });

    const updated = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    res.json({ message: `Đã cập nhật status → ${status}`, booking: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/bookings/:id/assign ───────────────────────
// Chống trùng lịch: NVDH đã có tour chồng ngày → 409 kèm danh sách; gửi lại với force=true để vẫn phân công
router.patch('/:id/assign', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const { assignedTo, wcAssigned, force } = req.body;
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });

    if (assignedTo && assignedTo !== booking.assignedTo && !force) {
      const days = await getDurationDays(booking);
      const start = booking.tourDate;
      const end = addDaysYmd(start, days - 1);
      const others = await dbAsync.find('bookings', {
        assignedTo, status: { $nin: ['CANCELLED', 'COMPLETED'] },
        bookingId: { $ne: req.params.id },
      });
      const conflicts = [];
      for (const o of others) {
        const oDays = await getDurationDays(o);
        const oEnd = addDaysYmd(o.tourDate, oDays - 1);
        if (o.tourDate <= end && start <= oEnd)
          conflicts.push({ bookingId: o.bookingId, product: o.product, tourDate: o.tourDate, days: oDays });
      }
      if (conflicts.length) {
        return res.status(409).json({
          error: `⚠️ ${assignedTo} đã có ${conflicts.length} tour trùng lịch (${start} → ${end})`,
          conflicts,
        });
      }
    }

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

// ── PATCH /api/bookings/:id/checklist/:code ───────────────
// Tick / untick 1 item checklist tour. CEO/TPDH tick được mọi item, role khác chỉ tick item của role mình
router.patch('/:id/checklist/:code', requireAuth, async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });

    const checklist = booking.checklist || [];
    const item = checklist.find(i => i.code === req.params.code);
    if (!item) return res.status(404).json({ error: `Không tìm thấy item ${req.params.code}` });

    const canTick = ['CEO', 'TPDH'].includes(req.user.role) || item.role === req.user.role;
    if (!canTick) return res.status(403).json({ error: `Việc này thuộc trách nhiệm role ${item.role}` });

    const now = new Date().toISOString();
    if (req.body.done !== false) {
      item.done = true; item.doneBy = req.user.username;
      item.doneName = req.user.name; item.doneAt = now;
      if (req.body.note) item.note = req.body.note;
    } else {
      item.done = false; item.doneBy = null; item.doneName = null; item.doneAt = null;
    }

    // NeDB không $set được phần tử trong array — ghi đè cả mảng (quirk #3)
    await dbAsync.update('bookings', { bookingId: req.params.id },
      { $set: { checklist, updatedAt: now } });
    await dbAsync.insert('activity', { type: 'CHECKLIST_TICK', bookingId: req.params.id,
      from: item.done ? null : 'DONE', to: item.code, by: req.user.username, at: now });

    res.json({ message: item.done ? `Đã hoàn thành ${item.code}` : `Đã bỏ tick ${item.code}`, checklist });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/bookings/:id/expenses ───────────────────────
// Sổ chi phí thực tế — đầu vào cho quyết toán PT-07
const EXPENSE_CATEGORIES = ['XE', 'KHACHSAN', 'ANUONG', 'VE', 'BAOHIEM', 'YTE', 'KHAC'];

router.post('/:id/expenses', requireAuth, async (req, res) => {
  try {
    const { category = 'KHAC', desc, amount, hasReceipt = false, nccId = null, dueDate = null } = req.body;
    if (!desc || !desc.trim()) return res.status(400).json({ error: 'Thiếu mô tả khoản chi' });
    const amt = Number(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Số tiền phải lớn hơn 0' });
    if (!EXPENSE_CATEGORIES.includes(category))
      return res.status(400).json({ error: `Loại chi không hợp lệ. Dùng: ${EXPENSE_CATEGORIES.join(', ')}` });
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))
      return res.status(400).json({ error: 'Hạn trả phải dạng YYYY-MM-DD' });

    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });

    const now = new Date().toISOString();
    const entry = {
      expId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      category, desc: desc.trim(), amount: amt, hasReceipt: !!hasReceipt,
      // Công nợ NCC: gắn nccId là khoản này vào sổ công nợ; paidNcc = đã thanh toán cho NCC chưa
      nccId: nccId || null, dueDate: dueDate || null, paidNcc: false,
      by: req.user.username, name: req.user.name, at: now,
    };
    await dbAsync.update('bookings', { bookingId: req.params.id },
      { $set: { updatedAt: now }, $push: { expenses: entry } });
    res.status(201).json({ message: 'Đã ghi khoản chi', expense: entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/bookings/:id/expenses/:expId/paid ──────────
// Đánh dấu đã/chưa thanh toán khoản chi cho NCC — CEO/KETOAN (finance:payment)
router.patch('/:id/expenses/:expId/paid', ...requirePerm('finance:payment'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    const entry = (booking.expenses || []).find(x => x.expId === req.params.expId);
    if (!entry) return res.status(404).json({ error: 'Không tìm thấy khoản chi' });

    const now = new Date().toISOString();
    entry.paidNcc = req.body.paid !== false;
    entry.paidNccBy = entry.paidNcc ? req.user.username : null;
    entry.paidNccAt = entry.paidNcc ? now : null;
    await dbAsync.update('bookings', { bookingId: req.params.id },
      { $set: { expenses: booking.expenses, updatedAt: now } });
    await dbAsync.insert('activity', { type: 'NCC_PAID', bookingId: req.params.id,
      from: entry.paidNcc ? null : 'PAID', to: `${entry.desc}|${entry.amount}`, by: req.user.username, at: now });
    res.json({ message: entry.paidNcc ? 'Đã đánh dấu thanh toán NCC' : 'Đã bỏ đánh dấu thanh toán' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/bookings/:id/expenses/:expId ──────────────
router.delete('/:id/expenses/:expId', requireAuth, async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    const entry = (booking.expenses || []).find(x => x.expId === req.params.expId);
    if (!entry) return res.status(404).json({ error: 'Không tìm thấy khoản chi' });

    const canDelete = ['CEO', 'TPDH', 'KETOAN'].includes(req.user.role) || entry.by === req.user.username;
    if (!canDelete) return res.status(403).json({ error: 'Chỉ người ghi hoặc CEO/TPDH/Kế toán được xoá khoản chi' });

    const expenses = booking.expenses.filter(x => x.expId !== req.params.expId);
    await dbAsync.update('bookings', { bookingId: req.params.id },
      { $set: { expenses, updatedAt: new Date().toISOString() } });
    res.json({ message: 'Đã xoá khoản chi' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/bookings/:id/daily-report ───────────────────
// Daily Tour Report có cấu trúc (OP-03)
router.post('/:id/daily-report', requireAuth, async (req, res) => {
  try {
    const { date, summary, groupStatus = 'OK', incidents = '', supplierRating } = req.body;
    if (!summary || !summary.trim()) return res.status(400).json({ error: 'Thiếu tóm tắt hành trình trong ngày' });
    if (!['OK', 'ISSUE'].includes(groupStatus))
      return res.status(400).json({ error: 'groupStatus phải là OK hoặc ISSUE' });

    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });

    const now = new Date().toISOString();
    const report = {
      date: date || now.slice(0, 10),
      summary: summary.trim(), groupStatus, incidents: incidents.trim(),
      supplierRating: supplierRating ? Math.min(5, Math.max(1, Number(supplierRating))) : null,
      by: req.user.username, name: req.user.name, at: now,
    };
    await dbAsync.update('bookings', { bookingId: req.params.id },
      { $set: { updatedAt: now }, $push: { dailyReports: report } });
    res.status(201).json({ message: 'Đã nộp Daily Tour Report', report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Passengers (hồ sơ từng hành khách) ────────────────────
// Diệt lỗi sai tên vé/visa, thiếu thông tin y tế & liên hệ khẩn — nuôi manifest + Go/No-Go
const PAX_ID_TYPES = ['CCCD', 'CMND', 'PASSPORT', 'OTHER'];
const PAX_GENDERS  = ['M', 'F', 'OTHER'];

function sanitizePax(body, base = {}) {
  const p = { ...base };
  const S = v => String(v == null ? '' : v).trim();
  if (body.fullName       !== undefined) p.fullName       = S(body.fullName);
  if (body.phone          !== undefined) p.phone          = S(body.phone);
  if (body.dob            !== undefined) p.dob            = S(body.dob);
  if (body.gender         !== undefined) p.gender         = PAX_GENDERS.includes(body.gender) ? body.gender : '';
  if (body.idType         !== undefined) p.idType         = PAX_ID_TYPES.includes(body.idType) ? body.idType : 'CCCD';
  if (body.idNumber       !== undefined) p.idNumber       = S(body.idNumber);
  if (body.nationality    !== undefined) p.nationality    = S(body.nationality) || 'VN';
  if (body.passportExpiry !== undefined) p.passportExpiry = S(body.passportExpiry);
  if (body.dietary        !== undefined) p.dietary        = S(body.dietary);
  if (body.medical        !== undefined) p.medical        = S(body.medical);
  if (body.emergencyName  !== undefined) p.emergencyName  = S(body.emergencyName);
  if (body.emergencyPhone !== undefined) p.emergencyPhone = S(body.emergencyPhone);
  if (body.emergencyRel   !== undefined) p.emergencyRel   = S(body.emergencyRel);
  if (body.isLead         !== undefined) p.isLead         = !!body.isLead;
  return p;
}

function paxDateErr(p) {
  for (const f of ['dob', 'passportExpiry']) {
    if (p[f] && !/^\d{4}-\d{2}-\d{2}$/.test(p[f])) return `${f} phải dạng YYYY-MM-DD`;
  }
  return null;
}

router.post('/:id/passengers', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    if (['COMPLETED', 'CANCELLED'].includes(booking.status))
      return res.status(409).json({ error: `Booking đã ${booking.status} — không sửa hành khách được nữa` });

    const now = new Date().toISOString();
    const pax = sanitizePax(req.body, {
      paxId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      idType: 'CCCD', nationality: 'VN', isLead: false,
      by: req.user.username, name: req.user.name, at: now,
    });
    if (!pax.fullName) return res.status(400).json({ error: 'Thiếu họ tên hành khách' });
    const dErr = paxDateErr(pax);
    if (dErr) return res.status(400).json({ error: dErr });

    const passengers = booking.passengers || [];
    // Chỉ 1 trưởng đoàn — set người mới làm lead thì bỏ lead người cũ
    if (pax.isLead) passengers.forEach(x => { x.isLead = false; });
    passengers.push(pax);
    await dbAsync.update('bookings', { bookingId: req.params.id }, { $set: { passengers, updatedAt: now } });
    await dbAsync.insert('activity', { type: 'PAX_ADDED', bookingId: req.params.id,
      to: pax.fullName, by: req.user.username, at: now });
    res.status(201).json({ message: 'Đã thêm hành khách', passenger: pax });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/passengers/:paxId', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    if (['COMPLETED', 'CANCELLED'].includes(booking.status))
      return res.status(409).json({ error: `Booking đã ${booking.status} — không sửa hành khách được nữa` });

    const passengers = booking.passengers || [];
    const target = passengers.find(x => x.paxId === req.params.paxId);
    if (!target) return res.status(404).json({ error: 'Không tìm thấy hành khách' });

    const updated = sanitizePax(req.body, target);
    if (!updated.fullName) return res.status(400).json({ error: 'Họ tên không được trống' });
    const dErr = paxDateErr(updated);
    if (dErr) return res.status(400).json({ error: dErr });
    Object.assign(target, updated);
    if (target.isLead) passengers.forEach(x => { if (x !== target) x.isLead = false; });

    const now = new Date().toISOString();
    await dbAsync.update('bookings', { bookingId: req.params.id }, { $set: { passengers, updatedAt: now } });
    res.json({ message: 'Đã cập nhật hành khách', passenger: target });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/passengers/:paxId', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    if (['COMPLETED', 'CANCELLED'].includes(booking.status))
      return res.status(409).json({ error: `Booking đã ${booking.status} — không sửa hành khách được nữa` });
    const passengers = (booking.passengers || []).filter(x => x.paxId !== req.params.paxId);
    if (passengers.length === (booking.passengers || []).length)
      return res.status(404).json({ error: 'Không tìm thấy hành khách' });
    await dbAsync.update('bookings', { bookingId: req.params.id },
      { $set: { passengers, updatedAt: new Date().toISOString() } });
    res.json({ message: 'Đã xoá hành khách' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Đặt dịch vụ NCC + trạng thái xác nhận ─────────────────
// Chống lỗi kinh điển "tưởng đã đặt rồi": mỗi dịch vụ đi qua REQUESTED → CONFIRMED (số voucher/PO) → CANCELLED.
// Đây là lớp giữ chỗ (khác sổ chi phí/công nợ — chỉ theo dõi tiền). Nuôi Go/No-Go + cảnh báo dashboard.
const SERVICE_CATEGORIES = ['XE', 'KHACHSAN', 'ANUONG', 'VE', 'BAOHIEM', 'YTE', 'KHAC'];
const SERVICE_STATUSES   = ['REQUESTED', 'CONFIRMED', 'CANCELLED'];

router.post('/:id/services', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const { category = 'KHAC', desc, nccId = null, note = '' } = req.body;
    if (!desc || !desc.trim()) return res.status(400).json({ error: 'Thiếu mô tả dịch vụ' });
    if (!SERVICE_CATEGORIES.includes(category))
      return res.status(400).json({ error: `Loại dịch vụ không hợp lệ. Dùng: ${SERVICE_CATEGORIES.join(', ')}` });

    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    if (['COMPLETED', 'CANCELLED'].includes(booking.status))
      return res.status(409).json({ error: `Booking đã ${booking.status} — không thêm dịch vụ được nữa` });

    const now = new Date().toISOString();
    const svc = {
      svcId: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      category, desc: desc.trim(), nccId: nccId || null, status: 'REQUESTED',
      voucherNo: '', confirmedBy: null, confirmedName: null, confirmedAt: null,
      note: String(note).trim(), by: req.user.username, name: req.user.name, at: now,
    };
    await dbAsync.update('bookings', { bookingId: req.params.id },
      { $set: { updatedAt: now }, $push: { services: svc } });
    await dbAsync.insert('activity', { type: 'SVC_ADDED', bookingId: req.params.id,
      to: svc.desc, by: req.user.username, at: now });
    res.status(201).json({ message: 'Đã thêm dịch vụ cần đặt', service: svc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:id/services/:svcId', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    const services = booking.services || [];
    const svc = services.find(x => x.svcId === req.params.svcId);
    if (!svc) return res.status(404).json({ error: 'Không tìm thấy dịch vụ' });

    const now = new Date().toISOString();
    if (req.body.category !== undefined) {
      if (!SERVICE_CATEGORIES.includes(req.body.category))
        return res.status(400).json({ error: 'Loại dịch vụ không hợp lệ' });
      svc.category = req.body.category;
    }
    if (req.body.desc !== undefined) {
      const d = String(req.body.desc).trim();
      if (!d) return res.status(400).json({ error: 'Mô tả không được trống' });
      svc.desc = d;
    }
    if (req.body.nccId     !== undefined) svc.nccId     = req.body.nccId || null;
    if (req.body.note      !== undefined) svc.note      = String(req.body.note).trim();
    if (req.body.voucherNo !== undefined) svc.voucherNo = String(req.body.voucherNo).trim();
    if (req.body.status    !== undefined) {
      if (!SERVICE_STATUSES.includes(req.body.status))
        return res.status(400).json({ error: `Trạng thái không hợp lệ. Dùng: ${SERVICE_STATUSES.join(', ')}` });
      svc.status = req.body.status;
      if (svc.status === 'CONFIRMED') {
        svc.confirmedBy = req.user.username; svc.confirmedName = req.user.name; svc.confirmedAt = now;
      } else {
        svc.confirmedBy = null; svc.confirmedName = null; svc.confirmedAt = null;
      }
    }
    await dbAsync.update('bookings', { bookingId: req.params.id }, { $set: { services, updatedAt: now } });
    await dbAsync.insert('activity', { type: 'SVC_UPDATED', bookingId: req.params.id,
      to: `${svc.desc}|${svc.status}`, by: req.user.username, at: now });
    res.json({ message: 'Đã cập nhật dịch vụ', service: svc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id/services/:svcId', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    const services = (booking.services || []).filter(x => x.svcId !== req.params.svcId);
    if (services.length === (booking.services || []).length)
      return res.status(404).json({ error: 'Không tìm thấy dịch vụ' });
    await dbAsync.update('bookings', { bookingId: req.params.id },
      { $set: { services, updatedAt: new Date().toISOString() } });
    res.json({ message: 'Đã xoá dịch vụ' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Chương trình tour (itinerary) + rooming list ──────────
// Lịch trình ngày-by-ngày + suất ăn + nơi nghỉ; nuôi Tour File, Pre-trip package, manifest.
// Dùng PUT thay toàn bộ (editor gửi cả state) — đơn giản & chắc với NeDB.
function sanitizeItinerary(body) {
  const days = Array.isArray(body.days) ? body.days : [];
  return days.slice(0, 60).map((d, i) => ({
    day: i + 1,
    title: String(d.title || '').trim().slice(0, 200),
    activities: (Array.isArray(d.activities) ? d.activities : []).slice(0, 60).map(a => ({
      time: String(a.time || '').trim().slice(0, 20),
      desc: String(a.desc || '').trim().slice(0, 500),
    })).filter(a => a.time || a.desc),
    meals: { B: !!(d.meals && d.meals.B), L: !!(d.meals && d.meals.L), D: !!(d.meals && d.meals.D) },
    hotel: String(d.hotel || '').trim().slice(0, 200),
    note: String(d.note || '').trim().slice(0, 500),
  }));
}

function sanitizeRooming(body) {
  const rooms = Array.isArray(body.rooms) ? body.rooms : [];
  return rooms.slice(0, 60).map(r => ({
    roomType: String(r.roomType || '').trim().slice(0, 60),
    roomNo: String(r.roomNo || '').trim().slice(0, 30),
    guests: (Array.isArray(r.guests) ? r.guests : []).slice(0, 12).map(g => String(g || '').trim()).filter(Boolean),
    note: String(r.note || '').trim().slice(0, 200),
  })).filter(r => r.roomType || r.roomNo || r.guests.length);
}

router.put('/:id/itinerary', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    if (booking.status === 'CANCELLED')
      return res.status(409).json({ error: 'Booking đã huỷ — không sửa chương trình' });
    const now = new Date().toISOString();
    const itinerary = { days: sanitizeItinerary(req.body), updatedBy: req.user.username, updatedAt: now };
    await dbAsync.update('bookings', { bookingId: req.params.id }, { $set: { itinerary, updatedAt: now } });
    await dbAsync.insert('activity', { type: 'ITINERARY_SAVED', bookingId: req.params.id,
      to: `${itinerary.days.length} ngày`, by: req.user.username, at: now });
    res.json({ message: 'Đã lưu chương trình tour', itinerary });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id/rooming', ...requirePerm('bookings:update'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    if (booking.status === 'CANCELLED')
      return res.status(409).json({ error: 'Booking đã huỷ — không sửa rooming' });
    const now = new Date().toISOString();
    const rooming = { rooms: sanitizeRooming(req.body), updatedBy: req.user.username, updatedAt: now };
    await dbAsync.update('bookings', { bookingId: req.params.id }, { $set: { rooming, updatedAt: now } });
    res.json({ message: 'Đã lưu rooming list', rooming });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/bookings/:id/readiness ───────────────────────
// Go/No-Go: bảng chấm sẵn sàng khởi hành (BẮT BUỘC + cảnh báo)
router.get('/:id/readiness', ...requirePerm('bookings:read'), async (req, res) => {
  try {
    const booking = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!booking) return res.status(404).json({ error: 'Không tìm thấy booking' });
    const ensured = ensureChecklist(booking);
    if (ensured) booking.checklist = ensured;
    res.json({ bookingId: booking.bookingId, readiness: assessReadiness(booking) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/bookings/:id/brief ───────────────────────────
// Generate Booking Brief text for Cty1
router.get('/:id/brief', ...requirePerm('bookings:read'), async (req, res) => {
  try {
    const b = await dbAsync.findOne('bookings', { bookingId: req.params.id });
    if (!b) return res.status(404).json({ error: 'Không tìm thấy booking' });

    const deadline = new Date(Date.now() + 4*3600000).toLocaleString('vi-VN');
    const vnd = n => Number(n || 0).toLocaleString('vi-VN');
    const collected = collectedOf(b);
    const payLine = b.payment.paid ? '✅ Đã TT đủ'
      : collected > 0 ? `🟡 Đã thu ${vnd(collected)}đ / ${vnd(b.payment.amount)}đ — còn thiếu ${vnd(Math.max(0, b.payment.amount - collected))}đ`
      : `⚠️ Chưa thu — ${vnd(b.payment.amount)}đ`;
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
      `Thanh toán : ${payLine}`,
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
