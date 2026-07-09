# Booking Hub — Working Notes

_Cập nhật: 2026-07-08_

Tài liệu làm việc: trạng thái hiện tại, việc vừa làm, và todo còn lại. Đọc kèm `CLAUDE.md` (briefing đầy đủ).

---

## 0. User đã hoàn thành (2026-07-08) — hạ tầng vận hành

- [x] **Bước 1 — chuỗi an toàn dữ liệu:** cấu hình email thật (Resend/SMTP) + xác nhận volume Railway → backup đêm 02:00, digest 07:30, email khách, nhắc real-time đã sống.
- [x] **Bước 2 — vệ sinh bảo mật:** đổi mật khẩu mặc định, gắn uptime monitor vào `/api/health`, cấu hình Zalo OA.
- ⏳ **Bước 3 — cổng thanh toán online (VNPay/MoMo):** user chủ động làm sau, dự kiến **~2026-09** (thủ tục merchant cần thời gian). Chưa code phần này.

---

## 1. Vừa hoàn thành trong phiên này (2026-07-08)

### Cổng NCC — portal nhà cung cấp tự xác nhận dịch vụ
Nhà cung cấp nhận link riêng `/ncc?key=<token>` (CEO/TPDH tạo từ bảng NCC, gửi Zalo/email 1 lần) → mở là thấy các dịch vụ REQUESTED gắn họ trên booking còn sống → bấm **Xác nhận + nhập số voucher** (→ CONFIRMED, nuôi Go/No-Go) hoặc **Báo không nhận** kèm lý do (→ cờ đỏ, status vẫn REQUESTED để chặn Go/No-Go, báo real-time CEO/TPDH).

| File | Vai trò |
|---|---|
| `src/routes/nccPortal.js` | 3 endpoint công khai `/api/ncc-portal/me\|confirm\|decline` (rate limit 60/15min/IP) |
| `src/routes/suppliers.js` | `POST /:id/portal-key` (tạo/thu hồi link); strip `portalKey` khỏi mọi response thường (`hasPortal` thay thế) |
| `src/services/notifier.js` | `notifySvcPortal` — NCC xác nhận/từ chối → báo ngay CEO/TPDH qua email/Zalo |
| `public/ncc.html` | Trang NCC mobile-first (route `/ncc`) |
| `public/index.html` | Nút "🔗 Cổng" + modal link (copy/tạo mới) trên bảng NCC; cờ đỏ "⛔ NCC báo không nhận" trên card dịch vụ |

Bảo mật: key crypto 24 ký tự, POST để key không vào access log, chỉ trả trường an toàn (không tên/SĐT khách, không tiền), regenerate = thu hồi link cũ ngay. **`npm test` → 186 pass, 0 fail** (+16 case cổng NCC).

### Đợt cải thiện tiếp (khối tự trị 2026-07-08/09) — 4 nhóm
1. **Khép kín vòng Cổng NCC**: thêm dịch vụ gắn NCC → tự email yêu cầu giữ chỗ cho NCC kèm link cổng (`notifier.notifySupplierNewRequest`, skip êm); nút "📧 Gửi link qua email" trong modal cổng (`portal-key` body `{sendEmail:true}` → `emailResult`); card dashboard **"⛔ NCC báo không nhận"** (`stats.declinedServices`).
2. **Tự đổi mật khẩu an toàn**: PATCH password — tự đổi (mọi role, kể cả CEO) bắt buộc `oldPassword` đúng (401 nếu sai); CEO đổi cho người khác không cần. UI: nút 🔑 cạnh Đăng xuất, modal thêm ô "Mật khẩu hiện tại" khi tự đổi.
3. **Security headers** (server.js middleware): nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy, Permissions-Policy, HSTS khi HTTPS.
4. **Phiếu thu in cho khách**: nút 🖨 per lần thu trong card thanh toán → phiếu thu chuẩn kế toán (số phiếu, ngày, người nộp, lý do, hình thức, **số tiền bằng chữ** — hàm `docSoVN` đã test mốt/lăm/lẻ/nghìn/triệu/tỷ, tổng/đã thu/còn lại, chỗ ký 2 bên).

**`npm test` → 198 pass, 0 fail** (+12 case). Verify Chrome: card ⛔ trên dashboard, modal đổi pass (sai old → báo lỗi, đúng old → login pass mới OK), nội dung phiếu thu đủ 7 mục.

### PWA — Cài app trên điện thoại + offline shell
Commit `5a0497b` — đã push lên `origin/master`.

| File | Vai trò |
|---|---|
| `public/manifest.webmanifest` | Metadata app: tên, icon, `display: standalone`, brand navy `#1F3864` |
| `public/sw.js` | Service worker — offline app shell + cache tĩnh |
| `public/icons/icon-192.png`, `icon-512.png` | Icon (nền navy + vòng tròn trắng + 3 chấm navy/teal/purple = hệ sinh thái 3 công ty) |
| `scripts/gen-icons.js` | Sinh lại icon bằng pixel + zlib (không cần thư viện ảnh) |
| `public/index.html` | Nhúng manifest/meta vào `<head>` + `initPWA()` (đăng ký SW + nút "📲 Cài app") |

**Quyết định thiết kế an toàn (quan trọng):**
- SW **tuyệt đối không cache `/api/`** → dữ liệu booking/tiền/đơn luôn tươi, không bao giờ hiện đơn cũ gây nhầm.
- **Navigation network-first**, offline mới rơi về app shell đã cache (SPA vẫn mở được, UI tự báo lỗi mạng).
- Static (icon/manifest) **stale-while-revalidate** → mở tức thì.
- Bỏ qua cross-origin (Tailwind CDN) và non-GET request.
- Đổi shell → **bump `CACHE_VERSION`** trong `sw.js` để client lấy bản mới.

### Shortcut "Việc của tôi" (long-press icon)
Commit `a07e32e` — đã push.

- `manifest.shortcuts` → URL `/?view=tasks`.
- Boot đọc `?view=tasks`: `showPage('dashboard')` → cuộn tới + highlight viền xanh khối 🎯 "Việc của tôi" 2.5s, rồi `history.replaceState` xoá param (refresh/back không kích lại).
- Khối "Việc của tôi" được gán `id="cardMyTasks"`.
- Bump `CACHE_VERSION` bh-v1 → **bh-v2**.

**Cách dùng (sau khi Railway deploy):** giữ (long-press) icon app đã cài → menu hiện "Việc của tôi" → mở thẳng. Chỉ có sau khi **cài app** (không phải tab thường); máy cài bản cũ nhận shortcut khi SW cập nhật (mở lại app 1-2 lần).

**Kiểm chứng tĩnh:** manifest JSON hợp lệ; server phục vụ đúng content-type (`application/manifest+json`, `text/javascript`, `image/png`); **`npm test` → 170 pass, 0 fail**.

**Verify trực tiếp trong Chrome (2026-07-08, localhost:3100) — TẤT CẢ ĐẠT:**

| Hạng mục | Kết quả |
|---|---|
| Service worker | ✅ Đăng ký, scope `/`, state `activated`, script `/sw.js` |
| Manifest | ✅ `name` đúng, `display: standalone`, 4 icons, theme-color `#1F3864` |
| apple-touch-icon | ✅ Có |
| Cache | ✅ `bh-v2` chứa đúng app shell (`/`, manifest, 2 icon) |
| **Không cache `/api/`** | ✅ Sau khi gọi login API, cache **không** chứa `/api/` — data luôn tươi |
| Offline shell | ✅ `caches.match('/')` trả 200 — offline vẫn mở được app |
| Installable | ✅ Chrome kích `beforeinstallprompt` → nút 📲 "Cài app" hiện thật |
| Shortcut deep-link | ✅ `/?view=tasks` → đăng nhập, tự cuộn xuống khối 🎯 "Việc của tôi", URL tự xoá param |
| Console | ✅ Không lỗi PWA/SW |

---

## 2. Cần user làm để PWA chạy thật
- PWA install chỉ chạy trên **HTTPS** (Railway có sẵn) hoặc `localhost`. `http://` LAN không cài được.
- Mở URL Railway trên điện thoại (Chrome/Safari) → "Thêm vào màn hình chính" hoặc nút **📲 Cài app** góc dưới phải.

---

## 3. Todo còn lại (backlog)

### Backlog chính thức (CLAUDE.md)
- [ ] **Cổng thanh toán online thật** (VNPay/MoMo/Stripe) — user làm ~2026-09 (xem mục 0).
- [ ] **Migrate sang MongoDB** khi scale.

### Roadmap "top-1" còn lại (memory)
- [ ] **Cổng NCC** — portal cho nhà cung cấp tự xác nhận dịch vụ/voucher. **← ĐANG LÀM phiên này**
- [ ] **BI / Business Intelligence** — phễu/LTV/forecast, cohort khách, hiệu suất sản phẩm (đợi có dữ liệu tour thật).
- [ ] Nhóm 3 (xa hơn): dynamic pricing, kết nối OTA, đa ngôn ngữ/tiền tệ, loyalty points, AI chatbot.

---

## 4. Ghi chú vận hành nhanh
- Chạy local: `node server.js` → http://localhost:3000
- Smoke test (170 case, DB tạm, không đụng `data/`): `npm test`
- Sinh lại icon PWA: `node scripts/gen-icons.js`
- Deploy: push `master` → Railway tự deploy.
- Tài khoản test: `ceo/ceo123`, `tpdh/tpdh123`, `cs/cs123`, `wc/wc123`, `ketoan/kt123`.

### Gotcha khi verify UI (từ kinh nghiệm trước)
- Cache-buster `?v=N` khi sửa index.html để né cache trình duyệt.
- Token lưu ở `localStorage` key `bh_token`.
- Kill node cũ trước khi restart server.
- Fetch trong trang để giữ UTF-8 đúng.
