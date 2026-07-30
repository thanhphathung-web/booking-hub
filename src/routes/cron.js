// Endpoint cho Vercel Cron Jobs (thay node-cron chạy trong process — không dùng được trên serverless
// vì process không sống liên tục giữa các request). Vercel tự gọi các route này theo lịch khai báo
// trong vercel.json, kèm header Authorization: Bearer <CRON_SECRET> — verify để chặn người ngoài
// tự gọi tay (spam gửi digest/backup/email khách qua URL công khai).
const router = require('express').Router();

function verifyCron(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(500).json({ error: 'CRON_SECRET chưa cấu hình' });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

router.get('/digest', verifyCron, async (req, res) => {
  try {
    const { sendDailyDigest } = require('../services/digest');
    const results = await sendDailyDigest();
    console.log('[digest]', JSON.stringify(results));
    res.json({ ok: true, results });
  } catch (e) { console.error('[digest] Lỗi:', e.message); res.status(500).json({ error: e.message }); }
});

router.get('/comms', verifyCron, async (req, res) => {
  try {
    const { runDaily } = require('../services/customerComms');
    const r = await runDaily();
    console.log('[comms]', JSON.stringify(r));
    res.json({ ok: true, result: r });
  } catch (e) { console.error('[comms] Lỗi:', e.message); res.status(500).json({ error: e.message }); }
});

router.get('/backup', verifyCron, async (req, res) => {
  try {
    const { sendBackupEmail } = require('../services/backup');
    const r = await sendBackupEmail();
    console.log('[backup]', JSON.stringify(r));
    res.json({ ok: true, result: r });
  } catch (e) { console.error('[backup] Lỗi:', e.message); res.status(500).json({ error: e.message }); }
});

module.exports = router;
