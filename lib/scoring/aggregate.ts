/**
 * Per-engineer aggregation: raw metrics, eligibility, both algorithms'
 * factor scores and composites, ranks, and evidence.
 *
 * All weights/thresholds come from lib/config so the methodology panel
 * describes exactly what was computed here.
 */

import {
  ELIGIBILITY,
  EVIDENCE_PER_ENGINEER,
  EXCERPT_CHARS,
  LATENCY_CAP_HOURS,
  QUALITY,
  WEIGHTS,
} from "../config";
import type {
  AlgorithmKey,
  AlgorithmResult,
  Direction,
  EngineerRawMetrics,
  EngineerScore,
  EventRow,
  EvidenceItem,
  FactorScore,
  ItemRow,
} from "../types";
import {
  computeFollowThrough,
  computeResponses,
  median,
  type FollowThroughRecord,
  type ResponseRecord,
} from "./events";
import { scoreComment, type CommentQuality } from "./quality";
import { percentileRanks } from "./rank";

export interface ScoredResponse extends ResponseRecord {
  quality: CommentQuality;
}

export interface EngineerAccumulator {
  login: string;
  responses: ScoredResponse[];
  followThrough: FollowThroughRecord[];
  associations: Map<string, number>;
  prsAuthored: number;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function aggregateEngineers(
  items: ItemRow[],
  events: EventRow[],
  windowStart: string,
): EngineerAccumulator[] {
  const accs = new Map<string, EngineerAccumulator>();
  const get = (login: string): EngineerAccumulator => {
    let a = accs.get(login);
    if (!a) {
      a = { login, responses: [], followThrough: [], associations: new Map(), prsAuthored: 0 };
      accs.set(login, a);
    }
    return a;
  };

  for (const r of computeResponses(items, events, windowStart)) {
    const a = get(r.event.authorLogin);
    a.responses.push({ ...r, quality: scoreComment(r.event.body) });
    const assoc = r.event.authorAssociation;
    if (assoc) a.associations.set(assoc, (a.associations.get(assoc) ?? 0) + 1);
  }
  for (const f of computeFollowThrough(items, events)) {
    const a = accs.get(f.login);
    if (a) a.followThrough.push(f);
  }
  const windowStartMs = Date.parse(windowStart);
  for (const it of items) {
    if (it.kind !== "pr" || Date.parse(it.createdAt) < windowStartMs) continue;
    const a = accs.get(it.authorLogin);
    if (a) a.prsAuthored++;
  }
  for (const a of accs.values()) {
    a.responses.sort((x, y) => Date.parse(x.event.createdAt) - Date.parse(y.event.createdAt));
  }
  return [...accs.values()].sort((a, b) => a.login.localeCompare(b.login));
}

export function rawMetrics(a: EngineerAccumulator): EngineerRawMetrics {
  const items = new Set<number>();
  const counterparts = new Set<string>();
  const latencies: number[] = [];
  let qualitySum = 0;
  let substantive = 0;
  for (const r of a.responses) {
    items.add(r.item.number);
    if (r.item.authorLogin !== a.login) counterparts.add(r.item.authorLogin);
    if (r.latencyHours !== null) latencies.push(r.latencyHours);
    qualitySum += r.quality.q;
    if (r.quality.q >= QUALITY.substantiveThreshold) substantive++;
  }
  const n = a.responses.length;
  const within24 = latencies.filter((h) => h < 24).length;
  const ftHours = a.followThrough.map((f) => f.hours);
  return {
    responses: n,
    distinctItems: items.size,
    distinctCounterparts: counterparts.size,
    medianReplyLatencyHours: round(median(latencies), 2),
    latencyN: latencies.length,
    within24hPct: latencies.length ? round((within24 / latencies.length) * 100, 1) : null,
    medianFollowThroughHours: round(median(ftHours), 2),
    followThroughN: ftHours.length,
    meanQuality: n ? round(qualitySum / n, 3) : null,
    substantiveResponses: substantive,
    prsAuthored: a.prsAuthored,
  };
}

export function isEligible(raw: EngineerRawMetrics): boolean {
  return (
    raw.responses >= ELIGIBILITY.minResponses && raw.distinctItems >= ELIGIBILITY.minDistinctItems
  );
}

export function mostCommonAssociation(a: EngineerAccumulator): string {
  let best = "NONE";
  let bestN = 0;
  for (const [k, n] of a.associations) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

export function avatarUrl(login: string): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=80`;
}

// ---------------------------------------------------------------------------
// Factor definitions
// ---------------------------------------------------------------------------

interface FactorDef {
  key: string;
  label: string;
  weight: number;
  direction: Direction;
  /** Value to rank on (null when n/a). */
  rankValue: (raw: EngineerRawMetrics) => number | null;
  /** Value to display as `raw`. */
  displayValue: (raw: EngineerRawMetrics) => number | null;
  n: (raw: EngineerRawMetrics) => number;
  rawLabel: (raw: EngineerRawMetrics) => string;
  explanation: (raw: EngineerRawMetrics, pct: number | null) => string;
  naNote?: (raw: EngineerRawMetrics) => string;
}

export const FACTOR_DEFS: Record<AlgorithmKey, FactorDef[]> = {
  responsive: [
    {
      key: "responsiveness",
      label: "Responsiveness",
      weight: WEIGHTS.responsive.responsiveness,
      direction: "lower_is_better",
      rankValue: (r) => r.medianReplyLatencyHours,
      displayValue: (r) => r.medianReplyLatencyHours,
      n: (r) => r.latencyN,
      rawLabel: (r) =>
        r.medianReplyLatencyHours === null
          ? "No measurable reply latency"
          : `Median reply ${fmtHours(r.medianReplyLatencyHours)}`,
      explanation: (r, pct) =>
        pct === null
          ? "not scored: every reply was a follow-up or lacked an in-window trigger"
          : `faster than ${fmtPct(pct)}% of eligible peers` +
            (r.within24hPct === null ? "" : `; ${fmtPct(r.within24hPct)}% of replies within 24h`),
      naNote: () => "Responsiveness n/a (no reply with a measurable trigger)",
    },
    {
      key: "volume",
      label: "Volume",
      weight: WEIGHTS.responsive.volume,
      direction: "higher_is_better",
      rankValue: (r) => r.responses,
      displayValue: (r) => r.responses,
      n: (r) => r.responses,
      rawLabel: (r) =>
        `${r.responses} responses across ${r.distinctItems} PR${r.distinctItems === 1 ? "" : "s"} and issues`,
      explanation: (_r, pct) =>
        pct === null ? "not scored" : `more responses than ${fmtPct(pct)}% of eligible peers`,
    },
    {
      key: "followThrough",
      label: "Merge follow-through",
      weight: WEIGHTS.responsive.followThrough,
      direction: "lower_is_better",
      rankValue: (r) =>
        r.followThroughN >= ELIGIBILITY.minMergedPrsForFollowThrough
          ? r.medianFollowThroughHours
          : null,
      displayValue: (r) => r.medianFollowThroughHours,
      n: (r) => r.followThroughN,
      rawLabel: (r) =>
        r.followThroughN >= ELIGIBILITY.minMergedPrsForFollowThrough &&
        r.medianFollowThroughHours !== null
          ? `Last comment lands median ${fmtHours(r.medianFollowThroughHours)} before merge`
          : `Not enough merged PRs (${r.followThroughN} of ${ELIGIBILITY.minMergedPrsForFollowThrough} needed)`,
      explanation: (r, pct) =>
        pct === null
          ? "not scored; weights renormalized across the remaining factors"
          : `closer to merge than ${fmtPct(pct)}% of eligible peers, over ${r.followThroughN} merged PRs`,
      naNote: (r) =>
        `Merge follow-through n/a (${r.followThroughN} merged PRs, fewer than ${ELIGIBILITY.minMergedPrsForFollowThrough})`,
    },
  ],
  constructive: [
    {
      key: "quality",
      label: "Quality",
      weight: WEIGHTS.constructive.quality,
      direction: "higher_is_better",
      rankValue: (r) =>
        r.responses >= ELIGIBILITY.minCommentsForQuality ? r.meanQuality : null,
      displayValue: (r) => r.meanQuality,
      n: (r) => r.responses,
      rawLabel: (r) =>
        r.meanQuality === null
          ? "No comments to score"
          : `Mean comment quality ${r.meanQuality.toFixed(2)} of 1.00`,
      explanation: (r, pct) =>
        pct === null
          ? `not scored: fewer than ${ELIGIBILITY.minCommentsForQuality} comments`
          : `more substantive than ${fmtPct(pct)}% of eligible peers, over ${r.responses} responses`,
      naNote: (r) =>
        `Quality n/a (${r.responses} comments, fewer than ${ELIGIBILITY.minCommentsForQuality})`,
    },
    {
      key: "substantiveVolume",
      label: "Substantive volume",
      weight: WEIGHTS.constructive.substantiveVolume,
      direction: "higher_is_better",
      rankValue: (r) => Math.log1p(r.substantiveResponses),
      displayValue: (r) => r.substantiveResponses,
      n: (r) => r.substantiveResponses,
      rawLabel: (r) =>
        `${r.substantiveResponses} substantive responses (quality ≥ ${QUALITY.substantiveThreshold})`,
      explanation: (_r, pct) =>
        pct === null ? "not scored" : `more than ${fmtPct(pct)}% of eligible peers`,
    },
    {
      key: "breadth",
      label: "Breadth",
      weight: WEIGHTS.constructive.breadth,
      direction: "higher_is_better",
      rankValue: (r) => r.distinctCounterparts,
      displayValue: (r) => r.distinctCounterparts,
      n: (r) => r.distinctCounterparts,
      rawLabel: (r) =>
        `Responded to ${r.distinctCounterparts} different ${r.distinctCounterparts === 1 ? "person" : "people"}'s work`,
      explanation: (_r, pct) =>
        pct === null ? "not scored" : `broader reach than ${fmtPct(pct)}% of eligible peers`,
    },
  ],
};

// ---------------------------------------------------------------------------
// Scoring across engineers
// ---------------------------------------------------------------------------

export interface ScoredEngineerInput {
  login: string;
  raw: EngineerRawMetrics;
}

/**
 * Compute AlgorithmResult (without rank) for every eligible engineer, with
 * percentiles taken among eligible engineers only. Returns a map by login.
 */
export function scoreAlgorithm(
  key: AlgorithmKey,
  eligible: ScoredEngineerInput[],
): Map<string, AlgorithmResult> {
  const defs = FACTOR_DEFS[key];
  const pctByFactor = defs.map((d) =>
    percentileRanks(
      eligible.map((e) => d.rankValue(e.raw)),
      d.direction,
    ),
  );

  const results = new Map<string, AlgorithmResult>();
  eligible.forEach((e, i) => {
    const available = defs.filter((_d, fi) => pctByFactor[fi][i] !== null);
    const weightSum = available.reduce((s, d) => s + d.weight, 0);
    const notes: string[] = [];
    let composite = 0;
    const factors: FactorScore[] = defs.map((d, fi) => {
      const pct = pctByFactor[fi][i];
      const effWeight = pct === null || weightSum === 0 ? 0 : d.weight / weightSum;
      if (pct !== null) composite += effWeight * pct;
      if (pct === null && d.naNote) notes.push(d.naNote(e.raw));
      return {
        key: d.key,
        label: d.label,
        weight: round(effWeight, 4) ?? 0,
        percentile: pct,
        raw: d.displayValue(e.raw),
        rawLabel: d.rawLabel(e.raw),
        explanation: d.explanation(e.raw, pct),
        n: d.n(e.raw),
        direction: d.direction,
      };
    });
    let note: string | undefined;
    if (available.length < defs.length) {
      const renorm = available.map((d) => `${d.label} ${(d.weight / weightSum).toFixed(2)}`).join(" / ");
      note = `${notes.join("; ")}; weights renormalized to ${renorm}`;
    }
    results.set(e.login, {
      composite: round(composite, 1) ?? 0,
      rank: 0, // filled by assignRanks
      factors,
      ...(note ? { note } : {}),
    });
  });
  return results;
}

/** Assign 1-based ranks by composite desc (ties: more responses, then login). */
export function assignRanks(
  results: Map<string, AlgorithmResult>,
  rawByLogin: Map<string, EngineerRawMetrics>,
): void {
  const logins = [...results.keys()].sort((a, b) => {
    const ra = results.get(a)!;
    const rb = results.get(b)!;
    if (rb.composite !== ra.composite) return rb.composite - ra.composite;
    const na = rawByLogin.get(a)?.responses ?? 0;
    const nb = rawByLogin.get(b)?.responses ?? 0;
    if (nb !== na) return nb - na;
    return a.localeCompare(b);
  });
  logins.forEach((login, i) => {
    results.get(login)!.rank = i + 1;
  });
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

// Lone UTF-16 surrogates (e.g. from a truncated emoji) are invalid JSON for
// Postgres, so every string that reaches the payload is scrubbed.
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function safeText(s: string): string {
  return (s ?? "").replace(LONE_SURROGATE_RE, "");
}

export function excerpt(body: string, event?: EventRow): string {
  const collapsed = safeText(body).replace(/\s+/g, " ").trim();
  if (collapsed.length === 0 && event?.kind === "review") {
    const state = (event.reviewState ?? "").toLowerCase().replace(/_/g, " ");
    return state ? `(${state} without a comment)` : "";
  }
  if (collapsed.length <= EXCERPT_CHARS) return collapsed;
  // Slice by code point so a surrogate pair is never split, then re-check
  // the UTF-16 length that EXCERPT_CHARS is expressed in.
  let cut = Array.from(collapsed).slice(0, EXCERPT_CHARS - 1).join("");
  while (cut.length > EXCERPT_CHARS - 1) cut = Array.from(cut).slice(0, -1).join("");
  return cut.trimEnd() + "…";
}

function toEvidence(r: ScoredResponse): EvidenceItem {
  return {
    url: r.event.url,
    itemNumber: r.item.number,
    itemTitle: safeText(r.item.title),
    itemKind: r.item.kind,
    eventKind: r.event.kind,
    createdAt: r.event.createdAt,
    excerpt: excerpt(r.event.body, r.event),
  };
}

export function buildEvidence(a: EngineerAccumulator): EngineerScore["evidence"] {
  const fastest = a.responses
    .filter((r) => r.latencyHours !== null)
    .sort(
      (x, y) =>
        (x.latencyHours as number) - (y.latencyHours as number) ||
        Date.parse(y.event.createdAt) - Date.parse(x.event.createdAt),
    )
    .slice(0, EVIDENCE_PER_ENGINEER)
    .map((r) => ({ ...toEvidence(r), latencyHours: round(r.latencyHours, 2) ?? 0 }));

  const best = [...a.responses]
    .sort(
      (x, y) =>
        y.quality.q - x.quality.q ||
        y.quality.features.words - x.quality.features.words ||
        Date.parse(y.event.createdAt) - Date.parse(x.event.createdAt),
    )
    .slice(0, EVIDENCE_PER_ENGINEER)
    .map((r) => ({ ...toEvidence(r), quality: r.quality.q }));

  return { fastestReplies: fastest, bestComments: best };
}

// ---------------------------------------------------------------------------
// Everything together
// ---------------------------------------------------------------------------

export interface ScoringOutput {
  /** Every human engineer with at least one response, sorted by login. */
  all: EngineerScore[];
  /** Eligible engineers only, sorted by Algorithm A rank. */
  eligible: EngineerScore[];
}

export function scoreEngineers(
  items: ItemRow[],
  events: EventRow[],
  windowStart: string,
): ScoringOutput {
  const accs = aggregateEngineers(items, events, windowStart);
  const rawByLogin = new Map<string, EngineerRawMetrics>();
  for (const a of accs) rawByLogin.set(a.login, rawMetrics(a));

  const eligibleInputs: ScoredEngineerInput[] = accs
    .map((a) => ({ login: a.login, raw: rawByLogin.get(a.login)! }))
    .filter((e) => isEligible(e.raw));

  const byAlgorithm: Record<AlgorithmKey, Map<string, AlgorithmResult>> = {
    responsive: scoreAlgorithm("responsive", eligibleInputs),
    constructive: scoreAlgorithm("constructive", eligibleInputs),
  };
  assignRanks(byAlgorithm.responsive, rawByLogin);
  assignRanks(byAlgorithm.constructive, rawByLogin);

  const all: EngineerScore[] = accs.map((a) => {
    const raw = rawByLogin.get(a.login)!;
    const eligible = isEligible(raw);
    return {
      login: a.login,
      avatarUrl: avatarUrl(a.login),
      association: mostCommonAssociation(a),
      eligible,
      raw,
      algorithms: {
        responsive: eligible ? byAlgorithm.responsive.get(a.login)! : null,
        constructive: eligible ? byAlgorithm.constructive.get(a.login)! : null,
      },
      evidence: buildEvidence(a),
    };
  });

  const eligible = all
    .filter((e) => e.eligible)
    .sort((a, b) => a.algorithms.responsive!.rank - b.algorithms.responsive!.rank);

  return { all, eligible };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function round(v: number | null | undefined, digits: number): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function fmtHours(h: number): string {
  if (h >= LATENCY_CAP_HOURS) return `${LATENCY_CAP_HOURS / 24}d+ (capped)`;
  if (h < 1) return `${Math.round(h * 60)}m`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

export function fmtPct(p: number): string {
  return Number.isInteger(p) ? String(p) : p.toFixed(0);
}
