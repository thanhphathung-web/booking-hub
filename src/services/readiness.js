// Go/No-Go — đánh giá mức sẵn sàng khởi hành của 1 booking.
// Mục tiêu: chặn "tour chạy mù" — gom điều kiện BẮT BUỘC (critical, chặn GO)
// và CẢNH BÁO (warn, không chặn) vào 1 bảng chấm để TPDH duyệt trước khi cho chạy.
// Pure function — dùng chung route (GET /:id/readiness) + smoke test.
const { collectedOf } = require('./payments');

function itemDone(b, code) {
  const i = (b.checklist || []).find(x => x.code === code);
  return !!(i && i.done);
}

function assessReadiness(b) {
  const totalPax = (b.adults || 0) + (b.children || 0);
  const pax = b.passengers || [];
  const named = pax.filter(p => p.fullName && String(p.fullName).trim());
  const collected = collectedOf(b);
  const amount = b.payment?.amount || 0;
  const isWellness = b.type === 'WELLNESS';

  const checks = [];
  const add = (key, label, severity, pass, detail) =>
    checks.push({ key, label, severity, pass: !!pass, detail });

  // ── Hồ sơ hành khách ──────────────────────────────────────
  add('pax_manifest', 'Danh sách hành khách đầy đủ', 'critical',
    totalPax > 0 && named.length >= totalPax,
    `${named.length}/${totalPax} khách có họ tên`);

  const withId = pax.filter(p => p.idNumber && String(p.idNumber).trim());
  add('pax_id', 'Giấy tờ tuỳ thân (CCCD/Hộ chiếu)', 'warn',
    totalPax > 0 && withId.length >= totalPax,
    `${withId.length}/${totalPax} khách có số giấy tờ`);

  const withSos = pax.filter(p => p.emergencyPhone && String(p.emergencyPhone).trim());
  add('pax_emergency', 'Liên hệ khẩn cấp mỗi khách', 'warn',
    totalPax > 0 && withSos.length >= totalPax,
    `${withSos.length}/${totalPax} khách có liên hệ khẩn`);

  // Hộ chiếu sắp hết hạn (< 6 tháng tính từ ngày khởi hành) — rủi ro rớt khách
  const sixMonthsAfter = (() => {
    const d = new Date((b.tourDate || '') + 'T00:00:00Z');
    if (isNaN(d)) return null;
    d.setUTCMonth(d.getUTCMonth() + 6);
    return d.toISOString().slice(0, 10);
  })();
  const badPassport = pax.filter(p => p.idType === 'PASSPORT' && p.passportExpiry
    && sixMonthsAfter && p.passportExpiry < sixMonthsAfter);
  if (pax.some(p => p.idType === 'PASSPORT')) {
    add('passport_valid', 'Hộ chiếu còn hạn > 6 tháng', 'critical',
      badPassport.length === 0,
      badPassport.length ? `${badPassport.length} khách hộ chiếu sắp/đã hết hạn` : 'Tất cả còn hạn');
  }

  // ── Tài chính ─────────────────────────────────────────────
  if (amount > 0) {
    add('payment', 'Thu đủ tiền khách', 'critical',
      b.payment?.paid || collected >= amount,
      collected >= amount ? 'Đã thu đủ'
        : `Còn thiếu ${(amount - collected).toLocaleString('vi-VN')}đ`);
  } else {
    add('payment', 'Thu đủ tiền khách', 'warn', false, 'Chưa nhập tổng tiền đơn');
  }

  // ── Nhân sự ───────────────────────────────────────────────
  add('nvdh', 'NVDH phụ trách', 'critical', !!b.assignedTo,
    b.assignedTo || 'Chưa phân công');
  if (isWellness) {
    add('wc', 'WC điều phối Wellness', 'critical', !!b.wcAssigned,
      b.wcAssigned || 'Chưa phân công');
  }

  // ── Dịch vụ NCC đã xác nhận (qua checklist PREOPS) ─────────
  add('transport', 'Đặt xe + tài xế (PO-02)', 'critical', itemDone(b, 'PO-02'),
    itemDone(b, 'PO-02') ? 'Đã xác nhận' : 'Chưa xác nhận');
  add('hotel', 'Đặt khách sạn (PO-03)', 'critical', itemDone(b, 'PO-03'),
    itemDone(b, 'PO-03') ? 'Đã xác nhận' : 'Chưa xác nhận');
  add('insurance', 'Bảo hiểm du lịch (PO-07)', 'critical', itemDone(b, 'PO-07'),
    itemDone(b, 'PO-07') ? 'Đã mua' : 'Chưa mua');

  const reconf = itemDone(b, 'PO-16') && itemDone(b, 'PO-17');
  add('reconfirm', 'Re-confirm xe + KS 24h (PO-16/17)', 'warn', reconf,
    reconf ? 'Đã re-confirm cận giờ' : 'Chưa re-confirm cận giờ');

  if (isWellness) {
    add('health', 'Khảo sát sức khoẻ khách (BC-06)', 'warn', itemDone(b, 'BC-06'),
      itemDone(b, 'BC-06') ? 'Đã thu phiếu' : 'Chưa thu phiếu');
  }

  const passed = checks.filter(c => c.pass).length;
  const blocking = checks.filter(c => c.severity === 'critical' && !c.pass);
  const warnings = checks.filter(c => c.severity === 'warn' && !c.pass);

  return {
    verdict: blocking.length === 0 ? 'GO' : 'NO_GO',
    score: Math.round(passed / checks.length * 100),
    passedCount: passed, total: checks.length,
    checks,
    blocking: blocking.map(c => ({ key: c.key, label: c.label, detail: c.detail })),
    warnings: warnings.map(c => ({ key: c.key, label: c.label, detail: c.detail })),
  };
}

module.exports = { assessReadiness };
