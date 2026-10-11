import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const here = dirname(fileURLToPath(import.meta.url));
const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {throw new Error("Set DATABASE_URL_UNPOOLED (preferred) or DATABASE_URL first");}
if (!process.env.DATABASE_URL_UNPOOLED && /-pooler\./.test(new URL(connectionString).hostname)) {
  throw new Error("Use Neon’s direct DATABASE_URL_UNPOOLED for schema migrations");
}

const pool = new Pool({ connectionString, max: 1 });
try {
  await pool.query(`CREATE TABLE IF NOT EXISTS slacki_schema_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(join(here, "../migrations"))).filter((file) => file.endsWith(".sql")).sort();
  for (const name of files) {
    const exists = await pool.query("SELECT 1 FROM slacki_schema_migrations WHERE name = $1", [name]);
    if (exists.rowCount) {continue;}
    const sql = await readFile(join(here, "../migrations", name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO slacki_schema_migrations (name) VALUES ($1)", [name]);
      await client.query("COMMIT");
      process.stdout.write(`Applied ${name}\n`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
} finally {
  await pool.end();
}
