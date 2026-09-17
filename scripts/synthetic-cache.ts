/**
 * Writes a deterministic synthetic ingest cache to data/raw/ (items.jsonl,
 * events.jsonl, meta.json) so `npm run score -- --from-cache` can be
 * exercised before the real ingestion finishes. Never run against a real
 * cache without intending to overwrite it.
 *
 *   npx tsx scripts/synthetic-cache.ts [--force]
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSynthetic } from "../lib/scoring/testing/fixtures";

const dir = resolve(process.cwd(), "data/raw");
const force = process.argv.includes("--force");
const metaFile = resolve(dir, "meta.json");

if (existsSync(metaFile) && !force) {
  console.error(`${metaFile} already exists; pass --force to overwrite with synthetic data.`);
  process.exit(1);
}

mkdirSync(dir, { recursive: true });
const { items, events, meta } = generateSynthetic();
writeFileSync(resolve(dir, "items.jsonl"), items.map((i) => JSON.stringify(i)).join("\n") + "\n");
writeFileSync(resolve(dir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
writeFileSync(metaFile, JSON.stringify({ ...meta, synthetic: true }, null, 2) + "\n");
console.log(`Wrote synthetic cache: ${items.length} items, ${events.length} events → ${dir}`);
