const router = require('express').Router();
const { dbAsync } = require('../db/database');
const { requireAuth, requirePerm } = require('../middleware/auth');

// CRM khách hàng — hồ sơ gom từ bookings theo SĐT (không lưu trùng dữ liệu),
// customers.db chỉ chứa phần bổ sung: ghi chú chăm sóc
// Hạng khách: VIP (≥3 tour hoặc đã chi ≥50tr) | THANTHIET (2 tour) | MOI (1 tour)

function normPhone(p) { return String(p || '').replace(/\D/g, ''); }

function tierOf(c) {
  if (c.bookings >= 3 || c.totalPaid >= 50000000) return 'VIP';
  if (c.bookings === 2) return 'THANTHIET';
  return 'MOI';
}

function aggregate(bookings) {
  const today = new Date().toISOString().slice(0, 10);
  const map = {};
  for (const b of bookings) { // bookings sort createdAt desc → tên/email lấy từ booking mới nhất
    const key = normPhone(b.customer?.phone);
    if (!key) continue;
    if (!map[key]) map[key] = { phoneKey: key, phone: b.customer.phone, name: b.customer.name,
      email: b.customer.email || '', bookings: 0, cancelled: 0, totalPaid: 0, totalValue: 0,
      pax: 0, lastTourDate: null, wellness: false, upcoming: false };
    const c = map[key];
    if (!c.email && b.customer.email) c.email = b.customer.email;
    if (b.status === 'CANCELLED') { c.cancelled++; continue; }
    c.bookings++;
    c.pax += (b.adults || 0) + (b.children || 0);
    c.totalValue += b.payment?.amount || 0;
    if (b.payment?.paid) c.totalPaid += b.payment?.amount || 0;
    if (!c.lastTourDate || b.tourDate > c.lastTourDate) c.lastTourDate = b.tourDate;
    if (b.type === 'WELLNESS') c.wellness = true;
    if (b.tourDate >= today && b.status !== 'COMPLETED') c.upcoming = true;
  }
  return Object.values(map).map(c => ({ ...c, tier: tierOf(c) }));
}

// ── GET /api/customers ────────────────────────────────────
router.get('/', ...requirePerm('bookings:read'), async (req, res) => {
  try {
    const bookings = await dbAsync.find('bookings', {}, { createdAt: -1 });
    let customers = aggregate(bookings);
    if (req.query.search) {
      const escaped = req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped, 'i');
      const digits = normPhone(req.query.search);
      customers = customers.filter(c => re.test(c.name) || (digits && c.phoneKey.includes(digits)));
    }
    customers.sort((a, b) => (b.totalPaid - a.totalPaid) || (b.totalValue - a.totalValue));
    res.json({ customers, total: customers.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/customers/:phone ─────────────────────────────
// Hồ sơ chi tiết: thống kê + lịch sử booking + ghi chú chăm sóc
router.get('/:phone', ...requirePerm('bookings:read'), async (req, res) => {
  try {
    const key = normPhone(req.params.phone);
    if (!key) return res.status(400).json({ error: 'SĐT không hợp lệ' });
    const all = await dbAsync.find('bookings', {}, { createdAt: -1 });
    const history = all.filter(b => normPhone(b.customer?.phone) === key)
      .map(b => ({ bookingId: b.bookingId, product: b.product, tourDate: b.tourDate,
        status: b.status, type: b.type, amount: b.payment?.amount || 0, paid: !!b.payment?.paid,
        pax: (b.adults || 0) + (b.children || 0) }));
    if (!history.length) return res.status(404).json({ error: 'Không tìm thấy khách hàng' });

    const profile = aggregate(all.filter(b => normPhone(b.customer?.phone) === key))[0];
    const doc = await dbAsync.findOne('customers', { phone: key });
    res.json({ customer: profile, history, notes: doc?.notes || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/customers/:phone/note ───────────────────────
router.post('/:phone/note', requireAuth, async (req, res) => {
  try {
    const key = normPhone(req.params.phone);
    const text = (req.body.text || '').trim();
    if (!key)  return res.status(400).json({ error: 'SĐT không hợp lệ' });
    if (!text) return res.status(400).json({ error: 'Ghi chú không được trống' });

    const entry = { text, by: req.user.username, name: req.user.name, at: new Date().toISOString() };
    const doc = await dbAsync.findOne('customers', { phone: key });
    if (doc) await dbAsync.update('customers', { phone: key }, { $push: { notes: entry } });
    else     await dbAsync.insert('customers', { phone: key, notes: [entry] });
    res.status(201).json({ message: 'Đã thêm ghi chú khách hàng' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
