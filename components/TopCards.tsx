"use client";

import { Avatar } from "./Avatar";
import { FactorBar } from "./FactorBar";
import { type Row, whySentence } from "./scoring";

export function TopCards({
  rows,
  customWeights,
  onOpen,
}: {
  rows: Row[];
  customWeights: boolean;
  onOpen: (login: string) => void;
}) {
  return (
    <section aria-label="Top 5 engineers" className="grid grid-cols-5 gap-3">
      {rows.map((row) => {
        const { engineer } = row;
        return (
          <article
            key={engineer.login}
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-hairline bg-surface p-3"
          >
            <header className="flex items-center gap-2">
              <span
                className="tnum shrink-0 text-[13px] font-semibold text-muted"
                aria-label={`Rank ${row.rank}`}
              >
                #{row.rank}
              </span>
              <Avatar src={engineer.avatarUrl} login={engineer.login} size={32} />
              <div className="min-w-0 flex-1">
                <a
                  href={`https://github.com/${engineer.login}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={engineer.login}
                  className="block truncate text-[14px] font-semibold text-ink hover:underline"
                >
                  {engineer.login}
                </a>
                <span className="inline-block rounded border border-hairline px-1 text-[10px] uppercase tracking-wide text-ink-2">
                  {engineer.association}
                </span>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[24px] font-semibold leading-none text-ink">
                  {row.composite.toFixed(1)}
                </div>
                <div className="text-[10px] text-muted">
                  impact score /100{customWeights ? "*" : ""}
                </div>
              </div>
            </header>

            <p className="truncate text-[11px] leading-snug text-ink-2" title={whySentence(row)}>
              {whySentence(row)}
            </p>

            <div className="flex flex-col gap-2">
              {row.factors.map((f) => (
                <FactorBar key={f.key} factor={f} compact />
              ))}
            </div>

            {row.result.note && !customWeights && (
              <p className="text-[10.5px] leading-snug text-ink-2">
                Note: {row.result.note}
              </p>
            )}

            <footer className="mt-auto flex items-center justify-between gap-2 border-t border-hairline pt-1.5 text-[11px] text-muted">
              <span>{engineer.raw.prsAuthored} PRs authored (not scored)</span>
              <button
                type="button"
                onClick={() => onOpen(engineer.login)}
                className="shrink-0 rounded px-1 text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Evidence
              </button>
            </footer>
          </article>
        );
      })}
    </section>
  );
}
