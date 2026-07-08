// Lịch khởi hành + quản lý số chỗ (inventory) — dùng chung route + createBooking + smoke test.
// Nguyên tắc: seatsSold luôn TÍNH LẠI từ bookings gắn departureId (status ≠ CANCELLED),
// không lưu đếm riêng → không bao giờ lệch (huỷ booking tự trả chỗ).
const { dbAsync } = require('../db/database');

const paxOf = b => (parseInt(b.adults) || 0) + (parseInt(b.children) || 0);

// Tổng số chỗ đã bán của 1 chuyến (bỏ booking đã huỷ)
async function soldForDeparture(departureId) {
  const bs = await dbAsync.find('bookings', { departureId, status: { $ne: 'CANCELLED' } });
  return bs.reduce((s, b) => s + paxOf(b), 0);
}

// Ghép số chỗ còn lại vào 1 chuyến (sold truyền vào để gọi hàng loạt không query lặp)
function availabilityOf(dep, sold) {
  const seatsSold = sold || 0;
  const seatsLeft = Math.max(0, (dep.seatsTotal || 0) - seatsSold);
  return { ...dep, seatsSold, seatsLeft, full: seatsLeft <= 0 };
}

// Kiểm tra 1 chuyến có nhận thêm `pax` khách không. Trả về chuỗi lỗi (để throw) hoặc null.
function capacityError(dep, pax, sold) {
  if (!dep) return 'Không tìm thấy chuyến khởi hành';
  if (!dep.active) return 'Chuyến khởi hành đã ngừng bán';
  if (dep.status === 'CANCELLED') return 'Chuyến khởi hành đã bị huỷ';
  if (dep.status === 'CLOSED') return 'Chuyến khởi hành đã đóng nhận khách';
  const left = Math.max(0, (dep.seatsTotal || 0) - (sold || 0));
  if (pax > left) return `Chuyến chỉ còn ${left} chỗ, không đủ cho ${pax} khách`;
  return null;
}

module.exports = { paxOf, soldForDeparture, availabilityOf, capacityError };
