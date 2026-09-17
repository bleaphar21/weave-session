# PostHog Engineering Impact Dashboard

Who are the most impactful engineers in PostHog/posthog over the last 90 days, and why?
See [SPEC.md](SPEC.md) for the impact definition, scoring algorithms, data plan and layout.

## Layout

- `scripts/ingest.ts` — fetch GitHub data → `data/raw/*.jsonl` cache → Postgres (`items`, `events`)
- `lib/scoring/` + `scripts/score.ts` — pure scoring functions → `engineer_scores`, `dashboard_snapshots`, `data/snapshot.json`
- `lib/data.ts` — page data access (DB first, snapshot fallback)
- `app/` — single-page dashboard
- `lib/types.ts`, `lib/config.ts`, `db/schema.sql` — shared contracts

## Commands

```bash
npm run db:migrate   # apply db/schema.sql
npm run ingest       # fetch + load (uses `gh auth token` when GITHUB_TOKEN is unset)
npm run score        # compute scores, write snapshot
npm run dev
```
