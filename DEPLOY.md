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
**Auto-deploy:** repo GitHub `thanhphathung-web/booking-hub` đã nối vào service —
`git push` lên `master` là Railway tự build + deploy, không cần lệnh gì thêm.
**Dữ liệu:** volume `booking-hub-volume` mount `/app/data` — NeDB giữ nguyên qua các lần deploy.

Deploy thủ công (khi cần): `railway up --detach`

### Environment variables (Railway dashboard → Variables)
```
JWT_SECRET=<chuỗi ngẫu nhiên 32 ký tự>        # bắt buộc
NODE_ENV=production
APP_URL=https://booking-hub-production.up.railway.app   # link trong email digest

# Email digest 07:30 sáng (bỏ trống = tắt)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<email gửi>
SMTP_PASS=<Gmail App Password — cần bật 2FA, tạo tại myaccount.google.com/apppasswords>
SMTP_FROM="Booking Hub <email gửi>"

# Zalo OA — kênh nhắc việc thứ 2 (bỏ trống = tắt)
ZALO_APP_ID=
ZALO_APP_SECRET=
ZALO_REFRESH_TOKEN=
```

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

Thêm vào website của bạn:

```javascript
// Tạo booking từ website Cty2
async function createBookingFromWebsite(orderData) {
  const response = await fetch('https://your-booking-hub.railway.app/api/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SYSTEM_TOKEN}`  // Token của user CS
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
