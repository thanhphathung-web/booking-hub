// Kênh Zalo OA — gửi tin nhắn Tư vấn (CS) cho nhân viên đã follow OA của công ty
// Cấu hình .env: ZALO_APP_ID, ZALO_APP_SECRET, ZALO_REFRESH_TOKEN (lấy 1 lần từ developers.zalo.me)
// Access token Zalo hết hạn ~25h; refresh token xoay vòng mỗi lần dùng
// → token mới nhất lưu ở data/zalo_token.json (ưu tiên hơn .env), tự refresh khi gần hết hạn

const fs = require('fs');
const path = require('path');

const TOKEN_FILE = path.join(__dirname, '../../data/zalo_token.json');
const OAUTH_URL  = 'https://oauth.zaloapp.com/v4/oa/access_token';
const API_BASE   = 'https://openapi.zalo.me';

let state = null; // { accessToken, expiresAt, refreshToken }

function loadState() {
  if (state) return state;
  state = { accessToken: null, expiresAt: 0, refreshToken: process.env.ZALO_REFRESH_TOKEN || null };
  try {
    const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    if (saved.refreshToken) state = saved; // file mới hơn .env
  } catch (e) { /* chưa có file — dùng .env */ }
  return state;
}

function saveState() {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(state, null, 2)); }
  catch (e) { console.error('[zalo] Không lưu được token file:', e.message); }
}

function isConfigured() {
  return !!(process.env.ZALO_APP_ID && process.env.ZALO_APP_SECRET && loadState().refreshToken);
}

async function getAccessToken() {
  const s = loadState();
  if (s.accessToken && Date.now() < s.expiresAt - 5 * 60 * 1000) return s.accessToken;

  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'secret_key': process.env.ZALO_APP_SECRET,
    },
    body: new URLSearchParams({
      app_id: process.env.ZALO_APP_ID,
      grant_type: 'refresh_token',
      refresh_token: s.refreshToken,
    }),
  });
  const data = await res.json();
  if (!data.access_token)
    throw new Error(`Refresh token Zalo thất bại: ${data.error_description || data.error_name || JSON.stringify(data)}`);

  s.accessToken  = data.access_token;
  s.refreshToken = data.refresh_token || s.refreshToken; // Zalo cấp refresh token mới mỗi lần
  s.expiresAt    = Date.now() + (parseInt(data.expires_in) || 90000) * 1000;
  saveState();
  return s.accessToken;
}

async function callApi(pathname, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(API_BASE + pathname, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'access_token': token, ...(options.headers || {}) },
  });
  const data = await res.json();
  if (data.error && data.error !== 0)
    throw new Error(`Zalo API lỗi ${data.error}: ${data.message || 'unknown'}`);
  return data;
}

// Gửi tin nhắn text cho 1 user (theo Zalo user_id trong phạm vi OA)
async function send(zaloUserId, text) {
  return callApi('/v3.0/oa/message/cs', {
    method: 'POST',
    body: JSON.stringify({
      recipient: { user_id: String(zaloUserId) },
      message: { text: text.length > 1900 ? text.slice(0, 1880) + '\n…(rút gọn)' : text },
    }),
  });
}

// Danh sách follower của OA — để admin tra Zalo ID gán cho nhân viên
async function getFollowers(offset = 0, count = 50) {
  const data = await callApi(`/v2.0/oa/getfollowers?data=${encodeURIComponent(JSON.stringify({ offset, count }))}`);
  const followers = data.data?.followers || [];
  // Lấy tên hiển thị từng follower (best effort — lỗi 1 người không chặn danh sách)
  const detailed = [];
  for (const f of followers) {
    try {
      const p = await callApi(`/v2.0/oa/getprofile?data=${encodeURIComponent(JSON.stringify({ user_id: f.user_id }))}`);
      detailed.push({ user_id: f.user_id, display_name: p.data?.display_name || '(không rõ tên)' });
    } catch (e) {
      detailed.push({ user_id: f.user_id, display_name: '(không lấy được tên)' });
    }
  }
  return { total: data.data?.total || followers.length, followers: detailed };
}

module.exports = { isConfigured, send, getFollowers };
