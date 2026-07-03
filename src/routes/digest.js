const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { buildAllDigests, sendDailyDigest } = require('../services/digest');
const mailer = require('../services/mailer');

// GET /api/digest/preview (CEO only) — xem nội dung digest sẽ gửi, không gửi thật
router.get('/preview', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  try {
    const digests = await buildAllDigests();
    res.json({ smtpConfigured: mailer.isConfigured(), count: digests.length, digests });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/digest/send (CEO only) — gửi digest ngay để test, không đợi cron 07:30
router.post('/send', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  try {
    const results = await sendDailyDigest();
    res.json({ smtpConfigured: mailer.isConfigured(), results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
