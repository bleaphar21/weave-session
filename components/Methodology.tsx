"use client";

import type { AlgorithmMethodology } from "@/lib/types";

function Section({
  title,
  items,
  open = false,
}: {
  title: string;
  items: string[];
  open?: boolean;
}) {
  return (
    <details open={open} className="group border-t border-hairline pt-2">
      <summary className="cursor-pointer select-none text-[12px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent">
        {title}
      </summary>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-snug text-ink-2">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </details>
  );
}

export function Methodology({
  methodology,
  excludedLogins,
  weights,
  customWeights,
  onWeightChange,
  onResetWeights,
}: {
  methodology: AlgorithmMethodology;
  excludedLogins: string[];
  weights: Record<string, number>;
  customWeights: boolean;
  onWeightChange: (key: string, value: number) => void;
  onResetWeights: () => void;
}) {
  return (
    <section
      aria-label="How it's scored"
      className="flex min-h-0 flex-col rounded-lg border border-hairline bg-surface"
    >
      <div className="border-b border-hairline px-3 py-2">
        <h2 className="text-[13px] font-semibold text-ink">
          How it&apos;s scored: {methodology.title}
        </h2>
        <p className="text-[11px] leading-snug text-ink-2">{methodology.summary}</p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 py-2">
        <div>
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted">Formula</h3>
          <p className="mt-0.5 rounded bg-page px-2 py-1 font-mono text-[11px] leading-snug text-ink">
            {methodology.formula}
          </p>
        </div>

        <table className="w-full text-[11px]">
          <caption className="sr-only">Factors</caption>
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-muted">
              <th scope="col" className="py-0.5 font-medium">Factor</th>
              <th scope="col" className="py-0.5 text-right font-medium">Weight</th>
              <th scope="col" className="py-0.5 pl-2 font-medium">Metric</th>
            </tr>
          </thead>
          <tbody>
            {methodology.factors.map((f) => (
              <tr key={f.key} className="border-t border-hairline align-top">
                <td className="py-1 pr-1 font-medium text-ink">{f.label}</td>
                <td className="tnum py-1 text-right text-ink">
                  {f.weight.toFixed(2)}
                </td>
                <td className="py-1 pl-2 leading-snug text-ink-2">
                  {f.metric}{" "}
                  <span className="text-muted">
                    ({f.direction === "lower_is_better" ? "lower is better" : "higher is better"})
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <details className="group border-t border-hairline pt-2">
          <summary className="cursor-pointer select-none text-[12px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent">
            Try your own weights{customWeights ? " (custom, ranks recomputed)" : ""}
          </summary>
          <div className="mt-1 space-y-1.5">
            {methodology.factors.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-[11px] text-ink-2">
                <span className="w-32 shrink-0 truncate">{f.label}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={weights[f.key] ?? 0}
                  onChange={(e) => onWeightChange(f.key, Number(e.target.value))}
                  className="min-w-0 flex-1 accent-[var(--bar)]"
                />
                <span className="tnum w-8 text-right text-ink">
                  {(weights[f.key] ?? 0).toFixed(2)}
                </span>
              </label>
            ))}
            <div className="flex items-center justify-between text-[10.5px] text-muted">
              <span>
                Weights are renormalized to sum to 1; factors with no percentile are skipped.
              </span>
              <button
                type="button"
                onClick={onResetWeights}
                disabled={!customWeights}
                className="rounded border border-hairline px-2 py-0.5 text-[11px] text-ink hover:bg-page disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-accent"
              >
                Reset
              </button>
            </div>
          </div>
        </details>

        <Section title="Definitions" items={methodology.definitions} />
        <Section title="Thresholds and eligibility" items={methodology.thresholds} />
        <Section title="Known limitations" items={methodology.limitations} open />
        <details className="border-t border-hairline pt-2">
          <summary className="cursor-pointer select-none text-[12px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-accent">
            Bot accounts excluded ({excludedLogins.length})
          </summary>
          <p className="mt-1 font-mono text-[10.5px] leading-relaxed text-ink-2">
            {excludedLogins.join(", ")}
          </p>
        </details>
      </div>
    </section>
  );
}
