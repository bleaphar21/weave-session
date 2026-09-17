"use client";

import { useEffect, useRef } from "react";
import type { AlgorithmMethodology, EvidenceItem } from "@/lib/types";
import { Avatar } from "./Avatar";
import { FactorBar } from "./FactorBar";
import { formatDate, formatHours, type Row } from "./scoring";

const EVENT_LABEL: Record<EvidenceItem["eventKind"], string> = {
  issue_comment: "comment",
  review_comment: "inline review comment",
  review: "review",
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-hairline px-2 py-1">
      <dt className="text-[10px] text-muted">{label}</dt>
      <dd className="tnum text-[13px] font-semibold text-ink">{value}</dd>
    </div>
  );
}

function EvidenceList({
  title,
  hint,
  items,
  badge,
}: {
  title: string;
  hint: string;
  items: EvidenceItem[];
  badge: (item: EvidenceItem) => string;
}) {
  return (
    <section>
      <h3 className="text-[12px] font-semibold text-ink">{title}</h3>
      <p className="mb-1.5 text-[11px] text-muted">{hint}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-ink-2">None recorded in this window.</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item) => (
            <li key={item.url} className="rounded border border-hairline p-2">
              <div className="flex items-baseline justify-between gap-2 text-[11px]">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 truncate font-medium text-accent hover:underline"
                >
                  {item.itemKind === "pr" ? "PR" : "Issue"} #{item.itemNumber}: {item.itemTitle}
                </a>
                <span className="tnum shrink-0 font-semibold text-ink">{badge(item)}</span>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-line text-[11px] leading-snug text-ink-2">
                {item.excerpt}
              </p>
              <p className="mt-1 text-[10px] text-muted">
                {EVENT_LABEL[item.eventKind]} · {formatDate(item.createdAt)} ·{" "}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  open on GitHub ↗
                </a>
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function EvidencePanel({
  row,
  methodology,
  onClose,
}: {
  row: Row | null;
  methodology: AlgorithmMethodology;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = row != null;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!row) return null;
  const { engineer, factors } = row;
  const raw = engineer.raw;

  return (
    <>
      <div
        className="fixed inset-0 z-20 bg-ink/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        className="fixed inset-y-0 right-0 z-30 flex w-[560px] max-w-full flex-col border-l border-hairline bg-surface shadow-xl"
      >
        <header className="flex items-start gap-3 border-b border-hairline p-4">
          <Avatar src={engineer.avatarUrl} login={engineer.login} size={40} />
          <div className="min-w-0 flex-1">
            <h2 id="evidence-title" className="text-[15px] font-semibold text-ink">
              <a
                href={`https://github.com/${engineer.login}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {engineer.login}
              </a>{" "}
              <span className="rounded border border-hairline px-1 align-middle text-[10px] font-normal uppercase tracking-wide text-ink-2">
                {engineer.association}
              </span>
            </h2>
            <p className="text-[12px] text-ink-2">
              #{row.rank} of {methodology.title} · impact score{" "}
              <span className="tnum font-semibold text-ink">{row.composite.toFixed(1)}</span> /100
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close evidence panel"
            className="rounded px-2 py-1 text-[13px] text-ink-2 hover:bg-page hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            Close ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          <section>
            <h3 className="mb-2 text-[12px] font-semibold text-ink">
              Factors ({methodology.title})
            </h3>
            <div className="space-y-2">
              {factors.map((f) => (
                <FactorBar key={f.key} factor={f} />
              ))}
            </div>
            {row.result.note && (
              <p className="mt-2 text-[11px] text-ink-2">Note: {row.result.note}</p>
            )}
          </section>

          <section>
            <h3 className="mb-1.5 text-[12px] font-semibold text-ink">Raw metrics</h3>
            <dl className="grid grid-cols-3 gap-1.5">
              <Metric label="Responses" value={String(raw.responses)} />
              <Metric label="Distinct PRs/issues" value={String(raw.distinctItems)} />
              <Metric label="Distinct people helped" value={String(raw.distinctCounterparts)} />
              <Metric
                label={`Median reply (n=${raw.latencyN})`}
                value={raw.medianReplyLatencyHours == null ? "n/a" : formatHours(raw.medianReplyLatencyHours)}
              />
              <Metric
                label="Replies within 24h"
                value={raw.within24hPct == null ? "n/a" : `${Math.round(raw.within24hPct)}%`}
              />
              <Metric
                label={`Last comment → merge (n=${raw.followThroughN})`}
                value={raw.medianFollowThroughHours == null ? "n/a" : formatHours(raw.medianFollowThroughHours)}
              />
              <Metric
                label="Mean comment quality"
                value={raw.meanQuality == null ? "n/a" : raw.meanQuality.toFixed(2)}
              />
              <Metric label="Substantive responses" value={String(raw.substantiveResponses)} />
              <Metric label="PRs authored (not scored)" value={String(raw.prsAuthored)} />
            </dl>
          </section>

          <EvidenceList
            title="Fastest replies"
            hint="Time from the previous human event on the item to this reply. Click through to verify."
            items={engineer.evidence.fastestReplies}
            badge={(i) => (i.latencyHours == null ? "" : `${formatHours(i.latencyHours)} reply`)}
          />
          <EvidenceList
            title="Most actionable comments"
            hint="Highest rule-based quality q (0-1): substance, code, references, questions, actionable phrasing, rationale."
            items={engineer.evidence.bestComments}
            badge={(i) => (i.quality == null ? "" : `q = ${i.quality.toFixed(2)}`)}
          />
        </div>
      </aside>
    </>
  );
}
