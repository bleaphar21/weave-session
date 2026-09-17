"use client";

import { useCallback, useMemo, useState } from "react";
import type { AlgorithmKey, DashboardData } from "@/lib/types";
import { AlgorithmToggle } from "./AlgorithmToggle";
import { EvidencePanel } from "./EvidencePanel";
import { Leaderboard } from "./Leaderboard";
import { Methodology } from "./Methodology";
import { TopCards } from "./TopCards";
import {
  defaultWeights,
  deriveRows,
  formatDate,
  formatDateTime,
} from "./scoring";

export function Dashboard({ data }: { data: DashboardData }) {
  const [algo, setAlgo] = useState<AlgorithmKey>("responsive");
  const [selected, setSelected] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<
    Partial<Record<AlgorithmKey, Record<string, number>>>
  >({});

  const methodology = data.methodology[algo];
  const override = overrides[algo] ?? null;
  const weights = override ?? defaultWeights(methodology);
  // Weights as actually applied (custom weights are renormalized to sum to 1).
  const weightSum = Object.values(weights).reduce((s, w) => s + w, 0);
  const displayWeights: Record<string, number> = Object.fromEntries(
    Object.entries(weights).map(([k, w]) => [k, weightSum > 0 ? w / weightSum : 0]),
  );

  const rows = useMemo(
    () => deriveRows(data, algo, override),
    [data, algo, override],
  );
  const top5 = rows.slice(0, 5);
  const selectedRow = selected
    ? (rows.find((r) => r.engineer.login === selected) ?? null)
    : null;

  const closePanel = useCallback(() => setSelected(null), []);

  function setWeight(key: string, value: number) {
    setOverrides((prev) => ({
      ...prev,
      [algo]: { ...(prev[algo] ?? defaultWeights(methodology)), [key]: value },
    }));
  }
  function resetWeights() {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[algo];
      return next;
    });
  }

  const c = data.counts;

  return (
    <main className="flex h-full flex-col gap-3 p-4">
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink">
            Who unblocks PostHog?
          </h1>
          <p className="text-[12px] text-ink-2">
            The most impactful engineers in{" "}
            <a
              href={`https://github.com/${data.repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-ink hover:underline"
            >
              {data.repo}
            </a>{" "}
            over the last {data.window.days} days, measured by how they respond to
            other people&apos;s work, not by lines of code.
          </p>
          <p className="text-[11px] text-muted">
            {formatDate(data.window.start)} – {formatDate(data.window.end)} · generated{" "}
            {formatDateTime(data.generatedAt)} · {c.humanEngineers} human engineers ·{" "}
            {c.eligibleEngineers} eligible (≥20 responses on ≥10 PRs/issues) ·{" "}
            {c.botAccountsExcluded} bot accounts excluded (
            {c.botEventsExcluded.toLocaleString("en-US")} bot events dropped)
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <AlgorithmToggle
            value={algo}
            onChange={(next) => {
              setAlgo(next);
              setSelected(null);
            }}
            methodology={data.methodology}
          />
          <p className="max-w-[520px] text-right text-[11px] leading-snug text-ink-2">
            {methodology.summary}
          </p>
        </div>
      </header>

      <TopCards rows={top5} customWeights={override != null} onOpen={setSelected} />

      <div className="grid min-h-0 flex-1 grid-cols-[2fr_1fr] gap-3">
        <Leaderboard
          rows={rows}
          factors={methodology.factors}
          weights={displayWeights}
          selected={selected}
          customWeights={override != null}
          onSelect={setSelected}
        />
        <Methodology
          methodology={methodology}
          excludedLogins={data.excludedLogins}
          weights={weights}
          customWeights={override != null}
          onWeightChange={setWeight}
          onResetWeights={resetWeights}
        />
      </div>

      <EvidencePanel row={selectedRow} methodology={methodology} onClose={closePanel} />
    </main>
  );
}
