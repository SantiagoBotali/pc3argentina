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
  // Only append RETURNING id for tables that have a SERIAL id column.
  // Tables like `settings` (TEXT primary key) and `user_sessions` do not have one.
  const isInsert = /^\s*INSERT/i.test(sql);
  const hasReturning = /RETURNING/i.test(sql);
  const hasSerialId = /INSERT\s+INTO\s+(products|product_images|discount_tiers|admin_users|colors|orders|order_items)\b/i.test(sql);
  const insertQuery = isInsert && !hasReturning && hasSerialId ? pgQuery + ' RETURNING id' : pgQuery;

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

/** Run a raw parameterised query and return rows. Useful for array params (ANY($1)). */
async function query(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

/** Execute a raw SQL string (DDL / multi-statement). No params. */
async function exec(sql) {
  await pool.query(sql);
}

/** No-op — data persists automatically in PostgreSQL */
function save() {}

async function init() {
  // max:3 — serverless functions are short-lived; a large pool wastes Neon connections.
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
  });

  // ── Schema + migrations in two batched round-trips ───────────────
  // Batching reduces cold-start latency: 14 sequential queries → 2 queries.
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
    );
    CREATE TABLE IF NOT EXISTS product_images (
      id          SERIAL PRIMARY KEY,
      product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      filename    TEXT    NOT NULL,
      color_name  TEXT    NOT NULL DEFAULT '',
      color_hex   TEXT    NOT NULL DEFAULT '',
      stock       INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS discount_tiers (
      id           SERIAL PRIMARY KEY,
      product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      section      TEXT    NOT NULL,
      min_quantity INTEGER NOT NULL,
      percentage   REAL    NOT NULL,
      UNIQUE(product_id, section, min_quantity)
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      id            SERIAL PRIMARY KEY,
      username      TEXT    NOT NULL UNIQUE,
      password_hash TEXT    NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS colors (
      id         SERIAL PRIMARY KEY,
      name       TEXT    NOT NULL,
      hex        TEXT    NOT NULL DEFAULT '#cccccc',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS orders (
      id           SERIAL PRIMARY KEY,
      status       TEXT        NOT NULL DEFAULT 'pending',
      section      TEXT        NOT NULL DEFAULT '',
      client_name  TEXT        NOT NULL DEFAULT '',
      client_phone TEXT        NOT NULL DEFAULT '',
      delivery     TEXT        NOT NULL DEFAULT 'retiro',
      address      TEXT        NOT NULL DEFAULT '',
      comprobante  TEXT        NOT NULL DEFAULT '',
      notes        TEXT        NOT NULL DEFAULT '',
      total        INTEGER     NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id           SERIAL PRIMARY KEY,
      order_id     INTEGER     NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id   INTEGER     REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT        NOT NULL DEFAULT '',
      color_name   TEXT        NOT NULL DEFAULT '',
      quantity     INTEGER     NOT NULL DEFAULT 1,
      unit_price   INTEGER     NOT NULL DEFAULT 0,
      subtotal     INTEGER     NOT NULL DEFAULT 0
    );
  `);

  // ── Idempotent column migrations (batched) ────────────────────────
  await pool.query(`
    ALTER TABLE products      ADD COLUMN IF NOT EXISTS price_public     INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE product_images ADD COLUMN IF NOT EXISTS color_name      TEXT    NOT NULL DEFAULT '';
    ALTER TABLE product_images ADD COLUMN IF NOT EXISTS stock           INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE product_images ADD COLUMN IF NOT EXISTS color_hex       TEXT    NOT NULL DEFAULT '';
    ALTER TABLE orders         ADD COLUMN IF NOT EXISTS client_club     TEXT    NOT NULL DEFAULT '';
    ALTER TABLE orders         ADD COLUMN IF NOT EXISTS client_dni      TEXT    NOT NULL DEFAULT '';
    ALTER TABLE orders         ADD COLUMN IF NOT EXISTS client_cuit     TEXT    NOT NULL DEFAULT '';
    ALTER TABLE orders         ADD COLUMN IF NOT EXISTS client_localidad TEXT   NOT NULL DEFAULT '';
    ALTER TABLE orders         ADD COLUMN IF NOT EXISTS client_email    TEXT    NOT NULL DEFAULT '';
    ALTER TABLE product_images ADD COLUMN IF NOT EXISTS image_type      TEXT    NOT NULL DEFAULT 'variant';
  `);

  // ── Seed default colors if table is empty ─────────────────────────
  const colorCount = await pool.query(`SELECT COUNT(*) FROM colors`);
  if (parseInt(colorCount.rows[0].count) === 0) {
    await pool.query(`
      INSERT INTO colors (name, hex, sort_order) VALUES
        ('Azul',        '#38BDF8', 0),
        ('Negro',       '#1C1C1C', 1),
        ('Beige',       '#C8B49A', 2),
        ('Azul marino', '#1E3A5F', 3),
        ('Rojo',        '#DC2626', 4),
        ('Verde',       '#16A34A', 5),
        ('Blanco',      '#E8E8E8', 6),
        ('Rosa',        '#E91E8C', 7),
        ('Amarillo',    '#F5C518', 8)
    `);
  }

  return { prepare, getClient, query, exec, save };
}

module.exports = { init };
