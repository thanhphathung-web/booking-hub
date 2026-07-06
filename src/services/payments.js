// Tiền cọc / thu từng đợt — helper dùng chung routes + reports
// payment.receipts = các lần thu tiền khách; payment.paid suy ra từ tổng đã thu.
// Booking cũ chưa có receipts: giữ cờ paid thủ công như trước (legacy).

function receiptsTotal(payment) {
  return (payment?.receipts || []).reduce((s, r) => s + (r.amount || 0), 0);
}

// Số tiền đã thực thu của 1 booking
function collectedOf(booking) {
  const p = booking?.payment || {};
  if ((p.receipts || []).length) return receiptsTotal(p);
  return p.paid ? (p.amount || 0) : 0;
}

// Cập nhật lại cờ paid sau khi receipts/amount thay đổi
function recomputePaid(payment) {
  payment.paid = (payment.amount || 0) > 0 && receiptsTotal(payment) >= payment.amount;
  return payment;
}

module.exports = { receiptsTotal, collectedOf, recomputePaid };
