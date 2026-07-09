# Booking Hub — Working Notes

_Cập nhật: 2026-07-09 — bản live đã deploy và kiểm tra đầy đủ_

Tài liệu làm việc: trạng thái hiện tại, việc vừa làm, todo còn lại. Đọc kèm `CLAUDE.md` (briefing đầy đủ) và `DECISIONS.md` (15 ADR — tại sao xây như vậy, đọc trước khi refactor).

---

## 0. TRẠNG THÁI HIỆN TẠI (TL;DR)

- **Bản live:** https://booking-hub-production.up.railway.app — commit `9f8e1b8`, sw `bh-v3`, đã verify (mục 4).
- **Smoke test:** `npm test` → **199 pass, 0 fail**.
- **Hạ tầng user đã xong (2026-07-08):** email thật (Resend) + volume Railway (backup 02:00 / digest 07:30 / email khách / nhắc real-time đều sống), đổi mật khẩu mặc định, uptime monitor vào `/api/health`, Zalo OA.
- **Không còn việc code nào đang dở.** Todo còn lại ở mục 5.

---

## 1. Chuỗi commit phiên 2026-07-08/09 (đều đã push + deploy)

| Commit | Nội dung |
|---|---|
| `d8a1002` | **Cổng NCC** — portal nhà cung cấp tự xác nhận dịch vụ/voucher qua link riêng |
| `f724c8a` | Khép kín vòng NCC + tự đổi mật khẩu + security headers + phiếu thu in |
| `d289e7c` | Ops Board "Cần chú ý" gom đủ cảnh báo + sổ tay hướng dẫn `/huongdan` |
| `975d5a8` | Bump SW `CACHE_VERSION` bh-v2 → **bh-v3** (shell đổi) |
| `9f8e1b8` | `DECISIONS.md` — 15 ADR quyết định thiết kế + lý do |

---

## 2. Chi tiết việc đã làm phiên này

### 2a. Cổng NCC — portal nhà cung cấp tự xác nhận (`d8a1002`)
NCC nhận link riêng `/ncc?key=<token>` (CEO/TPDH tạo từ bảng NCC → nút "🔗 Cổng", gửi 1 lần) → mở là thấy dịch vụ REQUESTED gắn họ trên booking còn sống → **Xác nhận + nhập voucher** (→ CONFIRMED, nuôi Go/No-Go) hoặc **Báo không nhận** kèm lý do (cờ `svc.declined`, status VẪN REQUESTED để chặn Go/No-Go, báo real-time CEO/TPDH).

| File | Vai trò |
|---|---|
| `src/routes/nccPortal.js` | 3 endpoint công khai `/api/ncc-portal/me\|confirm\|decline` (rate limit 60/15min/IP) |
| `src/routes/suppliers.js` | `POST /:id/portal-key` (tạo/thu hồi/sendEmail); strip `portalKey` khỏi response thường (`hasPortal` thay thế) |
| `src/services/notifier.js` | `notifySvcPortal` (NCC thao tác → báo CEO/TPDH), `notifySupplierNewRequest` (dịch vụ mới → email NCC) |
| `public/ncc.html` | Trang NCC mobile-first (route `/ncc`) |

Bảo mật: key crypto 24 ký tự URL-safe, key đi qua POST body (không vào access log), chỉ trả trường an toàn (không tên/SĐT khách, không tiền), regenerate = thu hồi ngay.

### 2b. Đợt hoàn thiện chuyên nghiệp (`f724c8a`, `d289e7c`)
1. **Khép kín vòng NCC:** thêm dịch vụ gắn NCC → tự email yêu cầu giữ chỗ kèm link cổng (skip êm nếu thiếu email/mail); nút "📧 Gửi link qua email" trong modal cổng (`portal-key` body `{sendEmail:true}` → `emailResult`); card dashboard **"⛔ NCC báo không nhận"** (`stats.declinedServices`).
2. **Tự đổi mật khẩu an toàn:** tự đổi (mọi role, kể cả CEO) bắt buộc `oldPassword` đúng (sai → 401); CEO đổi hộ người khác không cần (kịch bản quên pass). UI: nút 🔑 cạnh Đăng xuất, modal thêm ô "Mật khẩu hiện tại" khi tự đổi.
3. **Security headers** (middleware server.js): nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy, Permissions-Policy, HSTS khi HTTPS. Không CSP (chủ đích — ADR-15).
4. **Phiếu thu in cho khách:** nút 🖨 per lần thu trong card thanh toán → phiếu thu chuẩn kế toán: số phiếu, ngày, người nộp, lý do, hình thức, **số tiền bằng chữ** (`docSoVN` — đã test mốt/lăm/lẻ/nghìn/triệu/tỷ), tổng/đã thu/còn lại, chỗ ký 2 bên.
5. **Ops Board "Cần chú ý" gom đủ:** checklist quá hạn + NCC báo không nhận + sự cố mở + chờ duyệt huỷ; icon ⛔🚨🛑 cạnh mã đơn (`obIssueIcons`); card ⛔ dashboard bấm → `gotoOpsAttention()` nhảy tới Ops Board lọc sẵn.
6. **Sổ tay hướng dẫn `/huongdan`** (`public/huongdan.html`, link ❓ cuối sidebar, mở tab mới): bắt đầu/PWA/đổi pass, quy trình tour A→Z 6 bước, việc theo 6 vai trò, cổng NCC 4 bước, trang khách, FAQ 7 câu. Trang tĩnh, không chứa dữ liệu — gửi thẳng cho nhân viên mới được.

### 2c. DECISIONS.md (`9f8e1b8`)
15 ADR nhóm 5 chủ đề (nền tảng / nghiệp vụ / giao tiếp / bảo mật / quy ước code), mỗi ADR: Quyết định → Lý do → Hệ quả. Điểm mấu chốt: **trạng thái dẫn xuất không lưu, luôn tính lại** (paid, seatsSold, hạng khách); decline không đổi status; SW không cache `/api/`; notify không bao giờ throw. CLAUDE.md đầu file đã trỏ sang.

### Verify trong Chrome (localhost, cùng commit deploy)
- Cổng NCC: xác nhận + voucher → chuyển "Đã xác nhận"; decline → viền đỏ + lý do; admin thấy "bởi <NCC> (cổng NCC)" + cờ đỏ trên card dịch vụ; modal 🔗 link + copy + tạo mới.
- Đổi mật khẩu: sai old → "Mật khẩu hiện tại không đúng"; đúng old → modal đóng, login pass mới 200.
- Phiếu thu: đủ 7 mục (tiêu đề, khách, số tiền, bằng chữ, note, còn lại, mã đơn).
- Ops Board lọc "Cần chú ý" ra đúng tour có dịch vụ bị từ chối kèm icon ⛔; `/huongdan` render đẹp.

---

## 3. Các đợt trước (đã hoàn thành, tóm tắt)

### PWA (2026-07-08, commits `5a0497b`, `a07e32e`)
- `manifest.webmanifest` + `sw.js` + icon `public/icons/` (sinh bằng `scripts/gen-icons.js`).
- SW **không cache `/api/`**, navigation network-first, static stale-while-revalidate. Shortcut long-press "Việc của tôi" (`/?view=tasks`).
- Verify Chrome full (SW activated, installable, offline shell, không cache api, deep-link) — tất cả đạt.
- ⚠️ Quy tắc sắt: **đổi `index.html` → bump `CACHE_VERSION` trong `sw.js`** (hiện `bh-v3`).

### Trước đó nữa
Xem "Tính năng đã có" trong `CLAUDE.md` — 40+ mục từ auth đến departures/reviews/NPS, tất cả có smoke test.

---

## 4. Kiểm tra bản LIVE (2026-07-09) — TẤT CẢ ĐẠT

URL: https://booking-hub-production.up.railway.app

| Hạng mục | Kết quả |
|---|---|
| `/api/health` | ✅ OK — db ok, errors 0 |
| Đúng bản mới | ✅ `sw.js` trả `CACHE_VERSION = 'bh-v3'` |
| Security headers | ✅ đủ 5, gồm HSTS (nhận HTTPS đúng qua proxy Railway) |
| `/huongdan` | ✅ 200, render đầy đủ trong Chrome, UTF-8 chuẩn |
| `/ncc` `/tracuu` `/danhgia` | ✅ 200 đúng content-type |
| `manifest.webmanifest` | ✅ 200 `application/manifest+json` |
| Cổng NCC key rác | ✅ 404 + thông báo an toàn |
| `/api/errors`, PATCH password không token | ✅ 401 |

Chưa test trên live (cần đăng nhập thật — mật khẩu đã đổi, đúng thiết kế): nút 🔑, card ⛔, in phiếu thu, nút 📧 gửi link NCC → user bấm thử trên live; đã verify kỹ ở local cùng commit.

---

## 5. Todo còn lại

### Có kế hoạch
- [ ] **Cổng thanh toán online** (VNPay/MoMo/Stripe) — **user chủ trì ~2026-09** (thủ tục merchant). Kiến trúc receipts sẵn sàng nối webhook. KHÔNG tự code trước.
- [ ] **BI** (phễu/LTV/forecast/cohort) — đợi vài chục tour dữ liệu thật.

### Xa hơn (chưa xếp lịch)
- [ ] Dynamic pricing · kết nối OTA · đa ngôn ngữ/tiền tệ · loyalty points · AI chatbot.
- [ ] Migrate MongoDB — chỉ khi dữ liệu lớn thật.

### Việc người dùng (không phải code)
- [ ] Đưa team dùng thật + gửi họ link `/huongdan`; dữ liệu thật sẽ mở khoá BI.
- [ ] Thử vòng NCC thật: gắn email cho 1 NCC → thêm dịch vụ → NCC nhận email → tự xác nhận.

---

## 6. Ghi chú vận hành nhanh

- Chạy local: `node server.js` → http://localhost:3000
- Smoke test (199 case, DB tạm qua `DATA_DIR`, không đụng `data/`): `npm test`
- Deploy: push `master` → Railway tự deploy. Kiểm tra bản lên chưa: `curl .../sw.js | grep CACHE_VERSION`.
- Sinh lại icon PWA: `node scripts/gen-icons.js`
- Khôi phục backup: `node scripts/restore-backup.js <file.json.gz>` (khi server tắt).
- Tài khoản test local (production ĐÃ đổi pass): `ceo/ceo123`, `tpdh/tpdh123`, `cs/cs123`, `wc/wc123`, `ketoan/kt123`.

### Gotcha khi verify UI (kinh nghiệm tích luỹ)
- Cache-buster `?v=N` khi sửa index.html để né cache trình duyệt.
- Token lưu `localStorage` key `bh_token` — DB tạm mới thì token cũ thành "invalid token", cần login lại (không phải bug).
- Kill node cũ trước khi restart server (`taskkill //F //IM node.exe`).
- Fetch trong trang để giữ UTF-8 đúng.
- `$TMPDIR` rỗng trong Git Bash trên Windows → dùng `$LOCALAPPDATA/Temp/...` cho `DATA_DIR` tạm.
- `window.open` (in phiếu thu/tour file) mở ngoài tab group của Chrome MCP → verify nội dung bằng cách override `window.open` bắt HTML.
