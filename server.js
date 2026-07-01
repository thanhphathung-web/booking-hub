const util = require('util');
if (!util.isDate)   util.isDate   = (d) => d instanceof Date;
if (!util.isArray)  util.isArray  = Array.isArray;
if (!util.isRegExp) util.isRegExp = (r) => r instanceof RegExp;

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const seed           = require('./src/db/seed');
const seedChecklists = require('./src/db/seed_checklists');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ────────────────────────────────────────────
app.use('/api/auth',     require('./src/routes/auth'));
app.use('/api/bookings', require('./src/routes/bookings'));
app.use('/api/users',      require('./src/routes/users'));
app.use('/api/checklists', require('./src/routes/checklists'));

// Health check
app.get('/api/health', (req, res) =>
  res.json({ status: 'OK', version: '1.0.0', time: new Date().toISOString() }));

// ── SPA fallback — serve admin panel ─────────────────────
app.get('/{*splat}', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Start ─────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n🚀 Booking Hub running on http://localhost:${PORT}`);
  console.log(`   API:   http://localhost:${PORT}/api/health`);
  console.log(`   Admin: http://localhost:${PORT}/\n`);
  await seed();
  await seedChecklists();
});

module.exports = app;
