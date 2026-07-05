// Smoke test — chạy server thật trên DB tạm, kiểm tra các luồng chính end-to-end
// Chạy: npm test (không đụng data/ thật)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const WEBHOOK_KEY = 'test-webhook-key';

let passed = 0, failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  ✅', name); }
  else      { failed++; console.log('  ❌', name, extra); }
}

async function req(method, pathname, { token, key, body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(key ? { 'X-API-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* non-JSON */ }
  return { status: res.status, data };
}

async function login(username, password) {
  const r = await req('POST', '/api/auth/login', { body: { username, password } });
  return r.data?.token || null;
}

(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-smoke-'));
  console.log('DB tạm:', dataDir);
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT, DATA_DIR: dataDir, JWT_SECRET: 'smoke-secret',
      WEBHOOK_API_KEY: WEBHOOK_KEY, SMTP_HOST: '', ZALO_APP_ID: '' },
    stdio: 'ignore',
  });

  try {
    // Chờ server lên + seed users xong (bcrypt 7 user mất vài giây)
    let ceo = null;
    for (let i = 0; i < 60; i++) {
      try { ceo = await login('ceo', 'ceo123'); if (ceo) break; } catch (e) { /* chưa lên */ }
      await new Promise(r => setTimeout(r, 300));
    }
    if (!ceo) throw new Error('Server không khởi động được sau 18s');

    console.log('\n— Auth —');
    check('login ceo thành công', !!ceo);
    let r = await req('POST', '/api/auth/login', { body: { username: 'ceo', password: 'sai-pass' } });
    check('login sai pass → 401', r.status === 401);

    console.log('\n— Booking + checklist —');
    r = await req('POST', '/api/bookings', { token: ceo, body: {
      product: 'Tour Smoke Test', tourDate: '2030-01-20', adults: 2, children: 1,
      customer: { name: 'Khach Test', phone: '0900000001' },
      payment: { amount: 10000000, paid: false },
    }});
    check('tạo booking → 201', r.status === 201, JSON.stringify(r.data));
    const bid = r.data?.booking?.bookingId;
    check('checklist BOOKING sinh tự động', (r.data?.booking?.checklist || []).some(i => i.code === 'BC-01'));

    r = await req('PATCH', `/api/bookings/${bid}/status`, { token: ceo, body: { status: 'CONFIRMED' } });
    check('CONFIRMED sinh giai đoạn PREOPS', (r.data?.booking?.checklist || []).some(i => i.code === 'PO-02'));
    const po02 = r.data.booking.checklist.find(i => i.code === 'PO-02');
    check('PO-02 deadline = tourDate − 7', po02?.deadline === '2030-01-13', po02?.deadline);

    r = await req('PATCH', `/api/bookings/${bid}`, { token: ceo, body: { tourDate: '2030-02-20' } });
    const po02b = r.data?.booking?.checklist?.find(i => i.code === 'PO-02');
    check('đổi tourDate → deadline tính lại', po02b?.deadline === '2030-02-13', po02b?.deadline);

    r = await req('PATCH', `/api/bookings/${bid}/status`, { token: ceo, body: { status: 'IN_PROGRESS' } });
    check('IN_PROGRESS sinh OPS + POSTOPS', (r.data?.booking?.checklist || []).some(i => i.code === 'PT-08'));
    r = await req('PATCH', `/api/bookings/${bid}/status`, { token: ceo, body: { status: 'COMPLETED' } });
    check('COMPLETED bị chặn khi PT-08 chưa tick → 409', r.status === 409);
    r = await req('PATCH', `/api/bookings/${bid}/checklist/PT-08`, { token: ceo, body: { done: true } });
    check('CEO tick PT-08', r.status === 200);
    r = await req('PATCH', `/api/bookings/${bid}/status`, { token: ceo, body: { status: 'COMPLETED' } });
    check('COMPLETED sau khi tick PT-08 → OK', r.status === 200);

    console.log('\n— Phân quyền —');
    const cs = await login('cs', 'cs123');
    const nvdh = await login('nvdh', 'nvdh123');
    const ketoan = await login('ketoan', 'kt123');
    r = await req('PATCH', `/api/bookings/${bid}`, { token: cs, body: { product: 'x' } });
    check('CS sửa booking → 403', r.status === 403);
    r = await req('PATCH', `/api/bookings/${bid}/payment`, { token: nvdh, body: { paid: true } });
    check('NVDH cập nhật payment → 403', r.status === 403);
    r = await req('PATCH', `/api/bookings/${bid}/payment`, { token: ketoan, body: { paid: true } });
    check('KETOAN cập nhật payment → OK', r.status === 200);

    console.log('\n— Webhook CTY2 —');
    r = await req('POST', '/api/webhook/bookings', { key: 'sai-key', body: {} });
    check('webhook key sai → 401', r.status === 401);
    r = await req('POST', '/api/webhook/bookings', { key: WEBHOOK_KEY, body: {
      product: 'Tour Webhook', tourDate: '2030-03-01', adults: 2,
      customer: { name: 'Web Khach', phone: '0900000002' }, source: 'PLATFORM',
    }});
    check('webhook tạo booking → 201', r.status === 201, JSON.stringify(r.data));

    console.log('\n— Products + Cost Sheet + NCC —');
    r = await req('POST', '/api/suppliers', { token: ceo, body: { name: 'NCC Smoke', category: 'XE' } });
    const nccId = r.data?.supplier?.nccId;
    check('tạo NCC', r.status === 201);
    r = await req('POST', `/api/suppliers/${nccId}/rating`, { token: nvdh, body: { score: 4 } });
    check('NVDH chấm điểm NCC', r.status === 201);
    r = await req('POST', '/api/products', { token: ceo, body: {
      name: 'Tour Smoke SP', defaultPrice: 3000000,
      costSheet: [
        { category: 'XE', desc: 'Xe', costType: 'PER_GROUP', amount: 5000000 },
        { category: 'ANUONG', desc: 'An', costType: 'PER_PERSON', amount: 500000 },
      ],
    }});
    const prdId = r.data?.product?.productId;
    check('tạo product + cost sheet', r.status === 201);
    r = await req('POST', '/api/bookings', { token: ceo, body: {
      product: 'Tour Smoke SP', productId: prdId, tourDate: '2030-04-01', adults: 3, children: 1,
      customer: { name: 'K', phone: '09' },
    }});
    check('booking snapshot costEstimate = 5tr + 4×500k = 7tr', r.data?.booking?.costEstimate === 7000000,
      String(r.data?.booking?.costEstimate));

    console.log('\n— Expenses + Post Analysis —');
    r = await req('POST', `/api/bookings/${bid}/expenses`, { token: ceo, body: { category: 'XE', desc: 'Xe test', amount: 4000000 } });
    check('ghi khoản chi', r.status === 201);
    r = await req('GET', '/api/reports/post-analysis', { token: ceo });
    check('post-analysis có 1 tour COMPLETED', r.data?.summary?.tourCount === 1, String(r.data?.summary?.tourCount));
    check('lãi = 10tr − 4tr = 6tr', r.data?.tours?.[0]?.profit === 6000000, String(r.data?.tours?.[0]?.profit));
    r = await req('GET', '/api/reports/post-analysis', { token: nvdh });
    check('NVDH xem post-analysis → 403', r.status === 403);
    r = await req('GET', '/api/reports/revenue?year=2030', { token: ketoan });
    check('KETOAN xem doanh thu tháng', r.status === 200 && r.data?.months?.length === 12);
    check('doanh thu tháng 2/2030 = 10tr (booking COMPLETED)', r.data?.months?.[1]?.revenue === 10000000,
      String(r.data?.months?.[1]?.revenue));
    check('chi tháng 2/2030 = 4tr, lãi 6tr', r.data?.months?.[1]?.profit === 6000000, String(r.data?.months?.[1]?.profit));
    r = await req('GET', '/api/reports/revenue', { token: nvdh });
    check('NVDH xem doanh thu → 403', r.status === 403);

    console.log('\n— My-tasks + digest —');
    r = await req('GET', '/api/bookings/my-tasks', { token: nvdh });
    check('my-tasks trả về tasks', Array.isArray(r.data?.tasks));
    r = await req('GET', '/api/digest/preview', { token: ceo });
    check('digest preview', r.status === 200 && Array.isArray(r.data?.digests));

    console.log('\n— Audit log + rate limit —');
    r = await req('GET', '/api/reports/activity', { token: ceo });
    check('audit log có bản ghi', (r.data?.items || []).length > 0);
    r = await req('GET', '/api/reports/activity', { token: ketoan });
    check('KETOAN xem audit → 403', r.status === 403);
    // Rate limit: 5 lần sai với username riêng → lần 6 phải 429
    for (let i = 0; i < 5; i++) await req('POST', '/api/auth/login', { body: { username: 'brute-user', password: 'x' } });
    r = await req('POST', '/api/auth/login', { body: { username: 'brute-user', password: 'x' } });
    check('brute-force 6 lần → 429', r.status === 429, String(r.status));
    r = await req('POST', '/api/auth/login', { body: { username: 'tpdh', password: 'tpdh123' } });
    check('username khác không bị vạ lây', r.status === 200);

  } catch (e) {
    failed++;
    console.error('\n💥 Lỗi:', e.message);
  } finally {
    server.kill();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (e) { /* Windows file lock */ }
  }

  console.log(`\n════ KẾT QUẢ: ${passed} pass, ${failed} fail ════`);
  process.exit(failed ? 1 : 0);
})();
