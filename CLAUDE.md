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
  checklist: [{            // checklist SOP tour — sinh tự động theo status (src/db/tourChecklist.js)
    code,                  // BC-xx|PO-xx|OP-xx|PT-xx
    title, phase,          // BOOKING|PREOPS|OPS|POSTOPS
    role,                  // role chịu trách nhiệm
    deadline,              // YYYY-MM-DD hoặc null (trong tour)
    done, doneBy, doneName, doneAt, note
  }],
  expenses: [{ expId, category, desc, amount, hasReceipt, by, name, at }],  // sổ chi thực tế
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
                                    dueSoonUnpaid (tour KH trong 3 ngày chưa thu đủ — card đỏ trên dashboard)}
GET    /api/bookings/:id
POST   /api/bookings             body: booking object
PATCH  /api/bookings/:id         sửa product/tourDate/pax/customer/specialReqs/wellness (bookings:update;
                                 chặn khi COMPLETED/CANCELLED; đổi tourDate tự tính lại deadline checklist chưa done)
PATCH  /api/bookings/:id/payment body: {amount?, paid?} — finance:payment (CEO/KETOAN); có receipts thì paid bị suy ra lại
POST   /api/bookings/:id/payments          body: {amount, method?, date?, note?} — ghi 1 lần thu (finance:payment);
                                           thu đủ tự set paid=true; chặn khi CANCELLED
DELETE /api/bookings/:id/payments/:rcptId  — xoá lần thu ghi nhầm (finance:payment), paid tính lại
                                           Helper dùng chung: src/services/payments.js (collectedOf/receiptsTotal/recomputePaid)
PATCH  /api/bookings/:id/status  body: {status, note?}
PATCH  /api/bookings/:id/assign  body: {assignedTo?, wcAssigned?, force?} — NVDH trùng lịch (theo số ngày tour)
                                 → 409 {conflicts}; force=true để vẫn phân công (UI hiện confirm)
POST   /api/bookings/:id/note    body: {text}
GET    /api/bookings/:id/brief   → {brief: string} (text để gửi Zalo/email cho CTY1)
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

## Tính năng chưa có (backlog)

- [ ] Migrate sang MongoDB khi scale

---

## Conventions

- **Vietnamese** cho UI labels, messages, comments trong business logic
- **English** cho tên biến, hàm, routes, field names
- **Async/await** — không dùng callback
- **Không throw** trong routes — luôn try/catch + `res.status(xxx).json({error})`
- File mới trong routes → register trong `server.js`
