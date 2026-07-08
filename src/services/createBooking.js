// Tạo booking — dùng chung cho route admin (POST /api/bookings) và webhook CTY2
const { dbAsync } = require('../db/database');
const { ensureChecklist } = require('../db/tourChecklist');
const { estimateCost } = require('../routes/products');
const { soldForDeparture, capacityError } = require('./departures');

function genBookingId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.floor(Math.random()*9000)+1000;
  return `ORD-${ymd}-${rand}`;
}

async function createBooking(body, createdBy) {
  let { product, tourDate, adults=1, children=0, customer, specialReqs='', type='STANDARD', wellness={}, productId=null } = body;
  const departureId = body.departureId || null;
  const pax = (parseInt(adults) || 1) + (parseInt(children) || 0);

  // Đặt theo chuyến khởi hành: kiểm tra còn chỗ, snapshot ngày/sản phẩm/giá từ chuyến
  let departure = null;
  if (departureId) {
    departure = await dbAsync.findOne('departures', { departureId });
    const capErr = capacityError(departure, pax, await soldForDeparture(departureId));
    if (capErr) { const err = new Error(capErr); err.status = 409; throw err; }
    if (!productId) productId = departure.productId;
    if (!tourDate)  tourDate  = departure.date;   // chuyến cấp ngày nếu form không nhập
    if (!product)   product   = departure.productName;
  }

  if (!product || !tourDate || !customer?.name || !customer?.phone) {
    const err = new Error('Thiếu thông tin bắt buộc: product, tourDate, customer.name, customer.phone');
    err.status = 400;
    throw err;
  }

  // Snapshot dự toán chi từ Cost Sheet của sản phẩm (nếu chọn) — cost sheet đổi sau này không ảnh hưởng booking cũ
  let costEstimate = null;
  let autoAmount = 0;   // giá bán tự tính khi đặt theo chuyến (chuyến ưu tiên, rồi tới defaultPrice sản phẩm)
  if (productId) {
    const prd = await dbAsync.findOne('products', { productId });
    if (prd) {
      costEstimate = estimateCost(prd, pax);
      const unit = (departure?.price || 0) || (prd.defaultPrice || 0);
      autoAmount = unit * pax;
    }
  }

  const bookingId = genBookingId();
  const now = new Date().toISOString();
  const booking = {
    bookingId, product, tourDate, adults, children,
    customer: { name: customer.name, phone: customer.phone, email: customer.email || '' },
    specialReqs, type: type.toUpperCase(),
    wellness: type.toUpperCase() === 'WELLNESS' ? wellness : {},
    status: 'NEW',
    statusHistory: [{ status: 'NEW', by: createdBy, at: now }],
    assignedTo: null,    // NVDH Cty1
    wcAssigned: null,    // WC Cty3 (for wellness)
    payment: { amount: body.payment?.amount || autoAmount || 0, paid: body.payment?.paid || false, receipts: [] },
    source: body.source || 'ADMIN',  // ADMIN | WEBSITE | PLATFORM | DIRECT
    notes: [],
    passengers: [],     // hồ sơ từng hành khách (tên/giấy tờ/y tế/liên hệ khẩn) — nuôi Go/No-Go + manifest
    services: [],       // đặt dịch vụ NCC + trạng thái xác nhận (REQUESTED→CONFIRMED) — nuôi Go/No-Go
    itinerary: { days: [] },   // chương trình tour ngày-by-ngày + suất ăn + nơi nghỉ
    rooming: { rooms: [] },    // rooming list — phân phòng khách
    expenses: [],       // sổ chi phí thực tế
    incidents: [],      // sổ sự cố (OP-09) — mức độ/phân loại/biện pháp/trạng thái
    comms: { confirmSent: null, reminderSent: null, thankYouSent: null, log: [] },  // giao tiếp khách tự động
    dailyReports: [],   // Daily Tour Report
    productId,          // sản phẩm gốc (nếu tạo từ catalog)
    departureId,        // chuyến khởi hành gắn vào (nếu đặt theo lịch khởi hành) — nuôi số chỗ đã bán
    costEstimate,       // dự toán chi snapshot từ Cost Sheet
    createdAt: now,
    updatedAt: now,
    createdBy,
  };
  booking.checklist = ensureChecklist(booking) || [];

  const saved = await dbAsync.insert('bookings', booking);
  await dbAsync.insert('activity', { type: 'BOOKING_CREATED', bookingId, by: createdBy, at: now });
  return saved;
}

module.exports = { createBooking };
