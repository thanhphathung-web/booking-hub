# Booking Hub — Hướng dẫn Deploy

## 🚀 Chạy local (test)

```bash
cd booking-hub
npm install
node server.js
```
Mở trình duyệt: **http://localhost:3000**

---

## ☁️ Railway (đang chạy production)

**URL:** https://booking-hub-production.up.railway.app
**Auto-deploy:** ✅ hoạt động — `git push` lên `master` là Railway tự build + deploy (xác nhận 2026-07-05).
Yêu cầu đã setup đủ: (1) Railway GitHub App cài trên account `thanhphathung-web` với quyền repo `booking-hub`,
(2) service source nối repo. Lưu ý rút ra: nếu đổi cài đặt App, phải `railway service source disconnect`
rồi `connect` lại thì trigger mới được đăng ký. Deploy tay khi cần gấp: `railway up --detach`.
**Dữ liệu:** volume `booking-hub-volume` mount `/app/data` — NeDB giữ nguyên qua các lần deploy.
**Backup:** 02:00 sáng mỗi ngày hệ thống tự gửi email đính kèm toàn bộ data (nén .json.gz) tới `BACKUP_EMAIL`
(mặc định = SMTP_USER). Tải thủ công: đăng nhập CEO → Audit Log → 💾 Tải backup.
Khôi phục: tắt server → `node scripts/restore-backup.js <file.json.gz>` → bật lại (file cũ tự lưu *.bak-*).

Deploy thủ công (khi cần): `railway up --detach`

### ⚙️ Cấu hình Environment Variables trên Railway

**Cách đặt biến:** Railway dashboard → chọn **service `booking-hub`** → tab **Variables** →
**+ New Variable** (từng biến) hoặc **Raw Editor** (dán cả khối `KEY=value`). Lưu xong Railway **tự redeploy**.

> **KHÔNG cần đặt:** `PORT` (Railway tự cấp), `DATA_DIR` / `ENABLE_TEST_ERROR` (chỉ dùng cho test local).
> Biến để trống = tính năng tương ứng **tắt êm**, app vẫn chạy bình thường.

#### 1. Bắt buộc (app cần để chạy chuẩn)
```
JWT_SECRET=<chuỗi ngẫu nhiên ≥32 ký tự>     # bí mật ký token đăng nhập — BẮT BUỘC, giữ kín
NODE_ENV=production
APP_URL=https://booking-hub-production.up.railway.app   # link chèn vào email gửi khách/nhân viên
```
Tạo `JWT_SECRET` nhanh: chạy `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

#### 2. Email — MỞ KHOÁ nhiều tính năng cùng lúc
Cùng một cấu hình email bật: **digest nhắc việc 07:30** · **nhắc việc real-time** (phân công/sự cố) ·
**giao tiếp khách** (xác nhận/nhắc T-3/cảm ơn) · **backup tự động 02:00**.

**Cách A — Resend (KHUYÊN DÙNG trên Railway, gửi qua HTTPS, không bị chặn cổng SMTP):**
```
RESEND_API_KEY=re_xxxxxxxx      # tạo free tại resend.com → API Keys
RESEND_FROM=Booking Hub <onboarding@resend.dev>   # tuỳ chọn; chưa verify domain thì để mặc định
BACKUP_EMAIL=thanhphathung@gmail.com              # nơi nhận backup 02:00 (mặc định = SMTP_USER)
```
> Chưa verify domain: Resend chỉ gửi được tới **email chủ tài khoản Resend**. Verify domain để gửi cho khách thật.

**Cách B — SMTP (Gmail App Password; chỉ dùng được khi hạ tầng cho phép cổng 587):**
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<email gửi>
SMTP_PASS=<Gmail App Password — bật 2FA rồi tạo tại myaccount.google.com/apppasswords>
SMTP_FROM=Booking Hub <email gửi>
BACKUP_EMAIL=<email nhận backup>
```
> Đặt `RESEND_API_KEY` thì hệ thống **ưu tiên Resend**, bỏ qua SMTP. Chỉ cần 1 trong 2 cách.

#### 3. Zalo OA — nhắc việc nội bộ qua Zalo (tuỳ chọn)
```
ZALO_APP_ID=
ZALO_APP_SECRET=
ZALO_REFRESH_TOKEN=       # lấy 1 lần từ developers.zalo.me; app tự xoay vòng lưu data/zalo_token.json
```
Sau khi cấu hình: nhân viên **follow OA** → CEO vào **Quản lý User → 💬 Tra Zalo ID** → copy → dán vào
**🔔 Kênh nhắc** của từng nhân viên. Kiểm tra bằng nút **🔔 Kiểm tra kênh nhắc** (trang Quản lý User).

#### 4. Webhook website CTY2 (tuỳ chọn — để trống = endpoint tắt 503)
```
WEBHOOK_API_KEY=<chuỗi bí mật>     # website CTY2 gửi kèm header X-API-Key
```

#### 5. Giám sát lỗi (tuỳ chọn)
```
SENTRY_DSN=https://<key>@<host>/<project>   # đặt là tự đẩy lỗi lên Sentry (best-effort)
```
Uptime monitor ngoài (UptimeRobot…): trỏ vào `GET /api/health` (trả 200 khi OK, 503 khi DB lỗi).
Xem sức khoẻ + lỗi gần nhất trong app: đăng nhập CEO → **Audit Log → 🩺 Sức khoẻ hệ thống**.

### 📋 Bảng tra nhanh
| Biến | Bắt buộc | Mở khoá gì | Lấy ở đâu |
|---|---|---|---|
| `JWT_SECRET` | ✅ | Đăng nhập an toàn | tự sinh (lệnh crypto ở trên) |
| `NODE_ENV` | ✅ | chế độ production | đặt `production` |
| `APP_URL` | nên có | link đúng trong email | URL Railway của app |
| `RESEND_API_KEY` *hoặc* `SMTP_*` | tuỳ chọn* | digest + notify + giao tiếp khách + backup | resend.com / Gmail App Password |
| `BACKUP_EMAIL` | tuỳ chọn | nơi nhận backup 02:00 | email của bạn |
| `ZALO_APP_ID/SECRET/REFRESH_TOKEN` | tuỳ chọn | nhắc việc qua Zalo | developers.zalo.me |
| `WEBHOOK_API_KEY` | tuỳ chọn | nhận booking từ web CTY2 | tự đặt chuỗi bí mật |
| `SENTRY_DSN` | tuỳ chọn | đẩy lỗi lên Sentry | sentry.io project |

\* Không có email thì các tính năng gửi tin **skip êm** — nên cấu hình để dùng đủ tính năng đã build.

---

## ☁️ Deploy lên Render.com (Miễn phí)

### Bước 1: Push code lên GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<username>/booking-hub.git
git push -u origin main
```

### Bước 2: Tạo Web Service trên Render
- Vào https://render.com → New → Web Service
- Connect GitHub repo
- **Build Command**: `npm install`
- **Start Command**: `node server.js`

### Bước 3: Set environment variables
```
JWT_SECRET=<thay_bang_chuoi_ngau_nhien_dai_32_ky_tu>
NODE_ENV=production
```

---

## 🔗 Tích hợp API vào website Cty2 (Node.js)

Website CTY2 dùng endpoint webhook với API key — không cần tài khoản user, không lo token hết hạn.
API key nằm trong biến `WEBHOOK_API_KEY` (Railway Variables).

```javascript
// Tạo booking từ website Cty2
async function createBookingFromWebsite(orderData) {
  const response = await fetch('https://booking-hub-production.up.railway.app/api/webhook/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': process.env.BOOKING_HUB_API_KEY
    },
    body: JSON.stringify({
      product: orderData.tourName,
      tourDate: orderData.departureDate,
      adults: orderData.adults,
      children: orderData.children,
      customer: {
        name: orderData.customerName,
        phone: orderData.phone,
        email: orderData.email
      },
      type: orderData.hasWellness ? 'WELLNESS' : 'STANDARD',
      payment: {
        amount: orderData.totalPrice,
        paid: orderData.isPaid
      },
      source: 'PLATFORM'
    })
  });
  return response.json();
}
```

---

## 👤 Tài khoản

Mật khẩu mặc định (ceo123, tpdh123…) chỉ tồn tại khi seed lần đầu ở môi trường mới.
**Production đã đổi toàn bộ sang mật khẩu ngẫu nhiên ngày 2026-07-03** — xem file
`TAI-KHOAN-PRODUCTION.local.txt` trên máy local (không commit; lưu vào chỗ an toàn rồi xoá file).

7 tài khoản: ceo (CEO), tpdh (TPDH), nvdh (NVDH), cs (CS), pm (PM), wc (WC), ketoan (KETOAN).

⚠️ Với môi trường deploy mới, đổi mật khẩu mặc định ngay (CEO → Quản lý User → 🔑 Đổi pass).

---

## 📁 Cấu trúc thư mục

```
booking-hub/
├── server.js          # Entry point
├── .env               # Config (không commit lên git)
├── .env.example       # Template
├── package.json
├── public/
│   └── index.html     # Admin Panel (SPA)
├── src/
│   ├── db/
│   │   ├── database.js  # NeDB setup
│   │   └── seed.js      # Default users
│   ├── middleware/
│   │   └── auth.js      # JWT + RBAC
│   └── routes/
│       ├── auth.js      # Login/me
│       ├── bookings.js  # Booking CRUD
│       └── users.js     # User management
└── data/              # DB files (tự tạo khi chạy)
    ├── users.db
    ├── bookings.db
    └── activity.db
```
