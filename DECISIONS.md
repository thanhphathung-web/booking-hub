# Booking Hub — Quyết định thiết kế (ADR)

Ghi lại **tại sao** hệ thống được xây như hiện tại. Đọc trước khi định "sửa lại cho đúng" —
nhiều thứ trông kỳ nhưng là chủ đích. Format: Quyết định → Lý do → Hệ quả/Ràng buộc.

---

## 1. Nền tảng

### ADR-01 · NeDB file-based thay vì MongoDB/Postgres
- **Quyết định:** dùng `@seald-io/nedb` (fork được bảo trì), data là file trong `data/`.
- **Lý do:** pure JS không cần compile native, chạy mọi nơi, API giống MongoDB — MVP một người vận hành.
- **Hệ quả:** `data/` phải nằm trên **Railway volume** (không có = mất data mỗi deploy). Backup đêm qua email là lưới thứ hai. Khi scale → migrate MongoDB, API tương tự nên route gần như giữ nguyên. NeDB không hỗ trợ `$push` array lồng nhau → pattern `findOne → sửa mảng → update $set`.

### ADR-02 · SPA một file HTML + Tailwind CDN, không build step
- **Quyết định:** toàn bộ admin trong `public/index.html`; không React/bundler. Trang công khai tách file riêng (`tracuu.html`, `danhgia.html`, `ncc.html`, `huongdan.html`).
- **Lý do:** deploy = push, sửa = mở 1 file, không toolchain để hỏng.
- **Hệ quả:** file lớn (~5000 dòng) — chấp nhận; tách trang public khỏi SPA để không phình thêm và không lộ code admin. Đổi shell phải **bump `CACHE_VERSION` trong `sw.js`** (ADR-13).

### ADR-03 · Smoke test = server thật + DB tạm, không mock
- **Quyết định:** `npm test` spawn `server.js` thật với `DATA_DIR` tạm, gọi HTTP thật (199 case).
- **Lý do:** bug thật nằm ở tích hợp route↔db↔middleware; mock che mất. Một file test, không framework.
- **Hệ quả:** thêm tính năng nào cũng thêm case vào `test/smoke.js`; test không bao giờ đụng `data/` thật.

## 2. Nghiệp vụ cốt lõi

### ADR-04 · Trạng thái dẫn xuất KHÔNG lưu — luôn tính lại
- **Quyết định:** `payment.paid` suy ra từ tổng receipts ≥ amount (không toggle tay khi có receipts); `seatsSold` của chuyến khởi hành tính từ bookings gắn `departureId` (status ≠ CANCELLED); hạng khách CRM tính từ bookings theo SĐT.
- **Lý do:** trạng thái lưu sẵn sẽ lệch (xoá receipt, huỷ đơn, sửa tiền) — nguồn sự thật duy nhất là dữ liệu gốc.
- **Hệ quả:** huỷ đơn tự trả chỗ, xoá lần thu tự tính lại paid — không cần code "đồng bộ". Booking cũ chưa có receipts giữ cờ `paid` tay (legacy).

### ADR-05 · Huỷ booking bắt buộc 2 người (maker-checker)
- **Quyết định:** PATCH status=CANCELLED bị chặn 409; phải `cancel-request` (kèm lý do) → CEO/TPDH **khác người yêu cầu** duyệt.
- **Lý do:** huỷ là hành động phá huỷ doanh thu + trả chỗ, chống huỷ đơn phương/nhầm.
- **Hệ quả:** không có đường tắt huỷ, kể cả CEO. UI có banner + card "Chờ duyệt huỷ".

### ADR-06 · Checklist SOP tự sinh theo vòng đời, chặn cửa bằng dữ liệu
- **Quyết định:** tạo booking → sinh BOOKING; CONFIRMED → +PREOPS; IN_PROGRESS → +OPS/POSTOPS. Deadline tính từ `tourDate` (đổi ngày → tính lại item chưa done). COMPLETED bị chặn nếu PT-08 (quyết toán) chưa tick. Chuyển IN_PROGRESS khi Go/No-Go = NO_GO phải confirm vượt.
- **Lý do:** quy trình nằm trong hệ thống chứ không trong trí nhớ nhân viên; "tour chạy mù" là lỗi đắt nhất của điều hành tour.
- **Hệ quả:** booking cũ thiếu checklist được bổ sung lazy khi GET. Logic Go/No-Go thuần trong `src/services/readiness.js` (dùng chung route + test).

### ADR-07 · Dịch vụ NCC = lớp GIỮ CHỖ, tách khỏi sổ tiền
- **Quyết định:** `services[]` (REQUESTED→CONFIRMED + voucher) tách hẳn `expenses[]` (tiền/công nợ).
- **Lý do:** "tưởng đã đặt rồi" và "quên trả tiền NCC" là 2 lỗi khác nhau, người xử lý khác nhau.
- **Hệ quả:** Go/No-Go chỉ nhìn services; sổ công nợ chỉ nhìn expenses gắn nccId.

### ADR-08 · Cổng NCC: link bí mật, KHÔNG tài khoản; từ chối KHÔNG đổi status
- **Quyết định:** mỗi NCC một `portalKey` (crypto 24 ký tự) → link `/ncc?key=...`; không username/password. NCC "báo không nhận" chỉ cắm cờ `svc.declined`, status **vẫn REQUESTED**.
- **Lý do:** NCC không thể quản lý thêm một tài khoản; link gửi 1 lần qua Zalo/email là đủ mức tin cậy B2B, regenerate = thu hồi ngay. Decline giữ REQUESTED để **tiếp tục chặn Go/No-Go** — dịch vụ chưa có thay thế thì tour chưa sẵn sàng.
- **Hệ quả:** `portalKey` bị strip khỏi mọi response thường (chỉ endpoint portal-key trả); key gửi qua POST body để không vào access log; portal chỉ thấy trường an toàn (không tên/SĐT khách, không tiền).

## 3. Giao tiếp & thông báo

### ADR-09 · Mọi notify là fire-and-forget, không bao giờ throw, skip êm
- **Quyết định:** notifier/digest/comms không chặn response, nuốt lỗi vào kết quả per-channel; kênh chưa cấu hình / user thiếu địa chỉ → skip êm.
- **Lý do:** nghiệp vụ (tạo đơn, phân công) không được fail vì SMTP hỏng; hệ thống phải chạy được từ zero-config và "sống dậy" dần khi cấu hình thêm.
- **Hệ quả:** đừng bao giờ `await` notify trong đường chính của route rồi trả lỗi theo nó; test không cần mock mail.

### ADR-10 · Email ưu tiên Resend (HTTPS), không phụ thuộc SMTP
- **Quyết định:** mailer hỗ trợ `RESEND_API_KEY` (ưu tiên) hoặc SMTP; server ép `dns ipv4first`.
- **Lý do:** Railway Trial chặn outbound SMTP (587/465 timeout); Railway không route IPv6 egress.
- **Hệ quả:** backup đêm/digest/comms đều đi qua mailer chung — cấu hình 1 chỗ sống cả hệ.

### ADR-11 · Zalo OA: refresh token xoay vòng lưu file, ưu tiên hơn .env
- **Quyết định:** token mới nhất lưu `data/zalo_token.json` (Zalo xoay refresh token mỗi lần dùng).
- **Lý do:** token trong .env chết ngay sau lần refresh đầu — .env chỉ là seed lần đầu.
- **Hệ quả:** file token nằm trong volume + backup; xoá file = phải lấy token mới từ developers.zalo.me.

## 4. Bảo mật & công khai

### ADR-12 · Endpoint công khai: khớp 2 yếu tố + rate limit + chỉ trường an toàn
- **Quyết định:** `/api/lookup` (mã đơn + SĐT), `/api/reviews` (mã đơn + SĐT + COMPLETED + 1 lần/booking), `/api/ncc-portal` (portalKey) — đều POST, rate limit theo IP, response whitelist từng trường.
- **Lý do:** khách/NCC không có tài khoản; 2 yếu tố + giới hạn dò là đủ cho mức nhạy cảm này.
- **Hệ quả:** `trust proxy` = full chain (Railway nhiều lớp edge — trust 1 lớp làm rate limit vô dụng, bài học thật). Thêm trường vào response công khai phải soi từng field.

### ADR-13 · PWA: service worker KHÔNG cache /api/
- **Quyết định:** SW chỉ cache app shell + static; navigation network-first (offline mới rơi về shell); `/api/` luôn ra mạng.
- **Lý do:** hiện đơn/tiền cũ từ cache nguy hiểm hơn là chậm 1 giây.
- **Hệ quả:** đổi `index.html` → bump `CACHE_VERSION` trong `sw.js`, không có ngoại lệ.

### ADR-14 · Mật khẩu: tự đổi phải có mật khẩu cũ; CEO reset hộ không cần
- **Quyết định:** PATCH password — self (mọi role kể cả CEO) bắt buộc `oldPassword` đúng; CEO đổi cho người khác thì không (kịch bản quên mật khẩu).
- **Lý do:** chặn người lạ ngồi vào máy đang đăng nhập; đồng thời giữ đường cứu quên pass không cần email reset.
- **Hệ quả:** không có flow "quên mật khẩu" tự phục vụ — chủ đích, vì nhân viên ít và CEO reset được ngay.

### ADR-15 · Không CSP, nhưng có phần còn lại của security headers
- **Quyết định:** nosniff, X-Frame-Options SAMEORIGIN, Referrer-Policy, Permissions-Policy, HSTS (khi HTTPS); **không** Content-Security-Policy.
- **Lý do:** SPA inline script + Tailwind CDN — CSP đúng nghĩa đòi refactor toàn bộ, không đáng ở quy mô này.
- **Hệ quả:** nếu sau này tách bundle thì thêm CSP lúc đó.

## 5. Quy ước code (tóm tắt — chi tiết trong CLAUDE.md)

- Route **không throw** — try/catch + `res.status(xxx).json({error})`; lưới cuối: error handler + ring buffer + process handlers (không crash).
- Logic thuần tách vào `src/services/*` khi cần dùng chung route + test (readiness, payments, departures, reviews, createBooking).
- `itinerary`/`rooming` dùng **PUT thay toàn bộ** — editor gửi cả state, đơn giản và chắc với NeDB.
- Tiếng Việt cho UI/message/comment nghiệp vụ; tiếng Anh cho tên biến/hàm/field.
