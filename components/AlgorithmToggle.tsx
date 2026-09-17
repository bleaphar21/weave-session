"use client";

import type { AlgorithmKey, AlgorithmMethodology } from "@/lib/types";
import { ALGORITHM_ORDER } from "./scoring";

export function AlgorithmToggle({
  value,
  onChange,
  methodology,
}: {
  value: AlgorithmKey;
  onChange: (next: AlgorithmKey) => void;
  methodology: Record<AlgorithmKey, AlgorithmMethodology>;
}) {
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = ALGORITHM_ORDER.indexOf(value);
    const next =
      ALGORITHM_ORDER[
        (i + (e.key === "ArrowRight" ? 1 : -1) + ALGORITHM_ORDER.length) %
          ALGORITHM_ORDER.length
      ];
    onChange(next);
  }
  return (
    <div
      role="radiogroup"
      aria-label="Scoring algorithm"
      onKeyDown={onKeyDown}
      className="inline-flex rounded-md border border-hairline bg-surface p-0.5"
    >
      {ALGORITHM_ORDER.map((key) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(key)}
            className={
              "rounded px-3 py-1 text-[13px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent " +
              (active
                ? "bg-ink text-surface"
                : "text-ink-2 hover:bg-page hover:text-ink")
            }
          >
            {methodology[key].title}
          </button>
        );
      })}
    </div>
  );
}
