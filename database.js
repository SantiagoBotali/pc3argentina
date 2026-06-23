/**
 * PostgreSQL wrapper using the `pg` library.
 * Exposes a subset of the better-sqlite3 API (with async) so the rest
 * of the codebase only needs `await` on each call.
 */

const { Pool } = require('pg');

let pool;

/** Convert SQLite-style `?` placeholders to PostgreSQL `$1, $2, ...` */
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/** Flatten variadic args: prepare(sql).run(a, b, c) → [a, b, c] */
function flatParams(args) {
  if (!args || args.length === 0) return [];
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

/** Build a prepared-statement-like async object */
function prepare(sql) {
  const pgQuery = toPgSql(sql);
  // Append RETURNING id to INSERT statements so lastInsertRowid works
  const isInsert = /^\s*INSERT/i.test(sql);
  const hasReturning = /RETURNING/i.test(sql);
  const insertQuery = isInsert && !hasReturning ? pgQuery + ' RETURNING id' : pgQuery;

  return {
    async run(...args) {
      const params = flatParams(args);
      const result = await pool.query(insertQuery, params);
      return {
        lastInsertRowid: result.rows[0]?.id ?? 0,
        changes: result.rowCount ?? 0,
      };
    },
    async get(...args) {
      const params = flatParams(args);
      const result = await pool.query(pgQuery, params);
      return result.rows[0];
    },
    async all(...args) {
      const params = flatParams(args);
      const result = await pool.query(pgQuery, params);
      return result.rows;
    },
  };
}

/** Get a raw pg client for explicit transactions. Caller must call client.release(). */
async function getClient() {
  return pool.connect();
}

/** Execute a raw SQL string (DDL / multi-statement). No params. */
async function exec(sql) {
  await pool.query(sql);
}

/** No-op — data persists automatically in PostgreSQL */
function save() {}

async function init() {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  // ── Schema ───────────────────────────────────────────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS products (
      id           SERIAL PRIMARY KEY,
      slug         TEXT    NOT NULL UNIQUE,
      name         TEXT    NOT NULL,
      description  TEXT    NOT NULL DEFAULT '',
      contents     TEXT    NOT NULL DEFAULT '',
      price_pro    INTEGER NOT NULL DEFAULT 0,
      price_mayo   INTEGER NOT NULL DEFAULT 0,
      price_public INTEGER NOT NULL DEFAULT 0,
      stock        INTEGER NOT NULL DEFAULT 0,
      active       INTEGER NOT NULL DEFAULT 1,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS product_images (
      id          SERIAL PRIMARY KEY,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      filename    TEXT    NOT NULL,
      color_name  TEXT    NOT NULL DEFAULT '',
      stock       INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS discount_tiers (
      id           SERIAL PRIMARY KEY,
      product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      section      TEXT    NOT NULL,
      min_quantity INTEGER NOT NULL,
      percentage   REAL    NOT NULL,
      UNIQUE(product_id, section, min_quantity)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id            SERIAL PRIMARY KEY,
      username      TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // ── Migrations (idempotent column additions) ──────────────────────
  await pool.query(`ALTER TABLE products ADD COLUMN IF NOT EXISTS price_public INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE product_images ADD COLUMN IF NOT EXISTS color_name TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE product_images ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0`);

  return { prepare, getClient, exec, save };
}

module.exports = { init };
