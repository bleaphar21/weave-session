/**
 * Percentile ranks 0-100 among eligible engineers (SPEC: "A score of 92 on
 * responsiveness reads as faster than 92% of eligible peers").
 *
 * Ranks are averaged for ties. With n values, the best gets 100 and the
 * worst 0; a single value gets 100. Nulls are ignored (they get null back)
 * and do not count toward n.
 */

import type { Direction } from "../types";

export function percentileRanks(
  values: Array<number | null | undefined>,
  direction: Direction,
): Array<number | null> {
  const idx: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v === "number" && Number.isFinite(v)) idx.push(i);
  }
  const out: Array<number | null> = values.map(() => null);
  const n = idx.length;
  if (n === 0) return out;
  if (n === 1) {
    out[idx[0]] = 100;
    return out;
  }
  // Sort worst -> best so rank 1 is worst and rank n is best.
  const sign = direction === "higher_is_better" ? 1 : -1;
  idx.sort((a, b) => sign * ((values[a] as number) - (values[b] as number)));

  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]] === values[idx[i]]) j++;
    // 1-based ranks i+1 .. j+1, averaged.
    const avgRank = (i + 1 + (j + 1)) / 2;
    const pct = ((avgRank - 1) / (n - 1)) * 100;
    const rounded = Math.round(pct * 10) / 10;
    for (let k = i; k <= j; k++) out[idx[k]] = rounded;
    i = j + 1;
  }
  return out;
}
