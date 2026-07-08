/* Booking Hub — Service Worker (PWA)
 * Chiến lược an toàn cho app quản trị có auth:
 *  - KHÔNG BAO GIỜ cache /api/ → dữ liệu booking/tiền luôn tươi, tránh hiển thị đơn cũ gây nhầm.
 *  - Navigation (mở trang): network-first, offline thì trả app shell đã cache (SPA vẫn bật, báo lỗi mạng ở UI).
 *  - Static cùng origin (icon/manifest): stale-while-revalidate → mở tức thì, ngầm cập nhật.
 *  - Bỏ qua mọi request không phải GET và cross-origin (Tailwind CDN...) → để trình duyệt tự xử lý.
 * Đổi CACHE_VERSION mỗi lần sửa shell để buộc client lấy bản mới.
 */
const CACHE_VERSION = 'bh-v2';
const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Chỉ xử lý cùng origin; bỏ qua CDN/tài nguyên ngoài.
  if (url.origin !== self.location.origin) return;
  // Không đụng vào API — luôn để mạng xử lý (không cache dữ liệu nhạy cảm).
  if (url.pathname.startsWith('/api/')) return;

  // Điều hướng trang: network-first, fallback app shell khi offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/').then((r) => r || caches.match(req)))
    );
    return;
  }

  // Static: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
