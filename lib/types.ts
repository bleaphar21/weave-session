/**
 * Shared contracts between ingestion (scripts/ingest.ts), scoring/backend
 * (lib/scoring, scripts/score.ts, lib/data.ts) and the frontend (app/).
 *
 * Rules: additive changes only. Never rename or remove a field without
 * coordinating across all three worktrees.
 */

export type AlgorithmKey = "responsive" | "constructive";
export type ItemKind = "pr" | "issue";
export type EventKind = "issue_comment" | "review_comment" | "review";
export type Direction = "lower_is_better" | "higher_is_better";

// ---------------------------------------------------------------------------
// Raw rows (what ingestion writes, what scoring reads). Mirrors db/schema.sql.
// ---------------------------------------------------------------------------

export interface ItemRow {
  number: number;
  kind: ItemKind;
  authorLogin: string;
  authorAssociation: string | null;
  title: string;
  url: string;
  createdAt: string; // ISO
  mergedAt: string | null;
  closedAt: string | null;
  isDraft: boolean;
  additions: number | null;
  deletions: number | null;
}

export interface EventRow {
  id: string; // globally unique: `${kind}:${githubId}`
  itemNumber: number;
  kind: EventKind;
  reviewState: string | null; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | null
  authorLogin: string;
  authorAssociation: string | null;
  createdAt: string; // ISO
  body: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Scored output (what scoring writes to engineer_scores + data/snapshot.json,
// what the page renders).
// ---------------------------------------------------------------------------

export interface FactorScore {
  key: string; // 'responsiveness' | 'volume' | 'followThrough' | 'quality' | 'substantiveVolume' | 'breadth'
  label: string; // 'Responsiveness'
  weight: number; // effective weight used after any renormalization
  percentile: number | null; // 0-100 among eligible peers; null when n/a
  raw: number | null; // underlying metric value
  rawLabel: string; // 'Median reply 1.4h'
  explanation: string; // 'faster than 91% of eligible peers'
  n: number; // sample size behind raw
  direction: Direction;
}

export interface AlgorithmResult {
  composite: number; // 0-100
  rank: number; // 1-based among eligible engineers for this algorithm
  factors: FactorScore[];
  note?: string; // e.g. 'Merge follow-through n/a (fewer than 5 merged PRs); weights renormalized to 0.5/0.5'
}

export interface EvidenceItem {
  url: string;
  itemNumber: number;
  itemTitle: string;
  itemKind: ItemKind;
  eventKind: EventKind;
  createdAt: string; // ISO
  excerpt: string; // first ~240 chars of body, whitespace-collapsed
  latencyHours?: number; // present for fastestReplies
  quality?: number; // present for bestComments, 0-1
}

export interface EngineerRawMetrics {
  responses: number;
  distinctItems: number;
  distinctCounterparts: number; // distinct authors of items responded on (excluding self)
  medianReplyLatencyHours: number | null;
  latencyN: number;
  within24hPct: number | null; // share of latency-eligible replies under 24h
  medianFollowThroughHours: number | null;
  followThroughN: number;
  meanQuality: number | null; // 0-1
  substantiveResponses: number; // quality >= QUALITY.substantiveThreshold
  prsAuthored: number; // context only, not scored
}

export interface EngineerScore {
  login: string;
  avatarUrl: string;
  association: string; // most common author_association seen for this login
  eligible: boolean;
  raw: EngineerRawMetrics;
  algorithms: Record<AlgorithmKey, AlgorithmResult | null>; // null when not eligible
  evidence: {
    fastestReplies: EvidenceItem[]; // up to 3
    bestComments: EvidenceItem[]; // up to 3
  };
}

export interface MethodologyFactor {
  key: string;
  label: string;
  weight: number;
  metric: string; // plain-English description of the raw metric
  direction: Direction;
}

export interface AlgorithmMethodology {
  key: AlgorithmKey;
  title: string; // 'Responsive Collaborator'
  summary: string; // one or two sentences
  formula: string; // 'composite = 0.40 × R + 0.40 × V + 0.20 × M (each a percentile rank 0-100)'
  factors: MethodologyFactor[];
  definitions: string[]; // response event, trigger, latency...
  thresholds: string[];
  limitations: string[];
}

export interface DashboardCounts {
  humanEngineers: number;
  eligibleEngineers: number;
  botAccountsExcluded: number;
  botEventsExcluded: number;
  items: number;
  prs: number;
  issues: number;
  mergedPrs: number;
  events: number;
}

export interface DashboardData {
  generatedAt: string; // ISO
  repo: string; // 'PostHog/posthog'
  window: { start: string; end: string; days: number };
  counts: DashboardCounts;
  excludedLogins: string[]; // bot logins actually seen and dropped
  methodology: Record<AlgorithmKey, AlgorithmMethodology>;
  engineers: EngineerScore[]; // eligible engineers only; frontend sorts per algorithm
}
