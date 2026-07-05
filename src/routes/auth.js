const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { dbAsync } = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');

// ── Chống brute-force login ───────────────────────────────
// 5 lần sai trong 15 phút (theo IP + username) → khoá 15 phút. Thành công → reset.
const MAX_FAILS = 5;
const LOCK_MS   = 15 * 60 * 1000;
const loginFails = new Map(); // key "ip|username" → { count, lockedUntil, at }

setInterval(() => { // dọn entry cũ để map không phình
  const cutoff = Date.now() - LOCK_MS * 2;
  for (const [k, v] of loginFails) if (v.at < cutoff) loginFails.delete(k);
}, 10 * 60 * 1000).unref();

function checkLock(key) {
  const rec = loginFails.get(key);
  if (rec && rec.lockedUntil > Date.now())
    return Math.ceil((rec.lockedUntil - Date.now()) / 60000);
  return 0;
}

function recordFail(key) {
  const rec = loginFails.get(key) || { count: 0, lockedUntil: 0 };
  rec.count++; rec.at = Date.now();
  if (rec.count >= MAX_FAILS) { rec.lockedUntil = Date.now() + LOCK_MS; rec.count = 0; }
  loginFails.set(key, rec);
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: 'Username và password bắt buộc' });

    const key = `${req.ip}|${username.toLowerCase()}`;
    const lockedMins = checkLock(key);
    if (lockedMins)
      return res.status(429).json({ error: `Sai mật khẩu quá nhiều lần — thử lại sau ${lockedMins} phút` });

    const user = await dbAsync.findOne('users', { username: username.toLowerCase() });
    if (!user || !user.active) {
      recordFail(key);
      return res.status(401).json({ error: 'Tài khoản không tồn tại hoặc bị khóa' });
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      recordFail(key);
      return res.status(401).json({ error: 'Mật khẩu không đúng' });
    }
    loginFails.delete(key);

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
