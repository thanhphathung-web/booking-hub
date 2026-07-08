const router = require('express').Router();
const { dbAsync } = require('../db/database');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { soldForDeparture, availabilityOf } = require('../services/departures');

// Lịch khởi hành — chuyến bán theo ngày + số chỗ (inventory chống overbooking)
// Thuộc miền "sản phẩm" → CEO/PM quản lý (products:manage). Mọi role đọc được để tạo booking.
// departure: { departureId (DEP-xxx), productId, productName (snapshot), date (YYYY-MM-DD),
//   seatsTotal, price (giá bán/khách; 0 = dùng defaultPrice của sản phẩm),
//   status (OPEN|CLOSED|CANCELLED), note, active, createdAt/updatedAt/createdBy }

const isYmd = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const STATUSES = ['OPEN', 'CLOSED', 'CANCELLED'];

// Ghép seatsSold/seatsLeft cho danh sách chuyến (query sold từng chuyến)
async function withAvailability(deps) {
  const out = [];
  for (const d of deps) out.push(availabilityOf(d, await soldForDeparture(d.departureId)));
  return out;
}

// ── GET /api/departures ───────────────────────────────────
// ?productId= &active=true &upcoming=true (chỉ chuyến từ hôm nay trở đi)
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = {};
    if (req.query.productId) q.productId = req.query.productId;
    if (req.query.active === 'true') q.active = true;
    if (req.query.upcoming === 'true') q.date = { $gte: new Date().toISOString().slice(0, 10) };
    const deps = await dbAsync.find('departures', q, { date: 1 });
    res.json({ departures: await withAvailability(deps) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/departures/:id ───────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const dep = await dbAsync.findOne('departures', { departureId: req.params.id });
    if (!dep) return res.status(404).json({ error: 'Không tìm thấy chuyến khởi hành' });
    const sold = await soldForDeparture(dep.departureId);
    // Kèm booking gắn chuyến (tóm tắt) để xem ai đã đặt
    const bs = await dbAsync.find('bookings', { departureId: dep.departureId }, { createdAt: -1 });
    const bookings = bs.map(b => ({ bookingId: b.bookingId, customer: b.customer?.name,
      pax: (b.adults || 0) + (b.children || 0), status: b.status }));
    res.json({ departure: availabilityOf(dep, sold), bookings });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/departures (CEO/PM) ─────────────────────────
router.post('/', ...requirePerm('products:manage'), async (req, res) => {
  try {
    const { productId, date, seatsTotal, price = 0, note = '' } = req.body;
    if (!productId) return res.status(400).json({ error: 'Thiếu sản phẩm (productId)' });
    if (!isYmd(date)) return res.status(400).json({ error: 'Ngày khởi hành phải dạng YYYY-MM-DD' });
    if (!(Number(seatsTotal) > 0)) return res.status(400).json({ error: 'Số chỗ phải lớn hơn 0' });
    const product = await dbAsync.findOne('products', { productId });
    if (!product) return res.status(400).json({ error: 'Sản phẩm không tồn tại' });

    const now = new Date().toISOString();
    const dep = await dbAsync.insert('departures', {
      departureId: 'DEP-' + Date.now().toString(36).toUpperCase(),
      productId, productName: product.name, date,
      seatsTotal: Math.floor(Number(seatsTotal)),
      price: Number(price) || 0,
      status: 'OPEN', note: String(note).trim(), active: true,
      createdAt: now, updatedAt: now, createdBy: req.user.username,
    });
    res.status(201).json({ departure: availabilityOf(dep, 0), message: 'Đã tạo chuyến khởi hành' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/departures/:id (CEO/PM) ────────────────────
router.patch('/:id', ...requirePerm('products:manage'), async (req, res) => {
  try {
    const dep = await dbAsync.findOne('departures', { departureId: req.params.id });
    if (!dep) return res.status(404).json({ error: 'Không tìm thấy chuyến khởi hành' });
    const sold = await soldForDeparture(dep.departureId);

    const upd = { updatedAt: new Date().toISOString() };
    if (req.body.date !== undefined) {
      if (!isYmd(req.body.date)) return res.status(400).json({ error: 'Ngày khởi hành phải dạng YYYY-MM-DD' });
      upd.date = req.body.date;
    }
    if (req.body.seatsTotal !== undefined) {
      const n = Math.floor(Number(req.body.seatsTotal));
      if (!(n > 0)) return res.status(400).json({ error: 'Số chỗ phải lớn hơn 0' });
      if (n < sold) return res.status(409).json({ error: `Đã bán ${sold} chỗ — không thể giảm tổng chỗ xuống dưới ${sold}` });
      upd.seatsTotal = n;
    }
    if (req.body.price !== undefined) upd.price = Number(req.body.price) || 0;
    if (req.body.note !== undefined) upd.note = String(req.body.note).trim();
    if (req.body.status !== undefined) {
      if (!STATUSES.includes(req.body.status)) return res.status(400).json({ error: `Trạng thái không hợp lệ: ${STATUSES.join(', ')}` });
      upd.status = req.body.status;
    }
    await dbAsync.update('departures', { departureId: req.params.id }, { $set: upd });
    const updated = await dbAsync.findOne('departures', { departureId: req.params.id });
    res.json({ departure: availabilityOf(updated, sold), message: 'Đã cập nhật chuyến khởi hành' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/departures/:id/toggle (CEO/PM) — ngừng/mở bán ──
router.patch('/:id/toggle', ...requirePerm('products:manage'), async (req, res) => {
  try {
    const dep = await dbAsync.findOne('departures', { departureId: req.params.id });
    if (!dep) return res.status(404).json({ error: 'Không tìm thấy chuyến khởi hành' });
    await dbAsync.update('departures', { departureId: req.params.id },
      { $set: { active: !dep.active, updatedAt: new Date().toISOString() } });
    res.json({ message: `Đã ${dep.active ? 'ngừng bán' : 'mở bán lại'} chuyến`, active: !dep.active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/departures/:id (CEO only) — chặn nếu đã có booking ──
router.delete('/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  try {
    const count = await dbAsync.count('bookings', { departureId: req.params.id });
    if (count > 0) return res.status(409).json({ error: `Chuyến đã có ${count} booking — ngừng bán thay vì xoá` });
    await dbAsync.remove('departures', { departureId: req.params.id }, {});
    res.json({ message: 'Đã xoá chuyến khởi hành' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
