const router = require('express').Router();
const { dbAsync } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

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
