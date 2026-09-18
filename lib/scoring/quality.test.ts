import { describe, expect, it } from "vitest";
import { QUALITY } from "../config";
import { countWords, isRitualOnly, scoreComment, stripQuotesAndCode } from "./quality";

describe("stripQuotesAndCode / countWords", () => {
  it("removes quoted lines and fenced code before counting", () => {
    const body = [
      "> quoted line with many many words that should not count at all",
      "Real sentence one here.",
      "```ts",
      "const x = 1; const y = 2; const z = 3;",
      "```",
      "Real sentence two.",
    ].join("\n");
    const stripped = stripQuotesAndCode(body);
    expect(stripped).not.toContain("quoted line");
    expect(stripped).not.toContain("const x");
    expect(countWords(stripped)).toBe(7);
  });

  it("does not count emoji or bare punctuation as words", () => {
    expect(countWords("🎉 👍 :tada: -- !!")).toBe(0);
    expect(countWords("one two")).toBe(2);
  });
});

describe("isRitualOnly", () => {
  it.each(["LGTM", "lgtm!", "+1", "Thanks!", "thank you", "done", "nice 🎉", "👍", ":+1:", "", "   ", "Looks good, thanks"])(
    "treats %j as ritual",
    (b) => expect(isRitualOnly(b)).toBe(true),
  );
  it.each(["Thanks, but the migration is missing", "done, see #12", "nice catch, fixed in abc123"])(
    "treats %j as substantive",
    (b) => expect(isRitualOnly(b)).toBe(false),
  );
});

describe("scoreComment", () => {
  it("forces q to 0 for ritual-only bodies", () => {
    for (const b of ["LGTM", "+1", "thanks!", "done", "nice", "🚀🚀"]) {
      const r = scoreComment(b);
      expect(r.q).toBe(0);
      expect(r.features.ritualOnly).toBe(true);
    }
  });

  it("awards substance by word count thresholds", () => {
    const four = "one two three four";
    const five = "alpha beta gamma delta epsilon";
    const fifteen = Array.from({ length: QUALITY.substanceFullWords }, (_, i) => `w${i}`).join(" ");
    expect(scoreComment(four).features.substance).toBe(0);
    expect(scoreComment(five).features.substance).toBe(0.5);
    expect(scoreComment(five).q).toBeCloseTo(QUALITY.substance * 0.5, 5);
    expect(scoreComment(fifteen).features.substance).toBe(1);
    expect(scoreComment(fifteen).q).toBeCloseTo(QUALITY.substance, 5);
  });

  it("detects code blocks and suggestion blocks", () => {
    expect(scoreComment("Use this:\n```js\nfoo()\n```").features.code).toBe(true);
    expect(scoreComment("```suggestion\nreturn null\n```").features.code).toBe(true);
    expect(scoreComment("no code here at all").features.code).toBe(false);
  });

  it("detects references: URLs, #1234, file paths and line refs", () => {
    expect(scoreComment("see https://github.com/PostHog/posthog/pull/1").features.reference).toBe(true);
    expect(scoreComment("related to #1234").features.reference).toBe(true);
    expect(scoreComment("check frontend/src/lib/utils.ts").features.reference).toBe(true);
    expect(scoreComment("check utils.py:42").features.reference).toBe(true);
    expect(scoreComment("look at L120").features.reference).toBe(true);
    expect(scoreComment("plain words only").features.reference).toBe(false);
    // References inside a quoted line are someone else's.
    expect(scoreComment("> see #1234\n\nagreed, fixing now").features.reference).toBe(false);
  });

  it("detects question, actionable phrasing and rationale", () => {
    const r = scoreComment("Should we guard this? It crashes because value is undefined on first render.");
    expect(r.features.question).toBe(true);
    expect(r.features.actionable).toBe(true);
    expect(r.features.rationale).toBe(true);
    expect(scoreComment("what if we memoize").features.actionable).toBe(true);
    expect(scoreComment("nit: trailing space").features.actionable).toBe(true);
    expect(scoreComment("Let's do it").features.actionable).toBe(true);
    expect(scoreComment("this leads to a leak").features.rationale).toBe(true);
    expect(scoreComment("purely descriptive text").features.actionable).toBe(false);
    expect(scoreComment("purely descriptive text").features.rationale).toBe(false);
  });

  it("sums the configured points and never exceeds 1", () => {
    const words = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");
    const body = `${words}. Should we do this because of #12? \n\`\`\`suggestion\nx\n\`\`\``;
    const r = scoreComment(body);
    expect(r.features).toMatchObject({ substance: 1, code: true, reference: true, question: true, actionable: true, rationale: true });
    expect(r.q).toBeCloseTo(
      QUALITY.substance + QUALITY.code + QUALITY.reference + QUALITY.question + QUALITY.actionable + QUALITY.rationale,
      5,
    );
    expect(r.q).toBeLessThanOrEqual(1);
  });

  it("a ritual body with a question mark still scores 0", () => {
    expect(scoreComment("thanks?").q).toBe(0);
  });
});
