# TỔNG HỢP DỰ ÁN — XÂY DỰNG SOP, KPI & TÁI CẤU TRÚC PHÒNG KẾ TOÁN TPP

Cập nhật: 20/07/2026 | Bối cảnh: Công ty TPP — sản xuất hạt, doanh thu ~500 tỷ/năm, 4 địa điểm (Đồng Tháp, Hà Nội, TP.HCM, Phú Quốc), kênh GT/MT/Ecom, hệ thống AMIS + MISA.

---

## 1. DANH MỤC TÀI LIỆU ĐÃ BAN HÀNH (thư mục 260719)

| Mã | Tài liệu | Nội dung chính |
|---|---|---|
| SOP-TC-01 | Quy trình Thanh toán & Tạm ứng | Bám 20 bước AMIS thực tế; SLA từng cấp duyệt (TBP 4h, KT 8h, KTT 4h, GĐ 8h); quyết toán tạm ứng 7 ngày theo từng ID; chặn tạm ứng mới khi còn quá hạn; 7 điểm kiểm soát |
| SOP-KHO-01 | Quy trình Nhập kho | 3-way match (ĐĐH – Phiếu nhập – Hóa đơn); 6 nguyên tắc bắt buộc N1–N6; checklist dán tại kho; áp dụng chung 7 kho; xử lý chênh lệch có biên bản |
| MTR-PD-01 | Ma trận phê duyệt & phân quyền | Giữ hạn mức KTT ≤10tr (đang chạy trên AMIS); thêm tầng GĐĐH 10–200tr, TGĐ >200tr; chi không hóa đơn luôn qua GĐ + trần 5tr/lần; quy tắc chống chẻ nhỏ; cấm sửa/xóa chứng từ sau duyệt |
| KPI-TC-KHO-01 | Bộ KPI 2 quy trình | 6+6 chỉ số đo tự động từ timestamp AMIS/MISA; 3 tháng đầu chỉ đo baseline, chưa thưởng phạt |
| TC-JD-KPI-01 | Mô hình phòng kế toán mới | JD + KPI cho 6 vị trí văn phòng + 3 KT kho SX; phân bổ mục tiêu 50% ghi nhận – 25% kiểm soát – 25% quản trị; go-live 01/08/2026 |
| DA-CL-01 (V1 + V2) | Dự án Thống nhất hệ thống sổ sách | Lộ trình 8 tháng, cut-off 01/10/2026; V2 bổ sung: xử lý 5 nhóm số dư BCĐKT, kế hoạch thuế 2027, soát xét độc lập trước quyết toán, bộ 16 hồ sơ giải trình "chuẩn 10 ngày" |

## 2. CẤU TRÚC PHÒNG KẾ TOÁN MỚI (từ 01/08/2026)

- 6 vị trí văn phòng: KTT, KT thuế, KT bán hàng MT+Ecom, KT bán hàng GT, KT thanh toán, KT sản xuất (giá thành).
- 3 KT kho tại kho sản xuất: Mỹ An, Phú Điền, Cái Bè.
- Kho thương mại (Q12–BD, HN, Thạnh Lộc, kho bán hàng): KT bán hàng kênh tương ứng hạch toán, thủ kho lập phiếu.
- **Thay đổi kiểm soát then chốt:** Lệnh SX không còn do KT kho + QLSX tại kho tự lập. QLSX lập lệnh theo BOM chuẩn → KT sản xuất văn phòng xác nhận định mức TRƯỚC khi kho xuất NVL. Cảnh báo vượt định mức ≤5 ngày, ngưỡng >3% giá trị NVL/lệnh.
- Điều kiện tiên quyết: P.RD + Kỹ thuật chốt BOM nhóm SP chiếm 80% sản lượng trước 01/08; mua thêm user AMIS để người tạo chứng từ đầu nguồn tự nhập.

## 3. DỰ ÁN THỐNG NHẤT SỔ SÁCH (DA-CL-01 V2.0) — TÓM TẮT

- **Nguyên tắc cốt lõi:** cut-off 01/10/2026; chặn dòng mới trước, xử lý tồn đọng sau; KHÔNG hồi tố, không tạo chứng từ không phản ánh giao dịch thực (rủi ro hình sự Điều 200 BLHS); kiểm kê thực tế là số liệu gốc.
- **Lộ trình:** GĐ1-T8 đánh giá chênh lệch (mật) → GĐ2-T9 nghị quyết BLĐ + kế hoạch thuế 2027 → GĐ3-T10/11 chuẩn hóa dòng chảy (hóa đơn đầy đủ, Ecom trước) → GĐ4-T11/12 hội tụ số dư BCĐKT → GĐ5-T1/2027 một hệ thống → GĐ6-T2-3/2027 soát xét thuế độc lập trước quyết toán.
- **5 nhóm số dư khó nhất:** tiền/phải thu treo; TSCĐ; vay BLĐ (NĐ 132); lợi nhuận chưa phân phối (nhạy cảm nhất — bắt buộc qua tư vấn thuế); vốn góp.
- **KPI chuyển đổi:** 25–30% trọng số cá nhân trong thời gian dự án.
- **Tư vấn độc lập:** chỉ thuê 2 điểm chạm (GĐ4 + GĐ6), ngân sách 50–80tr, hợp đồng yêu cầu sản phẩm định lượng rủi ro.
- **Khó khăn thực tế cần lường:** tồn kho ảo phải "tiêu hóa" 2–4 quý; quỹ tiền mặt ảo; công nợ GT chỉ xác nhận được ~60–70%; "bước nhảy" số liệu sau cut-off chắc chắn bị CQT nhìn thấy (quy mô 500 tỷ thuộc nhóm giám sát kỹ); kế toán cũ sợ trách nhiệm; KD phản đối vì giá; NCC nhỏ tăng giá 3–8%.
- **3 việc bổ sung tháng 8 (chưa có trong V2, dự kiến V2.1):** thu hồi toàn bộ file nội bộ về ổ chung công ty; cam kết hành vi BLĐ trong nghị quyết (không duyệt miệng, không rút tiền không chứng từ); dự báo dòng tiền Q4/2026 chịu tải thuế mới.

## 4. RỦI RO ĐẶC THÙ NGÀNH HẠT (tư vấn ngày 20/07/2026 — cần KT thuế xác minh văn bản gốc)

1. **Thu mua nguyên liệu (KHẨN):** từ 01/10/2025, mua theo bảng kê ≥5tr phải thanh toán KHÔNG dùng tiền mặt mới được trừ chi phí — chấm dứt trả tiền mặt tại trạm cân. Bảng kê chỉ hợp lệ khi mua trực tiếp từ người sản xuất (qua thương lái phải có hóa đơn). Từ 12/03/2026 dùng mẫu 02/TNDN thay 01/TNDN (TT 20/2026/TT-BTC).
2. **Thuế GTGT nông sản đổi 2 lần:** 01/07/2025 sơ chế chịu 5% (Luật 48/2024); 01/01/2026 đảo lại — B2B sơ chế không kê khai tính nộp, vẫn khấu trừ đầu vào (Luật 149/2025). Việc cần làm: rà hóa đơn đã xuất từ 07/2025; lập ma trận thuế suất SKU × mức chế biến × kênh; xin xác nhận ranh giới "sơ chế vs chế biến" (rang/tẩm = chế biến).
3. **Định mức thu hồi:** BOM theo tỷ lệ thu hồi biến động theo vụ/lô (nhân/thô, ẩm độ, bể vỡ); ban hành nội bộ chống ấn định thuế; đối chiếu thu hồi từng lô = công cụ phát hiện gian lận trạm cân.
4. **Kiểm soát trạm cân:** cân in phiếu tự động, đo ẩm lưu hồ sơ có ảnh, camera, người mua ≠ người cân ≠ người thanh toán, đối chiếu giá mua với giá vùng theo tuần.
5. **Radar 500 tỷ:** hoàn thuế GTGT xuất khẩu (đầu vào bảng kê không có GTGT — đừng kỳ vọng hoàn lớn); NĐ 132 nếu vay BLĐ ≥10% vốn chủ → trần lãi vay 30% EBITDA + kê khai giao dịch liên kết; dự báo dòng tiền theo vụ, không theo tháng đều.

## 5. LỊCH TRIỂN KHAI HỢP NHẤT

| Thời gian | Việc |
|---|---|
| Tuần 4/7/2026 | Mua user AMIS, cấu hình phân luồng; BLĐ duyệt TC-JD-KPI-01 + MTR-PD-01; kiểm tra phương thức thanh toán thu mua (tiền mặt ≥5tr?); thu hồi file nội bộ về ổ chung |
| T8/2026 | Go-live phân luồng + JD ký nhận; chốt BOM 80% sản lượng; GĐ1 đánh giá chênh lệch; rà hóa đơn 07/2025→nay |
| 01/10/2026 | Cut-off một sổ; 100% chi ≥5tr chuyển khoản; kho không xuất NVL nếu lệnh SX chưa xác nhận |
| T11–12/2026 | Kiểm kê toàn bộ; xử lý 5 nhóm số dư (tư vấn thuế duyệt) |
| T1/2027 | Một hệ thống; BCTC 2027 sạch từ đầu năm |
| T2–3/2027 | Soát xét thuế độc lập; nộp quyết toán 2026; T11/2026 chốt KPI chính thức sau baseline |

## 6. VIỆC CHỜ QUYẾT ĐỊNH / ĐỀ XUẤT TIẾP THEO

- BLĐ chốt các con số hạn mức trong MTR-PD-01 (hiện là đề xuất).
- Đợt 2 SOP: xuất kho – bán hàng GT/MT/Ecom – thu mua (chờ mô tả luồng).
- Tài liệu mới đề xuất: SOP thu mua nguyên liệu hạt (trạm cân + bảng kê + thanh toán); ma trận thuế suất SKU; mẫu dự báo dòng tiền theo vụ; DA-CL-01 V2.1 (3 bổ sung mục 3).
- Lưu ý bảo mật: các tài liệu dùng ngôn ngữ an toàn ("thống nhất hệ thống sổ sách", không dùng "2 sổ"); bản đồ chênh lệch chỉ KTT giữ.

---
*Tài liệu do trợ lý AI tổng hợp từ phiên làm việc; các nội dung thuế cần xác minh với đại lý thuế/tư vấn trước khi áp dụng.*
