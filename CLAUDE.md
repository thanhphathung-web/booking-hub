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
Database: NeDB (pure JS, file-based NoSQL, MongoDB-like API)
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
    amount: Number,        // VNĐ
    paid: Boolean
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
GET    /api/bookings/stats       → {total, new, confirmed, inProgress, completed, cancelled, wellness}
GET    /api/bookings/:id
POST   /api/bookings             body: booking object
PATCH  /api/bookings/:id/status  body: {status, note?}
PATCH  /api/bookings/:id/assign  body: {assignedTo?, wcAssigned?}
POST   /api/bookings/:id/note    body: {text}
GET    /api/bookings/:id/brief   → {brief: string} (text để gửi Zalo/email cho CTY1)
GET    /api/bookings/my-tasks    → {tasks, overdue, dueToday} — checklist item chưa xong của user hiện tại
PATCH  /api/bookings/:id/checklist/:code  body: {done, note?} — CEO/TPDH tick mọi item, role khác chỉ item của mình
POST   /api/bookings/:id/expenses         body: {category, desc, amount, hasReceipt?}
DELETE /api/bookings/:id/expenses/:expId  — người ghi hoặc CEO/TPDH/KETOAN
POST   /api/bookings/:id/daily-report     body: {date?, summary, groupStatus, incidents?, supplierRating?}
```

### Users (CEO only)
```
GET    /api/users
POST   /api/users                body: {username, password, role, name, company}
PATCH  /api/users/:username/password  body: {newPassword}
PATCH  /api/users/:username/toggle    → khoá/mở khoá
DELETE /api/users/:username
```

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
- [x] Checklist SOP điều hành tour per-booking (4 giai đoạn BC/PO/OP/PT, deadline tính từ tourDate, phân role)
- [x] Khối "Việc của tôi" trên dashboard + badge quá hạn trên sidebar
- [x] Sổ chi phí thực tế per booking + lãi/lỗ tạm tính
- [x] Daily Tour Report có cấu trúc (khi IN_PROGRESS)

## Tính năng chưa có (backlog)

- [ ] Báo cáo doanh thu theo tháng / xuất Excel
- [ ] Quản lý NCC (nhà cung cấp) — chia sẻ 3 công ty
- [ ] Notification / reminder tour sắp khởi hành
- [ ] Assign NVDH/WC trực tiếp từ UI
- [ ] Filter nâng cao (theo ngày, theo người phụ trách)
- [ ] API webhook cho website CTY2
- [ ] Migrate sang MongoDB khi scale

---

## Conventions

- **Vietnamese** cho UI labels, messages, comments trong business logic
- **English** cho tên biến, hàm, routes, field names
- **Async/await** — không dùng callback
- **Không throw** trong routes — luôn try/catch + `res.status(xxx).json({error})`
- File mới trong routes → register trong `server.js`
