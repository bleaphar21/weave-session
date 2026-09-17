import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getSql, closeSql } from "../lib/db";

async function main() {
  const file = resolve(process.cwd(), "db/schema.sql");
  const statements = readFileSync(file, "utf8")
    .split(/^\s*--\s*@@\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.split("\n").every((l) => l.trim().startsWith("--") || l.trim() === ""));

  const sql = getSql();
  for (const stmt of statements) {
    await sql.unsafe(stmt);
  }
  console.log(`Applied ${statements.length} statements from db/schema.sql`);
  await closeSql();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
