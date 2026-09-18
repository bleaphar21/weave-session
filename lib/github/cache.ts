/**
 * Local on-disk cache for the ingest. Every fetched slice/page lands in
 * data/raw/slices/<name>.json so an interrupted run resumes where it stopped.
 * The merged outputs (items.jsonl, events.jsonl, meta.json) live in data/raw.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const RAW_DIR = resolve(process.cwd(), "data/raw");
export const SLICES_DIR = join(RAW_DIR, "slices");
export const ITEMS_PATH = join(RAW_DIR, "items.jsonl");
export const EVENTS_PATH = join(RAW_DIR, "events.jsonl");
export const META_PATH = join(RAW_DIR, "meta.json");
export const WINDOW_PATH = join(RAW_DIR, "window.json");

export function ensureDirs(): void {
  mkdirSync(SLICES_DIR, { recursive: true });
}

export function clearCache(): void {
  rmSync(SLICES_DIR, { recursive: true, force: true });
  rmSync(WINDOW_PATH, { force: true });
  ensureDirs();
}

export function slicePath(name: string): string {
  return join(SLICES_DIR, `${name}.json`);
}

export function sliceExists(name: string): boolean {
  return existsSync(slicePath(name));
}

/** Return the cached slice if present, otherwise fetch it and store it atomically. */
export async function withSlice<T>(name: string, fetcher: () => Promise<T>): Promise<T> {
  const path = slicePath(name);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  }
  const value = await fetcher();
  writeJsonAtomic(path, value);
  return value;
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, path);
}

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJsonl(path: string, rows: unknown[]): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  renameSync(tmp, path);
}

export function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as T);
}

/** ISO timestamp without separators, safe in file names: 20260915T000000Z */
export function compactIso(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
