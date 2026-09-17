/**
 * Tiny builders for hand-written scoring fixtures (tests) plus a
 * deterministic synthetic dataset generator that mimics the ingest cache.
 */

import type { EventKind, EventRow, ItemKind, ItemRow } from "../../types";
import type { IngestMeta } from "../index";

export const T0 = Date.parse("2026-08-01T00:00:00Z");
export const WINDOW_START = "2026-07-01T00:00:00Z";
export const WINDOW_END = "2026-09-29T00:00:00Z";

export const h = (hours: number, base = T0) => new Date(base + hours * 3_600_000).toISOString();

let seq = 0;

export function item(partial: Partial<ItemRow> & { number: number; authorLogin: string }): ItemRow {
  const kind: ItemKind = partial.kind ?? "pr";
  return {
    kind,
    authorAssociation: "MEMBER",
    title: `Item #${partial.number}`,
    url: `https://github.com/PostHog/posthog/${kind === "pr" ? "pull" : "issues"}/${partial.number}`,
    createdAt: h(0),
    mergedAt: null,
    closedAt: null,
    isDraft: false,
    additions: null,
    deletions: null,
    ...partial,
  };
}

export function ev(
  partial: Partial<EventRow> & { itemNumber: number; authorLogin: string; createdAt: string },
): EventRow {
  const kind: EventKind = partial.kind ?? "issue_comment";
  const id = partial.id ?? `${kind}:${++seq}`;
  return {
    id,
    kind,
    reviewState: kind === "review" ? (partial.reviewState ?? "COMMENTED") : null,
    authorAssociation: "MEMBER",
    body: "This looks reasonable to me, could we also add a test for the empty case?",
    url: `https://github.com/PostHog/posthog/pull/${partial.itemNumber}#issuecomment-${id.replace(/\W/g, "")}`,
    ...partial,
  };
}

export function meta(partial: Partial<IngestMeta> = {}): IngestMeta {
  return {
    repo: "PostHog/posthog",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    fetchedAt: WINDOW_END,
    counts: { botEventsExcluded: 0 },
    botLoginsSeen: [],
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// Synthetic dataset
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BODIES = [
  "LGTM",
  "+1",
  "Thanks!",
  "done",
  "nice 🎉",
  "Looks good, one nit: could we rename this to `fooBar` instead so it matches the rest of the module?",
  "Why do we need the extra fetch here? It looks like `useQuery` already handles it, see https://github.com/PostHog/posthog/pull/100.",
  "I think this should be guarded because the value can be undefined on first render, otherwise the page crashes.\n\n```suggestion\nif (!value) return null\n```",
  "> is this needed?\n\nYes, since the migration runs before the backfill we need it, see frontend/src/lib/utils.ts:42.",
  "What if we moved this into a helper so that both callers share the retry logic? Let's try that in a follow-up.",
  "Approving, but please consider adding a test for #123 before merging.",
  "This causes a regression in the dashboard filters. Could you check `ee/clickhouse/queries/funnels/base.py` line 88?",
  "Small thing",
  "ok",
];

export interface SyntheticOptions {
  seed?: number;
  engineers?: number;
  items?: number;
  eventsPerItem?: number;
  bots?: string[];
}

export function generateSynthetic(opts: SyntheticOptions = {}): {
  items: ItemRow[];
  events: EventRow[];
  meta: IngestMeta;
} {
  const rand = mulberry32(opts.seed ?? 42);
  const nEng = opts.engineers ?? 40;
  const nItems = opts.items ?? 600;
  const perItem = opts.eventsPerItem ?? 6;
  const bots = opts.bots ?? ["posthog-bot", "greptile-apps[bot]", "dependabot[bot]"];
  const logins = Array.from({ length: nEng }, (_, i) => `engineer${String(i + 1).padStart(2, "0")}`);
  const startMs = Date.parse(WINDOW_START);
  const endMs = Date.parse(WINDOW_END);
  const span = endMs - startMs;

  const items: ItemRow[] = [];
  const events: EventRow[] = [];
  let botEvents = 0;
  let eid = 0;

  for (let n = 1; n <= nItems; n++) {
    const author = logins[Math.floor(rand() * nEng)];
    const kind: ItemKind = rand() < 0.85 ? "pr" : "issue";
    // ~5% of items predate the window.
    const createdMs = rand() < 0.05 ? startMs - rand() * 20 * 86_400_000 : startMs + rand() * span * 0.9;
    const isDraft = kind === "pr" && rand() < 0.1;
    const merged = kind === "pr" && rand() < 0.7;
    let lastMs = createdMs;
    const itemEvents: EventRow[] = [];
    const count = 1 + Math.floor(rand() * perItem * 2);
    for (let k = 0; k < count; k++) {
      // Some engineers are systematically faster.
      const responder = logins[Math.floor(Math.pow(rand(), 1.6) * nEng)];
      const speed = 0.5 + (logins.indexOf(responder) / nEng) * 40; // hours-ish
      lastMs += Math.max(0.05, rand() * speed) * 3_600_000;
      if (lastMs > endMs) break;
      if (rand() < 0.15) {
        botEvents++;
        continue; // bot event, dropped at ingest
      }
      const r = rand();
      const evKind: EventKind = r < 0.25 ? "issue_comment" : r < 0.75 ? "review_comment" : "review";
      const reviewState =
        evKind === "review" ? (rand() < 0.6 ? "APPROVED" : rand() < 0.5 ? "COMMENTED" : "CHANGES_REQUESTED") : null;
      const body = evKind === "review" && reviewState === "APPROVED" && rand() < 0.5 ? "" : BODIES[Math.floor(rand() * BODIES.length)];
      if (Date.parse(WINDOW_START) > lastMs) continue; // only in-window events are stored
      eid++;
      itemEvents.push({
        id: `${evKind}:${eid}`,
        itemNumber: n,
        kind: evKind,
        reviewState,
        authorLogin: responder,
        authorAssociation: logins.indexOf(responder) % 7 === 0 ? "CONTRIBUTOR" : "MEMBER",
        createdAt: new Date(lastMs).toISOString(),
        body,
        url: `https://github.com/PostHog/posthog/pull/${n}#discussion_r${eid}`,
      });
    }
    const mergedMs = merged ? lastMs + rand() * 30 * 3_600_000 : null;
    items.push({
      number: n,
      kind,
      authorLogin: author,
      authorAssociation: "MEMBER",
      title: `Synthetic ${kind} #${n}`,
      url: `https://github.com/PostHog/posthog/${kind === "pr" ? "pull" : "issues"}/${n}`,
      createdAt: new Date(createdMs).toISOString(),
      mergedAt: mergedMs && mergedMs < endMs ? new Date(mergedMs).toISOString() : null,
      closedAt: mergedMs && mergedMs < endMs ? new Date(mergedMs).toISOString() : null,
      isDraft,
      additions: Math.floor(rand() * 500),
      deletions: Math.floor(rand() * 200),
    });
    events.push(...itemEvents);
  }

  const prs = items.filter((i) => i.kind === "pr");
  const m: IngestMeta = {
    repo: "PostHog/posthog",
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    fetchedAt: WINDOW_END,
    counts: {
      items: items.length,
      prs: prs.length,
      issues: items.length - prs.length,
      mergedPrs: prs.filter((p) => p.mergedAt).length,
      events: events.length,
      issueComments: events.filter((e) => e.kind === "issue_comment").length,
      reviewComments: events.filter((e) => e.kind === "review_comment").length,
      reviews: events.filter((e) => e.kind === "review").length,
      botEventsExcluded: botEvents,
      botItemsExcluded: 0,
    },
    botLoginsSeen: bots,
  };
  return { items, events, meta: m };
}
