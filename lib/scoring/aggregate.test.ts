import { describe, expect, it } from "vitest";
import { ELIGIBILITY, EVIDENCE_PER_ENGINEER, EXCERPT_CHARS, WEIGHTS } from "../config";
import type { EventRow, ItemRow } from "../types";
import { excerpt, scoreAlgorithm, scoreEngineers, type ScoredEngineerInput } from "./aggregate";
import { buildDashboardData } from "./index";
import { ev, generateSynthetic, h, item, meta, WINDOW_START } from "./testing/fixtures";

const rawOf = (over: Partial<ScoredEngineerInput["raw"]> = {}): ScoredEngineerInput["raw"] => ({
  responses: 30,
  distinctItems: 15,
  distinctCounterparts: 8,
  medianReplyLatencyHours: 2,
  latencyN: 20,
  within24hPct: 90,
  medianFollowThroughHours: 5,
  followThroughN: 6,
  meanQuality: 0.4,
  substantiveResponses: 12,
  prsAuthored: 3,
  ...over,
});

describe("scoreAlgorithm: weights and renormalization", () => {
  it("composite is the weighted sum of percentiles with full weights when all factors exist", () => {
    const res = scoreAlgorithm("responsive", [
      { login: "fast", raw: rawOf({ medianReplyLatencyHours: 1, responses: 50, medianFollowThroughHours: 1 }) },
      { login: "mid", raw: rawOf({ medianReplyLatencyHours: 2, responses: 40, medianFollowThroughHours: 2 }) },
      { login: "slow", raw: rawOf({ medianReplyLatencyHours: 3, responses: 30, medianFollowThroughHours: 3 }) },
    ]);
    const fast = res.get("fast")!;
    expect(fast.composite).toBe(100);
    expect(fast.note).toBeUndefined();
    expect(fast.factors.map((f) => f.weight)).toEqual([
      WEIGHTS.responsive.responsiveness,
      WEIGHTS.responsive.volume,
      WEIGHTS.responsive.followThrough,
    ]);
    const mid = res.get("mid")!;
    expect(mid.composite).toBe(50);
    expect(res.get("slow")!.composite).toBe(0);
  });

  it("renormalizes to 0.5/0.5 and adds a note when follow-through has too few merged PRs", () => {
    const res = scoreAlgorithm("responsive", [
      { login: "a", raw: rawOf({ followThroughN: ELIGIBILITY.minMergedPrsForFollowThrough - 1, medianReplyLatencyHours: 1, responses: 50 }) },
      { login: "b", raw: rawOf({ medianReplyLatencyHours: 2, responses: 40, medianFollowThroughHours: 4 }) },
      { login: "c", raw: rawOf({ medianReplyLatencyHours: 3, responses: 30, medianFollowThroughHours: 6 }) },
    ]);
    const a = res.get("a")!;
    expect(a.note).toMatch(/follow-through n\/a/i);
    expect(a.note).toMatch(/renormalized/);
    const ft = a.factors.find((f) => f.key === "followThrough")!;
    expect(ft.percentile).toBeNull();
    expect(ft.weight).toBe(0);
    expect(a.factors.find((f) => f.key === "responsiveness")!.weight).toBe(0.5);
    expect(a.factors.find((f) => f.key === "volume")!.weight).toBe(0.5);
    expect(a.composite).toBe(100);
    // Others keep full weights, and follow-through percentiles are ranked among the two that have it.
    const b = res.get("b")!;
    expect(b.note).toBeUndefined();
    expect(b.factors.find((f) => f.key === "followThrough")!.percentile).toBe(100);
  });

  it("every FactorScore has non-empty rawLabel/explanation and percentiles in 0-100", () => {
    const inputs: ScoredEngineerInput[] = Array.from({ length: 12 }, (_, i) => ({
      login: `e${i}`,
      raw: rawOf({
        medianReplyLatencyHours: i % 2 === 0 ? null : i + 0.5,
        latencyN: i % 2 === 0 ? 0 : 10,
        responses: 20 + (i % 4),
        followThroughN: i % 3,
        medianFollowThroughHours: i % 3 ? 4 : null,
        meanQuality: (i % 5) / 10,
        substantiveResponses: i,
        distinctCounterparts: i % 4,
      }),
    }));
    for (const key of ["responsive", "constructive"] as const) {
      const res = scoreAlgorithm(key, inputs);
      for (const r of res.values()) {
        expect(r.composite).toBeGreaterThanOrEqual(0);
        expect(r.composite).toBeLessThanOrEqual(100);
        expect(r.factors).toHaveLength(3);
        const wsum = r.factors.reduce((s, f) => s + f.weight, 0);
        expect(wsum).toBeCloseTo(1, 3);
        for (const f of r.factors) {
          expect(f.rawLabel.length).toBeGreaterThan(0);
          expect(f.explanation.length).toBeGreaterThan(0);
          if (f.percentile !== null) {
            expect(f.percentile).toBeGreaterThanOrEqual(0);
            expect(f.percentile).toBeLessThanOrEqual(100);
          } else {
            expect(f.weight).toBe(0);
          }
        }
      }
    }
  });

  it("constructive ranks substantive volume identically whether or not log is applied", () => {
    const res = scoreAlgorithm("constructive", [
      { login: "a", raw: rawOf({ substantiveResponses: 1 }) },
      { login: "b", raw: rawOf({ substantiveResponses: 10 }) },
      { login: "c", raw: rawOf({ substantiveResponses: 100 }) },
    ]);
    const pct = (l: string) => res.get(l)!.factors.find((f) => f.key === "substantiveVolume")!.percentile;
    expect([pct("a"), pct("b"), pct("c")]).toEqual([0, 50, 100]);
    expect(res.get("c")!.factors.find((f) => f.key === "substantiveVolume")!.raw).toBe(100);
  });
});

describe("excerpt", () => {
  it("collapses whitespace and stays within EXCERPT_CHARS", () => {
    const long = "word ".repeat(200);
    const e = excerpt(long);
    expect(e.length).toBeLessThanOrEqual(EXCERPT_CHARS);
    expect(e.endsWith("…")).toBe(true);
    expect(excerpt("a\n\n  b\tc")).toBe("a b c");
  });
  it("describes empty approvals", () => {
    expect(excerpt("", ev({ itemNumber: 1, authorLogin: "x", createdAt: h(1), kind: "review", reviewState: "APPROVED", body: "" }))).toContain("approved");
  });
});

describe("scoreEngineers end to end (hand-built)", () => {
  function buildFixture(): { items: ItemRow[]; events: EventRow[] } {
    const items: ItemRow[] = [];
    const events: EventRow[] = [];
    // 12 PRs by "author", merged 24h after creation; reviewer "fast" replies in 1h,
    // "slow" in 10h, both on every PR. "sparse" replies on 2 PRs only.
    for (let n = 1; n <= 12; n++) {
      items.push(item({ number: n, authorLogin: "author", createdAt: h(n * 100), mergedAt: h(n * 100 + 24) }));
      events.push(ev({ itemNumber: n, authorLogin: "fast", createdAt: h(n * 100 + 1), body: "Could we add a test for this because it touches billing? See #42." }));
      events.push(ev({ itemNumber: n, authorLogin: "fast", createdAt: h(n * 100 + 1.5), body: "LGTM" })); // follow-up, ritual
      events.push(ev({ itemNumber: n, authorLogin: "slow", createdAt: h(n * 100 + 10), kind: "review", reviewState: "APPROVED", body: "" }));
      events.push(ev({ itemNumber: n, authorLogin: "author", createdAt: h(n * 100 + 12), body: "Done, thanks!" }));
      if (n <= 2) events.push(ev({ itemNumber: n, authorLogin: "sparse", createdAt: h(n * 100 + 2) }));
    }
    return { items, events };
  }

  it("computes raw metrics, eligibility, ranks and evidence", () => {
    const { items, events } = buildFixture();
    const { all, eligible } = scoreEngineers(items, events, WINDOW_START);
    const logins = all.map((e) => e.login);
    expect(logins).toEqual(["author", "fast", "slow", "sparse"]);

    const fast = all.find((e) => e.login === "fast")!;
    expect(fast.raw.responses).toBe(24);
    expect(fast.raw.distinctItems).toBe(12);
    expect(fast.raw.distinctCounterparts).toBe(1);
    expect(fast.raw.latencyN).toBe(12); // follow-ups excluded
    expect(fast.raw.medianReplyLatencyHours).toBe(1);
    expect(fast.raw.within24hPct).toBe(100);
    expect(fast.raw.followThroughN).toBe(12);
    expect(fast.raw.medianFollowThroughHours).toBe(22.5);
    expect(fast.raw.substantiveResponses).toBe(12);
    expect(fast.raw.meanQuality).toBeGreaterThan(0);
    expect(fast.eligible).toBe(true);
    expect(fast.association).toBe("MEMBER");
    expect(fast.avatarUrl).toBe("https://github.com/fast.png?size=80");

    const slow = all.find((e) => e.login === "slow")!;
    expect(slow.raw.responses).toBe(12); // < minResponses
    expect(slow.eligible).toBe(false);
    expect(slow.algorithms.responsive).toBeNull();

    const author = all.find((e) => e.login === "author")!;
    expect(author.raw.responses).toBe(12); // replies to slow's approval
    expect(author.raw.prsAuthored).toBe(12);
    expect(author.raw.followThroughN).toBe(0);
    expect(author.eligible).toBe(false);

    expect(all.find((e) => e.login === "sparse")!.eligible).toBe(false);

    expect(eligible.map((e) => e.login)).toEqual(["fast"]);
    const res = fast.algorithms.responsive!;
    expect(res.rank).toBe(1);
    expect(res.composite).toBe(100); // n=1 -> 100 on every factor
    expect(fast.algorithms.constructive!.rank).toBe(1);

    expect(fast.evidence.fastestReplies).toHaveLength(EVIDENCE_PER_ENGINEER);
    expect(fast.evidence.fastestReplies[0].latencyHours).toBe(1);
    expect(fast.evidence.fastestReplies[0].url).toMatch(/^https:\/\/github\.com\//);
    expect(fast.evidence.bestComments).toHaveLength(EVIDENCE_PER_ENGINEER);
    expect(fast.evidence.bestComments[0].quality).toBeGreaterThan(0.4);
    expect(fast.evidence.bestComments[0].itemTitle).toMatch(/^Item #/);
  });
});

describe("buildDashboardData on synthetic data", () => {
  it("produces a well-formed DashboardData with consistent ranks", () => {
    const { items, events, meta: m } = generateSynthetic({ seed: 7, engineers: 30, items: 400 });
    const data = buildDashboardData(items, events, meta(m));
    expect(data.repo).toBe("PostHog/posthog");
    expect(data.window.days).toBe(90);
    expect(data.counts.items).toBe(items.length);
    expect(data.counts.eligibleEngineers).toBe(data.engineers.length);
    expect(data.counts.humanEngineers).toBeGreaterThanOrEqual(data.counts.eligibleEngineers);
    expect(data.counts.botAccountsExcluded).toBe(3);
    expect(data.excludedLogins).toEqual([...m.botLoginsSeen].sort());
    expect(data.engineers.length).toBeGreaterThan(3);
    expect(Object.keys(data.methodology).sort()).toEqual(["constructive", "responsive"]);

    for (const key of ["responsive", "constructive"] as const) {
      const sorted = [...data.engineers].sort((a, b) => b.algorithms[key]!.composite - a.algorithms[key]!.composite);
      const ranks = [...data.engineers].sort((a, b) => a.algorithms[key]!.rank - b.algorithms[key]!.rank);
      expect(ranks.map((e) => e.algorithms[key]!.rank)).toEqual(ranks.map((_, i) => i + 1));
      // composite ordering matches ranks (ties allowed)
      for (let i = 1; i < ranks.length; i++) {
        expect(ranks[i - 1].algorithms[key]!.composite).toBeGreaterThanOrEqual(ranks[i].algorithms[key]!.composite);
      }
      expect(sorted[0].algorithms[key]!.composite).toBe(ranks[0].algorithms[key]!.composite);
      for (const e of data.engineers) {
        expect(e.eligible).toBe(true);
        for (const f of e.algorithms[key]!.factors) {
          expect(f.rawLabel).not.toBe("");
          expect(f.explanation).not.toBe("");
          if (f.percentile !== null) {
            expect(f.percentile).toBeGreaterThanOrEqual(0);
            expect(f.percentile).toBeLessThanOrEqual(100);
          }
        }
        for (const ev of [...e.evidence.fastestReplies, ...e.evidence.bestComments]) {
          expect(ev.url).toMatch(/^https:\/\/github\.com\//);
          expect(ev.excerpt.length).toBeLessThanOrEqual(EXCERPT_CHARS);
        }
      }
    }
    // Should survive JSON round-trip unchanged.
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("defensively drops bot events that slipped through ingestion", () => {
    const { items, events, meta: m } = generateSynthetic({ seed: 3, engineers: 10, items: 50 });
    const withBot = [...events, ev({ itemNumber: 1, authorLogin: "sneaky-bot", createdAt: h(1) })];
    const data = buildDashboardData(items, withBot, meta({ ...m, botLoginsSeen: [] }));
    expect(data.excludedLogins).toContain("sneaky-bot");
    expect(data.counts.botEventsExcluded).toBe((m.counts.botEventsExcluded ?? 0) + 1);
    expect(data.counts.events).toBe(events.length);
  });
});
