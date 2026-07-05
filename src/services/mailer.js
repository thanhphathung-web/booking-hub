// Kênh gửi email — cấu hình SMTP qua .env, bỏ trống = tắt gửi mail
const nodemailer = require('nodemailer');

let transport = null;

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
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
  return getTransport().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, subject, text,
  });
}

module.exports = { isConfigured, send };
