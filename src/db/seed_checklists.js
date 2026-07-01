const { dbAsync } = require('./database');

const CHECKLIST_ITEMS = [
  // ── CS ────────────────────────────────────────────────
  { id:'cs-d1', role:'CS', freq:'DAILY', order:1, title:'Kiểm tra inbox & lead mới', detail:'Email + Zalo + Website. Phản hồi trong 30 phút.', sop:'PLT-03' },
  { id:'cs-d2', role:'CS', freq:'DAILY', order:2, title:'Tạo Booking mới trên hệ thống', detail:'Điền đầy đủ: tên tour, ngày, khách hàng, SĐT, số tiền.', sop:'PLT-02' },
  { id:'cs-d3', role:'CS', freq:'DAILY', order:3, title:'Xác nhận thông tin với khách', detail:'Gọi hoặc Zalo xác nhận trong 2 giờ sau khi nhận đơn.', sop:'PLT-02' },
  { id:'cs-d4', role:'CS', freq:'DAILY', order:4, title:'Chuyển booking sang CTY1', detail:'Copy Booking Brief → gửi Zalo/email TPDH. Đổi status CONFIRMED.', sop:'IC-01' },
  { id:'cs-d5', role:'CS', freq:'DAILY', order:5, title:'Không để đơn NEW quá 24 giờ', detail:'Kiểm tra danh sách, đôn đốc hoặc escalate.', sop:'PLT-02' },
  { id:'cs-w1', role:'CS', freq:'WEEKLY', order:1, title:'Báo cáo số đơn tuần cho CEO', detail:'Số mới / confirm / huỷ — gửi Zalo trước 17h Thứ 6.', sop:'' },
  { id:'cs-w2', role:'CS', freq:'WEEKLY', order:2, title:'Kiểm tra đơn chưa thanh toán đủ', detail:'Nhắc khách, báo kế toán.', sop:'PLT-05' },
  { id:'cs-w3', role:'CS', freq:'WEEKLY', order:3, title:'Ghi nhận phàn nàn vào Complaint_Log', detail:'Bất kỳ feedback tiêu cực nào từ khách.', sop:'PLT-03' },

  // ── TPDH ──────────────────────────────────────────────
  { id:'tpdh-d1', role:'TPDH', freq:'DAILY', order:1, title:'Nhận & xác nhận Booking Brief từ CTY2', detail:'Reply trong 4 giờ: confirm hoặc báo không khả thi + lý do.', sop:'IC-01' },
  { id:'tpdh-d2', role:'TPDH', freq:'DAILY', order:2, title:'Phân công NVDH cho tour', detail:'Mỗi tour phải có NVDH được assign trước 48h khởi hành.', sop:'OPS-01' },
  { id:'tpdh-d3', role:'TPDH', freq:'DAILY', order:3, title:'Kiểm tra chuẩn bị tour 3 ngày tới', detail:'Xe, NCC, khách sạn đã book? NVDH đã được brief?', sop:'OPS-02' },
  { id:'tpdh-d4', role:'TPDH', freq:'DAILY', order:4, title:'Cập nhật status booking trên hệ thống', detail:'Khởi hành → IN_PROGRESS. Về → COMPLETED.', sop:'OPS-03' },
  { id:'tpdh-w1', role:'TPDH', freq:'WEEKLY', order:1, title:'Họp briefing NVDH (15 phút Thứ 2)', detail:'Điểm danh các tour trong tuần.', sop:'OPS-02' },
  { id:'tpdh-w2', role:'TPDH', freq:'WEEKLY', order:2, title:'Đánh giá NCC tuần qua', detail:'Xe, khách sạn, ăn uống — ghi vào NCC_Rating.', sop:'OPS-06' },
  { id:'tpdh-w3', role:'TPDH', freq:'WEEKLY', order:3, title:'Báo cáo CEO: sự cố & NCC cần thay', detail:'Gửi Zalo hoặc email tóm tắt.', sop:'' },

  // ── NVDH ──────────────────────────────────────────────
  { id:'nvdh-d1', role:'NVDH', freq:'DAILY', order:1, title:'Đọc Brief tour trước khởi hành 48h', detail:'Nắm rõ yêu cầu đặc biệt: ăn chay, trẻ em, người cao tuổi.', sop:'OPS-02' },
  { id:'nvdh-d2', role:'NVDH', freq:'DAILY', order:2, title:'Điểm danh khách trước xuất phát', detail:'Đúng số người, nhận voucher nếu cần, check xe đúng biển số.', sop:'OPS-03' },
  { id:'nvdh-d3', role:'NVDH', freq:'DAILY', order:3, title:'Báo TPDH khi khởi hành & khi về', detail:'"Đoàn xuất phát lúc XX:XX" và "Đoàn về an toàn lúc XX:XX".', sop:'OPS-03' },
  { id:'nvdh-d4', role:'NVDH', freq:'DAILY', order:4, title:'Ghi nhận sự cố (nếu có)', detail:'Phàn nàn, NCC không đúng → ghi Complaint_Log ngay hôm đó.', sop:'OPS-04' },
  { id:'nvdh-w1', role:'NVDH', freq:'WEEKLY', order:1, title:'Nộp báo cáo chuyến đi cho TPDH', detail:'Trước 17h Thứ 6.', sop:'OPS-05' },
  { id:'nvdh-w2', role:'NVDH', freq:'WEEKLY', order:2, title:'Feedback NCC: điểm 1-5', detail:'Xe, khách sạn, ăn uống.', sop:'OPS-06' },

  // ── WC ────────────────────────────────────────────────
  { id:'wc-d1', role:'WC', freq:'DAILY', order:1, title:'Kiểm tra booking Wellness mới', detail:'Booking Hub → Filter WELLNESS. Liên hệ khách trong ngày.', sop:'HLT-01' },
  { id:'wc-d2', role:'WC', freq:'DAILY', order:2, title:'Xác nhận lịch khám với NCC y tế', detail:'NCC đã nhận thông tin khách? Slot khám đúng ngày tour?', sop:'HLT-04' },
  { id:'wc-d3', role:'WC', freq:'DAILY', order:3, title:'Phối hợp với NVDH CTY1', detail:'NVDH biết lịch khám chưa? Bàn giao danh sách yêu cầu y tế.', sop:'IC-03' },
  { id:'wc-w1', role:'WC', freq:'WEEKLY', order:1, title:'Báo cáo số khách Wellness trong tuần', detail:'Gửi CEO Thứ 6.', sop:'' },
  { id:'wc-w2', role:'WC', freq:'WEEKLY', order:2, title:'Đánh giá NCC y tế', detail:'Chất lượng, đúng giờ không — ghi NCC_Rating.', sop:'HLT-03' },
  { id:'wc-w3', role:'WC', freq:'WEEKLY', order:3, title:'Follow-up khách sau tour — upsell', detail:'Hỏi thăm sức khoẻ, nhắc lịch tái khám, giới thiệu gói mới.', sop:'HLT-05' },

  // ── KETOAN ────────────────────────────────────────────
  { id:'kt-d1', role:'KETOAN', freq:'DAILY', order:1, title:'Kiểm tra thanh toán đến hạn', detail:'Booking Hub → đơn chưa paid → nhắc CS liên hệ khách.', sop:'PLT-05' },
  { id:'kt-d2', role:'KETOAN', freq:'DAILY', order:2, title:'Ghi nhận thu chi phát sinh', detail:'Mọi khoản vào sổ đúng ngày. Không để hôm sau.', sop:'IC-02' },
  { id:'kt-d3', role:'KETOAN', freq:'DAILY', order:3, title:'Kiểm tra Form TC-02 nộp vào', detail:'Xử lý trong 1 ngày LV — duyệt hoàn tiền hoặc yêu cầu bổ sung.', sop:'TC-QC-02' },
  { id:'kt-w1', role:'KETOAN', freq:'WEEKLY', order:1, title:'Đối chiếu doanh thu với Booking Hub', detail:'Số tiền hệ thống vs sổ sách có khớp không?', sop:'PLT-05' },
  { id:'kt-w2', role:'KETOAN', freq:'WEEKLY', order:2, title:'Kiểm tra công nợ NCC đến hạn', detail:'Ai phải trả tuần này?', sop:'IC-02' },
  { id:'kt-w3', role:'KETOAN', freq:'WEEKLY', order:3, title:'Báo cáo dòng tiền tuần — gửi CEO', detail:'Trước 17h Thứ 6.', sop:'' },

  // ── CEO ───────────────────────────────────────────────
  { id:'ceo-d1', role:'CEO', freq:'DAILY', order:1, title:'Review Dashboard booking', detail:'Có đơn mới nào chưa được xử lý? Có vấn đề gì cần can thiệp?', sop:'' },
  { id:'ceo-d2', role:'CEO', freq:'DAILY', order:2, title:'Kiểm tra compliance checklist team', detail:'Ai chưa tick hôm nay? Hỏi nguyên nhân.', sop:'' },
  { id:'ceo-w1', role:'CEO', freq:'WEEKLY', order:1, title:'Họp team Thứ 2 (15 phút)', detail:'Review tuần trước, set priority tuần này.', sop:'' },
  { id:'ceo-w2', role:'CEO', freq:'WEEKLY', order:2, title:'Xem báo cáo dòng tiền từ Kế toán', detail:'Có vấn đề gì cần quyết định ngay?', sop:'IC-02' },
  { id:'ceo-w3', role:'CEO', freq:'WEEKLY', order:3, title:'Review SOP nào đang bị bỏ qua', detail:'Compliance rate thấp → train lại hoặc đơn giản hoá SOP.', sop:'' },
];

async function seedChecklists() {
  const existing = await dbAsync.count('checklist_items', {});
  if (existing > 0) { console.log('[seed-cl] Checklist items already exist, skipping'); return; }
  for (const item of CHECKLIST_ITEMS) {
    await dbAsync.insert('checklist_items', { ...item, createdAt: new Date().toISOString() });
  }
  console.log(`[seed-cl] Seeded ${CHECKLIST_ITEMS.length} checklist items`);
}

module.exports = seedChecklists;
