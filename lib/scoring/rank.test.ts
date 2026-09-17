import { describe, expect, it } from "vitest";
import { percentileRanks } from "./rank";

describe("percentileRanks", () => {
  it("n=1 gives 100, empty gives nothing", () => {
    expect(percentileRanks([5], "lower_is_better")).toEqual([100]);
    expect(percentileRanks([], "higher_is_better")).toEqual([]);
  });

  it("is direction-aware", () => {
    expect(percentileRanks([1, 2, 3], "higher_is_better")).toEqual([0, 50, 100]);
    expect(percentileRanks([1, 2, 3], "lower_is_better")).toEqual([100, 50, 0]);
  });

  it("averages ranks for ties", () => {
    // ranks (worst->best): 1 -> 1, 2 -> 2.5, 2 -> 2.5, 3 -> 4 ; n-1 = 3
    expect(percentileRanks([1, 2, 2, 3], "higher_is_better")).toEqual([0, 50, 50, 100]);
    expect(percentileRanks([7, 7], "higher_is_better")).toEqual([50, 50]);
  });

  it("ignores nulls without counting them toward n", () => {
    expect(percentileRanks([3, null, 1, undefined], "lower_is_better")).toEqual([0, null, 100, null]);
    expect(percentileRanks([null, 4], "higher_is_better")).toEqual([null, 100]);
  });

  it("stays within 0-100", () => {
    const vals = Array.from({ length: 57 }, (_, i) => (i * 7919) % 31);
    for (const p of percentileRanks(vals, "higher_is_better")) {
      expect(p).not.toBeNull();
      expect(p!).toBeGreaterThanOrEqual(0);
      expect(p!).toBeLessThanOrEqual(100);
    }
  });
});
