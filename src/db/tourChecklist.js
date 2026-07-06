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
  // ── Giai đoạn 1: Booking Control ──────────────────────────────────────────
  // Mục tiêu: đảm bảo hồ sơ đoàn đầy đủ, khách được xác nhận, khoản cọc vào sổ.

  { code:'BC-01', phase:'BOOKING', role:'CS',     offsetFrom:'created', offsetDays:0,
    title:'Kiểm tra thông tin khách: tên đầy đủ, SĐT, email, ngày sinh — không để trống trường nào' },

  { code:'BC-02', phase:'BOOKING', role:'CS',     offsetFrom:'created', offsetDays:0,
    title:'Ghi chi tiết yêu cầu đặc biệt: ăn kiêng / dị ứng thực phẩm / bệnh nền / thuốc đang dùng / hạn chế vận động' },

  { code:'BC-03', phase:'BOOKING', role:'KETOAN', offsetFrom:'created', offsetDays:1,
    title:'Thu cọc: ghi số tiền, phương thức thanh toán, ngày thu — gửi xác nhận ngay cho khách' },

  { code:'BC-04', phase:'BOOKING', role:'CS',     offsetFrom:'created', offsetDays:1,
    title:'Gửi Booking Confirmation chính thức (Booking Brief), kèm số đơn và SĐT hỗ trợ 24/7' },

  { code:'BC-05', phase:'BOOKING', role:'CS',     offsetFrom:'created', offsetDays:2,
    title:'Lập Guest List đầy đủ: họ tên, năm sinh, số CMND/Hộ chiếu, SĐT cá nhân từng người trong đoàn' },

  { code:'BC-06', phase:'BOOKING', role:'WC',     offsetFrom:'created', offsetDays:2,
    title:'Gửi phiếu khảo sát sức khoẻ ban đầu — nhắc khách điền đầy đủ và gửi lại trong 24h', wellnessOnly:true },

  { code:'BC-07', phase:'BOOKING', role:'CS',     offsetFrom:'created', offsetDays:1,
    title:'Thu thập giấy tờ tùy thân: CMND/CCCD/Hộ chiếu — kiểm tra còn hạn (HC quốc tế: còn >6 tháng)' },

  { code:'BC-08', phase:'BOOKING', role:'CS',     offsetFrom:'created', offsetDays:1,
    title:'Thu thập contact khẩn cấp: họ tên người thân, SĐT, quan hệ với khách (ít nhất 1 người/khách)' },

  { code:'BC-09', phase:'BOOKING', role:'CS',     offsetFrom:'created', offsetDays:3,
    title:'Gửi Pre-trip Package cho khách: đồ cần mang, lưu ý sức khoẻ/an toàn, dress code, SĐT liên lạc khẩn cấp' },

  { code:'BC-10', phase:'BOOKING', role:'WC',     offsetFrom:'created', offsetDays:3,
    title:'Xem xét phiếu sức khoẻ — xác nhận gói khám phù hợp, đánh cờ đỏ nếu có chống chỉ định', wellnessOnly:true },

  // ── Giai đoạn 2: Pre-Operation (T-14 → T-1) ───────────────────────────────
  // Mục tiêu: đặt đủ dịch vụ, xác nhận 2 lần, bàn giao đầy đủ cho NVDH.

  { code:'PO-01', phase:'PREOPS', role:'TPDH',   offsetFrom:'tour', offsetDays:-14,
    title:'Phân công NVDH phụ trách tour — gửi thông báo chính thức, nhận xác nhận bằng văn bản từ NVDH' },

  { code:'PO-02', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-10,
    title:'Đặt xe + tài xế: xác nhận hãng xe, biển số, SĐT tài xế, giờ đón, điểm đón cụ thể' },

  { code:'PO-03', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-10,
    title:'Đặt khách sạn: xác nhận số phòng, loại phòng, ngày check-in/out, yêu cầu đặc biệt (view, tầng, phòng thông)' },

  { code:'PO-04', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-7,
    title:'Gửi Rooming List cho từng khách sạn: tên đầy đủ từng khách theo từng phòng, kèm SĐT liên hệ' },

  { code:'PO-05', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-7,
    title:'Đặt nhà hàng toàn bộ bữa ăn: số suất, giờ ăn, menu — báo trước suất đặc biệt theo danh sách BC-02' },

  { code:'PO-06', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-7,
    title:'Mua vé tham quan/dịch vụ: đủ số lượng + 2 vé dự phòng — kiểm tra voucher còn hạn và điều khoản đổi/trả' },

  { code:'PO-07', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-5,
    title:'Mua bảo hiểm du lịch: đủ số người, mức bồi thường ≥ 50tr/người, ngày hiệu lực bao trùm toàn tour' },

  { code:'PO-08', phase:'PREOPS', role:'KETOAN', offsetFrom:'tour', offsetDays:-5,
    title:'Thu đủ thanh toán còn lại của khách — gửi xác nhận hoàn tất thanh toán' },

  { code:'PO-09', phase:'PREOPS', role:'TPDH',   offsetFrom:'tour', offsetDays:-5,
    title:'Duyệt dự toán chi tour — ký cấp tạm ứng tiền mặt cho NVDH, ghi rõ số tiền và ngày cấp' },

  { code:'PO-10', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-3,
    title:'Chuẩn bị Tour Pack từng khách: bảng tên cá nhân, nón tour, lịch trình in sẵn, SOS card (SĐT khẩn cấp)' },

  { code:'PO-11', phase:'PREOPS', role:'WC',     offsetFrom:'tour', offsetDays:-5,
    title:'Chốt lịch khám với NCC y tế: giờ khám, địa điểm cụ thể, danh sách khách kèm yêu cầu đặc biệt', wellnessOnly:true },

  { code:'PO-12', phase:'PREOPS', role:'WC',     offsetFrom:'tour', offsetDays:-3,
    title:'Gửi hồ sơ sức khoẻ đầy đủ từng khách cho NCC y tế — nhận xác nhận đã nhận hồ sơ', wellnessOnly:true },

  { code:'PO-13', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-3,
    title:'Chuẩn bị túi sơ cứu cơ bản: thuốc đau đầu, tiêu chảy, băng dán, sát khuẩn, nhiệt kế' },

  { code:'PO-14', phase:'PREOPS', role:'CS',     offsetFrom:'tour', offsetDays:-2,
    title:'Gửi nhắc lịch cuối cho khách: điểm hẹn, giờ, ảnh minh hoạ điểm đón, SĐT NVDH, dự báo thời tiết' },

  { code:'PO-15', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-2,
    title:'Kiểm tra thời tiết tại điểm đến — lập phương án dự phòng bằng văn bản nếu rủi ro cao' },

  { code:'PO-16', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-1,
    title:'Re-confirm tài xế 24h trước: gọi điện xác nhận biển số xe, giờ xuất phát, điểm đón, vị trí hiện tại' },

  { code:'PO-17', phase:'PREOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:-1,
    title:'Re-confirm từng khách sạn 24h trước: tất cả phòng sẵn sàng, yêu cầu đặc biệt đã được ghi nhận' },

  { code:'PO-18', phase:'PREOPS', role:'CS',     offsetFrom:'tour', offsetDays:-1,
    title:'Nhắn tin nhắc từng khách qua Zalo/SMS: giờ tập trung, điểm đón, thời tiết ngày mai, lưu ý cuối' },

  { code:'PO-19', phase:'PREOPS', role:'TPDH',   offsetFrom:'tour', offsetDays:-1,
    title:'Họp briefing NVDH (30 phút): điểm nhạy cảm lịch trình, phân công cụ thể, tình huống dự phòng, thẩm quyền quyết định tại chỗ' },

  { code:'PO-20', phase:'PREOPS', role:'TPDH',   offsetFrom:'tour', offsetDays:-1,
    title:'Bàn giao Tour File chính thức cho NVDH: lịch trình chi tiết, guest list, rooming list, voucher NCC, tiền tạm ứng' },

  // ── Giai đoạn 3: Operation (T+0 → hết tour) ───────────────────────────────
  // Mục tiêu: thực thi đúng kế hoạch, ghi chép đầy đủ, xử lý sự cố kịp thời.

  { code:'OP-01', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:0,
    title:'2h trước giờ đón: gọi xác nhận tài xế — xe đang di chuyển, biển số, ETA điểm đón' },

  { code:'OP-02', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:0,
    title:'Tại điểm đón: điểm danh đủ khách theo guest list — chụp ảnh đoàn gửi về văn phòng' },

  { code:'OP-03', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:0,
    title:'Phổ biến nội quy đoàn: giờ tập trung từng điểm, SĐT HDV, quy tắc an toàn, số khẩn cấp địa phương' },

  { code:'OP-04', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:0,
    title:'Phát Tour Pack cho từng khách — xác nhận đủ bảng tên cá nhân, lịch trình in, SOS card' },

  { code:'OP-05', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:0,
    title:'Nhận phòng khách sạn: phân phòng đúng rooming list, kiểm tra tiện nghi — báo ngay nếu phòng có vấn đề' },

  { code:'OP-06', phase:'OPS', role:'WC',   offsetFrom:'tour', offsetDays:0,
    title:'Xác nhận khách hoàn thành lịch khám đúng kế hoạch — ghi chú nếu có khách vắng mặt/hoãn lịch', wellnessOnly:true },

  { code:'OP-07', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:null,
    title:'Trước mỗi bữa ăn: xác nhận lại số suất với nhà hàng — thông báo danh sách suất ăn đặc biệt' },

  { code:'OP-08', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:null,
    title:'Ghi chi phí phát sinh ngay khi thanh toán: tên NCC, hạng mục, số tiền — chụp ảnh hoá đơn lưu lại' },

  { code:'OP-09', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:null,
    title:'Sự cố: báo TPDH trong 30 phút — ghi biên bản đầy đủ: thời gian, diễn biến, biện pháp xử lý, kết quả' },

  { code:'OP-10', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:null,
    title:'Nộp Daily Report trước 21:00 mỗi ngày: tóm tắt lịch trình, tình trạng đoàn, sự cố, kế hoạch ngày mai' },

  { code:'OP-11', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:null,
    title:'Ngày cuối tour: nhắc khách kiểm tra phòng và hành lý — check-out đúng giờ, tập trung đủ người và đồ' },

  { code:'OP-12', phase:'OPS', role:'NVDH', offsetFrom:'tour', offsetDays:null,
    title:'Về đến điểm xuất phát: điểm danh đủ khách lần cuối — báo về văn phòng tour kết thúc an toàn' },

  // ── Giai đoạn 4: Post-Operation (T+1 → T+14) ──────────────────────────────
  // Mục tiêu: quyết toán sạch, thu feedback, đóng hồ sơ, rút kinh nghiệm.

  { code:'PT-01', phase:'POSTOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:1,
    title:'Nộp toàn bộ chứng từ chi gốc + tường trình từng khoản — kèm đối chiếu tạm ứng / đã chi / còn lại' },

  { code:'PT-02', phase:'POSTOPS', role:'CS',     offsetFrom:'tour', offsetDays:2,
    title:'Gọi điện thu feedback từng khách: đánh giá tổng thể + từng dịch vụ — ghi nhận điểm khen và góp ý cụ thể' },

  { code:'PT-03', phase:'POSTOPS', role:'CS',     offsetFrom:'tour', offsetDays:3,
    title:'Gửi email cảm ơn + ưu đãi booking lần sau + link review Google Maps / Tripadvisor' },

  { code:'PT-04', phase:'POSTOPS', role:'KETOAN', offsetFrom:'tour', offsetDays:5,
    title:'Đối soát công nợ từng NCC: kiểm tra invoice đúng số lượng, đơn giá, điều khoản so với hợp đồng' },

  { code:'PT-05', phase:'POSTOPS', role:'NVDH',   offsetFrom:'tour', offsetDays:3,
    title:'Chấm điểm chất lượng từng NCC đã dùng trong tour (1-5 sao + ghi chú cụ thể: tốt gì, cần cải thiện gì)' },

  { code:'PT-06', phase:'POSTOPS', role:'KETOAN', offsetFrom:'tour', offsetDays:7,
    title:'Hoàn tất thanh toán NCC theo hạn hợp đồng — lưu biên lai xác nhận đã nhận thanh toán' },

  { code:'PT-07', phase:'POSTOPS', role:'KETOAN', offsetFrom:'tour', offsetDays:7,
    title:'Quyết toán tour: doanh thu − tổng chi thực tế = lãi/lỗ — so sánh với dự toán ban đầu, giải thích chênh lệch' },

  { code:'PT-08', phase:'POSTOPS', role:'TPDH',   offsetFrom:'tour', offsetDays:7,
    title:'Review Tour Closing Report toàn diện — ghi bài học kinh nghiệm, phê duyệt đóng booking' },

  { code:'PT-09', phase:'POSTOPS', role:'WC',     offsetFrom:'tour', offsetDays:5,
    title:'Nhận kết quả khám từ NCC y tế — tư vấn sơ bộ và chuyển kết quả đến từng khách', wellnessOnly:true },

  { code:'PT-10', phase:'POSTOPS', role:'TPDH',   offsetFrom:'tour', offsetDays:2,
    title:'Kiểm tra và duyệt chứng từ NVDH nộp — đối chiếu tạm ứng, phê duyệt hoàn ứng hoặc bổ sung nếu thiếu' },

  { code:'PT-11', phase:'POSTOPS', role:'WC',     offsetFrom:'tour', offsetDays:10,
    title:'Follow-up kết quả khám: liên hệ khách có kết quả cần theo dõi, hỗ trợ đặt lịch tái khám nếu cần', wellnessOnly:true },
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

// Tính lại deadline khi tourDate đổi — chỉ item chưa done (item done giữ nguyên làm lịch sử)
// Trả về mảng checklist mới nếu có thay đổi, null nếu không
function recomputeDeadlines(booking) {
  if (!booking.checklist || !booking.checklist.length) return null;
  const byCode = Object.fromEntries(TEMPLATE.map(t => [t.code, t]));
  let changed = false;
  const checklist = booking.checklist.map(item => {
    const t = byCode[item.code];
    if (!t || item.done || t.offsetDays === null) return item;
    const base = t.offsetFrom === 'created' ? (booking.createdAt || '').slice(0, 10) : booking.tourDate;
    const deadline = addDays(base, t.offsetDays);
    if (deadline === item.deadline) return item;
    changed = true;
    return { ...item, deadline };
  });
  return changed ? checklist : null;
}

module.exports = { ensureChecklist, recomputeDeadlines, PHASE_LABELS };
