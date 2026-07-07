// Bộ đệm vòng lưu N lỗi hệ thống gần nhất (in-memory) — để CEO xem nhanh khi có sự cố,
// và để /api/health báo số lỗi chưa xử lý. Không phụ thuộc dịch vụ ngoài.
// Nếu đặt SENTRY_DSN thì cũng bắn lỗi lên Sentry (best-effort, không chặn).
const MAX = 100;
const buffer = [];
let total = 0;

function capture(err, context = {}) {
  total++;
  const entry = {
    id: total,
    at: new Date().toISOString(),
    message: err?.message || String(err),
    stack: (err?.stack || '').split('\n').slice(0, 6).join('\n'),
    ...context, // { source, url, method } tuỳ nơi gọi
  };
  buffer.unshift(entry);
  if (buffer.length > MAX) buffer.pop();
  // Log ra stdout để Railway giữ lại
  console.error(`[error] ${entry.source || ''} ${entry.method || ''} ${entry.url || ''} — ${entry.message}`);
  forwardSentry(entry).catch(() => {});
  return entry;
}

// Best-effort forward tới Sentry qua Store API (không cần SDK/không thêm dependency)
async function forwardSentry(entry) {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const m = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/);
  if (!m) return;
  const [, key, host, projectId] = m;
  const url = `https://${host}/api/${projectId}/store/`;
  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=booking-hub/1`,
    },
    body: JSON.stringify({
      timestamp: entry.at,
      platform: 'node',
      level: 'error',
      logger: entry.source || 'app',
      message: entry.message,
      extra: { url: entry.url, method: entry.method, stack: entry.stack },
    }),
    signal: AbortSignal.timeout(8000),
  });
}

function recent(limit = 50) { return buffer.slice(0, Math.min(MAX, limit)); }
function count() { return total; }
function unresolvedCount() { return buffer.length; }

module.exports = { capture, recent, count, unresolvedCount };
