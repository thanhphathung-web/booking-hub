// Tạo booking — dùng chung cho route admin (POST /api/bookings) và webhook CTY2
const { dbAsync } = require('../db/database');
const { ensureChecklist } = require('../db/tourChecklist');
const { estimateCost } = require('../routes/products');

function genBookingId() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const rand = Math.floor(Math.random()*9000)+1000;
  return `ORD-${ymd}-${rand}`;
}

async function createBooking(body, createdBy) {
  const { product, tourDate, adults=1, children=0, customer, specialReqs='', type='STANDARD', wellness={}, productId=null } = body;
  if (!product || !tourDate || !customer?.name || !customer?.phone) {
    const err = new Error('Thiếu thông tin bắt buộc: product, tourDate, customer.name, customer.phone');
    err.status = 400;
    throw err;
  }

  // Snapshot dự toán chi từ Cost Sheet của sản phẩm (nếu chọn) — cost sheet đổi sau này không ảnh hưởng booking cũ
  let costEstimate = null;
  if (productId) {
    const prd = await dbAsync.findOne('products', { productId });
    if (prd) costEstimate = estimateCost(prd, (parseInt(adults) || 1) + (parseInt(children) || 0));
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
    payment: { amount: body.payment?.amount || 0, paid: body.payment?.paid || false, receipts: [] },
    source: body.source || 'ADMIN',  // ADMIN | WEBSITE | PLATFORM | DIRECT
    notes: [],
    passengers: [],     // hồ sơ từng hành khách (tên/giấy tờ/y tế/liên hệ khẩn) — nuôi Go/No-Go + manifest
    services: [],       // đặt dịch vụ NCC + trạng thái xác nhận (REQUESTED→CONFIRMED) — nuôi Go/No-Go
    itinerary: { days: [] },   // chương trình tour ngày-by-ngày + suất ăn + nơi nghỉ
    rooming: { rooms: [] },    // rooming list — phân phòng khách
    expenses: [],       // sổ chi phí thực tế
    incidents: [],      // sổ sự cố (OP-09) — mức độ/phân loại/biện pháp/trạng thái
    dailyReports: [],   // Daily Tour Report
    productId,          // sản phẩm gốc (nếu tạo từ catalog)
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
