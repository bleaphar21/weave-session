"use client";

import { useMemo, useState } from "react";
import type { MethodologyFactor } from "@/lib/types";
import { Avatar } from "./Avatar";
import { formatPercentile, type Row } from "./scoring";

type SortKey = "rank" | "login" | "composite" | `factor:${string}`;
type SortDir = "asc" | "desc";

const DEFAULT_DIR: Record<string, SortDir> = {
  rank: "asc",
  login: "asc",
  composite: "desc",
};

export function Leaderboard({
  rows,
  factors,
  weights,
  selected,
  customWeights,
  onSelect,
}: {
  rows: Row[];
  factors: MethodologyFactor[];
  /** Weight shown in each factor header (default or normalized custom). */
  weights: Record<string, number>;
  selected: string | null;
  customWeights: boolean;
  onSelect: (login: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_DIR[key] ?? "desc");
    }
  }

  const sorted = useMemo(() => {
    const value = (r: Row): number | string => {
      if (sortKey === "rank") return r.rank;
      if (sortKey === "login") return r.engineer.login.toLowerCase();
      if (sortKey === "composite") return r.composite;
      const key = sortKey.slice("factor:".length);
      const f = r.factors.find((x) => x.key === key);
      // Missing percentiles always sort to the bottom.
      return f?.percentile ?? (sortDir === "asc" ? Infinity : -Infinity);
    };
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return a.rank - b.rank;
    });
  }, [rows, sortKey, sortDir]);

  const columns: { key: SortKey; label: string; align: "left" | "right"; title?: string }[] = [
    { key: "rank", label: "#", align: "right" },
    { key: "login", label: "Engineer", align: "left" },
    { key: "composite", label: "Impact", align: "right", title: "Weighted sum of factor percentiles, 0-100" },
    ...factors.map((f) => ({
      key: `factor:${f.key}` as SortKey,
      label: `${f.label} ×${(weights[f.key] ?? f.weight).toFixed(2)}`,
      align: "right" as const,
      title: `${f.metric} (${f.direction === "lower_is_better" ? "lower is better" : "higher is better"}). Shown as percentile among eligible engineers.`,
    })),
  ];

  const ariaSort = (key: SortKey) =>
    key === sortKey ? (sortDir === "asc" ? "ascending" : "descending") : "none";

  return (
    <section
      aria-label="Leaderboard"
      className="flex min-h-0 flex-col rounded-lg border border-hairline bg-surface"
    >
      <div className="flex items-baseline justify-between border-b border-hairline px-3 py-2">
        <h2 className="text-[13px] font-semibold text-ink">
          All {rows.length} eligible engineers
        </h2>
        <p className="text-[11px] text-muted">
          Click a column to sort, a row for evidence. Factor cells show the
          percentile among eligible peers{customWeights ? "; * custom weights" : ""}.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="sticky top-0 z-10 bg-surface shadow-[0_1px_0_var(--hairline)]">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort(c.key)}
                  title={c.title}
                  className={
                    "whitespace-nowrap px-2 py-1.5 text-[11px] font-medium text-ink-2 " +
                    (c.align === "right" ? "text-right" : "text-left")
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(c.key)}
                    className="rounded hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {c.label}
                    <span aria-hidden="true" className="ml-1 inline-block w-2 text-muted">
                      {c.key === sortKey ? (sortDir === "asc" ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isSelected = row.engineer.login === selected;
              return (
                <tr
                  key={row.engineer.login}
                  tabIndex={0}
                  aria-selected={isSelected}
                  onClick={() => onSelect(row.engineer.login)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(row.engineer.login);
                    }
                  }}
                  className={
                    "cursor-pointer border-b border-hairline align-top hover:bg-page focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent " +
                    (isSelected ? "bg-bar-track/40" : "")
                  }
                >
                  <td className="tnum px-2 py-1.5 text-right text-ink-2">{row.rank}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <Avatar src={row.engineer.avatarUrl} login={row.engineer.login} size={20} />
                      <span className="whitespace-nowrap font-medium text-ink">{row.engineer.login}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted">
                        {row.engineer.association}
                      </span>
                    </div>
                  </td>
                  <td className="tnum px-2 py-1.5 text-right font-semibold text-ink">
                    {row.composite.toFixed(1)}
                  </td>
                  {factors.map((mf) => {
                    const f = row.factors.find((x) => x.key === mf.key);
                    return (
                      <td
                        key={mf.key}
                        className="px-2 py-1.5 text-right"
                        title={f ? `${f.rawLabel} — ${f.explanation}` : undefined}
                      >
                        <div className="tnum font-medium text-ink">
                          {f ? formatPercentile(f.percentile) : "n/a"}
                        </div>
                        <div className="max-w-[180px] truncate text-[10.5px] text-muted">
                          {f?.rawLabel}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
