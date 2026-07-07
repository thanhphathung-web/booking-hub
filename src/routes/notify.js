const router = require('express').Router();
const { dbAsync } = require('../db/database');
const { requireAuth, requirePerm } = require('../middleware/auth');
const notifier = require('../services/notifier');

// Kênh nhắc việc real-time đã sẵn sàng chưa (email/Zalo) — CEO xem để biết cần cấu hình gì
router.get('/status', ...requirePerm('users:manage'), (req, res) => {
  res.json(notifier.channelStatus());
});

// Gửi 1 tin thử tới chính kênh nhắc của user đang đăng nhập — để kiểm tra cấu hình
router.post('/test', requireAuth, async (req, res) => {
  try {
    const me = await dbAsync.findOne('users', { username: req.user.username });
    if (!me) return res.status(404).json({ error: 'Không tìm thấy user' });
    const subject = '🔔 [Booking Hub] Tin nhắc việc thử';
    const text = `Chào ${me.name},\n\nĐây là tin thử để kiểm tra kênh nhắc việc real-time của bạn.\nNếu bạn nhận được tin này qua email/Zalo thì kênh đã hoạt động.`;
    const result = await notifier.notifyUser(me, subject, text);
    res.json({ message: 'Đã thử gửi', result, channels: notifier.channelStatus() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
