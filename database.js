/**
 * Synchronous SQLite wrapper using sql.js (pure WebAssembly, no native build required).
 * Exposes a subset of the better-sqlite3 API so the rest of the codebase stays the same.
 */

const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const dbDir = path.join(__dirname, 'db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

const DB_PATH = path.join(dbDir, 'pc3.sqlite');

// sql.js must be initialised asynchronously, but we expose a synchronous API.
// We resolve the DB synchronously using node's blocking approach via a shared state object
// that gets filled during the init() call, which must be awaited before anything else.

let SQL = null;
let sqlDb = null;

async function init() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    sqlDb = new SQL.Database(buf);
  } else {
    sqlDb = new SQL.Database();
  }

  // Enable WAL-equivalent settings
  sqlDb.run('PRAGMA foreign_keys = ON;');

  // Create tables
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS products (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      slug        TEXT    NOT NULL UNIQUE,
      name        TEXT    NOT NULL,
      description TEXT    NOT NULL DEFAULT '',
      contents    TEXT    NOT NULL DEFAULT '',
      price_pro   INTEGER NOT NULL DEFAULT 0,
      price_mayo  INTEGER NOT NULL DEFAULT 0,
      stock       INTEGER NOT NULL DEFAULT 0,
      active      INTEGER NOT NULL DEFAULT 1,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS product_images (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      filename    TEXT    NOT NULL,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS discount_tiers (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      section      TEXT    NOT NULL,
      min_quantity INTEGER NOT NULL,
      percentage   REAL    NOT NULL,
      UNIQUE(product_id, section, min_quantity)
    );
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL
    );
  `);

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  save();
  return proxy;
}

/** Persist the in-memory database to disk */
function save() {
  const data = sqlDb.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/**
 * Parse named params like `@name` or `?` positional into sql.js format.
 * sql.js uses `?NNN`, `:name`, `@name`, `$name`.
 * It accepts plain objects for named params and arrays for positional.
 */
function toSqlJsParams(params) {
  if (!params || params.length === 0) return [];
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object' && !Array.isArray(params[0])) {
    return params[0]; // named params object
  }
  return params;
}

/** Execute a statement and return { lastInsertRowid, changes } */
function runStmt(sql, params) {
  const p = toSqlJsParams(params);
  sqlDb.run(sql, p);
  const info = {
    lastInsertRowid: sqlDb.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0,
    changes: sqlDb.exec('SELECT changes()')[0]?.values[0]?.[0] ?? 0,
  };
  save();
  return info;
}

/** Return first matching row as object, or undefined */
function getRow(sql, params) {
  const p = toSqlJsParams(params);
  const result = sqlDb.exec(sql, p);
  if (!result.length || !result[0].values.length) return undefined;
  const { columns, values } = result[0];
  return Object.fromEntries(columns.map((c, i) => [c, values[0][i]]));
}

/** Return all matching rows as objects */
function allRows(sql, params) {
  const p = toSqlJsParams(params);
  const result = sqlDb.exec(sql, p);
  if (!result.length) return [];
  const { columns, values } = result[0];
  return values.map(row => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
}

/** Execute multi-statement DDL / DML (no params) */
function execSql(sql) {
  sqlDb.exec(sql);
  save();
}

/** Build a prepared-statement-like object */
function prepare(sql) {
  return {
    run(...args) { return runStmt(sql, args); },
    get(...args) { return getRow(sql, args); },
    all(...args) { return allRows(sql, args); },
  };
}

/** Simple transaction wrapper */
function transaction(fn) {
  return (...args) => {
    sqlDb.run('BEGIN');
    try {
      fn(...args);
      sqlDb.run('COMMIT');
      save();
    } catch (e) {
      sqlDb.run('ROLLBACK');
      throw e;
    }
  };
}

const proxy = {
  prepare,
  exec: execSql,
  transaction,
  save,
  pragma: () => {}, // no-op (handled in init)
};

module.exports = { init, proxy };
