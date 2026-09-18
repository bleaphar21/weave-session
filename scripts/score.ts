/**
 * npm run score [-- --from-cache] [--synthetic] [--no-db]
 *
 * Loads items + events (Postgres by default, data/raw/*.jsonl with
 * --from-cache), computes both algorithms, writes data/snapshot.json and,
 * when DATABASE_URL is set, persists engineer_scores + dashboard_snapshots
 * against the latest ingest_runs row (creating one from meta when absent).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPO_FULL, WINDOW_DAYS } from "../lib/config";
import { closeSql, getSql, hasDatabaseUrl } from "../lib/db";
import { buildScoring, type IngestMeta } from "../lib/scoring";
import { generateSynthetic } from "../lib/scoring/testing/fixtures";
import type { AlgorithmKey, DashboardData, EngineerScore, EventRow, ItemRow } from "../lib/types";

const args = new Set(process.argv.slice(2));
const FROM_CACHE = args.has("--from-cache");
const SYNTHETIC = args.has("--synthetic");
const NO_DB = args.has("--no-db");
const RAW_DIR = resolve(process.cwd(), "data/raw");
const SNAPSHOT = resolve(process.cwd(), "data/snapshot.json");

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function readJsonl<T>(file: string): T[] {
  const text = readFileSync(file, "utf8");
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (t) out.push(JSON.parse(t) as T);
  }
  return out;
}

function loadFromCache(): { items: ItemRow[]; events: EventRow[]; meta: IngestMeta } {
  const itemsFile = resolve(RAW_DIR, "items.jsonl");
  const eventsFile = resolve(RAW_DIR, "events.jsonl");
  const metaFile = resolve(RAW_DIR, "meta.json");
  for (const f of [itemsFile, eventsFile, metaFile]) {
    if (!existsSync(f)) throw new Error(`--from-cache: missing ${f}`);
  }
  return {
    items: readJsonl<ItemRow>(itemsFile),
    events: readJsonl<EventRow>(eventsFile),
    meta: JSON.parse(readFileSync(metaFile, "utf8")) as IngestMeta,
  };
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v));
const isoOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : iso(v));

async function loadFromDb(): Promise<{ items: ItemRow[]; events: EventRow[]; meta: IngestMeta }> {
  const sql = getSql();
  const itemRows = await sql`select * from items`;
  const eventRows = await sql`select * from events`;
  const items: ItemRow[] = itemRows.map((r) => ({
    number: Number(r.number),
    kind: r.kind,
    authorLogin: r.author_login,
    authorAssociation: r.author_association ?? null,
    title: r.title ?? "",
    url: r.url,
    createdAt: iso(r.created_at),
    mergedAt: isoOrNull(r.merged_at),
    closedAt: isoOrNull(r.closed_at),
    isDraft: Boolean(r.is_draft),
    additions: r.additions === null ? null : Number(r.additions),
    deletions: r.deletions === null ? null : Number(r.deletions),
  }));
  const events: EventRow[] = eventRows.map((r) => ({
    id: r.id,
    itemNumber: Number(r.item_number),
    kind: r.kind,
    reviewState: r.review_state ?? null,
    authorLogin: r.author_login,
    authorAssociation: r.author_association ?? null,
    createdAt: iso(r.created_at),
    body: r.body ?? "",
    url: r.url,
  }));

  let meta: IngestMeta;
  const metaFile = resolve(RAW_DIR, "meta.json");
  const [run] = await sql`select * from ingest_runs order by id desc limit 1`;
  if (run) {
    meta = {
      repo: REPO_FULL,
      windowStart: iso(run.window_start),
      windowEnd: iso(run.window_end),
      fetchedAt: iso(run.finished_at ?? run.started_at),
      counts: (run.counts ?? {}) as IngestMeta["counts"],
      botLoginsSeen: ((run.counts ?? {}) as { botLoginsSeen?: string[] }).botLoginsSeen ?? [],
    };
    if (existsSync(metaFile)) {
      const fileMeta = JSON.parse(readFileSync(metaFile, "utf8")) as IngestMeta;
      meta.botLoginsSeen = fileMeta.botLoginsSeen ?? meta.botLoginsSeen;
      meta.counts = { ...fileMeta.counts, ...meta.counts };
    }
  } else if (existsSync(metaFile)) {
    meta = JSON.parse(readFileSync(metaFile, "utf8")) as IngestMeta;
  } else {
    const end = new Date();
    const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);
    meta = {
      repo: REPO_FULL,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      fetchedAt: end.toISOString(),
      counts: {},
      botLoginsSeen: [],
    };
    console.warn("No ingest_runs row and no data/raw/meta.json; window derived from now().");
  }
  return { items, events, meta };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

async function persist(data: DashboardData, all: EngineerScore[], meta: IngestMeta): Promise<number> {
  const sql = getSql();
  let [run] = await sql`select id, window_start, window_end from ingest_runs order by id desc limit 1`;
  // Reuse the latest run only when it describes the same window as the data
  // being scored; otherwise (no run yet, or a stale smoke run) create one.
  const sameWindow =
    run &&
    Math.abs(Date.parse(iso(run.window_start)) - Date.parse(meta.windowStart)) < 60_000 &&
    Math.abs(Date.parse(iso(run.window_end)) - Date.parse(meta.windowEnd)) < 60_000;
  if (!run || !sameWindow) {
    if (run) console.log(`Latest ingest_runs row ${run.id} covers a different window; creating a new one`);
    [run] = await sql`
      insert into ingest_runs (started_at, finished_at, window_start, window_end, counts)
      values (${meta.fetchedAt}, ${meta.fetchedAt}, ${meta.windowStart}, ${meta.windowEnd},
              ${sql.json({ ...meta.counts, botLoginsSeen: meta.botLoginsSeen } as never)})
      returning id, window_start, window_end`;
    console.log(`Created ingest_runs row ${run.id} from meta`);
  }
  const runId = Number(run.id);

  await sql.begin(async (tx) => {
    for (const e of all) {
      const metrics = { raw: e.raw, algorithms: e.algorithms };
      await tx`
        insert into engineer_scores (run_id, login, avatar_url, association, eligible, metrics, evidence)
        values (${runId}, ${e.login}, ${e.avatarUrl}, ${e.association}, ${e.eligible},
                ${tx.json(metrics as never)}, ${tx.json(e.evidence as never)})
        on conflict (run_id, login) do update set
          avatar_url = excluded.avatar_url,
          association = excluded.association,
          eligible = excluded.eligible,
          metrics = excluded.metrics,
          evidence = excluded.evidence`;
    }
    await tx`
      insert into dashboard_snapshots (run_id, generated_at, payload)
      values (${runId}, ${data.generatedAt}, ${tx.json(data as never)})
      on conflict (run_id) do update set
        generated_at = excluded.generated_at,
        payload = excluded.payload`;
  });
  return runId;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printTop(data: DashboardData, key: AlgorithmKey, n = 5): void {
  const title = data.methodology[key].title;
  console.log(`\nTop ${n} — ${title}`);
  const rows = [...data.engineers]
    .sort((a, b) => a.algorithms[key]!.rank - b.algorithms[key]!.rank)
    .slice(0, n);
  for (const e of rows) {
    const r = e.algorithms[key]!;
    const raw = e.raw;
    const factors = r.factors
      .map((f) => `${f.label}: ${f.rawLabel} (p${f.percentile ?? "n/a"})`)
      .join(" | ");
    console.log(
      `  #${r.rank} ${e.login} [${e.association}] composite ${r.composite}` +
        `\n     ${factors}` +
        `\n     responses=${raw.responses} items=${raw.distinctItems} counterparts=${raw.distinctCounterparts}` +
        ` medianLatencyH=${raw.medianReplyLatencyHours} (n=${raw.latencyN}, <24h ${raw.within24hPct}%)` +
        ` medianFollowThroughH=${raw.medianFollowThroughHours} (n=${raw.followThroughN})` +
        ` meanQ=${raw.meanQuality} substantive=${raw.substantiveResponses} prsAuthored=${raw.prsAuthored}` +
        (r.note ? `\n     note: ${r.note}` : ""),
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const useDb = hasDatabaseUrl() && !NO_DB;
  let loaded: { items: ItemRow[]; events: EventRow[]; meta: IngestMeta };
  let source: string;
  if (SYNTHETIC) {
    loaded = generateSynthetic();
    source = "synthetic";
  } else if (FROM_CACHE || !useDb) {
    if (!FROM_CACHE) console.log("DATABASE_URL not set; reading data/raw cache.");
    loaded = loadFromCache();
    source = "data/raw";
  } else {
    loaded = await loadFromDb();
    source = "postgres";
  }
  console.log(
    `Loaded ${loaded.items.length} items and ${loaded.events.length} events from ${source} ` +
      `(window ${loaded.meta.windowStart} → ${loaded.meta.windowEnd})`,
  );

  const t0 = Date.now();
  const { data, allEngineers } = buildScoring(loaded.items, loaded.events, loaded.meta);
  console.log(
    `Scored ${allEngineers.length} human engineers (${data.engineers.length} eligible) in ${Date.now() - t0}ms`,
  );

  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  writeFileSync(SNAPSHOT, JSON.stringify(data, null, 2) + "\n");
  console.log(`Wrote ${SNAPSHOT}`);

  if (useDb) {
    try {
      const runId = await persist(data, allEngineers, loaded.meta);
      console.log(`Persisted ${allEngineers.length} engineer_scores rows and dashboard_snapshots for run ${runId}`);
    } catch (err) {
      console.error("DB persistence failed (snapshot.json still written):", err);
      process.exitCode = 1;
    } finally {
      await closeSql();
    }
  } else {
    console.log("DATABASE_URL not set (or --no-db); skipped DB writes.");
  }

  printTop(data, "responsive");
  printTop(data, "constructive");
}

main().catch(async (err) => {
  console.error(err);
  await closeSql().catch(() => {});
  process.exit(1);
});
