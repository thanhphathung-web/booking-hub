// Checklist SOP điều hành tour — sinh tự động theo vòng đời booking
// offsetFrom: 'created' (từ ngày tạo booking) | 'tour' (từ ngày khởi hành)
// offsetDays: số ngày lệch (âm = trước tour). null = không có deadline cố định (trong tour)
// wellnessOnly: chỉ thêm khi booking.type === 'WELLNESS'

const PHASE_LABELS = {
  BOOKING: 'Booking Control — Xác nhận đơn',
  PREOPS:  'Pre-Operation — Chuẩn bị trước tour',
  OPS:     'Operation — Trong tour',
  POSTOPS: 'Post-Operation — Sau tour',
};

const TEMPLATE = [
  // ── Giai đoạn 1: Booking Control ──────────────────────────
  { code:'BC-01', phase:'BOOKING', role:'CS',     offsetFrom:'created', offsetDays:0, title:'Kiểm tra đầy đủ thông tin khách (tên, SĐT, email, giấy tờ nếu cần)' },
  { code:'BC-02', phase:'BOOKING', role:'CS',     offsetFrom:'created', offsetDays:1, title:'Xác nhận yêu cầu đặc biệt: ăn kiêng, dị ứng, y tế, trẻ em/người cao tuổi' },
  { code:'BC-03', phase:'BOOKING', role:'KETOAN', offsetFrom:'created', offsetDays:1, title:'Xác nhận thu cọc' },
  { code:'BC-04', phase:'BOOKING', role:'CS',     offsetFrom:'created', offsetDays:1, title:'Gửi Booking Confirmation cho khách (dùng Booking Brief)' },
  { code:'BC-05', phase:'BOOKING', role:'CS',     offsetFrom:'created', offsetDays:2, title:'Lập Guest List đoàn (họ tên, năm sinh, giấy tờ)' },
  { code:'BC-06', phase:'BOOKING', role:'WC',     offsetFrom:'created', offsetDays:2, title:'Xác nhận gói khám + gửi phiếu khảo sát sức khoẻ ban đầu', wellnessOnly:true },

  // ── Giai đoạn 2: Pre-Operation (T-7 → T-1) ────────────────
  { code:'PO-01', phase:'PREOPS', role:'TPDH',   offsetFrom:'tour', offsetDays:-7, title:'Phân công NVDH phụ trách tour' },
  { code:'PO-02', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-7, title:'Đặt & xác nhận xe + tài xế với NCC' },
  { code:'PO-03', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-7, title:'Đặt & xác nhận khách sạn (số phòng, loại phòng)' },
  { code:'PO-04', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-5, title:'Đặt nhà hàng + báo trước suất ăn đặc biệt (từ BC-02)' },
  { code:'PO-05', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-5, title:'Mua vé tham quan / dịch vụ tại điểm đến' },
  { code:'PO-06', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-3, title:'Mua bảo hiểm du lịch cho cả đoàn' },
  { code:'PO-07', phase:'PREOPS', role:'KETOAN', offsetFrom:'tour', offsetDays:-3, title:'Thu đủ phần thanh toán còn lại của khách' },
  { code:'PO-08', phase:'PREOPS', role:'CS',     offsetFrom:'tour', offsetDays:-2, title:'Gửi thông tin đón khách: giờ, điểm hẹn, tên + SĐT HDV' },
  { code:'PO-09', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-1, title:'Kiểm tra thời tiết, quyết định phương án dự phòng nếu cần' },
  { code:'PO-10', phase:'PREOPS', role:'TPDH',   offsetFrom:'tour', offsetDays:-1, title:'Bàn giao Tour File cho HDV: lịch trình, guest list, voucher, tiền tạm ứng' },
  { code:'PO-11', phase:'PREOPS', role:'WC',     offsetFrom:'tour', offsetDays:-5, title:'Chốt lịch khám với NCC y tế (giờ, địa điểm, danh sách khách)', wellnessOnly:true },
  { code:'PO-12', phase:'PREOPS', role:'WC',     offsetFrom:'tour', offsetDays:-3, title:'Thu hồ sơ sức khoẻ của khách, chuyển cho NCC y tế trước', wellnessOnly:true },

  // ── Giai đoạn 3: Operation (T-0 → hết tour) ───────────────
  { code:'OP-01', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:0,    title:'Re-confirm xe/tài xế sáng ngày khởi hành' },
  { code:'OP-02', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:0,    title:'HDV check-in điểm đón, điểm danh đủ khách, báo về văn phòng' },
  { code:'OP-03', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:0,    title:'Nộp Daily Tour Report cuối mỗi ngày tour (trước 21:00)' },
  { code:'OP-04', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:null, title:'Ghi mọi chi phí phát sinh vào sổ chi ngay khi phát sinh' },
  { code:'OP-05', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:null, title:'Sự cố phát sinh: báo TPDH trong 30 phút + ghi lại cách xử lý' },
  { code:'OP-06', phase:'OPS', role:'WC',   offsetFrom:'tour', offsetDays:0,    title:'Xác nhận khách hoàn thành lịch khám đúng kế hoạch', wellnessOnly:true },

  // ── Giai đoạn 4: Post-Operation (T+1 → T+7) ───────────────
  { code:'PT-01', phase:'POSTOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:1, title:'HDV nộp báo cáo tổng kết + toàn bộ chứng từ chi' },
  { code:'PT-02', phase:'POSTOPS', role:'CS',     offsetFrom:'tour', offsetDays:2, title:'Thu feedback khách (gọi điện / form)' },
  { code:'PT-03', phase:'POSTOPS', role:'CS',     offsetFrom:'tour', offsetDays:2, title:'Gửi email cảm ơn + ưu đãi cho lần sau' },
  { code:'PT-04', phase:'POSTOPS', role:'KETOAN', offsetFrom:'tour', offsetDays:3, title:'Đối soát công nợ với từng NCC' },
  { code:'PT-05', phase:'POSTOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:3, title:'Chấm điểm chất lượng NCC (1–5 sao + ghi chú)' },
  { code:'PT-06', phase:'POSTOPS', role:'KETOAN', offsetFrom:'tour', offsetDays:7, title:'Hoàn tất thanh toán NCC' },
  { code:'PT-07', phase:'POSTOPS', role:'KETOAN', offsetFrom:'tour', offsetDays:7, title:'Quyết toán tour: doanh thu − tổng chi thực tế = lãi/lỗ' },
  { code:'PT-08', phase:'POSTOPS', role:'TPDH',   offsetFrom:'tour', offsetDays:7, title:'TPDH duyệt Tour Closing Report → đóng booking' },
  { code:'PT-09', phase:'POSTOPS', role:'WC',     offsetFrom:'tour', offsetDays:5, title:'Nhận kết quả khám từ NCC y tế, chuyển cho khách', wellnessOnly:true },
];

// Giai đoạn nào cần tồn tại ở mỗi status (cộng dồn)
const PHASES_BY_STATUS = {
  NEW:         ['BOOKING'],
  CONFIRMED:   ['BOOKING', 'PREOPS'],
  IN_PROGRESS: ['BOOKING', 'PREOPS', 'OPS', 'POSTOPS'],
  COMPLETED:   ['BOOKING', 'PREOPS', 'OPS', 'POSTOPS'],
};

function addDays(ymd, days) {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildItems(phases, booking) {
  return TEMPLATE
    .filter(t => phases.includes(t.phase))
    .filter(t => !t.wellnessOnly || booking.type === 'WELLNESS')
    .map(t => ({
      code: t.code, title: t.title, phase: t.phase, role: t.role,
      deadline: t.offsetDays === null ? null
        : addDays(t.offsetFrom === 'created' ? (booking.createdAt || new Date().toISOString()).slice(0, 10) : booking.tourDate, t.offsetDays),
      done: false, doneBy: null, doneName: null, doneAt: null, note: '',
    }));
}

// Trả về mảng checklist mới nếu cần bổ sung item, null nếu không có gì thay đổi
function ensureChecklist(booking) {
  const phases = PHASES_BY_STATUS[booking.status];
  if (!phases) return null; // CANCELLED — không sinh thêm
  const existing = booking.checklist || [];
  const have = new Set(existing.map(i => i.code));
  const missing = buildItems(phases, booking).filter(i => !have.has(i.code));
  if (missing.length === 0 && booking.checklist) return null;
  return [...existing, ...missing];
}

module.exports = { ensureChecklist, PHASE_LABELS };
