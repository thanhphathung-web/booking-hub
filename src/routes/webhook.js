const router = require('express').Router();
const crypto = require('crypto');
const { createBooking } = require('../services/createBooking');

// Webhook cho website CTY2 đẩy booking vào Hub — xác thực bằng API key, không cần tài khoản user
// Header: X-API-Key = WEBHOOK_API_KEY (.env / Railway Variables). Không set biến = webhook tắt.

function requireApiKey(req, res, next) {
  const configured = process.env.WEBHOOK_API_KEY;
  if (!configured)
    return res.status(503).json({ error: 'Webhook chưa được bật — set WEBHOOK_API_KEY trong biến môi trường' });
  const given = Buffer.from(String(req.headers['x-api-key'] || ''));
  const expected = Buffer.from(configured);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected))
    return res.status(401).json({ error: 'API key không hợp lệ' });
  next();
}

// ── POST /api/webhook/bookings ────────────────────────────
// Body giống POST /api/bookings; source chỉ nhận WEBSITE|PLATFORM (mặc định WEBSITE)
router.post('/bookings', requireApiKey, async (req, res) => {
  try {
    const source = ['WEBSITE', 'PLATFORM'].includes(req.body.source) ? req.body.source : 'WEBSITE';
    const saved = await createBooking({ ...req.body, source }, 'cty2-webhook');
    // Trả gọn cho hệ thống ngoài — không lộ dữ liệu nội bộ (checklist, ghi chú...)
    res.status(201).json({
      bookingId: saved.bookingId,
      status: saved.status,
      message: 'Booking đã được tạo trên Booking Hub',
    });
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

module.exports = router;
