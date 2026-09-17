import type {
  AlgorithmKey,
  AlgorithmMethodology,
  AlgorithmResult,
  DashboardData,
  EngineerScore,
  FactorScore,
} from "@/lib/types";

/** One engineer as seen through the active algorithm (and optional custom weights). */
export interface Row {
  engineer: EngineerScore;
  result: AlgorithmResult;
  /** Composite 0-100 (backend value, or recomputed when custom weights are set). */
  composite: number;
  rank: number;
  /** Factors with the weight actually applied (renormalized when custom). */
  factors: FactorScore[];
}

export type WeightOverride = Record<string, number> | null;

export const ALGORITHM_ORDER: AlgorithmKey[] = ["responsive", "constructive"];

export function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

export function deriveRows(
  data: DashboardData,
  algo: AlgorithmKey,
  override: WeightOverride,
): Row[] {
  const rows: Row[] = [];
  for (const engineer of data.engineers) {
    const result = engineer.algorithms[algo];
    if (!engineer.eligible || !result) continue;
    if (!override) {
      rows.push({
        engineer,
        result,
        composite: result.composite,
        rank: result.rank,
        factors: result.factors,
      });
      continue;
    }
    // Custom weights: renormalize over the factors that have a percentile.
    const usable = result.factors.filter((f) => f.percentile != null);
    const total = usable.reduce((s, f) => s + (override[f.key] ?? 0), 0);
    const factors = result.factors.map((f) => ({
      ...f,
      weight:
        f.percentile == null || total === 0
          ? 0
          : (override[f.key] ?? 0) / total,
    }));
    const composite = round1(
      factors.reduce((s, f) => s + f.weight * (f.percentile ?? 0), 0),
    );
    rows.push({ engineer, result, composite, rank: 0, factors });
  }
  if (override) {
    rows
      .sort(
        (a, b) =>
          b.composite - a.composite ||
          a.engineer.login.localeCompare(b.engineer.login),
      )
      .forEach((r, i) => {
        r.rank = i + 1;
      });
  }
  return rows.sort((a, b) => a.rank - b.rank);
}

export function defaultWeights(m: AlgorithmMethodology): Record<string, number> {
  return Object.fromEntries(m.factors.map((f) => [f.key, f.weight]));
}

export function formatWeight(w: number): string {
  return `×${w.toFixed(2)}`;
}

export function formatPercentile(p: number | null): string {
  return p == null ? "n/a" : `${Math.round(p)}`;
}

export function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h >= 48) return `${round1(h / 24)} d`;
  return `${round1(h)} h`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(iso: string): string {
  return (
    new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }) + " UTC"
  );
}

/** "why this person" sentence built from the two strongest factors. */
export function whySentence(row: Row): string {
  const ranked = row.factors
    .filter((f) => f.percentile != null)
    .sort((a, b) => (b.percentile ?? 0) - (a.percentile ?? 0));
  if (ranked.length === 0) return "";
  const [a, b] = ranked;
  const part = (f: FactorScore) => f.label.toLowerCase();
  return b
    ? `Ranks #${row.rank} mainly on ${part(a)} and ${part(b)}.`
    : `Ranks #${row.rank} on ${part(a)}.`;
}
