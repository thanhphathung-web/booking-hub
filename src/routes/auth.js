const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { dbAsync } = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username và password bắt buộc' });

    const user = await dbAsync.findOne('users', { username: username.toLowerCase() });
    if (!user || !user.active)
      return res.status(401).json({ error: 'Tài khoản không tồn tại hoặc bị khóa' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Mật khẩu không đúng' });

    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role, name: user.name, company: user.company },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, user: { username: user.username, role: user.role, name: user.name, company: user.company } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
