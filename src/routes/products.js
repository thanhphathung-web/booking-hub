const router = require('express').Router();
const { dbAsync } = require('../db/database');
const { requireAuth, requirePerm } = require('../middleware/auth');

// Sản phẩm tour + Tour Cost Sheet (dự toán chi phí — Pre-Sales Control)
// costSheet: [{ category, desc, nccId?, costType: 'PER_PERSON'|'PER_GROUP', amount }]

const COST_CATEGORIES = ['XE', 'KHACHSAN', 'ANUONG', 'VE', 'BAOHIEM', 'YTE', 'KHAC'];

function validateCostSheet(costSheet) {
  if (!Array.isArray(costSheet)) return 'costSheet phải là mảng';
  for (const row of costSheet) {
    if (!COST_CATEGORIES.includes(row.category)) return `Loại chi không hợp lệ: ${row.category}`;
    if (!row.desc || !row.desc.trim()) return 'Mỗi dòng chi phí cần mô tả';
    if (!['PER_PERSON', 'PER_GROUP'].includes(row.costType)) return 'costType phải là PER_PERSON hoặc PER_GROUP';
    if (!Number(row.amount) || Number(row.amount) < 0) return 'Số tiền dự toán không hợp lệ';
  }
  return null;
}

// Dự toán tổng chi cho 1 đoàn pax người
function estimateCost(product, pax) {
  return (product.costSheet || []).reduce((sum, row) =>
    sum + (row.costType === 'PER_PERSON' ? row.amount * pax : row.amount), 0);
}

// ── GET /api/products ─────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = {};
    if (req.query.active === 'true') q.active = true;
    if (req.query.type) q.type = req.query.type;
    const products = await dbAsync.find('products', q, { name: 1 });
    res.json({ products });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/products/:id ─────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const product = await dbAsync.findOne('products', { productId: req.params.id });
    if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    res.json({ product });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/products (CEO/PM) ───────────────────────────
router.post('/', ...requirePerm('products:manage'), async (req, res) => {
  try {
    const { name, type = 'STANDARD', durationDays = 1, defaultPrice = 0, description = '', costSheet = [] } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Thiếu tên sản phẩm' });
    if (!['STANDARD', 'WELLNESS'].includes(type)) return res.status(400).json({ error: 'type phải là STANDARD hoặc WELLNESS' });
    const csErr = validateCostSheet(costSheet);
    if (csErr) return res.status(400).json({ error: csErr });

    const now = new Date().toISOString();
    const product = await dbAsync.insert('products', {
      productId: 'PRD-' + Date.now().toString(36).toUpperCase(),
      name: name.trim(), type,
      durationDays: Math.max(1, parseInt(durationDays) || 1),
      defaultPrice: Number(defaultPrice) || 0,   // giá bán / khách
      description: description.trim(),
      costSheet: costSheet.map(r => ({ category: r.category, desc: r.desc.trim(),
        nccId: r.nccId || null, costType: r.costType, amount: Number(r.amount) })),
      active: true, createdAt: now, updatedAt: now, createdBy: req.user.username,
    });
    res.status(201).json({ product, message: 'Đã tạo sản phẩm' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/products/:id (CEO/PM) ──────────────────────
router.patch('/:id', ...requirePerm('products:manage'), async (req, res) => {
  try {
    const product = await dbAsync.findOne('products', { productId: req.params.id });
    if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });

    const upd = { updatedAt: new Date().toISOString() };
    if (req.body.name)        upd.name = String(req.body.name).trim();
    if (req.body.type && ['STANDARD','WELLNESS'].includes(req.body.type)) upd.type = req.body.type;
    if (req.body.durationDays) upd.durationDays = Math.max(1, parseInt(req.body.durationDays) || 1);
    if (req.body.defaultPrice !== undefined) upd.defaultPrice = Number(req.body.defaultPrice) || 0;
    if (req.body.description !== undefined) upd.description = String(req.body.description).trim();
    if (req.body.costSheet !== undefined) {
      const csErr = validateCostSheet(req.body.costSheet);
      if (csErr) return res.status(400).json({ error: csErr });
      upd.costSheet = req.body.costSheet.map(r => ({ category: r.category, desc: r.desc.trim(),
        nccId: r.nccId || null, costType: r.costType, amount: Number(r.amount) }));
    }
    await dbAsync.update('products', { productId: req.params.id }, { $set: upd });
    const updated = await dbAsync.findOne('products', { productId: req.params.id });
    res.json({ product: updated, message: 'Đã cập nhật sản phẩm' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/products/:id/toggle (CEO/PM) ───────────────
router.patch('/:id/toggle', ...requirePerm('products:manage'), async (req, res) => {
  try {
    const product = await dbAsync.findOne('products', { productId: req.params.id });
    if (!product) return res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
    await dbAsync.update('products', { productId: req.params.id },
      { $set: { active: !product.active, updatedAt: new Date().toISOString() } });
    res.json({ message: `Đã ${product.active ? 'ngừng bán' : 'mở bán lại'} sản phẩm`, active: !product.active });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/products/:id (CEO only) ───────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  try {
    await dbAsync.remove('products', { productId: req.params.id }, {});
    res.json({ message: 'Đã xoá sản phẩm' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.estimateCost = estimateCost;
