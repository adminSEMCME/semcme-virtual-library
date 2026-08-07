import pg from "pg";
import { config } from "./config.js";

function databaseUrlWithoutSslMode(value) {
  if (!value) return value;
  try {
    const url = new URL(value);
    url.searchParams.delete("sslmode");
    return url.toString();
  } catch {
    return value;
  }
}

const useSsl =
  config.databaseUrl?.includes("sslmode=require") ||
  config.databaseUrl?.includes("supabase") ||
  config.nodeEnv === "production";

export const pool = new pg.Pool({
  connectionString: databaseUrlWithoutSslMode(config.databaseUrl),
  ssl: useSsl ? { rejectUnauthorized: false } : undefined
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
