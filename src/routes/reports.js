const router = require('express').Router();
const { dbAsync } = require('../db/database');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { collectedOf } = require('../services/payments');

// Post Analysis (giai đoạn 6): lãi/lỗ per tour, hiệu quả per sản phẩm, xếp hạng NCC
// Chỉ tính tour COMPLETED — tour chưa xong chưa quyết toán được

const CAN_VIEW = ['CEO', 'KETOAN', 'TPDH'];

router.get('/post-analysis', requireAuth, async (req, res) => {
  if (!CAN_VIEW.includes(req.user.role))
    return res.status(403).json({ error: 'Chỉ CEO / Kế toán / TPDH xem được báo cáo này' });
  try {
    const q = { status: 'COMPLETED' };
    if (req.query.from || req.query.to) {
      q.tourDate = {};
      if (req.query.from) q.tourDate.$gte = req.query.from;
      if (req.query.to)   q.tourDate.$lte = req.query.to;
    }
    const bookings = await dbAsync.find('bookings', q, { tourDate: -1 });

    // ── Per tour ──────────────────────────────────────────
    const tours = bookings.map(b => {
      const revenue  = b.payment?.amount || 0;
      const actual   = (b.expenses || []).reduce((s, e) => s + (e.amount || 0), 0);
      const estimate = b.costEstimate != null ? b.costEstimate : null;
      const profit   = revenue - actual;
      return {
        bookingId: b.bookingId, product: b.product, productId: b.productId || null,
        tourDate: b.tourDate, pax: (b.adults || 0) + (b.children || 0), type: b.type,
        revenue, estimate, actual, profit,
        variance: estimate != null ? actual - estimate : null,   // dương = vượt dự toán
        margin: revenue > 0 ? Math.round(profit / revenue * 100) : null,
      };
    });

    // ── Summary ───────────────────────────────────────────
    const totalRevenue = tours.reduce((s, t) => s + t.revenue, 0);
    const totalCost    = tours.reduce((s, t) => s + t.actual, 0);
    const totalProfit  = totalRevenue - totalCost;
    const summary = {
      tourCount: tours.length,
      totalRevenue, totalCost, totalProfit,
      avgMargin: totalRevenue > 0 ? Math.round(totalProfit / totalRevenue * 100) : null,
      profitable: tours.filter(t => t.profit > 0).length,
      losing:     tours.filter(t => t.profit < 0).length,
      overBudget: tours.filter(t => t.variance != null && t.variance > 0).length,
    };

    // ── Per product ───────────────────────────────────────
    const byProductMap = {};
    for (const t of tours) {
      const key = t.productId || t.product;
      if (!byProductMap[key]) byProductMap[key] = { product: t.product, productId: t.productId,
        tourCount: 0, pax: 0, revenue: 0, cost: 0 };
      const g = byProductMap[key];
      g.tourCount++; g.pax += t.pax; g.revenue += t.revenue; g.cost += t.actual;
    }
    const byProduct = Object.values(byProductMap).map(g => ({
      ...g, profit: g.revenue - g.cost,
      margin: g.revenue > 0 ? Math.round((g.revenue - g.cost) / g.revenue * 100) : null,
    })).sort((a, b) => b.profit - a.profit);

    // ── NCC ranking ───────────────────────────────────────
    const allSuppliers = await dbAsync.find('suppliers', {}, { name: 1 });
    const suppliers = allSuppliers
      .filter(s => (s.ratings || []).length > 0)
      .map(s => ({
        nccId: s.nccId, name: s.name, category: s.category, active: s.active,
        avgRating: Math.round(s.ratings.reduce((sum, r) => sum + r.score, 0) / s.ratings.length * 10) / 10,
        ratingCount: s.ratings.length,
        lastNote: s.ratings[s.ratings.length - 1]?.note || '',
      }))
      .sort((a, b) => b.avgRating - a.avgRating);

    res.json({ summary, tours, byProduct, suppliers });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/revenue ──────────────────────────────
// Doanh thu theo tháng (theo tourDate — tháng thực hiện tour), CEO/KETOAN
// Mỗi tháng: số tour, khách, doanh thu, đã thu, chờ thu, chi thực tế, lãi gộp
router.get('/revenue', ...requirePerm('finance:read'), async (req, res) => {
  try {
    const all = await dbAsync.find('bookings', { status: { $ne: 'CANCELLED' } }, { tourDate: 1 });
    const years = [...new Set(all.map(b => (b.tourDate || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y)))].sort();
    const year = /^\d{4}$/.test(req.query.year) ? req.query.year
      : (years.includes(String(new Date().getFullYear())) ? String(new Date().getFullYear()) : years[years.length - 1]);

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `${year}-${String(i + 1).padStart(2, '0')}`,
      tours: 0, pax: 0, revenue: 0, collected: 0, pending: 0, cost: 0, profit: 0,
    }));
    for (const b of all) {
      if ((b.tourDate || '').slice(0, 4) !== year) continue;
      const idx = parseInt(b.tourDate.slice(5, 7), 10) - 1;
      if (idx < 0 || idx > 11) continue;
      const m = months[idx];
      const amount = b.payment?.amount || 0;
      const cost = (b.expenses || []).reduce((s, e) => s + (e.amount || 0), 0);
      m.tours++; m.pax += (b.adults || 0) + (b.children || 0);
      m.revenue += amount;
      // Đã thu = tổng receipts (booking cũ chưa có receipts thì theo cờ paid)
      const collected = collectedOf(b);
      m.collected += collected;
      m.pending += Math.max(0, amount - collected);
      m.cost += cost;
    }
    for (const m of months) m.profit = m.revenue - m.cost;

    const totals = months.reduce((t, m) => ({
      tours: t.tours + m.tours, pax: t.pax + m.pax, revenue: t.revenue + m.revenue,
      collected: t.collected + m.collected, pending: t.pending + m.pending,
      cost: t.cost + m.cost, profit: t.profit + m.profit,
    }), { tours: 0, pax: 0, revenue: 0, collected: 0, pending: 0, cost: 0, profit: 0 });
    totals.margin = totals.revenue > 0 ? Math.round(totals.profit / totals.revenue * 100) : null;

    res.json({ year, years, months, totals });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/payables ─────────────────────────────
// Sổ công nợ NCC: khoản chi gắn nccId chưa thanh toán, gom theo NCC, cảnh báo quá hạn (CEO/KETOAN)
router.get('/payables', ...requirePerm('finance:read'), async (req, res) => {
  try {
    const [bookings, allSuppliers] = await Promise.all([
      dbAsync.find('bookings', { status: { $ne: 'CANCELLED' } }),
      dbAsync.find('suppliers', {}),
    ]);
    const supplierName = Object.fromEntries(allSuppliers.map(s => [s.nccId, s.name]));
    const today = new Date().toISOString().slice(0, 10);
    const in7days = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    const byNcc = {};
    let totalUnpaid = 0, overdueAmount = 0, overdueCount = 0, dueSoonAmount = 0;
    for (const b of bookings) {
      for (const e of b.expenses || []) {
        if (!e.nccId || e.paidNcc) continue;
        if (!byNcc[e.nccId]) byNcc[e.nccId] = { nccId: e.nccId,
          name: supplierName[e.nccId] || e.nccId, unpaid: 0, overdue: 0, items: [] };
        const g = byNcc[e.nccId];
        const isOverdue = !!e.dueDate && e.dueDate < today;
        g.unpaid += e.amount;
        if (isOverdue) { g.overdue += e.amount; overdueAmount += e.amount; overdueCount++; }
        if (e.dueDate && e.dueDate >= today && e.dueDate <= in7days) dueSoonAmount += e.amount;
        totalUnpaid += e.amount;
        g.items.push({ bookingId: b.bookingId, product: b.product, expId: e.expId,
          category: e.category, desc: e.desc, amount: e.amount, dueDate: e.dueDate,
          overdue: isOverdue, at: e.at });
      }
    }
    const suppliers = Object.values(byNcc)
      .map(g => ({ ...g, items: g.items.sort((a, b2) =>
        String(a.dueDate || '9999').localeCompare(String(b2.dueDate || '9999'))) }))
      .sort((a, b2) => b2.unpaid - a.unpaid);
    res.json({ summary: { totalUnpaid, overdueAmount, overdueCount, dueSoonAmount }, suppliers });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reports/activity ─────────────────────────────
// Audit log (giai đoạn 7 — Internal Audit): mọi thao tác trên hệ thống, CEO only
router.get('/activity', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  try {
    const q = {};
    if (req.query.bookingId) {
      const escaped = req.query.bookingId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      q.bookingId = new RegExp(escaped, 'i');
    }
    if (req.query.type) q.type = req.query.type;
    if (req.query.by)   q.by   = req.query.by;
    const limit = Math.min(500, parseInt(req.query.limit) || 200);
    const items = await dbAsync.findPage('activity', q, { at: -1 }, 0, limit);
    res.json({ items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
