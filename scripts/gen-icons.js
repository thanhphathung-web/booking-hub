// Sinh icon PWA (PNG 192/512 + maskable) không cần thư viện ảnh — vẽ pixel + đóng gói PNG bằng zlib.
// Thiết kế: nền navy full-bleed (an toàn maskable) → vòng tròn trắng (quả địa cầu) →
// 3 chấm navy/teal/purple (hệ sinh thái 3 công ty). Chạy: node scripts/gen-icons.js
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const NAVY = [0x1f, 0x38, 0x64];
const TEAL = [0x00, 0x6b, 0x6b];
const PURPLE = [0x4a, 0x23, 0x5a];
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function draw(size) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const globeR = size * 0.32;
  const dotR = size * 0.075;
  // 3 chấm sắp tam giác trong vòng tròn
  const orbit = size * 0.14;
  const dots = [
    { c: NAVY,   x: cx,               y: cy - orbit },
    { c: TEAL,   x: cx - orbit * 0.87, y: cy + orbit * 0.5 },
    { c: PURPLE, x: cx + orbit * 0.87, y: cy + orbit * 0.5 },
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let col = NAVY;
      const dg = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (dg <= globeR) col = WHITE;
      for (const d of dots) {
        if (Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y) <= dotR) { col = d.c; break; }
      }
      const i = (y * size + x) * 4;
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
    }
  }
  return encodePng(size, size, buf);
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const s of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${s}.png`), draw(s));
  console.log(`icon-${s}.png`);
}
console.log('Done.');
