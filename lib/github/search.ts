/**
 * GraphQL `search(type: ISSUE)` slicing for PRs (with nested reviews) and
 * issues. Search caps at 1,000 results per query, so every query is scoped to
 * a time range; ranges that report more than SPLIT_THRESHOLD results are
 * halved recursively. Each range is cached as one slice file.
 */
import { REPO, REPO_FULL, SEARCH_EXCLUDED_APPS } from "../config";
import { compactIso, withSlice } from "./cache";
import { graphql } from "./client";

export const SPLIT_THRESHOLD = 900;
const MIN_SPLIT_SPAN_MS = 60 * 60 * 1000; // never split below one hour
const MAX_SEARCH_PAGES = 10; // 10 x 100 = the 1,000-result cap

export interface RawActor {
  login: string;
  __typename: string; // User | Bot | Organization | Mannequin | EnterpriseUserAccount
}

export interface RawReview {
  databaseId: number | null;
  state: string; // APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED | PENDING
  submittedAt: string | null;
  body: string;
  url: string;
  author: RawActor | null;
  authorAssociation: string;
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface RawPullRequest {
  __typename: "PullRequest";
  number: number;
  title: string;
  url: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  isDraft: boolean;
  additions: number;
  deletions: number;
  author: RawActor | null;
  authorAssociation: string;
  reviews: { totalCount: number; nodes: RawReview[]; pageInfo: PageInfo };
}

export interface RawIssue {
  __typename: "Issue";
  number: number;
  title: string;
  url: string;
  createdAt: string;
  closedAt: string | null;
  author: RawActor | null;
  authorAssociation: string;
}

export type SearchNode = RawPullRequest | RawIssue | { __typename: string };

export interface SearchSlice {
  name: string;
  query: string;
  issueCount: number;
  pages: number;
  split: boolean;
  nodes: SearchNode[];
}

const REVIEW_FIELDS = `
  databaseId state submittedAt body url authorAssociation
  author { login __typename }`;

const SEARCH_QUERY = `
query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on PullRequest {
        number title url createdAt mergedAt closedAt isDraft additions deletions authorAssociation
        author { login __typename }
        reviews(first: 30) {
          totalCount
          nodes { ${REVIEW_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }
      ... on Issue {
        number title url createdAt closedAt authorAssociation
        author { login __typename }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}`;

const MORE_REVIEWS_QUERY = `
query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviews(first: 100, after: $after) {
        nodes { ${REVIEW_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

interface SearchPage {
  search: {
    issueCount: number;
    pageInfo: PageInfo;
    nodes: SearchNode[];
  };
  rateLimit: { cost: number; remaining: number; resetAt: string };
}

interface MoreReviewsPage {
  repository: { pullRequest: { reviews: { nodes: RawReview[]; pageInfo: PageInfo } } | null };
}

export let lastRateLimitRemaining: number | null = null;

/** Base query shared by every search: repo scope plus the excluded app authors. */
export function baseQuery(): string {
  const excluded = SEARCH_EXCLUDED_APPS.map((slug) => `-author:app/${slug}`).join(" ");
  return `repo:${REPO_FULL} ${excluded}`;
}

/** Search-syntax timestamp: 2026-09-15T00:00:00Z */
export function searchIso(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function fetchSearchPage(q: string, after: string | null, label: string): Promise<SearchPage> {
  const page = await graphql<SearchPage>(SEARCH_QUERY, { q, after }, label);
  lastRateLimitRemaining = page.rateLimit?.remaining ?? lastRateLimitRemaining;
  return page;
}

/** Fetch the remaining review pages for a PR that has more than 30 reviews. */
async function completeReviews(pr: RawPullRequest): Promise<void> {
  let after = pr.reviews.pageInfo.endCursor;
  let hasNext = pr.reviews.pageInfo.hasNextPage;
  let guard = 0;
  while (hasNext && after && guard++ < 20) {
    const data = await graphql<MoreReviewsPage>(
      MORE_REVIEWS_QUERY,
      { owner: REPO.owner, name: REPO.name, number: pr.number, after },
      `reviews PR#${pr.number}`,
    );
    const reviews = data.repository.pullRequest?.reviews;
    if (!reviews) break;
    pr.reviews.nodes.push(...reviews.nodes);
    hasNext = reviews.pageInfo.hasNextPage;
    after = reviews.pageInfo.endCursor;
  }
  pr.reviews.pageInfo = { hasNextPage: false, endCursor: after };
}

export interface RangeSearchOptions {
  /** Slice file prefix, e.g. "prs-created". */
  prefix: string;
  /** Search qualifiers besides the time range, e.g. "is:pr". */
  qualifiers: string;
  /** Which date field the range applies to. */
  field: "created" | "updated";
  start: Date;
  /** Exclusive end. */
  end: Date;
  log: (line: string) => void;
}

/**
 * Search one time range [start, end) and return its nodes, reading from the
 * slice cache when available. Ranges reporting more than SPLIT_THRESHOLD
 * results are halved recursively (each half is its own cached slice).
 */
export async function searchRange(opts: RangeSearchOptions): Promise<SearchSlice> {
  const { prefix, qualifiers, field, start, end, log } = opts;
  const name = `${prefix}_${compactIso(start)}_${compactIso(end)}`;
  return withSlice<SearchSlice>(name, async () => {
    const endInclusive = new Date(end.getTime() - 1000);
    const q = `${baseQuery()} ${qualifiers} ${field}:${searchIso(start)}..${searchIso(endInclusive)}`;
    const first = await fetchSearchPage(q, null, `${name} p1`);
    const issueCount = first.search.issueCount;

    if (issueCount > SPLIT_THRESHOLD && end.getTime() - start.getTime() > MIN_SPLIT_SPAN_MS) {
      const mid = new Date(Math.floor((start.getTime() + end.getTime()) / 2));
      log(`[gql] ${name}: ${issueCount} results > ${SPLIT_THRESHOLD}, splitting at ${searchIso(mid)}`);
      const [a, b] = await Promise.all([
        searchRange({ ...opts, end: mid }),
        searchRange({ ...opts, start: mid }),
      ]);
      return { name, query: q, issueCount, pages: a.pages + b.pages, split: true, nodes: [...a.nodes, ...b.nodes] };
    }
    if (issueCount > 1000) {
      log(`[gql] WARNING ${name}: ${issueCount} results in a one-hour slice; search returns at most 1,000`);
    }

    const nodes: SearchNode[] = [...first.search.nodes];
    let pageInfo = first.search.pageInfo;
    let pages = 1;
    while (pageInfo.hasNextPage && pageInfo.endCursor && pages < MAX_SEARCH_PAGES) {
      const next = await fetchSearchPage(q, pageInfo.endCursor, `${name} p${pages + 1}`);
      nodes.push(...next.search.nodes);
      pageInfo = next.search.pageInfo;
      pages++;
    }

    // Paginate reviews for the rare PR with more than 30.
    let extraReviewPrs = 0;
    for (const node of nodes) {
      if (node.__typename === "PullRequest" && (node as RawPullRequest).reviews.pageInfo.hasNextPage) {
        extraReviewPrs++;
        await completeReviews(node as RawPullRequest);
      }
    }

    const reviewCount = nodes.reduce(
      (n, node) => n + (node.__typename === "PullRequest" ? (node as RawPullRequest).reviews.nodes.length : 0),
      0,
    );
    log(
      `[gql] ${name}: ${nodes.length}/${issueCount} nodes, ${pages} page(s), ${reviewCount} reviews` +
        (extraReviewPrs ? ` (${extraReviewPrs} PR(s) needed extra review pages)` : "") +
        (lastRateLimitRemaining !== null ? `, ${lastRateLimitRemaining} points left` : ""),
    );
    return { name, query: q, issueCount, pages, split: false, nodes };
  });
}

/** Consecutive [start, end) ranges aligned to UTC midnight (first/last may be partial). */
export function dayRanges(start: Date, end: Date): Array<[Date, Date]> {
  const out: Array<[Date, Date]> = [];
  let cur = start;
  while (cur < end) {
    const nextMidnight = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + 1));
    const next = nextMidnight < end ? nextMidnight : end;
    out.push([cur, next]);
    cur = next;
  }
  return out;
}

/** Consecutive [start, end) ranges of `days` days starting at `start`. */
export function spanRanges(start: Date, end: Date, days: number): Array<[Date, Date]> {
  const out: Array<[Date, Date]> = [];
  const step = days * 24 * 60 * 60 * 1000;
  let cur = start;
  while (cur < end) {
    const next = new Date(Math.min(cur.getTime() + step, end.getTime()));
    out.push([cur, next]);
    cur = next;
  }
  return out;
}
