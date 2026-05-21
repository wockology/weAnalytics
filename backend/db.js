const fs   = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH  = path.join(DATA_DIR, 'database.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let _db    = null;
let _timer = null;

function save() {
  clearTimeout(_timer);
  _timer = setTimeout(() => {
    if (_db) fs.writeFileSync(DB_PATH, _db.export());
  }, 300);
}

function toRows(results) {
  if (!results || !results.length) return [];
  const { columns, values } = results[0];
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

function params(args) {
  const flat = args.flat();
  return flat.length ? flat : undefined;
}

const db = {
  pragma() {},

  exec(sql) {
    _db.exec(sql);
    save();
  },

  prepare(sql) {
    return {
      all(...args)  { return toRows(_db.exec(sql, params(args))); },
      get(...args)  { return toRows(_db.exec(sql, params(args)))[0]; },
      run(...args)  {
        _db.run(sql, params(args));
        const rowid = toRows(_db.exec('SELECT last_insert_rowid() AS id'))[0]?.id ?? 0;
        save();
        return { lastInsertRowid: rowid, changes: _db.getRowsModified() };
      },
    };
  },
};

async function init() {
  const SQL = await require('sql.js')();
  const buf = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  _db = buf ? new SQL.Database(buf) : new SQL.Database();
}

module.exports = { db, init };
