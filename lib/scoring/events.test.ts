import { describe, expect, it } from "vitest";
import { LATENCY_CAP_HOURS } from "../config";
import { computeFollowThrough, computeResponses, groupEventsByItem, isResponseEvent, median } from "./events";
import { ev, h, item, WINDOW_START } from "./testing/fixtures";

const byLogin = (rs: ReturnType<typeof computeResponses>, login: string) =>
  rs.filter((r) => r.event.authorLogin === login);

describe("isResponseEvent", () => {
  it("keeps comments and non-empty or decisive reviews, drops empty COMMENTED reviews and bots", () => {
    expect(isResponseEvent(ev({ itemNumber: 1, authorLogin: "a", createdAt: h(1) }))).toBe(true);
    expect(isResponseEvent(ev({ itemNumber: 1, authorLogin: "a", createdAt: h(1), kind: "review", reviewState: "APPROVED", body: "" }))).toBe(true);
    expect(isResponseEvent(ev({ itemNumber: 1, authorLogin: "a", createdAt: h(1), kind: "review", reviewState: "CHANGES_REQUESTED", body: "" }))).toBe(true);
    expect(isResponseEvent(ev({ itemNumber: 1, authorLogin: "a", createdAt: h(1), kind: "review", reviewState: "COMMENTED", body: "" }))).toBe(false);
    expect(isResponseEvent(ev({ itemNumber: 1, authorLogin: "a", createdAt: h(1), kind: "review", reviewState: "COMMENTED", body: "  " }))).toBe(false);
    expect(isResponseEvent(ev({ itemNumber: 1, authorLogin: "a", createdAt: h(1), kind: "review", reviewState: "COMMENTED", body: "hm" }))).toBe(true);
    expect(isResponseEvent(ev({ itemNumber: 1, authorLogin: "posthog-bot", createdAt: h(1) }))).toBe(false);
    expect(isResponseEvent(ev({ itemNumber: 1, authorLogin: "greptile-apps[bot]", createdAt: h(1) }))).toBe(false);
  });

  it("drops self-declared automated comments posted under human logins", () => {
    const marker = "> [!NOTE]\n> 🤖 Automated comment by **QA Swarm** — not written by a human\n\nFindings...";
    expect(isResponseEvent(ev({ itemNumber: 1, authorLogin: "a", createdAt: h(1), body: marker }))).toBe(false);
    expect(isResponseEvent(ev({ itemNumber: 1, authorLogin: "a", createdAt: h(1), body: "AI reply: Fixed in abc123." }))).toBe(false);
    expect(isResponseEvent(ev({ itemNumber: 1, authorLogin: "a", createdAt: h(1), body: "I asked the AI to reply here, but this is me." }))).toBe(true);
  });
});

describe("groupEventsByItem", () => {
  it("groups per item in chronological order", () => {
    const events = [
      ev({ itemNumber: 1, authorLogin: "a", createdAt: h(5) }),
      ev({ itemNumber: 2, authorLogin: "b", createdAt: h(1) }),
      ev({ itemNumber: 1, authorLogin: "b", createdAt: h(2) }),
    ];
    const g = groupEventsByItem(events);
    expect([...g.keys()].sort()).toEqual([1, 2]);
    expect(g.get(1)!.map((e) => e.authorLogin)).toEqual(["b", "a"]);
  });
});

describe("computeResponses: trigger and latency", () => {
  it("uses item creation as trigger for the first reviewer and the previous other-human event afterwards", () => {
    const items = [item({ number: 1, authorLogin: "author", createdAt: h(0) })];
    const events = [
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(2) }), // 2h after creation
      ev({ itemNumber: 1, authorLogin: "author", createdAt: h(5) }), // reply to rev: 3h
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(6) }), // reply to author: 1h
    ];
    const rs = computeResponses(items, events, WINDOW_START);
    expect(rs).toHaveLength(3);
    expect(rs[0].triggerIsCreation).toBe(true);
    expect(rs[0].latencyHours).toBe(2);
    expect(rs[1].triggerLogin).toBe("rev");
    expect(rs[1].latencyHours).toBe(3);
    expect(rs[2].latencyHours).toBe(1);
  });

  it("excludes latency on a follow-up (previous human event by same person) but still counts it", () => {
    const items = [item({ number: 1, authorLogin: "author" })];
    const events = [
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(1) }),
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(1.5) }),
    ];
    const rs = byLogin(computeResponses(items, events, WINDOW_START), "rev");
    expect(rs).toHaveLength(2);
    expect(rs[0].latencyHours).toBe(1);
    expect(rs[1].latencyHours).toBeNull();
    expect(rs[1].latencyExclusion).toBe("follow_up");
    // Trigger is still the most recent event by someone else (creation here).
    expect(rs[1].triggerIsCreation).toBe(true);
  });

  it("trigger is the most recent event by someone else, even if an own event is in between", () => {
    const items = [item({ number: 1, authorLogin: "author" })];
    const events = [
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(1) }),
      ev({ itemNumber: 1, authorLogin: "author", createdAt: h(2) }),
      ev({ itemNumber: 1, authorLogin: "other", createdAt: h(3) }),
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(10) }), // trigger = other at 3h
    ];
    const rs = byLogin(computeResponses(items, events, WINDOW_START), "rev");
    expect(rs[1].triggerLogin).toBe("other");
    expect(rs[1].latencyHours).toBe(7);
  });

  it("does not count the author's own first comment as a response, but counts replies to a reviewer", () => {
    const items = [item({ number: 1, authorLogin: "author" })];
    const events = [
      ev({ itemNumber: 1, authorLogin: "author", createdAt: h(1) }), // self-note, not a response
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(2) }),
      ev({ itemNumber: 1, authorLogin: "author", createdAt: h(4) }), // reply to rev
    ];
    const rs = computeResponses(items, events, WINDOW_START);
    const author = byLogin(rs, "author");
    expect(author).toHaveLength(1);
    expect(author[0].latencyHours).toBe(2);
    // Reviewer's trigger is the author's earlier event (a human event), not creation.
    const rev = byLogin(rs, "rev");
    expect(rev[0].triggerIsCreation).toBe(false);
    expect(rev[0].latencyHours).toBe(1);
  });

  it("excludes creation-based latency when the item predates the window", () => {
    const items = [item({ number: 1, authorLogin: "author", createdAt: "2026-06-01T00:00:00Z" })];
    const events = [
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(1) }),
      ev({ itemNumber: 1, authorLogin: "author", createdAt: h(3) }),
    ];
    const rs = computeResponses(items, events, WINDOW_START);
    expect(rs[0].latencyHours).toBeNull();
    expect(rs[0].latencyExclusion).toBe("predates_window");
    // Once an in-window trigger exists, latency is measured normally.
    expect(rs[1].latencyHours).toBe(2);
  });

  it("excludes creation-based latency on draft PRs", () => {
    const items = [item({ number: 1, authorLogin: "author", isDraft: true })];
    const events = [
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(1) }),
      ev({ itemNumber: 1, authorLogin: "author", createdAt: h(2) }),
    ];
    const rs = computeResponses(items, events, WINDOW_START);
    expect(rs[0].latencyExclusion).toBe("draft_creation");
    expect(rs[0].latencyHours).toBeNull();
    expect(rs[1].latencyHours).toBe(1);
  });

  it("caps latency at LATENCY_CAP_HOURS", () => {
    const items = [item({ number: 1, authorLogin: "author" })];
    const events = [ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(LATENCY_CAP_HOURS * 3) })];
    const rs = computeResponses(items, events, WINDOW_START);
    expect(rs[0].latencyHours).toBe(LATENCY_CAP_HOURS);
  });

  it("ignores bot events entirely (never a trigger, never a response)", () => {
    const items = [item({ number: 1, authorLogin: "author" })];
    const events = [
      ev({ itemNumber: 1, authorLogin: "posthog-bot", createdAt: h(1) }),
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(4) }),
    ];
    const rs = computeResponses(items, events, WINDOW_START);
    expect(rs).toHaveLength(1);
    expect(rs[0].triggerIsCreation).toBe(true);
    expect(rs[0].latencyHours).toBe(4);
  });

  it("skips events whose item is unknown", () => {
    const rs = computeResponses([], [ev({ itemNumber: 9, authorLogin: "rev", createdAt: h(1) })], WINDOW_START);
    expect(rs).toHaveLength(0);
  });
});

describe("computeFollowThrough", () => {
  it("measures merged_at minus last pre-merge event per non-author engineer, capped", () => {
    const items = [
      item({ number: 1, authorLogin: "author", mergedAt: h(10) }),
      item({ number: 2, authorLogin: "author", mergedAt: null }),
      item({ number: 3, authorLogin: "author", kind: "issue", closedAt: h(10) }),
    ];
    const events = [
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(2) }),
      ev({ itemNumber: 1, authorLogin: "rev", createdAt: h(7) }), // last before merge -> 3h
      ev({ itemNumber: 1, authorLogin: "author", createdAt: h(8) }), // author excluded
      ev({ itemNumber: 1, authorLogin: "late", createdAt: h(12) }), // after merge -> skipped
      ev({ itemNumber: 1, authorLogin: "slow", createdAt: h(10 - LATENCY_CAP_HOURS * 2) }),
      ev({ itemNumber: 2, authorLogin: "rev", createdAt: h(1) }), // not merged
      ev({ itemNumber: 3, authorLogin: "rev", createdAt: h(1) }), // issue
    ];
    const ft = computeFollowThrough(items, events);
    const rev = ft.find((f) => f.login === "rev");
    expect(rev).toBeDefined();
    expect(rev!.hours).toBe(3);
    expect(rev!.item.number).toBe(1);
    expect(ft.find((f) => f.login === "late")).toBeUndefined();
    expect(ft.find((f) => f.login === "author")).toBeUndefined();
    expect(ft.find((f) => f.login === "slow")!.hours).toBe(LATENCY_CAP_HOURS);
    expect(ft).toHaveLength(2);
  });
});

describe("median", () => {
  it("handles empty, odd and even inputs", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
});
