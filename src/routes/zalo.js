const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const zalo = require('../services/zalo');

// GET /api/zalo/status (CEO only) — kiểm tra cấu hình Zalo OA
router.get('/status', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  res.json({ configured: zalo.isConfigured() });
});

// GET /api/zalo/followers (CEO only) — tra Zalo ID của nhân viên đã follow OA
router.get('/followers', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  if (!zalo.isConfigured())
    return res.status(400).json({ error: 'Zalo OA chưa cấu hình — điền ZALO_APP_ID / ZALO_APP_SECRET / ZALO_REFRESH_TOKEN vào .env' });
  try {
    const result = await zalo.getFollowers(parseInt(req.query.offset) || 0, 50);
    res.json(result);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

module.exports = router;
