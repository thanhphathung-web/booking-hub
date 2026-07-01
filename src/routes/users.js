const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { dbAsync } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// GET /api/users (CEO only)
router.get('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  const users = await dbAsync.find('users', {}, { createdAt: -1 });
  res.json({ users: users.map(u => ({ ...u, password: undefined })) });
});

// POST /api/users (CEO only)
router.post('/', requireAuth, async (req, res) => {
  if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
  const { username, password, role, name, company } = req.body;
  if (!username || !password || !role) return res.status(400).json({ error: 'Thiếu thông tin' });
  const exists = await dbAsync.findOne('users', { username: username.toLowerCase() });
  if (exists) return res.status(400).json({ error: 'Username đã tồn tại' });
  const hash = await bcrypt.hash(password, 10);
  const user = await dbAsync.insert('users', {
    username: username.toLowerCase(), password: hash,
    role, name: name || username, company: company || 'ALL',
    active: true, createdAt: new Date().toISOString()
  });
  res.status(201).json({ user: { ...user, password: undefined } });
});

// PATCH /api/users/:username/password
router.patch('/:username/password', requireAuth, async (req, res) => {
  // CEO can change anyone's, others can only change their own
  if (req.user.role !== 'CEO' && req.user.username !== req.params.username)
    return res.status(403).json({ error: 'Không có quyền' });
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
  const hash = await bcrypt.hash(newPassword, 10);
  await dbAsync.update('users', { username: req.params.username }, { $set: { password: hash } });
  res.json({ message: 'Đã đổi mật khẩu' });
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
