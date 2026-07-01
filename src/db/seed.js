// Seed default users on first run
const bcrypt = require('bcryptjs');
const { dbAsync } = require('./database');

const DEFAULT_USERS = [
  { username: 'ceo',      password: 'ceo123',    role: 'CEO',      name: 'CEO',               company: 'ALL' },
  { username: 'tpdh',     password: 'tpdh123',   role: 'TPDH',     name: 'Trưởng Phòng ĐH',   company: 'CTY1' },
  { username: 'nvdh',     password: 'nvdh123',   role: 'NVDH',     name: 'NV Điều Hành',       company: 'CTY1' },
  { username: 'cs',       password: 'cs123',     role: 'CS',       name: 'CS Team',            company: 'CTY2' },
  { username: 'pm',       password: 'pm123',     role: 'PM',       name: 'PM Platform',        company: 'CTY2' },
  { username: 'wc',       password: 'wc123',     role: 'WC',       name: 'Wellness Coordinator', company: 'CTY3' },
  { username: 'ketoan',   password: 'kt123',     role: 'KETOAN',   name: 'Kế Toán',            company: 'ALL' },
];

async function seed() {
  try {
    const existing = await dbAsync.count('users', {});
    if (existing > 0) {
      console.log(`[seed] ${existing} users already exist, skipping`);
      return;
    }
    for (const u of DEFAULT_USERS) {
      const hash = await bcrypt.hash(u.password, 10);
      await dbAsync.insert('users', {
        ...u, password: hash,
        createdAt: new Date().toISOString(),
        active: true
      });
      console.log(`[seed] Created user: ${u.username} (${u.role})`);
    }
    console.log('[seed] Done');
  } catch (e) {
    console.error('[seed] Error:', e.message);
  }
}

module.exports = seed;
