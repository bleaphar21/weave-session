import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DashboardData } from "./types";

/**
 * Data access for the page. OWNED BY THE BACKEND WORKTREE.
 *
 * Current behaviour (stub): read data/snapshot.json from the repo.
 * Backend replaces this with: latest dashboard_snapshots row from Postgres,
 * falling back to data/snapshot.json when DATABASE_URL is unset or the query
 * fails. The signature must not change; the frontend depends on it.
 */
export async function getDashboardData(): Promise<DashboardData> {
  const file = resolve(process.cwd(), "data/snapshot.json");
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as DashboardData;
}
