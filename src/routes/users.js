const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { dbAsync } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/users/staff — NVDH + WC list for assign dropdowns (all auth users)
router.get('/staff', requireAuth, async (req, res) => {
  try {
    const users = await dbAsync.find('users', { active: true }, { name: 1 });
    const staff = users
      .filter(u => ['NVDH','WC','TPDH'].includes(u.role))
      .map(u => ({ username: u.username, name: u.name, role: u.role }));
    res.json({ staff });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/users (CEO only)
router.get('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  const users = await dbAsync.find('users', {}, { createdAt: -1 });
  res.json({ users: users.map(u => ({ ...u, password: undefined })) });
});

// POST /api/users (CEO only)
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  const { username, password, role, name, company, email } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Thiếu thông tin' });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Email không hợp lệ' });
  const exists = await dbAsync.findOne('users', { username: username.toLowerCase() });
  if (exists) return res.status(400).json({ error: 'Username đã tồn tại' });
  const hash = await bcrypt.hash(password, 10);
  const user = await dbAsync.insert('users', {
    username: username.toLowerCase(), password: hash,
    role, name: name || username, company: company || 'ALL',
    email: email || '',   // dùng cho email digest nhắc việc
    active: true, createdAt: new Date().toISOString()
  });
  res.status(201).json({ user: { ...user, password: undefined } });
});

// PATCH /api/users/:username/password
// CEO đổi cho người khác không cần mật khẩu cũ (quên pass); TỰ đổi của mình
// (kể cả CEO) phải nhập đúng mật khẩu hiện tại — chặn người lạ ngồi vào máy đang mở
router.patch('/:username/password', requireAuth, async (req, res) => {
  const isSelf = req.user.username === req.params.username;
  if (req.user.role !== 'CEO' && !isSelf)
    return res.status(403).json({ error: 'Không có quyền' });
  const { newPassword, oldPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
  if (isSelf) {
    const me = await dbAsync.findOne('users', { username: req.user.username });
    const ok = me && await bcrypt.compare(String(oldPassword || ''), me.password);
    if (!ok) return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await dbAsync.update('users', { username: req.params.username }, { $set: { password: hash } });
  res.json({ message: 'Đã đổi mật khẩu' });
});

// PATCH /api/users/:username/email — CEO đổi cho bất kỳ ai, user tự đổi của mình
router.patch('/:username/email', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO' && req.user.username !== req.params.username)
    return res.status(403).json({ error: 'Không có quyền' });
  const email = (req.body.email || '').trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Email không hợp lệ' });
  const user = await dbAsync.findOne('users', { username: req.params.username });
  if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
  await dbAsync.update('users', { username: req.params.username }, { $set: { email } });
  res.json({ message: email ? `Đã cập nhật email → ${email}` : 'Đã xoá email' });
});

// PATCH /api/users/:username/notify — kênh nhận nhắc việc (email + Zalo ID)
router.patch('/:username/notify', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO' && req.user.username !== req.params.username)
    return res.status(403).json({ error: 'Không có quyền' });
  const email  = (req.body.email  || '').trim();
  const zaloId = (req.body.zaloId || '').trim();
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Email không hợp lệ' });
  if (zaloId && !/^\d{5,25}$/.test(zaloId)) return res.status(400).json({ error: 'Zalo ID phải là dãy số (lấy từ danh sách follower OA)' });
  const user = await dbAsync.findOne('users', { username: req.params.username });
  if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
  await dbAsync.update('users', { username: req.params.username }, { $set: { email, zaloId } });
  res.json({ message: 'Đã cập nhật kênh nhắc việc' });
});

module.exports = router;

// PATCH /api/users/:username/toggle (CEO only)
router.patch('/:username/toggle', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  const user = await dbAsync.findOne('users', { username: req.params.username });
  if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
  if (req.params.username === req.user.username) return res.status(400).json({ error: 'Không thể khoá tài khoản chính mình' });
  await dbAsync.update('users', { username: req.params.username }, { $set: { active: !user.active } });
  res.json({ message: `Đã ${!user.active ? 'mở khoá' : 'khoá'} tài khoản`, active: !user.active });
});

// DELETE /api/users/:username (CEO only)
router.delete('/:username', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  if (req.params.username === req.user.username) return res.status(400).json({ error: 'Không thể xoá tài khoản chính mình' });
  await dbAsync.remove('users', { username: req.params.username }, {});
  res.json({ message: 'Đã xoá user' });
});
