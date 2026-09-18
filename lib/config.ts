/**
 * Single source of truth for tunable constants. Both algorithms, the ingest
 * filters and the methodology panel read from here so the UI always describes
 * exactly what was computed.
 */

export const REPO = { owner: "PostHog", name: "posthog" } as const;
export const REPO_FULL = `${REPO.owner}/${REPO.name}`;

export const WINDOW_DAYS = 90;

/** GitHub App slugs excluded at search time via `-author:app/<slug>`. */
export const SEARCH_EXCLUDED_APPS = ["trunk-io", "posthog"] as const;

/**
 * Logins treated as bots regardless of GitHub's `type` field. Matching is
 * case-insensitive. Any login whose type is "Bot", ends with "[bot]", or ends
 * with "bot" is also excluded (see isBotLogin).
 */
export const BOT_LOGIN_DENYLIST = [
  "posthog-bot",
  "posthog",
  "copilot",
  "trunk-io",
  "coderabbitai",
  "greptile-apps",
  "github-actions",
  "dependabot",
  "renovate",
  "hosthog",
  "deployment-status-posthog",
  "vercel",
  "codecov",
  "sentry-io",
  "cursor",
  "devin-ai-integration",
  "claude",
] as const;

export function isBotLogin(login: string, userType?: string | null): boolean {
  const l = login.toLowerCase();
  if (userType === "Bot") return true;
  if (l.endsWith("[bot]")) return true;
  if (l.endsWith("bot")) return true;
  return (BOT_LOGIN_DENYLIST as readonly string[]).includes(l);
}

/**
 * Comments posted through a human's account but self-declared as automated
 * (PostHog runs agent tooling such as "QA Swarm", "Review Triage" and
 * "PR Shepherd" under personal logins). Matched case-insensitively against
 * the comment body; matching events are excluded like bot events.
 */
export const AUTOMATED_BODY_MARKERS: readonly RegExp[] = [
  /not written by a human/i,
  /automated comment by/i,
  /^\s*(?:>\s*)?AI reply:/i,
];

export function isAutomatedBody(body: string | null | undefined): boolean {
  if (!body) return false;
  return AUTOMATED_BODY_MARKERS.some((re) => re.test(body));
}

export const ELIGIBILITY = {
  minResponses: 20,
  minDistinctItems: 10,
  minMergedPrsForFollowThrough: 5,
  minCommentsForQuality: 20,
} as const;

export const WEIGHTS = {
  responsive: { responsiveness: 0.4, volume: 0.4, followThrough: 0.2 },
  constructive: { quality: 0.5, substantiveVolume: 0.3, breadth: 0.2 },
} as const;

/** Algorithm B per-comment feature points; sum of points is 1.0. */
export const QUALITY = {
  substance: 0.3,
  code: 0.2,
  reference: 0.15,
  question: 0.1,
  actionable: 0.15,
  rationale: 0.1,
  substanceFullWords: 15,
  substanceHalfWords: 5,
  substantiveThreshold: 0.4,
} as const;

/** Cap on reply latency and follow-through deltas before taking the median. */
export const LATENCY_CAP_HOURS = 14 * 24;

export const EVIDENCE_PER_ENGINEER = 3;
export const EXCERPT_CHARS = 240;
