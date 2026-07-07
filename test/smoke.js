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
    check('PO-02 deadline = tourDate − 10', po02?.deadline === '2030-01-10', po02?.deadline);

    r = await req('PATCH', `/api/bookings/${bid}`, { token: ceo, body: { tourDate: '2030-02-20' } });
    const po02b = r.data?.booking?.checklist?.find(i => i.code === 'PO-02');
    check('đổi tourDate → deadline tính lại', po02b?.deadline === '2030-02-10', po02b?.deadline);

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

    console.log('\n— Tiền cọc / thu từng đợt —');
    {
      r = await req('POST', '/api/bookings', { token: ceo, body: {
        product: 'Tour Coc 2N1Đ', tourDate: '2030-07-01', adults: 2,
        customer: { name: 'Khach Coc', phone: '0900000021' },
        payment: { amount: 8000000 },
      }});
      const cocId = r.data.booking.bookingId;
      r = await req('POST', `/api/bookings/${cocId}/payments`, { token: nvdh, body: { amount: 1000000 } });
      check('NVDH ghi nhận thu tiền → 403', r.status === 403);
      r = await req('POST', `/api/bookings/${cocId}/payments`, { token: ketoan,
        body: { amount: 3000000, method: 'CASH', note: 'Cọc 3tr' } });
      check('KETOAN thu cọc 3tr → 201, chưa đủ', r.status === 201 && r.data?.payment?.paid === false, JSON.stringify(r.data));
      check('collected 3tr, còn thiếu 5tr', r.data?.collected === 3000000 && r.data?.remaining === 5000000);
      r = await req('POST', '/api/lookup', { body: { bookingId: cocId, phone: '0900000021' } });
      check('khách tra cứu thấy đã thanh toán 3tr / còn lại 5tr',
        r.data?.booking?.payment?.collected === 3000000 && r.data?.booking?.payment?.remaining === 5000000);
      r = await req('POST', `/api/bookings/${cocId}/payments`, { token: ketoan, body: { amount: 5000000 } });
      check('thu nốt 5tr → paid tự thành true', r.data?.payment?.paid === true);
      const rcpt2 = r.data?.receipt?.rcptId;
      r = await req('GET', `/api/bookings/${cocId}`, { token: ceo });
      check('booking lưu 2 lần thu', (r.data?.booking?.payment?.receipts || []).length === 2);
      r = await req('DELETE', `/api/bookings/${cocId}/payments/${rcpt2}`, { token: ketoan });
      check('xoá lần thu → paid tính lại thành false', r.status === 200 && r.data?.payment?.paid === false
        && r.data?.collected === 3000000, JSON.stringify(r.data));
      r = await req('PATCH', `/api/bookings/${cocId}/payment`, { token: ketoan, body: { paid: true } });
      check('có receipts thì không toggle paid tay được (paid vẫn suy ra = false)', r.data?.payment?.paid === false);
      r = await req('GET', '/api/bookings/stats', { token: ceo });
      check('stats có dueSoonUnpaid', typeof r.data?.dueSoonUnpaid === 'number');
    }

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

    console.log('\n— Calendar + chống trùng lịch NVDH —');
    {
      // 2 tour 3 ngày chồng nhau: 2030-06-10 (3N) và 2030-06-12 (3N)
      let r1 = await req('POST', '/api/bookings', { token: ceo, body: {
        product: 'Tour Cal A 3N2Đ', tourDate: '2030-06-10', adults: 2,
        customer: { name: 'Cal A', phone: '0900000011' } } });
      const calA = r1.data.booking.bookingId;
      let r2 = await req('POST', '/api/bookings', { token: ceo, body: {
        product: 'Tour Cal B 3N2Đ', tourDate: '2030-06-12', adults: 2,
        customer: { name: 'Cal B', phone: '0900000012' } } });
      const calB = r2.data.booking.bookingId;

      r = await req('GET', '/api/bookings/calendar?month=2030-06', { token: nvdh });
      check('calendar tháng 6/2030 có 2 tour, đoán đúng 3 ngày từ tên',
        r.data?.items?.filter(i => i.bookingId === calA || i.bookingId === calB).length === 2
        && r.data.items.find(i => i.bookingId === calA)?.days === 3);

      r = await req('PATCH', `/api/bookings/${calA}/assign`, { token: ceo, body: { assignedTo: 'nvdh' } });
      check('phân công tour A cho nvdh → OK', r.status === 200);
      r = await req('PATCH', `/api/bookings/${calB}/assign`, { token: ceo, body: { assignedTo: 'nvdh' } });
      check('tour B chồng ngày (12 vs 10+3N) → 409 kèm conflicts', r.status === 409 && r.data?.conflicts?.length === 1,
        JSON.stringify(r.data));
      r = await req('PATCH', `/api/bookings/${calB}/assign`, { token: ceo, body: { assignedTo: 'nvdh', force: true } });
      check('force=true vẫn phân công được', r.status === 200);
      // Tour không chồng (2030-06-20) phải OK không cần force
      let r3 = await req('POST', '/api/bookings', { token: ceo, body: {
        product: 'Tour Cal C 2N1Đ', tourDate: '2030-06-20', adults: 1,
        customer: { name: 'Cal C', phone: '0900000013' } } });
      r = await req('PATCH', `/api/bookings/${r3.data.booking.bookingId}/assign`, { token: ceo, body: { assignedTo: 'nvdh' } });
      check('tour không chồng ngày → OK không cần force', r.status === 200);
    }

    console.log('\n— CRM khách hàng —');
    {
      // Tạo booking thứ 2 cùng SĐT với booking đầu (0900000001) → khách 2 tour
      await req('POST', '/api/bookings', { token: ceo, body: {
        product: 'Tour lần 2 của khách quen', tourDate: '2030-05-01', adults: 2,
        customer: { name: 'Khach Test', phone: '0900 000 001' }, // SĐT có khoảng trắng — phải gom chung
        payment: { amount: 5000000, paid: true },
      }});
      r = await req('GET', '/api/customers', { token: cs });
      const kh = r.data?.customers?.find(c => c.phoneKey === '0900000001');
      check('gom 2 booking cùng SĐT (kể cả khác định dạng)', kh?.bookings === 2, JSON.stringify(kh));
      check('hạng THANTHIET với 2 tour', kh?.tier === 'THANTHIET', kh?.tier);
      check('tổng thực thu đúng (10tr paid + 5tr paid)', kh?.totalPaid === 15000000, String(kh?.totalPaid));
      r = await req('GET', '/api/customers/0900000001', { token: cs });
      check('hồ sơ khách có lịch sử 2 booking', r.data?.history?.length === 2);
      r = await req('POST', '/api/customers/0900000001/note', { token: cs, body: { text: 'Khách thích ăn chay' } });
      check('CS thêm ghi chú khách', r.status === 201);
      r = await req('GET', '/api/customers/0900000001', { token: ceo });
      check('ghi chú đọc lại được', r.data?.notes?.[0]?.text === 'Khách thích ăn chay');
      r = await req('GET', '/api/customers?search=0900000001', { token: ceo });
      check('tìm theo SĐT', r.data?.customers?.length === 1);
    }

    console.log('\n— Công nợ NCC —');
    {
      // Khoản chi gắn NCC + hạn trả quá khứ → công nợ quá hạn
      r = await req('POST', `/api/bookings/${bid}/expenses`, { token: ceo, body: {
        category: 'KHACHSAN', desc: 'No khach san test', amount: 3000000,
        nccId: nccId, dueDate: '2020-01-01' } });
      check('ghi khoản chi gắn NCC + hạn trả', r.status === 201);
      const debtExpId = r.data.expense.expId;
      r = await req('GET', '/api/reports/payables', { token: ketoan });
      const nccGroup = r.data?.suppliers?.find(s => s.nccId === nccId);
      check('sổ công nợ gom theo NCC, đúng số tiền', nccGroup?.unpaid === 3000000, JSON.stringify(nccGroup));
      check('cảnh báo quá hạn (hạn 2020)', r.data?.summary?.overdueCount === 1 && nccGroup?.overdue === 3000000);
      r = await req('PATCH', `/api/bookings/${bid}/expenses/${debtExpId}/paid`, { token: nvdh, body: { paid: true } });
      check('NVDH đánh dấu đã trả → 403', r.status === 403);
      r = await req('PATCH', `/api/bookings/${bid}/expenses/${debtExpId}/paid`, { token: ketoan, body: { paid: true } });
      check('KETOAN đánh dấu đã trả → OK', r.status === 200);
      r = await req('GET', '/api/reports/payables', { token: ketoan });
      check('trả xong biến khỏi sổ công nợ', !r.data?.suppliers?.find(s => s.nccId === nccId));
    }

    console.log('\n— Hồ sơ hành khách + Go/No-Go —');
    {
      r = await req('POST', '/api/bookings', { token: ceo, body: {
        product: 'Tour Readiness 2N1Đ', tourDate: '2030-09-01', adults: 2,
        customer: { name: 'Truong Doan', phone: '0900000031' },
        payment: { amount: 5000000 },
      }});
      const rid = r.data.booking.bookingId;
      check('booking mới có mảng passengers rỗng', Array.isArray(r.data.booking.passengers) && r.data.booking.passengers.length === 0);

      r = await req('GET', `/api/bookings/${rid}/readiness`, { token: ceo });
      check('readiness ban đầu → NO_GO', r.data?.readiness?.verdict === 'NO_GO', JSON.stringify(r.data?.readiness?.verdict));
      check('có điều kiện bắt buộc chưa đạt', (r.data?.readiness?.blocking || []).some(x => x.key === 'pax_manifest'));

      r = await req('POST', `/api/bookings/${rid}/passengers`, { token: ceo, body: { phone: '09' } });
      check('thêm khách thiếu tên → 400', r.status === 400);
      r = await req('POST', `/api/bookings/${rid}/passengers`, { token: cs, body: { fullName: 'X' } });
      check('CS (không có bookings:update) thêm khách → 403', r.status === 403);
      r = await req('POST', `/api/bookings/${rid}/passengers`, { token: nvdh, body: {
        fullName: 'NGUYEN VAN A', idNumber: '0123', emergencyPhone: '0988', isLead: true } });
      check('NVDH thêm trưởng đoàn → 201', r.status === 201);
      const pax1 = r.data.passenger.paxId;
      r = await req('POST', `/api/bookings/${rid}/passengers`, { token: nvdh, body: {
        fullName: 'NGUYEN THI B', idNumber: '0456', emergencyPhone: '0977', isLead: true } });
      check('thêm khách 2 (cũng đánh lead) → 201', r.status === 201);
      const pax2 = r.data.passenger.paxId;

      r = await req('GET', `/api/bookings/${rid}`, { token: ceo });
      const plist = r.data.booking.passengers;
      check('booking lưu 2 hành khách', plist.length === 2);
      check('chỉ 1 trưởng đoàn (lead mới thắng)', plist.filter(p => p.isLead).length === 1 && plist.find(p => p.paxId === pax2).isLead === true);

      r = await req('PATCH', `/api/bookings/${rid}/passengers/${pax1}`, { token: nvdh, body: { dietary: 'ăn chay' } });
      check('sửa hành khách (thêm ăn kiêng) → OK', r.status === 200 && r.data.passenger.dietary === 'ăn chay');
      r = await req('PATCH', `/api/bookings/${rid}/passengers/${pax1}`, { token: nvdh, body: { passportExpiry: 'sai-ngay' } });
      check('ngày sai định dạng → 400', r.status === 400);

      // Chuẩn bị đủ để GO: confirm → tick PO-02/03/07, phân NVDH, thu đủ tiền
      await req('PATCH', `/api/bookings/${rid}/status`, { token: ceo, body: { status: 'CONFIRMED' } });
      await req('PATCH', `/api/bookings/${rid}/assign`, { token: ceo, body: { assignedTo: 'nvdh' } });
      await req('POST', `/api/bookings/${rid}/payments`, { token: ketoan, body: { amount: 5000000 } });

      // Chỉ cần các mục BẮT BUỘC đạt là GO (mục cảnh báo chưa xong vẫn GO)
      for (const code of ['PO-02','PO-03','PO-07'])
        await req('PATCH', `/api/bookings/${rid}/checklist/${code}`, { token: ceo, body: { done: true } });
      r = await req('GET', `/api/bookings/${rid}/readiness`, { token: ceo });
      check('đủ điều kiện bắt buộc → GO (dù cảnh báo còn)', r.data?.readiness?.verdict === 'GO', JSON.stringify(r.data?.readiness?.blocking));
      check('còn cảnh báo reconfirm chưa xong → score < 100', r.data?.readiness?.score < 100 && r.data?.readiness?.score >= 80, String(r.data?.readiness?.score));

      // Tick nốt mục cảnh báo → 100%
      for (const code of ['PO-16','PO-17'])
        await req('PATCH', `/api/bookings/${rid}/checklist/${code}`, { token: ceo, body: { done: true } });
      r = await req('GET', `/api/bookings/${rid}/readiness`, { token: ceo });
      check('xong cả cảnh báo → score = 100', r.data?.readiness?.score === 100, String(r.data?.readiness?.score));

      r = await req('DELETE', `/api/bookings/${rid}/passengers/${pax1}`, { token: nvdh });
      check('xoá 1 hành khách → OK', r.status === 200);
      r = await req('GET', `/api/bookings/${rid}/readiness`, { token: ceo });
      check('thiếu khách → pax_manifest lại chặn GO', r.data?.readiness?.verdict === 'NO_GO');
    }

    console.log('\n— Đặt dịch vụ NCC + xác nhận (Go/No-Go) —');
    {
      r = await req('POST', '/api/bookings', { token: ceo, body: {
        product: 'Tour NCC Confirm 2N1Đ', tourDate: '2030-10-01', adults: 1,
        customer: { name: 'Khach NCC', phone: '0900000041' },
        payment: { amount: 5000000 },
      }});
      const sid = r.data.booking.bookingId;
      check('booking mới có mảng services rỗng', Array.isArray(r.data.booking.services) && r.data.booking.services.length === 0);

      r = await req('POST', `/api/bookings/${sid}/services`, { token: nvdh, body: { category: 'XE' } });
      check('thêm dịch vụ thiếu mô tả → 400', r.status === 400);
      r = await req('POST', `/api/bookings/${sid}/services`, { token: cs, body: { category: 'XE', desc: 'Xe' } });
      check('CS (không có bookings:update) thêm dịch vụ → 403', r.status === 403);
      r = await req('POST', `/api/bookings/${sid}/services`, { token: nvdh, body: { category: 'KHACHSAN', desc: 'KS ABC 3 phòng', nccId } });
      check('NVDH thêm dịch vụ → 201, status REQUESTED', r.status === 201 && r.data.service.status === 'REQUESTED');
      const svcId = r.data.service.svcId;

      // Chuẩn bị mọi điều kiện GO khác
      await req('POST', `/api/bookings/${sid}/passengers`, { token: nvdh, body: { fullName: 'KHACH NCC' } });
      await req('PATCH', `/api/bookings/${sid}/status`, { token: ceo, body: { status: 'CONFIRMED' } });
      for (const code of ['PO-02','PO-03','PO-07'])
        await req('PATCH', `/api/bookings/${sid}/checklist/${code}`, { token: ceo, body: { done: true } });
      await req('PATCH', `/api/bookings/${sid}/assign`, { token: ceo, body: { assignedTo: 'nvdh' } });
      await req('POST', `/api/bookings/${sid}/payments`, { token: ketoan, body: { amount: 5000000 } });

      r = await req('GET', `/api/bookings/${sid}/readiness`, { token: ceo });
      check('dịch vụ chưa xác nhận → NO_GO (services_confirmed chặn)',
        r.data.readiness.verdict === 'NO_GO' && r.data.readiness.blocking.some(x => x.key === 'services_confirmed'),
        JSON.stringify(r.data.readiness.blocking));

      r = await req('PATCH', `/api/bookings/${sid}/services/${svcId}`, { token: nvdh, body: { status: 'CONFIRMED', voucherNo: 'KS-2030-01' } });
      check('xác nhận dịch vụ (kèm voucher) → CONFIRMED + confirmedAt',
        r.status === 200 && r.data.service.status === 'CONFIRMED' && !!r.data.service.confirmedAt);
      r = await req('GET', `/api/bookings/${sid}/readiness`, { token: ceo });
      check('xác nhận xong dịch vụ → GO', r.data.readiness.verdict === 'GO', JSON.stringify(r.data.readiness.blocking));

      r = await req('PATCH', `/api/bookings/${sid}/services/${svcId}`, { token: nvdh, body: { status: 'BADSTATUS' } });
      check('status dịch vụ không hợp lệ → 400', r.status === 400);
      r = await req('DELETE', `/api/bookings/${sid}/services/${svcId}`, { token: nvdh });
      check('xoá dịch vụ → OK', r.status === 200);

      // Dashboard: tour cận ngày (trong 7N) còn dịch vụ REQUESTED
      const soonDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
      r = await req('POST', '/api/bookings', { token: ceo, body: {
        product: 'Tour Cận Ngày', tourDate: soonDate, adults: 1,
        customer: { name: 'Can Ngay', phone: '0900000042' } } });
      const soonId = r.data.booking.bookingId;
      await req('POST', `/api/bookings/${soonId}/services`, { token: nvdh, body: { category: 'XE', desc: 'Xe đón' } });
      r = await req('GET', '/api/bookings/stats', { token: ceo });
      check('stats.unconfirmedSoon đếm tour cận ngày còn NCC chưa xác nhận', r.data.unconfirmedSoon >= 1, String(r.data.unconfirmedSoon));
    }

    console.log('\n— Backup —');
    {
      const zlib = require('zlib');
      const res = await fetch(BASE + '/api/backup/download', { headers: { Authorization: 'Bearer ' + ceo } });
      check('CEO tải backup → 200 gzip', res.status === 200 && res.headers.get('content-type') === 'application/gzip');
      const buf = Buffer.from(await res.arrayBuffer());
      let bundle = null;
      try { bundle = JSON.parse(zlib.gunzipSync(buf).toString('utf8')); } catch (e) { /* để check fail */ }
      check('backup giải nén được, có users.db + bookings.db',
        bundle?.app === 'booking-hub' && !!bundle.files['users.db'] && !!bundle.files['bookings.db']);
      check('bookings.db trong backup chứa booking test', String(bundle?.files['bookings.db']).includes('Tour Smoke Test'));
      const res2 = await fetch(BASE + '/api/backup/download', { headers: { Authorization: 'Bearer ' + nvdh } });
      check('NVDH tải backup → 403', res2.status === 403);
      r = await req('POST', '/api/backup/send', { token: ceo });
      check('gửi backup khi chưa cấu hình email → skip êm', r.status === 200 && r.data?.sent === false);
    }

    console.log('\n— Tra cứu công khai cho khách —');
    {
      r = await req('POST', '/api/lookup', { body: { bookingId: bid, phone: '0900 000 001' } });
      check('tra cứu đúng mã + SĐT (khác định dạng) → 200', r.status === 200, JSON.stringify(r.data));
      check('chỉ trả trường an toàn — không lộ checklist/expenses/costEstimate/passengers/services (PII)',
        r.data?.booking && !('checklist' in r.data.booking) && !('expenses' in r.data.booking)
        && !('costEstimate' in r.data.booking) && !('notes' in r.data.booking)
        && !('passengers' in r.data.booking) && !('services' in r.data.booking));
      check('có statusLabel tiếng Việt + timeline', !!r.data?.booking?.statusLabel && Array.isArray(r.data?.booking?.timeline));
      r = await req('POST', '/api/lookup', { body: { bookingId: bid, phone: '0999999999' } });
      check('SĐT sai → 404', r.status === 404);
      r = await req('GET', '/tracuu');
      check('trang /tracuu phục vụ được', r.status === 200);
    }

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
