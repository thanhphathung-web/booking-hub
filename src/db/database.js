// @seald-io/nedb: fork được bảo trì của nedb, API tương thích, vá lỗ hổng underscore
const Datastore = require('@seald-io/nedb');
const path = require('path');

// DATA_DIR env cho phép test chạy trên thư mục tạm; mặc định ./data như cũ
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');

const db = {
  users:    new Datastore({ filename: path.join(DATA_DIR, 'users.db'),    autoload: true }),
  bookings: new Datastore({ filename: path.join(DATA_DIR, 'bookings.db'), autoload: true }),
  activity: new Datastore({ filename: path.join(DATA_DIR, 'activity.db'), autoload: true }),
};

// Auto-compact daily
db.users.persistence.setAutocompactionInterval(86400000);
db.bookings.persistence.setAutocompactionInterval(86400000);

// Promise wrappers
const dbAsync = {
  find:   (coll, query, sort) => new Promise((res, rej) => {
    let cursor = db[coll].find(query);
    if (sort) cursor = cursor.sort(sort);
    cursor.exec((e, docs) => e ? rej(e) : res(docs));
  }),
  findOne: (coll, query) => new Promise((res, rej) =>
    db[coll].findOne(query, (e, doc) => e ? rej(e) : res(doc))),
  insert:  (coll, doc)   => new Promise((res, rej) =>
    db[coll].insert(doc, (e, newDoc) => e ? rej(e) : res(newDoc))),
  update:  (coll, query, update, opts={}) => new Promise((res, rej) =>
    db[coll].update(query, update, opts, (e, n) => e ? rej(e) : res(n))),
  remove:  (coll, query, opts={}) => new Promise((res, rej) =>
    db[coll].remove(query, opts, (e, n) => e ? rej(e) : res(n))),
  count:   (coll, query) => new Promise((res, rej) =>
    db[coll].count(query, (e, n) => e ? rej(e) : res(n))),
  findPage: (coll, query, sort, skip, limit) => new Promise((res, rej) => {
    let cursor = db[coll].find(query);
    if (sort)  cursor = cursor.sort(sort);
    if (skip)  cursor = cursor.skip(skip);
    if (limit) cursor = cursor.limit(limit);
    cursor.exec((e, docs) => e ? rej(e) : res(docs));
  }),
};

module.exports = { db, dbAsync };

// ── Checklist datastores ──────────────────────────────────
db.checklist_items = new Datastore({ filename: path.join(DATA_DIR, 'checklist_items.db'), autoload: true });
db.checklist_logs  = new Datastore({ filename: path.join(DATA_DIR, 'checklist_logs.db'),  autoload: true });

// ── Products + NCC (Pre-Sales) ────────────────────────────
db.products  = new Datastore({ filename: path.join(DATA_DIR, 'products.db'),  autoload: true });
db.suppliers = new Datastore({ filename: path.join(DATA_DIR, 'suppliers.db'), autoload: true });
