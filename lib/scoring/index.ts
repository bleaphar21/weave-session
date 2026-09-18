/**
 * Entry point: turn ingested items + events (+ ingest meta) into the
 * DashboardData payload the page renders.
 */

import { isAutomatedBody, isBotLogin } from "../config";
import type { DashboardData, EngineerScore, EventRow, ItemRow } from "../types";
import { scoreEngineers } from "./aggregate";
import { buildMethodology } from "./methodology";

export * from "./events";
export * from "./quality";
export * from "./rank";
export * from "./aggregate";
export * from "./methodology";

/** Shape of data/raw/meta.json written by scripts/ingest.ts. */
export interface IngestMeta {
  repo: string;
  windowStart: string; // ISO
  windowEnd: string; // ISO
  fetchedAt: string; // ISO
  counts: {
    items?: number;
    prs?: number;
    issues?: number;
    mergedPrs?: number;
    events?: number;
    issueComments?: number;
    reviewComments?: number;
    reviews?: number;
    botEventsExcluded?: number;
    botItemsExcluded?: number;
    [key: string]: number | undefined;
  };
  botLoginsSeen: string[];
}

export interface ScoringResult {
  data: DashboardData;
  /** Every human engineer with at least one response (eligible or not). */
  allEngineers: EngineerScore[];
}

/** Defensive bot filter on top of what ingestion already removed. */
export function dropBots(items: ItemRow[], events: EventRow[]): { items: ItemRow[]; events: EventRow[]; botLogins: Set<string> } {
  const botLogins = new Set<string>();
  const keptEvents = events.filter((e) => {
    if (isBotLogin(e.authorLogin)) {
      botLogins.add(e.authorLogin);
      return false;
    }
    // Self-declared automated comments posted through a human's account.
    if (isAutomatedBody(e.body)) return false;
    return true;
  });
  // Items authored by bots stay (humans respond on them) but we still record the login.
  for (const it of items) if (isBotLogin(it.authorLogin)) botLogins.add(it.authorLogin);
  return { items, events: keptEvents, botLogins };
}

export function buildScoring(items: ItemRow[], events: EventRow[], meta: IngestMeta): ScoringResult {
  const filtered = dropBots(items, events);
  const { all, eligible } = scoreEngineers(filtered.items, filtered.events, meta.windowStart);

  const prs = filtered.items.filter((i) => i.kind === "pr");
  const excluded = new Set<string>(meta.botLoginsSeen ?? []);
  for (const l of filtered.botLogins) excluded.add(l);

  const startMs = Date.parse(meta.windowStart);
  const endMs = Date.parse(meta.windowEnd);
  const days = Math.max(1, Math.round((endMs - startMs) / 86_400_000));

  const data: DashboardData = {
    generatedAt: new Date().toISOString(),
    repo: meta.repo,
    window: { start: meta.windowStart, end: meta.windowEnd, days },
    counts: {
      humanEngineers: all.length,
      eligibleEngineers: eligible.length,
      botAccountsExcluded: excluded.size,
      botEventsExcluded: (meta.counts?.botEventsExcluded ?? 0) + (events.length - filtered.events.length),
      items: filtered.items.length,
      prs: prs.length,
      issues: filtered.items.length - prs.length,
      mergedPrs: prs.filter((p) => p.mergedAt).length,
      events: filtered.events.length,
    },
    excludedLogins: [...excluded].sort((a, b) => a.localeCompare(b)),
    methodology: buildMethodology(),
    engineers: eligible,
  };
  return { data, allEngineers: all };
}

export function buildDashboardData(items: ItemRow[], events: EventRow[], meta: IngestMeta): DashboardData {
  return buildScoring(items, events, meta).data;
}
