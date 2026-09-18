/**
 * Repo-wide comment listings via REST:
 *   GET /repos/{owner}/{repo}/issues/comments?since=   (issue + PR conversation comments)
 *   GET /repos/{owner}/{repo}/pulls/comments?since=    (inline review comments)
 *
 * `since` filters on updated_at, so the listing also returns old comments that
 * were merely edited; those are dropped here (created_at outside the window)
 * and counted. Each request is cached as one slice file, trimmed to the fields
 * we use (bot bodies blanked to save space).
 *
 * Why cursor walks instead of page numbers: old comments are edited by bots
 * all the time, and with page-number pagination every edit shifts a page
 * boundary, so a page fetched after the edit next to one fetched before it
 * silently skips a comment. Sorting by updated_at ascending and advancing
 * `since` to the last page's max updated_at (always page=1) is immune to that:
 * an edit only moves the comment to the end of the walk, where it is fetched
 * again. It also avoids deep offsets, which GitHub answers with HTTP 500 for
 * this repo when sorting by created_at.
 *
 * For parallelism the updated_at axis is split into WALKS ranges (boundaries
 * come from a few page-number probes), each walked independently; a final tail
 * walk picks up anything created or edited while the others ran.
 */
import { REPO } from "../config";
import { compactIso, withSlice } from "./cache";
import { parseLastPage, rest } from "./client";

export type CommentListing = "issue_comments" | "review_comments";

const WALKS = 6;
const PER_PAGE = 100;

interface RestUser {
  login: string;
  type: string; // User | Bot | Organization
}

interface RestComment {
  id: number;
  html_url: string;
  body: string | null;
  user: RestUser | null;
  author_association: string;
  created_at: string;
  updated_at: string;
  issue_url?: string;
  pull_request_url?: string;
}

/** Trimmed comment stored in the page cache. Bot bodies are blanked to save space. */
export interface CachedComment {
  id: number;
  itemNumber: number;
  htmlUrl: string;
  body: string;
  login: string;
  userType: string;
  authorAssociation: string;
  createdAt: string;
}

export interface CommentPage {
  listing: CommentListing;
  since: string;
  page: number;
  rawCount: number;
  outOfWindow: number;
  maxUpdatedAt: string | null;
  comments: CachedComment[];
}

const PATHS: Record<CommentListing, string> = {
  issue_comments: `/repos/${REPO.owner}/${REPO.name}/issues/comments`,
  review_comments: `/repos/${REPO.owner}/${REPO.name}/pulls/comments`,
};

function numberFromUrl(url: string | undefined): number {
  const m = url?.match(/\/(\d+)$/);
  return m ? Number(m[1]) : NaN;
}

function trim(c: RestComment, isBotType: boolean): CachedComment {
  return {
    id: c.id,
    itemNumber: numberFromUrl(c.issue_url ?? c.pull_request_url),
    htmlUrl: c.html_url,
    body: isBotType ? "" : (c.body ?? ""),
    login: c.user?.login ?? "ghost",
    userType: c.user?.type ?? "User",
    authorAssociation: c.author_association,
    createdAt: c.created_at,
  };
}

export interface CommentFetchOptions {
  listing: CommentListing;
  windowStart: Date;
  windowEnd: Date;
  log: (line: string) => void;
}

async function fetchRaw(opts: CommentFetchOptions, since: string, page: number) {
  return rest<RestComment[]>(PATHS[opts.listing], {
    since,
    per_page: PER_PAGE,
    page,
    sort: "updated",
    direction: "asc",
  });
}

function toPage(opts: CommentFetchOptions, since: string, page: number, data: RestComment[]): CommentPage {
  const { listing, windowStart, windowEnd } = opts;
  const comments: CachedComment[] = [];
  let outOfWindow = 0;
  let maxUpdatedAt: string | null = null;
  for (const c of data) {
    if (!maxUpdatedAt || c.updated_at > maxUpdatedAt) maxUpdatedAt = c.updated_at;
    const created = new Date(c.created_at);
    if (created < windowStart || created > windowEnd) {
      outOfWindow++;
      continue;
    }
    comments.push(trim(c, c.user?.type === "Bot"));
  }
  return { listing, since, page, rawCount: data.length, outOfWindow, maxUpdatedAt, comments };
}

function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function minusOneSecond(iso: string): string {
  return isoSeconds(new Date(new Date(iso).getTime() - 1000));
}

/**
 * WALKS start timestamps along the updated_at axis, spaced evenly in time
 * between the window start and now. Comment activity is roughly uniform over
 * time, which balances the walks. (Page-number probes were tried first, but
 * GitHub caps the `rel="last"` page count on this listing at 300, so they
 * bunched up in the first weeks.) The one probe request only reports the
 * capped page count for the progress line. Cached as one slice.
 */
async function probeBoundaries(opts: CommentFetchOptions): Promise<{ boundaries: string[]; lastPage: number | null }> {
  const { listing, windowStart, windowEnd, log } = opts;
  const since = isoSeconds(windowStart);
  return withSlice(`${listing}_${compactIso(windowStart)}_probe`, async () => {
    const first = await fetchRaw(opts, since, 1);
    const lastPage = parseLastPage(first.headers.get("link"));
    const boundaries = [since];
    const spanMs = Math.min(Date.now(), windowEnd.getTime()) - windowStart.getTime();
    if (lastPage && lastPage >= WALKS * 2) {
      for (let k = 1; k < WALKS; k++) {
        boundaries.push(isoSeconds(new Date(windowStart.getTime() + Math.floor((spanMs * k) / WALKS))));
      }
    }
    log(`[rest] ${listing}: >=${lastPage ?? "?"} pages, ${boundaries.length} walk(s) starting at ${boundaries.join(", ")}`);
    return { boundaries, lastPage };
  });
}

interface WalkResult {
  comments: CachedComment[];
  rawCount: number;
  outOfWindow: number;
  requests: number;
  maxUpdatedAt: string | null;
}

/**
 * Walk the listing from `since` forward by updated_at until a short page, or
 * until the page's max updated_at reaches `stopAt` (the next walk's start).
 */
async function walk(
  opts: CommentFetchOptions,
  label: string,
  since: string,
  stopAt: string | null,
  cache: boolean,
): Promise<WalkResult> {
  const { listing, windowStart, log } = opts;
  const out: WalkResult = { comments: [], rawCount: 0, outOfWindow: 0, requests: 0, maxUpdatedAt: null };
  let cur = since;
  let page = 1;
  for (;;) {
    const name = `${listing}_${compactIso(windowStart)}_${label}_${compactIso(new Date(cur))}_p${page}`;
    const fetcher = async () => toPage(opts, cur, page, (await fetchRaw(opts, cur, page)).data);
    const p = cache ? await withSlice<CommentPage>(name, fetcher) : await fetcher();
    out.requests++;
    out.comments.push(...p.comments);
    out.rawCount += p.rawCount;
    out.outOfWindow += p.outOfWindow;
    if (p.maxUpdatedAt && (!out.maxUpdatedAt || p.maxUpdatedAt > out.maxUpdatedAt)) out.maxUpdatedAt = p.maxUpdatedAt;
    if (out.requests % 25 === 0) {
      log(`[rest] ${listing} ${label}: ${out.requests} requests, at ${p.maxUpdatedAt}, ${out.comments.length} in window`);
    }
    if (p.rawCount < PER_PAGE || !p.maxUpdatedAt) break;
    if (stopAt && p.maxUpdatedAt >= stopAt) break;
    // Step `since` back one second so ties at the boundary are not lost if
    // GitHub treats `since` as strictly-after; duplicates are removed later.
    const next = minusOneSecond(p.maxUpdatedAt);
    if (next <= cur) {
      page++; // more than a page of comments share this second: page within it
    } else {
      cur = next;
      page = 1;
    }
  }
  log(`[rest] ${listing} ${label}: done, ${out.requests} requests, ${out.comments.length} in window, ${out.outOfWindow} out of window`);
  return out;
}

/** Fetch every comment of one listing updated since the window start; returns in-window comments (deduped). */
export async function fetchCommentListing(opts: CommentFetchOptions): Promise<{
  comments: CachedComment[];
  requests: number;
  rawCount: number;
  outOfWindow: number;
}> {
  const { listing, log } = opts;
  const { boundaries } = await probeBoundaries(opts);
  const results = await Promise.all(
    boundaries.map((b, k) =>
      walk(opts, `w${k}`, k === 0 ? b : minusOneSecond(b), k + 1 < boundaries.length ? boundaries[k + 1] : null, true),
    ),
  );
  // Anything created or edited while the walks ran has updated_at past the
  // last cursor; one uncached tail walk from there picks it up.
  const maxSeen = results.reduce<string | null>((m, r) => (r.maxUpdatedAt && (!m || r.maxUpdatedAt > m) ? r.maxUpdatedAt : m), null);
  if (maxSeen) results.push(await walk(opts, "tail", minusOneSecond(maxSeen), null, false));

  const byId = new Map<number, CachedComment>();
  let rawCount = 0;
  let outOfWindow = 0;
  let requests = 0;
  for (const r of results) {
    for (const c of r.comments) byId.set(c.id, c);
    rawCount += r.rawCount;
    outOfWindow += r.outOfWindow;
    requests += r.requests;
  }
  log(`[rest] ${listing}: ${byId.size} distinct in-window comments from ${requests} requests (${rawCount} listed, ${outOfWindow} out of window)`);
  return { comments: [...byId.values()], requests, rawCount, outOfWindow };
}
