# Booking Hub — Hướng dẫn Deploy

## 🚀 Chạy local (test)

```bash
cd booking-hub
npm install
node server.js
```
Mở trình duyệt: **http://localhost:3000**

---

## ☁️ Deploy lên Railway.app (Khuyến nghị — Free tier)

### Bước 1: Tạo tài khoản
- Vào https://railway.app → Sign up bằng GitHub

### Bước 2: Upload code
```bash
# Cài Railway CLI
npm install -g @railway/cli

# Login
railway login

# Tạo project mới
railway init

# Deploy
railway up
```

### Bước 3: Set environment variables
Trong Railway dashboard → Variables:
```
PORT=3000
JWT_SECRET=<thay_bang_chuoi_ngau_nhien_dai_32_ky_tu>
NODE_ENV=production
```

### Bước 4: Lấy URL
Railway tự cấp URL dạng: `https://booking-hub-xxxx.up.railway.app`

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

## 👤 Tài khoản mặc định

| Username | Password | Role | Công ty |
|----------|----------|------|---------|
| ceo      | ceo123   | CEO  | ALL     |
| tpdh     | tpdh123  | TPDH | CTY1    |
| nvdh     | nvdh123  | NVDH | CTY1    |
| cs       | cs123    | CS   | CTY2    |
| pm       | pm123    | PM   | CTY2    |
| wc       | wc123    | WC   | CTY3    |
| ketoan   | kt123    | KETOAN | ALL  |

⚠️ **Đổi mật khẩu ngay sau khi deploy!** (CEO → Settings trong app)

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
