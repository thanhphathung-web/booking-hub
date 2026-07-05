const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { createBackupArchive, sendBackupEmail } = require('../services/backup');

// GET /api/backup/download (CEO only) — tải file backup .json.gz ngay lập tức
router.get('/download', requireAuth, (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  try {
    const { filename, buffer } = createBackupArchive();
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/backup/send (CEO only) — gửi backup qua email ngay, không đợi cron 02:00
router.post('/send', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  try {
    const result = await sendBackupEmail();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
