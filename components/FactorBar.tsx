import type { FactorScore } from "@/lib/types";
import { formatPercentile, formatWeight } from "./scoring";

/**
 * One horizontal CSS bar showing a factor's percentile (0-100) with the
 * label, weight, raw metric and plain-English explanation. Single series,
 * single hue; track is a lighter step of the same hue.
 */
export function FactorBar({
  factor,
  compact = false,
}: {
  factor: FactorScore;
  compact?: boolean;
}) {
  const p = factor.percentile;
  const width = p == null ? 0 : Math.max(0, Math.min(100, p));
  return (
    <div className={compact ? "space-y-0.5" : "space-y-1"}>
      <div className="flex items-baseline justify-between gap-2 text-[11px] leading-tight">
        <span className="truncate font-medium text-ink">
          {factor.label}{" "}
          <span className="font-normal text-muted">
            {formatWeight(factor.weight)}
          </span>
        </span>
        <span className="tnum shrink-0 font-semibold text-ink">
          {formatPercentile(p)}
          {p != null && (
            <span className="font-normal text-muted"> pct</span>
          )}
        </span>
      </div>
      <div
        className="h-1.5 w-full rounded-full bg-bar-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p ?? undefined}
        aria-valuetext={
          p == null
            ? `${factor.label}: not available`
            : `${factor.label}: ${Math.round(p)}th percentile`
        }
        aria-label={factor.label}
      >
        {p != null && (
          <div
            className="h-full rounded-full bg-bar"
            style={{ width: `${width}%` }}
          />
        )}
      </div>
      <p className="text-[11px] leading-snug text-ink-2">
        <span className="text-ink">{factor.rawLabel}</span>
        {" — "}
        {factor.explanation}
      </p>
    </div>
  );
}
