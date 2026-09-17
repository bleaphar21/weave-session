# Engineering Impact Dashboard — Spec

Target: Weave take-home. Audience: a busy PostHog engineering leader. Deliverable: a single-page dashboard on Vercel that names the top 5 most impactful engineers in the PostHog/posthog repo over the last 90 days and shows exactly why.

Status: spec only. No application code exists yet.

---

## 1. Definition of impact

Lines of code, commits, and files changed are explicitly out. The thesis: **the engineers with the most impact are the ones who unblock other people.** In a repo shipping roughly 300 human PRs a day, the scarce resource is a human who responds quickly, responds often, and whose feedback moves work to merge.

Two scoring algorithms, switched by a toggle. Both use the same data.

### Algorithm A — Responsive Collaborator (default)

| Factor | Weight | Metric | Direction |
|---|---|---|---|
| Responsiveness | 0.40 | Median reply latency (hours) across the engineer's responses | lower is better |
| Volume | 0.40 | Number of responses (comments, inline review comments, reviews) | higher is better |
| Merge follow-through | 0.20 | Median time from the engineer's last comment on a PR to that PR merging | lower is better |

Composite A = 0.40 × R + 0.40 × V + 0.20 × M, where each factor is a percentile rank (0–100) among eligible engineers. A score of 92 on responsiveness reads as "faster than 92% of eligible peers." If an engineer has too few merged-PR data points for M (see thresholds), the weights renormalize to 0.5 / 0.5 and the card says so.

### Algorithm B — Constructive Communicator (toggle)

Non-sentiment, rule-based scoring of each comment's substance. No LLM, no positivity/negativity. It asks: does this comment give the reader something to act on?

Per-comment quality q ∈ [0, 1]:

| Feature | Points | Detection |
|---|---|---|
| Substance | 0.30 | ≥15 words after stripping quotes and code → 1.0; 5–14 words → 0.5; fewer → 0 |
| Code | 0.20 | Contains a fenced code block or a GitHub `suggestion` block |
| Reference | 0.15 | Contains a URL, a `#1234` reference, or a file path / line reference |
| Question | 0.10 | Contains at least one `?` |
| Actionable phrasing | 0.15 | Matches should / could / consider / suggest / instead / what if / nit / let's / we can / try |
| Rationale | 0.10 | Matches because / since / so that / otherwise / leads to / this causes |
| Ritual-only override | — | Body is only lgtm / +1 / thanks / done / nice / emoji → q forced to 0 |

Engineer metrics and composite:

| Factor | Weight | Metric |
|---|---|---|
| Quality | 0.50 | Mean q across the engineer's responses |
| Substantive volume | 0.30 | log(1 + count of responses with q ≥ 0.4) |
| Breadth | 0.20 | Distinct people whose PRs/issues the engineer responded on |

Composite B = 0.50 × rank(quality) + 0.30 × rank(substantive volume) + 0.20 × rank(breadth). Same percentile-rank normalization as A.

### Shared definitions

- **Response event**: a human's issue comment, inline review comment, or review (APPROVED, CHANGES_REQUESTED, DISMISSED, or COMMENTED with a non-empty body) on a PR or issue. Empty COMMENTED reviews are dropped because they are just containers for inline comments that are counted separately.
- **Trigger** for a response at time t on item I: the most recent human event on I before t by someone other than the responder, or the item's creation if no such event. Bot events never count as triggers.
- **Reply latency** = t − trigger time. Excluded when the immediately previous human event on the item is by the same person (a follow-up, not a reply) or when the item predates the window and no in-window trigger exists. Volume still counts these.
- **Merge follow-through** per (engineer, merged PR) where the engineer is not the PR author: merged_at − engineer's last event before merge.
- **Human**: GitHub user type is User, and login is not on the bot denylist (matches `[bot]`, ends in `bot`, or is in a configurable list: posthog-bot, Copilot, trunk-io, coderabbitai, greptile-apps, github-actions, dependabot, renovate, hosthog, deployment-status-posthog, vercel, codecov, sentry-io). The denylist is displayed in the dashboard's methodology panel.
- **Eligibility**: ≥ 20 responses and ≥ 10 distinct items in the window. Merge follow-through needs ≥ 5 merged PRs; otherwise weights renormalize.
- **Window**: 90 days ending at ingest time. Items are included if created or updated in the window; only events created in the window are stored.
- External contributors are included and labeled with their author association (MEMBER, CONTRIBUTOR, etc.).
- PRs authored are shown as context on each card but are not part of either score.

### Known limitations (stated in the UI)

- Latency is wall-clock, so weekends and time zones inflate it. Median blunts this but does not remove it.
- First-response latency on a PR is measured from PR creation, not from "ready for review" or from a review request. Draft PRs are flagged and their creation-to-first-response latency is excluded.
- Algorithm B rewards length and structure as proxies for substance. A long unhelpful comment scores well; a terse brilliant one scores poorly.
- Comments in Slack, pairing sessions, and design docs are invisible.

---

## 2. Data (measured 2026-09-17)

| Last 90 days in PostHog/posthog | Count | Source |
|---|---|---|
| PRs created | 36,044 (≈60% bot-authored) | search API |
| PRs by humans (excluding trunk-io and posthog apps) | 18,076 (≈313/day) | search API |
| PRs merged | 15,229 | search API |
| Issues created / updated | 1,055 / 3,085 | search API |
| Issue comments (PRs and issues) | ≈30,000, ≈94% bots | REST pagination headers |
| Inline review comments | ≈94,000, ≈83% bots | REST pagination headers |
| Reviews (sample day) | 65% by bots, 59% empty body | GraphQL |

Estimated human events after filtering: ≈2k issue comments, ≈16k inline review comments, ≈15k reviews. Small enough for a free Postgres tier.

### Fetch plan

| Data | Endpoint | Requests | Why |
|---|---|---|---|
| PRs + reviews | GraphQL `search(type: ISSUE)` sliced per day: `repo:PostHog/posthog is:pr created:YYYY-MM-DD -author:app/trunk-io -author:app/posthog`, with `reviews(first: 30)` | ≈360 (cost 1 point each) | Search excludes the two dominant bot authors and avoids the 1,000-result cap by slicing per day. Reviews come nested at no extra cost. |
| Issues | Same GraphQL search with `is:issue updated:>=window` in 2-week slices | ≈40 | Under the 1,000 cap per slice. |
| Issue comments | REST `GET /repos/PostHog/posthog/issues/comments?since=&per_page=100&page=N` | ≈300 | One repo-wide list instead of per-item calls. Covers PRs and issues. |
| Inline review comments | REST `GET /repos/PostHog/posthog/pulls/comments?since=&per_page=100&page=N` | ≈940 | Same trick. |

Budget: ≈1,250 REST calls against 5,000/hour, ≈400 GraphQL points against 5,000/hour. Concurrency 6 for REST, 4 for GraphQL, exponential backoff on 403/429/5xx, resumable by slice. Expected wall time 5–8 minutes. Auth comes from the local gh CLI token via `gh auth token`; no token is stored in the repo.

Ingest-time filters: drop bot events immediately (keep only a count for the methodology panel), drop comments whose created_at is outside the window (the `since` parameter also returns edited old comments), paginate the rare PR with more than 30 reviews.

### Persistence

Neon Postgres (free tier) provisioned through the Vercel Marketplace, connected with the Neon serverless driver. Plain SQL, no ORM.

```
ingest_runs   (id, started_at, finished_at, window_start, window_end, counts jsonb)
items         (number pk, kind pr|issue, author_login, author_association, title, url,
               created_at, merged_at, closed_at, is_draft, additions, deletions)
events        (id pk, item_number, kind issue_comment|review_comment|review, review_state,
               author_login, author_association, created_at, body text, url)
engineer_scores (run_id, login, avatar_url, association, metrics jsonb, evidence jsonb,
               primary key (run_id, login))
```

`metrics` holds every raw number and every percentile for both algorithms so the page never recomputes from events. `evidence` holds the three highest-q comments and the three fastest replies with GitHub links. The ingest also writes `data/snapshot.json` (same shape as the page's props) as a fallback so the URL loads even if the database is unreachable.

---

## 3. Dashboard

One page, fits 1440×900 without scrolling the outer page.

- **Header**: title, window dates, ingest timestamp, the toggle (Responsive Collaborator / Constructive Communicator), and a one-line count: "N human engineers, M eligible, K bot accounts excluded."
- **Top 5 cards**: rank, avatar, login, association badge, composite score, and one bar per factor with a plain-English line and the raw number. Example: "Median reply 1.4h, faster than 91% of peers" / "312 responses across 140 PRs and issues" / "Last comment lands median 3.2h before merge." Context line: PRs authored.
- **Leaderboard** (left two-thirds): top 20 eligible engineers, sortable by any factor, internal scroll. Clicking a row opens an evidence panel with linked GitHub comments so the reader can verify.
- **How it's scored** (right third): the exact formula, weights, thresholds, exclusions, and the limitations above. Changes with the toggle.
- Weight sliders (stretch): sub-scores are already in the props, so the composite can be recomputed client-side for a leader who disagrees with the defaults.

Performance: the page is a server component with `revalidate = 3600`, reading the latest `engineer_scores` run. That makes it static after first render, well under the 10-second red flag, and the snapshot fallback covers database outages.

---

## 4. Stack and layout

- Next.js (App Router, TypeScript), Tailwind. No charting library; factor bars are CSS.
- `scripts/ingest.ts` (run with tsx): fetch → filter → store events → score → store scores → write snapshot.
- `lib/scoring.ts`: pure functions for triggers, latency, follow-through, comment quality, percentile ranks. A small fixture test covers the trigger and follow-up rules.
- `app/page.tsx` server component; `app/components/Dashboard.tsx` client component for the toggle, table, and evidence panel.
- Vercel deploy via CLI (already logged in). Only `DATABASE_URL` is needed in Vercel; the GitHub token is local-only.
- README with the approach summary, the elapsed time, and the session export note.

---

## 5. Time plan (90 minutes)

| Minutes | Work |
|---|---|
| 0–8 | Scaffold Next app, first commit, provision Neon, set env |
| 8–30 | Write ingest script, start the run in the background |
| 30–55 | Scoring library, score persistence, snapshot, fixture test |
| 55–75 | Dashboard UI |
| 75–85 | Deploy, verify the live URL loads and matches the snapshot, README |
| 85–90 | Buffer |

Cut order if behind: weight sliders first, then the fixture test, then the evidence panel (links stay on the cards).

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| GitHub secondary rate limits | Modest concurrency, backoff, resumable slices |
| Bot denylist incomplete | Denylist is configurable and displayed; any login with >200 events gets a manual glance |
| Search index lag for the newest PRs | Acceptable; window end is ingest time |
| Neon cold start on Vercel | ISR static page plus snapshot fallback |
| Search's 1,000-result cap | Per-day PR slices (max ≈313 observed); a slice over 900 is halved automatically |

---

## 7. Assumptions made without asking

1. Eligibility threshold is 20 responses. Adjustable in one constant.
2. Replies on one's own PR count as responses when they reply to a human reviewer.
3. External contributors are ranked alongside PostHog members, with a badge.
4. Spec-writing time counts toward the reported timer if the timer was already running; otherwise the timer starts when implementation begins. Either way the README reports the honest figure.

## 8. Not needed before starting

- Vercel MCP server is unauthenticated in this session; the Vercel CLI is logged in and is sufficient.
- No GitHub token needs to be pasted anywhere; the ingest reads it from the gh CLI.
