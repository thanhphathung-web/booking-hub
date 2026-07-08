# Booking Hub — CLAUDE.md

## Mục đích file này
Đây là briefing cho Claude Code để hiểu ngay project mà không cần hỏi lại.
Đọc file này trước khi làm bất cứ thứ gì.

---

## Business Context

Hệ sinh thái 3 công ty:

| Công ty | Tên | Vai trò | Màu |
|---------|-----|---------|-----|
| CTY1 | OPS | Điều hành tour thực tế (NVDH, TPDH) | NAVY |
| CTY2 | PLT | E-commerce platform du lịch (website/app) | TEAL |
| CTY3 | HLT | Wellness — bán gói khám sức khoẻ + Travel+Wellness | PURPLE |

**Flow chính:** Khách đặt tour qua CTY2 website → tạo booking trên Booking Hub → CTY1 điều hành tour → CTY3 phối hợp nếu là Wellness tour.

**Owner:** Vi Tran — thanhphathung@gmail.com

---

## Tech Stack

```
Backend:  Node.js + Express 5
Database: NeDB qua @seald-io/nedb (fork được bảo trì — pure JS, file-based NoSQL, MongoDB-like API)
Auth:     JWT (jsonwebtoken) + bcryptjs
Frontend: Single HTML file (SPA) + Tailwind CSS CDN
```

**Lý do chọn NeDB:** Pure JavaScript, không cần compile native module, chạy được mọi nơi. Phù hợp MVP. Khi scale → migrate sang MongoDB (API tương tự).

**Không dùng:** React, Vue, TypeScript, Webpack, bất kỳ bundler nào. Keep it simple.

---

## Cấu trúc thư mục

```
booking-hub/
├── server.js                 # Entry point — app setup + listen
├── .env                      # PORT, JWT_SECRET, NODE_ENV
├── .env.example
├── DEPLOY.md                 # Hướng dẫn deploy Railway/Render
├── public/
│   └── index.html            # Toàn bộ admin panel (SPA ~800 lines)
└── src/
    ├── db/
    │   ├── database.js       # NeDB datastores + Promise wrappers (dbAsync)
    │   └── seed.js           # Tạo 7 default users lần đầu chạy
    ├── middleware/
    │   └── auth.js           # requireAuth + requirePerm + ROLE_PERMISSIONS
    └── routes/
        ├── auth.js           # POST /api/auth/login, GET /api/auth/me
        ├── bookings.js       # Full booking CRUD + status flow + brief
        └── users.js          # User management (CEO only)
```

---

## Database (NeDB)

3 datastores — file lưu trong `/data/`:

### users.db
```javascript
{
  username: String,     // lowercase, unique
  password: String,     // bcrypt hash
  role: String,         // CEO|TPDH|NVDH|CS|PM|WC|KETOAN
  name: String,         // display name
  company: String,      // ALL|CTY1|CTY2|CTY3
  email: String,        // nhận email digest nhắc việc (rỗng = không nhận)
  zaloId: String,       // Zalo user_id trong phạm vi OA — nhận nhắc việc qua Zalo
  active: Boolean,      // default true
  createdAt: ISOString
}
```

### bookings.db
```javascript
{
  bookingId: String,       // ORD-YYYYMMDD-XXXX (auto-generated)
  product: String,         // tên tour/sản phẩm
  tourDate: String,        // YYYY-MM-DD
  adults: Number,
  children: Number,
  customer: {
    name: String,
    phone: String,
    email: String
  },
  specialReqs: String,
  type: 'STANDARD'|'WELLNESS',
  wellness: {              // chỉ có khi type=WELLNESS
    package: String,       // tên gói khám
    ncc: String            // NCC y tế
  },
  status: 'NEW'|'CONFIRMED'|'IN_PROGRESS'|'COMPLETED'|'CANCELLED',
  statusHistory: [{ status, by, at, note }],
  assignedTo: String,      // username NVDH
  wcAssigned: String,      // username WC (Wellness Coordinator)
  payment: {
    amount: Number,        // VNĐ — tổng tiền đơn
    paid: Boolean,         // có receipts thì LUÔN suy ra từ tổng đã thu ≥ amount (không toggle tay);
                           // booking cũ chưa có receipts giữ cờ paid thủ công (legacy)
    receipts: [{           // các lần thu tiền khách (cọc / trả nốt)
      rcptId, amount, method,   // CASH|BANK|CARD|OTHER
      date,                     // YYYY-MM-DD
      note, by, name, at
    }]
  },
  source: String,          // WEBSITE|PLATFORM|ADMIN|DIRECT
  notes: [{ text, by, name, at }],
  passengers: [{           // hồ sơ từng hành khách — nuôi manifest + Go/No-Go (chống sai tên vé/visa, thiếu y tế)
    paxId, fullName, phone, gender,   // M|F|OTHER
    dob,                              // YYYY-MM-DD
    idType,                           // CCCD|CMND|PASSPORT|OTHER
    idNumber, nationality, passportExpiry,
    dietary, medical,                 // ăn kiêng/dị ứng · bệnh nền/thuốc
    emergencyName, emergencyPhone, emergencyRel,
    isLead,                           // trưởng đoàn (chỉ 1 người)
    by, name, at
  }],
  services: [{             // đặt dịch vụ NCC + trạng thái xác nhận giữ chỗ — chống "tưởng đã đặt rồi"
    svcId, category,                  // XE|KHACHSAN|ANUONG|VE|BAOHIEM|YTE|KHAC
    desc, nccId,
    status,                           // REQUESTED → CONFIRMED → (CANCELLED)
    voucherNo,                        // số voucher/PO/mã xác nhận từ NCC (khi CONFIRMED)
    confirmedBy, confirmedName, confirmedAt, note, by, name, at
  }],                                 // lớp GIỮ CHỖ (khác expenses — chỉ theo dõi tiền/công nợ)
  itinerary: {             // chương trình tour ngày-by-ngày (PUT thay toàn bộ)
    days: [{ day, title, activities: [{ time, desc }], meals: { B, L, D }, hotel, note }],
    updatedBy, updatedAt   // day tự đánh số 1..n; date hiển thị = tourDate + (day-1) tính ở client
  },
  rooming: {               // rooming list — phân phòng khách
    rooms: [{ roomType, roomNo, guests: [tên khách], note }], updatedBy, updatedAt
  },
  comms: {                 // giao tiếp khách tự động — dedupe qua timestamp đã gửi
    confirmSent, reminderSent, thankYouSent,   // ISO timestamp (null = chưa gửi)
    log: [{ type, channel, to, result, at, by }]
  },
  checklist: [{            // checklist SOP tour — sinh tự động theo status (src/db/tourChecklist.js)
    code,                  // BC-xx|PO-xx|OP-xx|PT-xx
    title, phase,          // BOOKING|PREOPS|OPS|POSTOPS
    role,                  // role chịu trách nhiệm
    deadline,              // YYYY-MM-DD hoặc null (trong tour)
    done, doneBy, doneName, doneAt, note
  }],
  expenses: [{ expId, category, desc, amount, hasReceipt, by, name, at }],  // sổ chi thực tế
  incidents: [{            // sổ sự cố (OP-09): biên bản có cấu trúc + trạng thái xử lý
    incId, severity,       // LOW|MEDIUM|HIGH|CRITICAL
    category,              // HEALTH|ACCIDENT|SUPPLIER|WEATHER|CUSTOMER|LOGISTICS|OTHER
    title, description, action, occurredAt,
    status,               // OPEN → RESOLVED
    resolvedAt, resolvedBy, by, name, at
  }],
  dailyReports: [{ date, summary, groupStatus, incidents, supplierRating, by, name, at }],
  createdAt: ISOString,
  updatedAt: ISOString,
  createdBy: String        // username
}
```

**Checklist tour tự sinh theo vòng đời:** tạo booking → giai đoạn BOOKING; CONFIRMED → +PREOPS; IN_PROGRESS → +OPS+POSTOPS. Booking cũ thiếu checklist được bổ sung lazy khi GET detail / my-tasks. Chuyển COMPLETED bị chặn nếu PT-08 chưa tick.

### activity.db
```javascript
{ type, bookingId, from, to, by, at }
```

---

## API Endpoints

### Auth
```
POST /api/auth/login       body: {username, password} → {token, user}
GET  /api/auth/me          header: Bearer token → {user}
```

### Bookings
```
GET    /api/bookings             query: ?status=&type=&search=
GET    /api/bookings/stats       → {total, new, confirmed, inProgress, completed, cancelled, wellness, unpaid, urgent,
                                    dueSoonUnpaid (tour KH trong 3 ngày chưa thu đủ — card đỏ trên dashboard),
                                    unconfirmedSoon (tour KH trong 7 ngày còn dịch vụ NCC chưa xác nhận — card 🤝),
                                    openIncidents (sự cố còn mở trên tour chưa đóng — card đỏ 🚨)}
GET    /api/bookings/:id
POST   /api/bookings             body: booking object
PATCH  /api/bookings/:id         sửa product/tourDate/pax/customer/specialReqs/wellness (bookings:update;
                                 chặn khi COMPLETED/CANCELLED; đổi tourDate tự tính lại deadline checklist chưa done)
PATCH  /api/bookings/:id/payment body: {amount?, paid?} — finance:payment (CEO/KETOAN); có receipts thì paid bị suy ra lại
POST   /api/bookings/:id/payments          body: {amount, method?, date?, note?} — ghi 1 lần thu (finance:payment);
                                           thu đủ tự set paid=true; chặn khi CANCELLED
DELETE /api/bookings/:id/payments/:rcptId  — xoá lần thu ghi nhầm (finance:payment), paid tính lại
                                           Helper dùng chung: src/services/payments.js (collectedOf/receiptsTotal/recomputePaid)
PATCH  /api/bookings/:id/status  body: {status, note?} — status=CANCELLED bị chặn (409): huỷ phải qua 2 người
POST   /api/bookings/:id/cancel-request  body: {reason} (bookings:update) — tạo yêu cầu huỷ, chưa đổi status
POST   /api/bookings/:id/cancel-approve  (bookings:confirm = CEO/TPDH; người duyệt ≠ người yêu cầu) → CANCELLED
POST   /api/bookings/:id/cancel-reject   (người yêu cầu hoặc CEO/TPDH) — bỏ yêu cầu
                                 booking.cancelRequest = {by,name,reason,at} khi đang chờ; UI: banner đỏ + nút duyệt/bỏ
                                 trên detail, card dashboard "Chờ duyệt huỷ" (stats.pendingCancels)
PATCH  /api/bookings/:id/assign  body: {assignedTo?, wcAssigned?, force?} — NVDH trùng lịch (theo số ngày tour)
                                 → 409 {conflicts}; force=true để vẫn phân công (UI hiện confirm)
POST   /api/bookings/:id/note    body: {text}
GET    /api/bookings/:id/brief   → {brief: string} (text để gửi Zalo/email cho CTY1)
POST   /api/bookings/:id/passengers          body: {fullName*, phone?, gender?, dob?, idType?, idNumber?,
                                             nationality?, passportExpiry?, dietary?, medical?, emergencyName?,
                                             emergencyPhone?, emergencyRel?, isLead?} — bookings:update; chặn COMPLETED/CANCELLED
PATCH  /api/bookings/:id/passengers/:paxId   sửa 1 hành khách (bookings:update)
DELETE /api/bookings/:id/passengers/:paxId   xoá 1 hành khách (bookings:update)
POST   /api/bookings/:id/services            body: {category, desc*, nccId?, note?} → status REQUESTED (bookings:update)
PATCH  /api/bookings/:id/services/:svcId     body: {status?, voucherNo?, desc?, category?, nccId?, note?}
                                             status=CONFIRMED tự ghi confirmedBy/At; chống lỗi "tưởng đã đặt"
DELETE /api/bookings/:id/services/:svcId     xoá 1 dịch vụ (bookings:update)
PUT    /api/bookings/:id/itinerary           body: {days:[{title,activities:[{time,desc}],meals:{B,L,D},hotel,note}]}
                                             thay toàn bộ chương trình (bookings:update; chặn CANCELLED); day tự đánh số
PUT    /api/bookings/:id/rooming             body: {rooms:[{roomType,roomNo,guests:[],note}]} — thay toàn bộ rooming list
                                             UI: card "Chương trình tour" + "Rooming list" trên detail (editor modal),
                                             nút 🖨 In chương trình (bản khách), và nhúng vào Tour File in ra.
POST   /api/bookings/:id/incidents           body: {severity, category, title*, description*, action?, occurredAt?} (requireAuth)
PATCH  /api/bookings/:id/incidents/:incId     body: {status?, action?, ...} — status=RESOLVED tự ghi resolvedBy/At
DELETE /api/bookings/:id/incidents/:incId     người ghi hoặc CEO/TPDH
                                             UI: card "Sổ sự cố" (hiện từ CONFIRMED) + modal ghi/sửa + nút 🆘 Thẻ SOS
                                             (in liên hệ khẩn 113/114/115 + NVDH + LH khẩn từng khách + cảnh báo y tế).
GET    /api/bookings/:id/readiness → {readiness} Go/No-Go: {verdict: GO|NO_GO, score, passedCount, total,
                                   checks[{key,label,severity:critical|warn,pass,detail}], blocking[], warnings[]}
                                   Pure logic: src/services/readiness.js (dùng chung route + smoke test).
                                   Critical: danh sách khách đủ tên · thu đủ tiền · NVDH (+WC nếu wellness) ·
                                   PO-02 xe · PO-03 KS · PO-07 bảo hiểm · dịch vụ NCC đã xác nhận (nếu có ghi
                                   services) · hộ chiếu >6th (nếu có khách dùng HC).
                                   UI: card 🚦 trên booking detail; chuyển IN_PROGRESS khi NO_GO → confirm cảnh báo.
GET    /api/bookings/my-tasks    → {tasks, overdue, dueToday} — checklist item chưa xong của user hiện tại
GET    /api/bookings/calendar    ?month=YYYY-MM → {items: [{bookingId, product, tourDate, endDate, days, status, assignedTo, pax}]}
                                 (days: từ product.durationDays, hoặc đoán "3N" trong tên, mặc định 1; trang "Lịch tour")
PATCH  /api/bookings/:id/checklist/:code  body: {done, note?} — CEO/TPDH tick mọi item, role khác chỉ item của mình
POST   /api/bookings/:id/expenses         body: {category, desc, amount, hasReceipt?, nccId?, dueDate?}
                                          (gắn nccId → khoản chi vào sổ công nợ NCC, dueDate = hạn trả)
PATCH  /api/bookings/:id/expenses/:expId/paid  body: {paid} — đánh dấu đã trả NCC (finance:payment)
DELETE /api/bookings/:id/expenses/:expId  — người ghi hoặc CEO/TPDH/KETOAN
POST   /api/bookings/:id/daily-report     body: {date?, summary, groupStatus, incidents?, supplierRating?}
```

### Users (CEO only)
```
GET    /api/users
POST   /api/users                body: {username, password, role, name, company}
PATCH  /api/users/:username/password  body: {newPassword}
PATCH  /api/users/:username/email     body: {email} — CEO hoặc chính chủ
PATCH  /api/users/:username/notify    body: {email, zaloId} — kênh nhắc việc, CEO hoặc chính chủ
PATCH  /api/users/:username/toggle    → khoá/mở khoá
DELETE /api/users/:username
```

### Tra cứu công khai (khách hàng)
```
POST /api/lookup   body: {bookingId, phone} — KHÔNG cần auth; rate limit 20 lượt/15min/IP
                   → chỉ trường an toàn: product, tourDate, pax, statusLabel VN, payment, timeline
                   (tuyệt đối không thêm checklist/expenses/notes/costEstimate vào response này)
```
UI: trang `/tracuu` (public/tracuu.html — file riêng, không dính SPA admin). CS gửi link + mã đơn cho khách.

### Webhook (website CTY2)
```
POST /api/webhook/bookings   header: X-API-Key = WEBHOOK_API_KEY (.env; không set = endpoint tắt 503)
                             body giống POST /api/bookings; source chỉ nhận WEBSITE|PLATFORM (mặc định WEBSITE)
                             → 201 {bookingId, status} (response gọn, không lộ dữ liệu nội bộ)
```
Logic tạo booking dùng chung `src/services/createBooking.js` (admin route + webhook), createdBy = 'cty2-webhook'.

### Customers (CRM)
```
GET  /api/customers              ?search= (bookings:read) — hồ sơ gom từ bookings theo SĐT (chuẩn hoá bỏ ký tự ngoài số)
GET  /api/customers/:phone       → {customer, history, notes}
POST /api/customers/:phone/note  body: {text} — ghi chú chăm sóc (customers.db chỉ lưu notes, thống kê tính từ bookings)
```
Hạng khách: VIP (≥3 tour hoặc thực thu ≥50tr) | THANTHIET (2 tour) | MOI (1). UI: trang "Khách hàng" + modal hồ sơ (lịch sử booking, ghi chú); tên khách trên booking detail bấm được để mở hồ sơ.

### Độ bền / giám sát (`src/services/errorLog.js`)
```
GET /api/health   (công khai) → {status, version, uptimeSec, node, db, rssMB, errors} — target cho uptime monitor
GET /api/errors   (CEO) → {total, unresolved, errors[]} — bộ đệm 100 lỗi gần nhất
```
Lưới an toàn: error-handler middleware cuối chuỗi + `process.on(unhandledRejection|uncaughtException)` → ghi vào ring buffer (không crash). Đặt `SENTRY_DSN` thì forward lỗi lên Sentry (best-effort, không thêm dependency). UI: nút "🩺 Sức khoẻ hệ thống" trên trang Audit Log. `ENABLE_TEST_ERROR=1` bật route `/api/health/boom` (chỉ dùng smoke test).

### Backup (CEO only)
```
GET  /api/backup/download   → tải data/ nén .json.gz (nút 💾 trên trang Audit Log)
POST /api/backup/send       → gửi backup qua email ngay
```
Cron 02:00 sáng (giờ VN) tự gửi backup qua email tới `BACKUP_EMAIL` (mặc định SMTP_USER). Khôi phục: `node scripts/restore-backup.js <file.json.gz>` khi server tắt. File >35MB → gửi email cảnh báo thay vì đính kèm.

### Digest (CEO only)
```
GET    /api/digest/preview   → xem nội dung digest sẽ gửi (không gửi thật)
POST   /api/digest/send      → gửi digest ngay để test, không đợi cron
```

**Digest nhắc việc:** cron 07:30 sáng (Asia/Ho_Chi_Minh) trong `server.js` → `src/services/digest.js` gom việc chưa xong per user (dùng chung logic my-tasks trong `src/services/tasks.js`), soạn 1 tin tổng hợp (quá hạn / hôm nay / 3 ngày tới), gửi qua **2 kênh độc lập**: email (`src/services/mailer.js`) và Zalo OA (`src/services/zalo.js`). Kênh nào chưa cấu hình / user chưa có địa chỉ → skip êm, kết quả trả per-user per-channel.

⚠️ **Email trên Railway:** gói Trial chặn outbound SMTP (cổng 587/465 timeout) — Gmail App Password chỉ dùng được khi nâng gói Hobby+. Mailer hỗ trợ 2 đường: `RESEND_API_KEY` (ưu tiên, HTTPS — không bị chặn) hoặc SMTP. Server đã ép `dns ipv4first` (Railway không route IPv6 egress).

### Zalo OA (`src/services/zalo.js` + `/api/zalo`)
```
GET /api/zalo/status      (CEO) → {configured}
GET /api/zalo/followers   (CEO) → danh sách follower OA {user_id, display_name} để gán zaloId cho nhân viên
```
- Cấu hình .env: `ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_REFRESH_TOKEN` (lấy 1 lần từ developers.zalo.me)
- Access token hết hạn ~25h → service tự refresh; refresh token Zalo **xoay vòng** mỗi lần dùng → token mới nhất lưu `data/zalo_token.json` (ưu tiên hơn .env)
- Gửi tin CS `/v3.0/oa/message/cs` — nhân viên phải **follow OA** của công ty trước
- Flow gán: nhân viên follow OA → CEO vào Quản lý User → "💬 Tra Zalo ID" → copy → dán vào "🔔 Kênh nhắc" của user
- **Chưa test với OA thật** (cần app_id/secret/token thật) — mọi lỗi API trả về trong kết quả digest per-user, không crash

### Giao tiếp khách tự động (`src/services/customerComms.js`)
```
GET  /api/bookings/:id/comms/preview?type=confirm|reminder|thankyou (bookings:read) → {subject,text,to,sentAt}
POST /api/bookings/:id/comms/send   body:{type} (bookings:read) → gửi email khách ngay, trả kết quả
```
3 touchpoint theo vòng đời: **confirm** (tự gửi khi lần đầu CONFIRMED) · **reminder** T-3 · **thankyou** sau tour.
Cron 08:00 (giờ VN) trong `server.js` → `runDaily()`: nhắc T-3 (tourDate = today+3) + cảm ơn (COMPLETED, tourDate trong 7 ngày gần đây — chống blast lịch sử). Kênh: **email khách** (customer.email) qua mailer; chưa có email / mail chưa cấu hình → skip êm, dedupe qua `booking.comms`. UI: card "💌 Giao tiếp khách" trên detail (preview + gửi email + copy + Zalo deep link). Zalo khách gửi tay (OA chỉ nhắn follower).

### Nhắc việc real-time (`src/services/notifier.js` + `/api/notify`)
```
GET  /api/notify/status   (CEO) → {email, zalo} — kênh nhắc real-time đã cấu hình chưa
POST /api/notify/test     (requireAuth) → gửi 1 tin thử tới kênh nhắc của chính user, trả kết quả per-channel
```
Khác digest 07:30 (gom việc theo ngày). Sự kiện đẩy NGAY qua mailer + zalo (fire-and-forget, không chặn response, không throw):
- **Phân công NVDH/WC** (PATCH /:id/assign, chỉ khi người phụ trách đổi) → báo người được phân công.
- **Sự cố HIGH/CRITICAL** (POST /:id/incidents) → báo CEO + TPDH.
Kênh nào chưa cấu hình / user chưa có email|zaloId → skip êm. UI: nút "🔔 Kiểm tra kênh nhắc" trang Quản lý User.

### Products (Tour Cost Sheet)
```
GET    /api/products             ?active=true&type=   (mọi role)
GET    /api/products/:id
POST   /api/products             (CEO/PM — products:manage)
PATCH  /api/products/:id         (CEO/PM) — sửa cả costSheet
PATCH  /api/products/:id/toggle  (CEO/PM) — ngừng bán / mở bán
DELETE /api/products/:id         (CEO only)
```
`products.db`: `{ productId (PRD-xxx), name, type, durationDays, defaultPrice (giá bán/khách), description, costSheet: [{category, desc, nccId?, costType: PER_PERSON|PER_GROUP, amount}], active }`.
Tạo booking với `productId` → server snapshot `costEstimate` = Σ PER_GROUP + Σ PER_PERSON × (adults+children) vào booking (cost sheet đổi sau không ảnh hưởng booking cũ). Detail hiển thị thực chi vs dự toán.

### Reports
```
GET /api/reports/post-analysis   ?from=&to= (lọc theo tourDate; CEO/KETOAN/TPDH)
→ { summary, tours, byProduct, suppliers }
GET /api/reports/activity        ?bookingId=&type=&by=&limit= (CEO only) — audit log, trang "Audit Log" trên UI
GET /api/reports/revenue         ?year= (finance:read — CEO/KETOAN) — doanh thu theo tháng khởi hành:
                                 {year, years, months[12]: {tours,pax,revenue,collected,pending,cost,profit}, totals}
GET /api/reports/payables        (finance:read) — sổ công nợ NCC: khoản chi gắn nccId chưa paidNcc,
                                 gom theo NCC + cảnh báo quá hạn/7 ngày; trang "Công nợ NCC" (nav KETOAN/CEO)
```
Chỉ tính tour COMPLETED. Per tour: doanh thu, dự toán (costEstimate), thực chi (Σ expenses), chênh dự toán, lãi/lỗ, margin. byProduct gom theo productId. suppliers xếp hạng theo avgRating (chỉ NCC đã được chấm), <3★ cảnh báo. UI: trang "Post Analysis" + xuất CSV.

### Suppliers (NCC)
```
GET    /api/suppliers            ?category=&active=true   (mọi role, kèm avgRating)
POST   /api/suppliers            (CEO/TPDH — ncc:manage)
PATCH  /api/suppliers/:id        (CEO/TPDH)
PATCH  /api/suppliers/:id/toggle (CEO/TPDH)
POST   /api/suppliers/:id/rating body: {score 1-5, note?, bookingId?}  (mọi role — PT-05)
DELETE /api/suppliers/:id        (CEO only)
```
`suppliers.db`: `{ nccId (NCC-xxx), name, category (XE|KHACHSAN|ANUONG|VE|BAOHIEM|YTE|KHAC), phone, email, contact, address, notes, ratings: [{score, note, bookingId, by, name, at}], active }`.

### Departures (Lịch khởi hành + số chỗ)
```
GET    /api/departures            ?productId= &active=true &upcoming=true (mọi role, kèm seatsSold/seatsLeft/full)
GET    /api/departures/:id        → {departure (kèm số chỗ), bookings[]} (tóm tắt booking gắn chuyến)
POST   /api/departures            (CEO/PM — products:manage) body: {productId*, date*, seatsTotal*, price?, note?}
PATCH  /api/departures/:id        (CEO/PM) sửa date/seatsTotal/price/note/status; giảm seatsTotal < đã bán → 409
PATCH  /api/departures/:id/toggle (CEO/PM) ngừng/mở bán
DELETE /api/departures/:id        (CEO only) — chặn nếu chuyến đã có booking (409)
```
`departures.db`: `{ departureId (DEP-xxx), productId, productName (snapshot), date (YYYY-MM-DD), seatsTotal, price (giá bán/khách; 0 = dùng defaultPrice sản phẩm), status (OPEN|CLOSED|CANCELLED), note, active, createdAt/updatedAt/createdBy }`.
**seatsSold KHÔNG lưu** — luôn tính từ bookings gắn `departureId` (status ≠ CANCELLED) → huỷ đơn tự trả chỗ, không lệch. Logic dùng chung: `src/services/departures.js` (soldForDeparture/availabilityOf/capacityError).
Tạo booking kèm `departureId` (admin + webhook) → kiểm tra còn chỗ (overbooking → 409), snapshot ngày/sản phẩm/giá từ chuyến, tự tính `payment.amount` = giá × pax nếu form không nhập. UI: trang "Lịch khởi hành" + ô chọn chuyến trong form Tạo booking.

### Reviews / NPS (đánh giá sau tour)
```
POST /api/reviews                 (CÔNG KHAI — khách gửi; rate limit 10/15min/IP) body: {bookingId, phone, stars 1-5*, nps 0-10?, comment?}
                                  khớp mã đơn + SĐT, tour phải COMPLETED, mỗi booking 1 review; ≤2★/NPS≤6 → followUp.needed
GET  /api/reviews/public          (CÔNG KHAI) review đã duyệt, che tên khách, không lộ SĐT/mã đơn → {reviews, stats}
GET  /api/reviews                 (bookings:read) ?published=true|false &productId= &negative=true → {reviews, stats}
GET  /api/reviews/stats           (bookings:read) → {overall, byProduct[], pendingPublish, needFollowUp}
PATCH  /api/reviews/:id           (CEO/TPDH) body: {published?, reply?, followUpDone?}
DELETE /api/reviews/:id           (CEO only)
```
`reviews.db`: `{ reviewId (REV-xxx), bookingId, productId, productName, customerName, phone, stars, nps, comment, published (mặc định false — CEO/TPDH duyệt mới hiện public), reply, followUp:{needed,done}, source, createdAt/updatedAt }`.
Logic thuần: `src/services/reviews.js` (npsCategory 9-10/7-8/0-6, isNegative, computeStats: avgStars + NPS = %promoter−%detractor). Đánh giá tệ → ghi note cảnh báo vào booking + báo CEO/TPDH real-time (`notifier.notifyNegativeReview`). Email cảm ơn chèn link `/danhgia?ma=<bookingId>`. Post-analysis gắn avgStars/NPS per sản phẩm. UI: trang "Đánh giá" (cards NPS/sao + duyệt/trả lời/chăm sóc) + trang khách công khai `/danhgia` (public/danhgia.html).

---

## Roles & Permissions

```javascript
const ROLE_PERMISSIONS = {
  CEO:    ['*'],                                          // tất cả
  TPDH:   ['bookings:read','bookings:update','bookings:confirm','ncc:*'],
  NVDH:   ['bookings:read','bookings:update'],
  CS:     ['bookings:read','bookings:create'],
  PM:     ['bookings:read','products:*'],
  WC:     ['bookings:read','wellness:*'],
  KETOAN: ['bookings:read','finance:*'],
};
```

---

## dbAsync API (dùng trong routes)

```javascript
const { dbAsync } = require('../db/database');

await dbAsync.find('bookings', { status: 'NEW' }, { createdAt: -1 });
await dbAsync.findOne('users', { username: 'ceo' });
await dbAsync.insert('bookings', { ...doc });
await dbAsync.update('bookings', { bookingId: id }, { $set: { status: 'CONFIRMED' } });
await dbAsync.update('bookings', { bookingId: id }, { $push: { notes: note } });
await dbAsync.remove('users', { username: 'nvdh2' }, {});
await dbAsync.count('bookings', { status: 'NEW' });
```

---

## Middleware usage

```javascript
const { requireAuth, requirePerm } = require('../middleware/auth');

// Chỉ cần login
router.get('/something', requireAuth, handler);

// Cần permission cụ thể
router.post('/something', ...requirePerm('bookings:create'), handler);

// req.user có: { userId, username, role, name, company }
```

---

## Frontend (public/index.html)

- Single file ~800 lines — không tách ra file riêng
- Tailwind CSS từ CDN (không có bundler)
- State: `TOKEN`, `USER`, `ALL_BOOKINGS` — lưu localStorage
- Hàm `api(path, opts)` — fetch wrapper tự thêm Bearer token
- Pages: `dashboard`, `bookings`, `detail`, `new-booking`, `users`
- `showPage(name)` — switch giữa các page

**Khi thêm page mới:**
1. Thêm `<div id="page-xxx" class="page hidden">` vào `<main>`
2. Thêm nav link trong sidebar
3. Thêm `if (page === 'xxx') loadXxx()` trong `showPage()`
4. Viết function `loadXxx()` trong `<script>`

---

## Chạy & test

```bash
# Chạy local
node server.js
# → http://localhost:3000

# Smoke test (71 case, server thật + DB tạm qua env DATA_DIR, không đụng data/)
npm test

# Test API nhanh
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"ceo","password":"ceo123"}'
```

**Tài khoản test:**
| username | password | role |
|---|---|---|
| ceo | ceo123 | CEO |
| tpdh | tpdh123 | TPDH |
| cs | cs123 | CS |
| wc | wc123 | WC |
| ketoan | kt123 | KETOAN |

---

## Vấn đề đã biết / Quirks

1. **NeDB warnings** khi chạy: `util.isDate is not a function` — không phải lỗi, chỉ là deprecation warning của thư viện cũ. Fix đã có trong `server.js` (polyfill util).

2. **Express 5** không hỗ trợ wildcard `'*'` — dùng `'/{*splat}'` cho SPA fallback.

3. **NeDB không hỗ trợ** `$push` trực tiếp trên array lồng nhau — dùng `findOne` → modify → `update` nếu cần.

4. **Mỗi bash call độc lập** trong sandbox Claude — server không giữ giữa các lần gọi.

---

## Tính năng đã có

- [x] Auth + JWT + 7 roles
- [x] Booking CRUD (STANDARD + WELLNESS)
- [x] Status flow: NEW → CONFIRMED → IN_PROGRESS → COMPLETED | CANCELLED
- [x] Booking Brief generator (text gửi cho CTY1)
- [x] Notes nội bộ per booking
- [x] Dashboard stats
- [x] Quản lý User (CEO): tạo, khoá, xoá, đổi pass
- [x] Checklist SOP điều hành tour per-booking (4 giai đoạn BC/PO/OP/PT, 52 items, deadline tính từ tourDate/createDate, phân role; T-14→T+14)
- [x] Khối "Việc của tôi" trên dashboard + badge quá hạn trên sidebar
- [x] Sổ chi phí thực tế per booking + lãi/lỗ tạm tính
- [x] Daily Tour Report có cấu trúc (khi IN_PROGRESS)
- [x] Email digest nhắc việc 07:30 sáng (node-cron + nodemailer, tắt được qua .env)
- [x] Sản phẩm Tour + Cost Sheet dự toán (CEO/PM quản lý), booking snapshot dự toán chi
- [x] Quản lý NCC chia sẻ 3 công ty (CEO/TPDH quản lý) + chấm điểm chất lượng 1-5★
- [x] Báo cáo Post Analysis: lãi/lỗ per tour, hiệu quả per sản phẩm, xếp hạng NCC, xuất CSV
- [x] Kênh Zalo OA cho digest nhắc việc (auto-refresh token, tra follower để gán zaloId)
- [x] Webhook API cho website CTY2 (X-API-Key)
- [x] Sửa booking + cập nhật thanh toán (đổi tourDate tự tính lại deadline checklist)
- [x] Chống brute-force login (5 sai/15min theo IP+username → khoá 15min; trust proxy cho Railway)
- [x] Audit Log viewer (CEO) — giai đoạn 7 Internal Audit
- [x] Smoke test 71 case (`npm test`)
- [x] Báo cáo doanh thu theo tháng (server-side, chọn năm, xuất CSV/Excel)
- [x] Backup tự động 02:00 qua email + tải thủ công + script khôi phục
- [x] CRM khách hàng: gom theo SĐT, phân hạng VIP/Thân thiết/Mới, lịch sử + ghi chú chăm sóc
- [x] Lịch tour calendar tháng + chống trùng lịch NVDH (409 + force override)
- [x] Sổ công nợ NCC: khoản chi gắn NCC + hạn trả, gom theo NCC, cảnh báo quá hạn, KETOAN đánh dấu đã trả
- [x] Trang tra cứu công khai /tracuu cho khách (mã đơn + SĐT, rate limit, chỉ trường an toàn)
- [x] Tiền cọc / thu từng đợt: receipts per booking, paid tự suy ra, cảnh báo "sắp KH chưa thu đủ",
      báo cáo đã thu/chờ thu + CRM + brief + /tracuu đều tính theo tổng thực thu
- [x] Hồ sơ hành khách chi tiết (tên đúng giấy tờ, giấy tờ, y tế/dị ứng, liên hệ khẩn) → manifest in ra dùng thật
- [x] Cổng Go/No-Go: bảng chấm sẵn sàng khởi hành (bắt buộc + cảnh báo), chặn "tour chạy mù" khi chuyển IN_PROGRESS
- [x] Đặt dịch vụ NCC + trạng thái xác nhận giữ chỗ (REQUESTED→CONFIRMED + voucher), nuôi Go/No-Go + card dashboard "NCC chưa xác nhận"
- [x] Chương trình tour ngày-by-ngày (mốc giờ + suất ăn + nơi nghỉ) + rooming list; in bản khách + nhúng Tour File; nuôi Go/No-Go (cảnh báo)
- [x] Sổ sự cố có cấu trúc (mức độ/phân loại/biện pháp/OPEN→RESOLVED) + card dashboard "Sự cố đang mở" + Thẻ SOS in cho NVDH
- [x] Nhắc việc real-time: phân công NVDH/WC + sự cố nặng đẩy ngay qua email/Zalo (fire-and-forget, skip êm nếu chưa cấu hình)
- [x] Giao tiếp khách tự động: xác nhận (khi CONFIRMED) → nhắc T-3 → cảm ơn/đánh giá sau tour (cron 08:00 + gửi tay, dedupe)
- [x] Độ bền: health check nâng cao (uptime/db/RAM/lỗi), ring buffer lỗi + viewer CEO, error handler + process handlers, hook Sentry
- [x] Huỷ booking 2 người (maker-checker): yêu cầu huỷ + lý do → CEO/TPDH khác duyệt; chặn huỷ trực tiếp, chống huỷ đơn phương
- [x] Lịch khởi hành + quản lý số chỗ (departures/inventory): bán theo chuyến có ngày + seatsTotal, seatsSold tính tự động từ booking (huỷ tự trả chỗ), chống overbooking; đặt booking theo chuyến tự snapshot ngày/giá
- [x] Đánh giá / NPS sau tour: khách gửi qua trang công khai /danhgia (khớp mã đơn + SĐT), duyệt hiển thị + trả lời; đánh giá tệ tự báo CEO/TPDH + ghi note; gắn avgStars/NPS vào Post Analysis
- [x] PWA: cài app trên điện thoại (`manifest.webmanifest` + `public/sw.js` + icon sinh sẵn `public/icons/`), mở tức thì, offline trả app shell. SW **không cache /api/** (data booking/tiền luôn tươi), network-first cho navigation, stale-while-revalidate cho static. Nút "📲 Cài app" hiện khi trình duyệt cho phép (beforeinstallprompt). Sinh lại icon: `node scripts/gen-icons.js`. Đổi shell → bump `CACHE_VERSION` trong sw.js

## Tính năng chưa có (backlog)

- [ ] Cổng thanh toán online thật (VNPay/MoMo/Stripe) — hiện receipts vẫn ghi tay
- [ ] Migrate sang MongoDB khi scale

---

## Conventions

- **Vietnamese** cho UI labels, messages, comments trong business logic
- **English** cho tên biến, hàm, routes, field names
- **Async/await** — không dùng callback
- **Không throw** trong routes — luôn try/catch + `res.status(xxx).json({error})`
- File mới trong routes → register trong `server.js`
