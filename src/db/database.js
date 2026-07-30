// Thay NeDB bằng PostgreSQL (Supabase, schema "booking") — 1 bảng/collection, cột `doc JSONB`.
// dbAsync giữ NGUYÊN interface cũ (find/findOne/insert/update/remove/count/findPage) với cú pháp
// query/update kiểu Mongo mà NeDB vốn mô phỏng ($set/$push/$gte/$lte/$gt/$lt/$ne/$in/$nin/$exists/$or,
// dot-path 'a.b') — đây là toàn bộ tập toán tử thực tế được dùng trong src/routes|services (rà soát
// bằng grep trước khi viết). Route code phía trên KHÔNG cần đổi gì.
const crypto = require('crypto');
const { pool } = require('./pool');

// Cho phép test chạy trên schema riêng (tương đương DATA_DIR tạm của NeDB trước đây) — không đụng
// dữ liệu thật. Mặc định "booking" (dùng chung project Supabase với MRP, khác schema "app").
const SCHEMA = process.env.PGSCHEMA || 'booking';

const COLLECTIONS = [
  'users', 'bookings', 'activity', 'checklist_items', 'checklist_logs',
  'products', 'suppliers', 'customers', 'departures', 'reviews',
];

function assertColl(coll) {
  if (!COLLECTIONS.includes(coll)) throw new Error(`Collection không hợp lệ: ${coll}`);
}

async function ensureSchema() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`);
  for (const c of COLLECTIONS) {
    await pool.query(`CREATE TABLE IF NOT EXISTS "${SCHEMA}"."${c}" (
      id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      doc JSONB NOT NULL
    )`);
  }
}

// Mọi thao tác dbAsync đều chờ ready trước — tự đủ, không cần gọi init riêng ở server.js
// (giống hệt cách NeDB tự tạo file khi autoload:true trước đây).
const ready = ensureSchema();

// _id dạng gần giống NeDB (chuỗi ngắn, đủ để duy nhất trong phạm vi app này).
function genId() {
  return crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 14);
}

function getPath(obj, path) {
  let cur = obj;
  for (const p of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function setPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function matchValue(actual, cond) {
  if (cond instanceof RegExp) return typeof actual === 'string' && cond.test(actual);
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    for (const op of Object.keys(cond)) {
      const v = cond[op];
      switch (op) {
        case '$gte': if (!(actual >= v)) return false; break;
        case '$lte': if (!(actual <= v)) return false; break;
        case '$gt':  if (!(actual > v))  return false; break;
        case '$lt':  if (!(actual < v))  return false; break;
        case '$ne':  if (actual === v)   return false; break;
        case '$in':  if (!Array.isArray(v) || !v.includes(actual)) return false; break;
        case '$nin': if (Array.isArray(v) && v.includes(actual))   return false; break;
        case '$exists': if ((actual !== undefined) !== !!v) return false; break;
        default: throw new Error(`Toán tử query không hỗ trợ: ${op}`);
      }
    }
    return true;
  }
  if (cond === null) return actual == null;
  return actual === cond;
}

function matchesQuery(doc, query) {
  for (const key of Object.keys(query)) {
    if (key === '$or') {
      if (!query.$or.some((sub) => matchesQuery(doc, sub))) return false;
      continue;
    }
    if (!matchValue(getPath(doc, key), query[key])) return false;
  }
  return true;
}

function sortDocs(docs, sort) {
  const keys = Object.entries(sort);
  return [...docs].sort((a, b) => {
    for (const [k, dir] of keys) {
      const av = getPath(a, k), bv = getPath(b, k);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }
    return 0;
  });
}

// { $set, $push } — duy nhất 2 toán tử update thực tế dùng trong app (rà soát bằng grep).
// Không có $set nào cũng không có $push → coi là ghi đè toàn bộ document (giữ _id cũ),
// giống hành vi "full replace" mặc định của NeDB khi update không dùng operator.
function applyUpdate(doc, ops) {
  const next = JSON.parse(JSON.stringify(doc));
  const hasOperator = Object.keys(ops).some((k) => k.startsWith('$'));
  if (!hasOperator) return { ...ops, _id: next._id };
  if (ops.$set) for (const [k, v] of Object.entries(ops.$set)) setPath(next, k, v);
  if (ops.$push) for (const [k, v] of Object.entries(ops.$push)) {
    const arr = getPath(next, k);
    if (Array.isArray(arr)) arr.push(v); else setPath(next, k, [v]);
  }
  return next;
}

async function loadAll(coll) {
  await ready;
  const { rows } = await pool.query(`SELECT id, doc FROM "${SCHEMA}"."${coll}"`);
  return rows;
}

const dbAsync = {
  find: async (coll, query = {}, sort) => {
    assertColl(coll);
    const rows = await loadAll(coll);
    let docs = rows.filter((r) => matchesQuery(r.doc, query)).map((r) => r.doc);
    if (sort) docs = sortDocs(docs, sort);
    return docs;
  },

  findOne: async (coll, query = {}) => {
    assertColl(coll);
    const rows = await loadAll(coll);
    const row = rows.find((r) => matchesQuery(r.doc, query));
    return row ? row.doc : null;
  },

  insert: async (coll, doc) => {
    assertColl(coll);
    await ready;
    const toInsert = { ...doc, _id: doc._id || genId() };
    await pool.query(`INSERT INTO "${SCHEMA}"."${coll}" (doc) VALUES ($1)`, [toInsert]);
    return toInsert;
  },

  update: async (coll, query = {}, updateOps, opts = {}) => {
    assertColl(coll);
    const rows = await loadAll(coll);
    const matched = rows.filter((r) => matchesQuery(r.doc, query));
    const targets = opts.multi ? matched : matched.slice(0, 1);
    for (const row of targets) {
      const newDoc = applyUpdate(row.doc, updateOps);
      await pool.query(`UPDATE "${SCHEMA}"."${coll}" SET doc=$1 WHERE id=$2`, [newDoc, row.id]);
    }
    return targets.length;
  },

  remove: async (coll, query = {}, opts = {}) => {
    assertColl(coll);
    const rows = await loadAll(coll);
    const matched = rows.filter((r) => matchesQuery(r.doc, query));
    const targets = opts.multi ? matched : matched.slice(0, 1);
    for (const row of targets) {
      await pool.query(`DELETE FROM "${SCHEMA}"."${coll}" WHERE id=$1`, [row.id]);
    }
    return targets.length;
  },

  count: async (coll, query = {}) => {
    assertColl(coll);
    const rows = await loadAll(coll);
    return rows.filter((r) => matchesQuery(r.doc, query)).length;
  },

  findPage: async (coll, query = {}, sort, skip = 0, limit) => {
    assertColl(coll);
    const rows = await loadAll(coll);
    let docs = rows.filter((r) => matchesQuery(r.doc, query)).map((r) => r.doc);
    if (sort) docs = sortDocs(docs, sort);
    if (skip) docs = docs.slice(skip);
    if (limit) docs = docs.slice(0, limit);
    return docs;
  },
};

module.exports = { dbAsync, ready, ensureSchema, SCHEMA, COLLECTIONS };
