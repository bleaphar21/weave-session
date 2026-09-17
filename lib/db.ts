import postgres from "postgres";

/**
 * Lazy Postgres client (postgres.js). Works against Neon's pooled connection
 * string and against a local Postgres. Lazy so `next build` does not crash
 * when DATABASE_URL is absent; callers must handle the thrown error.
 *
 * Scripts run outside Next.js do not auto-load .env.local: use the npm
 * scripts (they wrap with dotenv-cli) or export DATABASE_URL yourself.
 */

let _sql: ReturnType<typeof postgres> | null = null;

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getSql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    _sql = postgres(url, {
      ssl: "require",
      prepare: false, // required for Neon's pgbouncer pooler
      max: 5,
      idle_timeout: 20,
      connect_timeout: 15,
    });
  }
  return _sql;
}

export async function closeSql() {
  if (_sql) {
    await _sql.end({ timeout: 5 });
    _sql = null;
  }
}
