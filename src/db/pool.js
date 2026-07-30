// Kết nối PostgreSQL (Supabase, schema "booking") dùng chung toàn app — thay NeDB.
require('dotenv').config();
const { Pool } = require('pg');

// Cloud Postgres (Supabase/Neon/Render...): bật SSL khi connection string yêu cầu (sslmode=require)
// hoặc PGSSL=1. Không bật mặc định — DB nội bộ/local không cần SSL.
const url = process.env.DATABASE_URL || '';
const useSsl = /sslmode=require|ssl=true/i.test(url) || process.env.PGSSL === '1';

const pool = new Pool({
  connectionString: url,
  max: 10,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  // Không cho lỗi idle client làm sập process.
  console.error('[pg] idle client error:', err.message);
});

module.exports = { pool };
