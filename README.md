# Who unblocks PostHog? — Engineering Impact Dashboard

**Live:** https://weave-session.vercel.app

Who are the most impactful engineers in [PostHog/posthog](https://github.com/PostHog/posthog) over the last 90 days, and why?
Full design in [SPEC.md](SPEC.md). A screenshot is in [docs/dashboard.png](docs/dashboard.png).

## Approach in short

Lines of code, commits and files changed are out. In a repo that merges roughly 300 human PRs a day, the scarce resource is a human who responds to other people's work quickly, often, and in a way that moves it to merge. So "impact" here means **unblocking others**, and two algorithms score it from the same data. A toggle switches between them, and every number on the page carries the plain-English metric behind it plus links to the actual GitHub comments so a leader can verify the ranking.

| Algorithm | Factors (weights) | Each factor is |
|---|---|---|
| Responsive Collaborator (default) | median reply latency (0.40), number of responses (0.40), time from the engineer's last comment to the PR merging (0.20) | a percentile rank among eligible peers, 0–100 |
| Constructive Communicator (toggle) | mean comment quality (0.50), count of substantive comments (0.30), number of different people responded to (0.20) | same |

Comment quality is rule-based, not sentiment: word count after stripping quotes and code, code blocks or suggestions, links and file or issue references, questions, actionable phrasing, and stated rationale. Ritual-only comments ("lgtm", "+1", "thanks") score zero.

Eligibility: at least 20 responses on at least 10 distinct PRs or issues. Bots are excluded by account type, a denylist, and login patterns. Comments posted through a human account but self-labelled as automated (PostHog's QA Swarm, Review Triage, PR Shepherd, and "AI reply:" comments) are excluded too, because counting them would credit a person for an agent's work.

## Data

90 days ending 2026-09-17, fetched from the GitHub API and loaded into Neon Postgres:

| | Count |
|---|---|
| PRs / issues with in-window activity (human-authored) | 19,207 / 3,013 |
| Human events kept (issue comments, inline review comments, reviews) | 57,347 |
| Bot events dropped | 245,768 from 42 bot accounts |
| Human engineers seen / eligible | 415 / 120 |

Fetch plan: per-day GraphQL search slices for PRs with nested reviews (1 rate-limit point each), and repo-wide REST comment listings walked by `updated` cursor rather than page number because GitHub returns 500s on deep pages and edits by bots shift page boundaries mid-fetch. Bot filtering happens at fetch time. Spot-checks against the raw API for three PRs and one issue matched at the individual-event level.

## Stack

Next.js (App Router) on Vercel, statically rendered with hourly revalidation, so the page loads in well under a second. Neon Postgres via the Vercel Marketplace holds the raw items and events, per-engineer scores, and the rendered snapshot. The page reads the latest snapshot from Postgres and falls back to the committed `data/snapshot.json` if the database is unreachable. No charting library; bars are CSS.

## Layout

- `scripts/ingest.ts`, `lib/github/` — fetch → `data/raw/*.jsonl` cache → Postgres
- `lib/scoring/` — pure scoring functions, 53 unit tests (`npm test`)
- `scripts/score.ts` — compute both algorithms, write Postgres and `data/snapshot.json`
- `lib/data.ts` — page data access (DB first, snapshot fallback)
- `app/`, `components/` — the single-screen dashboard
- `lib/types.ts`, `lib/config.ts`, `db/schema.sql` — shared contracts and every tunable constant

## Reproduce

```bash
npm install
npm run db:migrate            # needs DATABASE_URL in .env.local
npm run ingest                # uses GITHUB_TOKEN or `gh auth token`; ~15 min
npm run score -- --from-cache # writes Postgres + data/snapshot.json
npm run dev
```

## Known limitations

- Latency is wall-clock; weekends and time zones inflate it. Medians blunt this but do not remove it.
- First-response latency on a PR is measured from PR creation, not from "ready for review" or a review request. Draft-creation triggers are excluded.
- Comment quality rewards structure and length as proxies for substance; a terse brilliant comment scores low.
- Slack, pairing, and design docs are invisible to this analysis.

## Process

Built with Claude Code. A written spec came first, then three parallel agents in separate git worktrees (ingestion, scoring backend, frontend) working against shared type contracts, then integration and deploy. Elapsed time is reported from the assignment timer in the submission form.
