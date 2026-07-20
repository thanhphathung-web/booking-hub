# TPP Kế toán — Tiến độ công cụ quản lý (Artifact)

Cập nhật: 20/07/2026 | Nguồn nội dung: `TONG_HOP_DU_AN_TPP.md` (cùng thư mục)

## Đã làm

Xây 1 Artifact riêng (không liên quan code booking-hub), gộp từ 2 bản nháp ban đầu thành 1 trang:

**Link:** https://claude.ai/code/artifact/0ffc3ce6-167b-4b25-a5cf-2329303356b7
(riêng tư — chỉ chủ tài khoản Claude thấy, trừ khi tự bấm chia sẻ)

9 mục trong 1 trang cuộn, sidebar điều hướng:
1. Tài liệu đã ban hành (6 doc, mỗi doc có việc "phổ biến & ký nhận")
2. Cơ cấu phòng kế toán mới (tham khảo, không có checklist)
3. DA-CL-01 chi tiết (nguyên tắc cốt lõi, 6 giai đoạn, 5 nhóm số dư khó, khó khăn thực tế)
4. Lịch triển khai hợp nhất (18 việc theo mốc thời gian, tick trạng thái)
5. Rủi ro ngành hạt cần xử lý (5 nhóm, cờ KHẨN cho thu mua nguyên liệu)
6. Chờ quyết định / đề xuất tiếp theo (6 việc + lưu ý bảo mật)
7. **Checklist định kỳ** — SOP-TC-01 (7 điểm) + SOP-KHO-01 (4 điểm), theo kỳ tháng, có nút "Chốt kỳ" lưu lịch sử %
8. **KPI (KPI-TC-KHO-01)** — 12 chỉ số (6+6), chế độ Baseline/Chính thức, trọng số JD-KPI 50/25/25
9. **Đánh giá theo JD-KPI** — nhập điểm Ghi nhận/Kiểm soát/Quản trị, tự tính điểm tổng + xếp loại

Dữ liệu lưu `localStorage` trong trình duyệt (2 key: `tpp_ketoan_board_v1` + `tpp_ketoan_ops_v1`). Nút "Xuất/Nhập bản sao lưu" ở đầu trang gộp cả 2 phần thành 1 file JSON.

## Việc còn dang dở — cần làm tiếp

- **12 chỉ số KPI ở mục 8 là bản ĐỀ XUẤT do AI soạn** (suy ra từ mô tả SOP-TC-01/SOP-KHO-01), **chưa phải KPI-TC-KHO-01 chính thức**. Cần:
  - Lấy nội dung đầy đủ file KPI-TC-KHO-01 gốc (thư mục 260719)
  - Dán vào để thay đúng 12 chỉ số thật (tên, đơn vị, chiều đạt, mục tiêu)
- Ngưỡng xếp loại đánh giá (Xuất sắc ≥90 / Tốt ≥75 / Đạt ≥60) ở mục 9 cũng là **đề xuất mặc định**, chưa phải chính sách BLĐ chốt.
- "7 điểm kiểm soát" SOP-TC-01 ở mục 7 mới liệt kê được ~6 ý rút từ tóm tắt — cần đối chiếu bản SOP đầy đủ để bổ sung điểm còn thiếu.
- "N1–N6" SOP-KHO-01 ở mục 7 mới có 1 dòng chung chung — cần điền đúng 6 nguyên tắc thật nếu muốn tách checklist chi tiết hơn.

## Cách tiếp tục ở phiên sau

Mở lại conversation này (hoặc phiên mới, dán link file này), nói ví dụ:
> "đọc TPP_KETOAN_TIEN_DO.md, giờ điền 12 chỉ số KPI thật — nội dung KPI-TC-KHO-01 đây: ..."

hoặc mở thẳng link artifact ở trên và sửa tay trong trang (mọi ô tên/đơn vị/chiều đạt đều edit trực tiếp được, không cần qua AI).
