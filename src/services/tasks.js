// Gom checklist item chưa xong theo user — dùng chung cho route my-tasks và email digest
const { dbAsync } = require('../db/database');
const { ensureChecklist } = require('../db/tourChecklist');

function canSeeTask(user, item, booking) {
  if (['CEO', 'TPDH'].includes(user.role)) return true;
  if (item.role !== user.role) return false;
  if (user.role === 'NVDH') return !booking.assignedTo || booking.assignedTo === user.username;
  if (user.role === 'WC')   return !booking.wcAssigned || booking.wcAssigned === user.username;
  return true; // CS, KETOAN: mọi booking
}

// Booking đang chạy, đã bổ sung checklist còn thiếu (lazy migration cho booking cũ)
async function getRunningBookings() {
  const bookings = await dbAsync.find('bookings',
    { status: { $nin: ['CANCELLED', 'COMPLETED'] } }, { tourDate: 1 });
  for (const b of bookings) {
    const ensured = ensureChecklist(b);
    if (ensured) {
      await dbAsync.update('bookings', { bookingId: b.bookingId }, { $set: { checklist: ensured } });
      b.checklist = ensured;
    }
  }
  return bookings;
}

// Việc chưa xong của 1 user, quá hạn trước rồi theo deadline tăng dần
function tasksFor(user, bookings, today) {
  const tasks = [];
  for (const b of bookings) {
    for (const item of b.checklist || []) {
      if (item.done) continue;
      if (!canSeeTask(user, item, b)) continue;
      tasks.push({
        bookingId: b.bookingId, product: b.product, tourDate: b.tourDate,
        code: item.code, title: item.title, phase: item.phase, role: item.role,
        deadline: item.deadline,
        overdue:  !!item.deadline && item.deadline < today,
        dueToday: item.deadline === today,
      });
    }
  }
  tasks.sort((a, b) => (b.overdue - a.overdue)
    || String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')));
  return tasks;
}

module.exports = { canSeeTask, getRunningBookings, tasksFor };
