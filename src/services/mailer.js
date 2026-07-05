// Kênh gửi email — 2 đường:
// 1. RESEND_API_KEY (ưu tiên): gửi qua HTTPS api.resend.com — dùng được cả khi hạ tầng chặn cổng SMTP
// 2. SMTP_HOST/USER/PASS: nodemailer SMTP truyền thống (Gmail App Password...)
// Không cấu hình gì = tắt gửi mail, app vẫn chạy
const nodemailer = require('nodemailer');

let transport = null;

function isConfigured() {
  return !!(process.env.RESEND_API_KEY
    || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));
}

async function sendViaResend(to, subject, text) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // Resend chỉ cho gửi từ domain đã verify — chưa verify thì dùng onboarding@resend.dev
      // (KHÔNG dùng SMTP_FROM ở đây: địa chỉ gmail sẽ bị Resend từ chối)
      from: process.env.RESEND_FROM || 'Booking Hub <onboarding@resend.dev>',
      to: [to], subject, text,
    }),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Resend lỗi ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data;
}

function getTransport() {
  if (!transport) {
    const port = parseInt(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      // Fail nhanh thay vì treo nhiều phút khi hạ tầng chặn cổng SMTP
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
  }
  return transport;
}

async function send(to, subject, text) {
  if (process.env.RESEND_API_KEY) return sendViaResend(to, subject, text);
  return getTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, subject, text,
  });
}

module.exports = { isConfigured, send };
