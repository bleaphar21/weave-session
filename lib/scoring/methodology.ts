/**
 * Methodology text for the "How it's scored" panel, generated from the same
 * constants the scorer uses so the panel can never drift from the numbers.
 */

import {
  BOT_LOGIN_DENYLIST,
  ELIGIBILITY,
  LATENCY_CAP_HOURS,
  QUALITY,
  WEIGHTS,
  WINDOW_DAYS,
} from "../config";
import type { AlgorithmKey, AlgorithmMethodology, MethodologyFactor } from "../types";

const w2 = (w: number) => w.toFixed(2);

const SHARED_DEFINITIONS: string[] = [
  "Response event: a human's issue comment, inline review comment, or review (APPROVED, CHANGES_REQUESTED, DISMISSED, or COMMENTED with a non-empty body) on a PR or issue. Empty COMMENTED reviews are dropped because they are only containers for inline comments, which are counted separately.",
  "Trigger for a response at time t on item I: the most recent human event on I before t by someone other than the responder, or the item's creation if there is none. Bot events never count as triggers.",
  `Reply latency: t minus the trigger time, capped at ${LATENCY_CAP_HOURS / 24} days. Excluded when the immediately previous human event on the item is by the same person (a follow-up, not a reply), when the item predates the window and no in-window trigger exists, or when the trigger is the creation of a draft PR. Volume still counts these.`,
  "An author's comment on their own PR or issue counts as a response only when it replies to another human who has already commented.",
  `Human: GitHub user type is User and the login is not on the bot denylist (matches [bot], ends in "bot", or is one of: ${BOT_LOGIN_DENYLIST.join(", ")}).`,
  `Window: ${WINDOW_DAYS} days ending at ingest time. Items are included if created or updated in the window; only events created in the window are stored.`,
  "External contributors are included and labeled with their author association (MEMBER, CONTRIBUTOR, etc.). PRs authored are shown as context only and are not part of either score.",
];

const SHARED_THRESHOLDS: string[] = [
  `Eligibility: at least ${ELIGIBILITY.minResponses} responses and at least ${ELIGIBILITY.minDistinctItems} distinct PRs or issues in the window.`,
  "Each factor is a percentile rank 0-100 among eligible engineers (ties share the average rank; a percentile of 92 reads as better than 92% of eligible peers).",
];

const SHARED_LIMITATIONS: string[] = [
  "Latency is wall-clock, so weekends and time zones inflate it. Median blunts this but does not remove it.",
  'First-response latency on a PR is measured from PR creation, not from "ready for review" or from a review request. Draft PRs are flagged and their creation-to-first-response latency is excluded.',
  "Algorithm B rewards length and structure as proxies for substance. A long unhelpful comment scores well; a terse brilliant one scores poorly.",
  "Comments in Slack, pairing sessions, and design docs are invisible.",
];

function responsiveFactors(): MethodologyFactor[] {
  return [
    {
      key: "responsiveness",
      label: "Responsiveness",
      weight: WEIGHTS.responsive.responsiveness,
      metric: "Median reply latency (hours) across the engineer's responses",
      direction: "lower_is_better",
    },
    {
      key: "volume",
      label: "Volume",
      weight: WEIGHTS.responsive.volume,
      metric: "Number of responses (comments, inline review comments, reviews)",
      direction: "higher_is_better",
    },
    {
      key: "followThrough",
      label: "Merge follow-through",
      weight: WEIGHTS.responsive.followThrough,
      metric:
        "Median time from the engineer's last comment on a PR (not their own) to that PR merging",
      direction: "lower_is_better",
    },
  ];
}

function constructiveFactors(): MethodologyFactor[] {
  return [
    {
      key: "quality",
      label: "Quality",
      weight: WEIGHTS.constructive.quality,
      metric: "Mean per-comment quality q (0-1) across the engineer's responses",
      direction: "higher_is_better",
    },
    {
      key: "substantiveVolume",
      label: "Substantive volume",
      weight: WEIGHTS.constructive.substantiveVolume,
      metric: `log(1 + count of responses with q ≥ ${QUALITY.substantiveThreshold})`,
      direction: "higher_is_better",
    },
    {
      key: "breadth",
      label: "Breadth",
      weight: WEIGHTS.constructive.breadth,
      metric: "Distinct people whose PRs or issues the engineer responded on",
      direction: "higher_is_better",
    },
  ];
}

export function buildMethodology(): Record<AlgorithmKey, AlgorithmMethodology> {
  const rw = WEIGHTS.responsive;
  const cw = WEIGHTS.constructive;
  const renormA = rw.responsiveness / (rw.responsiveness + rw.volume);
  const renormV = rw.volume / (rw.responsiveness + rw.volume);

  return {
    responsive: {
      key: "responsive",
      title: "Responsive Collaborator",
      summary:
        "The engineers with the most impact are the ones who unblock other people: they respond quickly, respond often, and their feedback lands close to merge.",
      formula: `composite = ${w2(rw.responsiveness)} × R + ${w2(rw.volume)} × V + ${w2(rw.followThrough)} × M (each a percentile rank 0-100 among eligible engineers)`,
      factors: responsiveFactors(),
      definitions: [
        ...SHARED_DEFINITIONS,
        `Merge follow-through: for each merged PR the engineer commented on but did not author, merged_at minus the engineer's last event before merge, capped at ${LATENCY_CAP_HOURS / 24} days; the factor is the median over those PRs.`,
      ],
      thresholds: [
        ...SHARED_THRESHOLDS,
        `Merge follow-through needs at least ${ELIGIBILITY.minMergedPrsForFollowThrough} merged PRs; otherwise the weights renormalize to ${w2(renormA)} / ${w2(renormV)} and the card says so.`,
      ],
      limitations: SHARED_LIMITATIONS,
    },
    constructive: {
      key: "constructive",
      title: "Constructive Communicator",
      summary:
        "Non-sentiment, rule-based scoring of each comment's substance: does this comment give the reader something to act on? No LLM, no positivity or negativity.",
      formula: `composite = ${w2(cw.quality)} × rank(quality) + ${w2(cw.substantiveVolume)} × rank(substantive volume) + ${w2(cw.breadth)} × rank(breadth) (each a percentile rank 0-100 among eligible engineers)`,
      factors: constructiveFactors(),
      definitions: [
        ...SHARED_DEFINITIONS,
        `Per-comment quality q (0-1) adds: substance ${QUALITY.substance} (≥${QUALITY.substanceFullWords} words after stripping quotes and code → full, ${QUALITY.substanceHalfWords}-${QUALITY.substanceFullWords - 1} words → half); code ${QUALITY.code} (fenced code block or GitHub suggestion); reference ${QUALITY.reference} (URL, #1234, or file path / line reference); question ${QUALITY.question} (at least one "?"); actionable phrasing ${QUALITY.actionable} (should / could / consider / suggest / instead / what if / nit / let's / we can / try); rationale ${QUALITY.rationale} (because / since / so that / otherwise / leads to / this causes).`,
        "Ritual-only override: a body that is only lgtm / +1 / thanks / done / nice / emoji is forced to q = 0.",
      ],
      thresholds: [
        ...SHARED_THRESHOLDS,
        `A response is substantive when q ≥ ${QUALITY.substantiveThreshold}.`,
        `Quality needs at least ${ELIGIBILITY.minCommentsForQuality} comments; otherwise the weights renormalize across the remaining factors and the card says so.`,
      ],
      limitations: SHARED_LIMITATIONS,
    },
  };
}
