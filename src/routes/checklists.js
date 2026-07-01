const router = require('express').Router();
const { dbAsync } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// ── Helpers ───────────────────────────────────────────────
function getPeriodKey(freq) {
  const now = new Date();
  if (freq === 'DAILY') return now.toISOString().slice(0, 10); // YYYY-MM-DD
  // WEEKLY: YYYY-WNN
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}

// GET /api/checklists — my checklist + today's/this week's completion
router.get('/', requireAuth, async (req, res) => {
  try {
    const role = req.user.role;
    const username = req.user.username;
    const items = await dbAsync.find('checklist_items', { role }, { freq: 1, order: 1 });
    const dailyKey  = getPeriodKey('DAILY');
    const weeklyKey = getPeriodKey('WEEKLY');

    const logs = await dbAsync.find('checklist_logs', {
      username,
      periodKey: { $in: [dailyKey, weeklyKey] }
    });
    const doneSet = new Set(logs.map(l => l.itemId + '|' + l.periodKey));

    const result = items.map(item => ({
      ...item,
      done: doneSet.has(item.id + '|' + (item.freq === 'DAILY' ? dailyKey : weeklyKey))
    }));
    res.json({ items: result, dailyKey, weeklyKey });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/checklists/:itemId/complete — tick done
router.post('/:itemId/complete', requireAuth, async (req, res) => {
  try {
    const item = await dbAsync.findOne('checklist_items', { id: req.params.itemId });
    if (!item) return res.status(404).json({ error: 'Không tìm thấy item' });
    const periodKey = getPeriodKey(item.freq);
    const existing = await dbAsync.findOne('checklist_logs', { itemId: item.id, username: req.user.username, periodKey });
    if (!existing) {
      await dbAsync.insert('checklist_logs', {
        itemId: item.id, username: req.user.username,
        role: req.user.role, periodKey,
        completedAt: new Date().toISOString()
      });
    }
    res.json({ done: true, periodKey });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/checklists/:itemId/complete — untick
router.delete('/:itemId/complete', requireAuth, async (req, res) => {
  try {
    const item = await dbAsync.findOne('checklist_items', { id: req.params.itemId });
    if (!item) return res.status(404).json({ error: 'Không tìm thấy item' });
    const periodKey = getPeriodKey(item.freq);
    await dbAsync.remove('checklist_logs', { itemId: item.id, username: req.user.username, periodKey }, {});
    res.json({ done: false });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/checklists/summary — CEO: all roles today's compliance
router.get('/summary', requireAuth, async (req, res) => {
  try {
    if (req.user.role !== 'CEO') return res.status(403).json({ error: 'CEO only' });
    const dailyKey  = getPeriodKey('DAILY');
    const weeklyKey = getPeriodKey('WEEKLY');
    const allItems = await dbAsync.find('checklist_items', {});
    const allLogs  = await dbAsync.find('checklist_logs', { periodKey: { $in: [dailyKey, weeklyKey] } });
    const users = await dbAsync.find('users', { active: { $ne: false } });

    const summary = [];
    const roles = ['CS','TPDH','NVDH','WC','KETOAN'];
    for (const role of roles) {
      const roleItems = allItems.filter(i => i.role === role);
      const dailyItems  = roleItems.filter(i => i.freq === 'DAILY');
      const weeklyItems = roleItems.filter(i => i.freq === 'WEEKLY');
      const roleUsers = users.filter(u => u.role === role);

      for (const u of roleUsers) {
        const userLogs = allLogs.filter(l => l.username === u.username);
        const dailyDone  = userLogs.filter(l => l.periodKey === dailyKey).length;
        const weeklyDone = userLogs.filter(l => l.periodKey === weeklyKey).length;
        summary.push({
          username: u.username, name: u.name, role,
          daily:  { done: dailyDone,  total: dailyItems.length,  pct: dailyItems.length  ? Math.round(dailyDone/dailyItems.length*100)   : 0 },
          weekly: { done: weeklyDone, total: weeklyItems.length, pct: weeklyItems.length ? Math.round(weeklyDone/weeklyItems.length*100) : 0 },
        });
      }
    }
    res.json({ summary, dailyKey, weeklyKey });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
