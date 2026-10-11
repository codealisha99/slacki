import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

const globalForPg = globalThis as typeof globalThis & { slackiPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
  const pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 5_000 });
  if (process.env.VERCEL) {
    attachDatabasePool(pool);
  }
  return pool;
}

function getPool(): Pool {
  if (globalForPg.slackiPool) {
    return globalForPg.slackiPool;
  }
  const pool = createPool();
  if (process.env.NODE_ENV !== "production") {
    globalForPg.slackiPool = pool;
  }
  return pool;
}

export const db = {
  query: (text: string, values?: unknown[]) => getPool().query(text, values),
  connect: () => getPool().connect(),
};
