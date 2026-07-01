const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// Roles allowed per route
const ROLE_PERMISSIONS = {
  CEO:    ['*'],
  TPDH:   ['bookings:read','bookings:update','bookings:confirm','ncc:*'],
  NVDH:   ['bookings:read','bookings:update'],
  CS:     ['bookings:read','bookings:create'],
  PM:     ['bookings:read','products:*'],
  WC:     ['bookings:read','wellness:*'],
  KETOAN: ['bookings:read','finance:*'],
};

function hasPermission(role, perm) {
  const perms = ROLE_PERMISSIONS[role] || [];
  if (perms.includes('*')) return true;
  if (perms.includes(perm)) return true;
  const ns = perm.split(':')[0];
  if (perms.includes(ns + ':*')) return true;
  return false;
}

// Middleware: require valid JWT
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized — no token' });
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized — invalid token' });
  }
}

// Middleware: require specific permission
function requirePerm(perm) {
  return [requireAuth, (req, res, next) => {
    if (!hasPermission(req.user.role, perm)) {
      return res.status(403).json({ error: `Forbidden — need ${perm}` });
    }
    next();
  }];
}

module.exports = { requireAuth, requirePerm, JWT_SECRET };
