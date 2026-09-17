import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { closeSql, getSql, hasDatabaseUrl } from "./db";
import type { DashboardData } from "./types";

/**
 * Data access for the page. OWNED BY THE BACKEND WORKTREE.
 *
 * Reads the latest dashboard_snapshots.payload from Postgres when
 * DATABASE_URL is set (bounded by DB_TIMEOUT_MS); on any error, timeout, or
 * when the variable is unset, falls back to data/snapshot.json. Never throws
 * as long as the snapshot file exists and parses. The signature must not
 * change; the frontend depends on it.
 */

export const DB_TIMEOUT_MS = 5_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function readLatestSnapshotFromDb(): Promise<DashboardData | null> {
  const sql = getSql();
  const rows = await sql`
    select payload from dashboard_snapshots
    order by generated_at desc, run_id desc
    limit 1`;
  if (rows.length === 0) return null;
  const payload = rows[0].payload;
  const data = (typeof payload === "string" ? JSON.parse(payload) : payload) as DashboardData;
  if (!data || !Array.isArray(data.engineers) || !data.methodology) {
    throw new Error("dashboard_snapshots.payload is not a DashboardData object");
  }
  return data;
}

async function readSnapshotFile(): Promise<DashboardData> {
  const file = resolve(process.cwd(), "data/snapshot.json");
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as DashboardData;
}

export async function getDashboardData(): Promise<DashboardData> {
  if (hasDatabaseUrl()) {
    try {
      const data = await withTimeout(readLatestSnapshotFromDb(), DB_TIMEOUT_MS, "dashboard_snapshots read");
      if (data) {
        console.log("[data] dashboard source: postgres dashboard_snapshots");
        return data;
      }
      console.warn("[data] no dashboard_snapshots rows; falling back to data/snapshot.json");
    } catch (err) {
      console.warn(
        `[data] postgres read failed (${err instanceof Error ? err.message : String(err)}); falling back to data/snapshot.json`,
      );
      // Reset the client so a wedged connection does not poison later requests.
      await closeSql().catch(() => {});
    }
  } else {
    console.log("[data] DATABASE_URL unset; dashboard source: data/snapshot.json");
  }
  const data = await readSnapshotFile();
  console.log("[data] dashboard source: data/snapshot.json");
  return data;
}
