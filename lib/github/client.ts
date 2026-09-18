/**
 * Minimal GitHub client used by scripts/ingest.ts: token discovery, a
 * concurrency limiter, and REST/GraphQL calls with exponential backoff.
 *
 * The token comes from GITHUB_TOKEN or `gh auth token`. It is never logged.
 */
import { execSync } from "node:child_process";

const API = "https://api.github.com";
const USER_AGENT = "posthog-impact-dashboard-ingest";
const MAX_ATTEMPTS = 8;
const MAX_WAIT_MS = 5 * 60 * 1000;

let cachedToken: string | null = null;

export function getToken(): string {
  if (cachedToken) return cachedToken;
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) {
    cachedToken = fromEnv;
    return cachedToken;
  }
  try {
    const out = execSync("gh auth token", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) {
      cachedToken = out;
      return cachedToken;
    }
  } catch {
    // fall through
  }
  throw new Error("No GitHub token found: set GITHUB_TOKEN or run `gh auth login`.");
}

// ---------------------------------------------------------------------------
// Concurrency limiter (tiny p-limit)
// ---------------------------------------------------------------------------

export class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly max: number) {}

  run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.active++;
        fn().then(resolve, reject).finally(() => {
          this.active--;
          const next = this.queue.shift();
          if (next) next();
        });
      };
      if (this.active < this.max) start();
      else this.queue.push(start);
    });
  }
}

export const restLimiter = new Limiter(6);
export const graphqlLimiter = new Limiter(4);

// ---------------------------------------------------------------------------
// Retry / backoff
// ---------------------------------------------------------------------------

export const stats = { rest: 0, graphql: 0, retries: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt: number): number {
  const base = Math.min(60_000, 1000 * 2 ** attempt);
  return Math.round(base * (0.5 + Math.random())); // jitter 0.5x-1.5x
}

function rateLimitWaitMs(res: Response, attempt: number): number {
  const retryAfter = res.headers.get("retry-after");
  if (retryAfter && Number.isFinite(Number(retryAfter))) {
    return Number(retryAfter) * 1000 + 500;
  }
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = res.headers.get("x-ratelimit-reset");
  if (remaining === "0" && reset) {
    return Math.max(0, Number(reset) * 1000 - Date.now()) + 1000;
  }
  return backoffMs(attempt);
}

/**
 * Fetch and JSON-parse with retries. Network errors, truncated bodies,
 * 403/429 (rate limits, honoring retry-after / x-ratelimit-reset) and 5xx are
 * retried with exponential backoff and jitter; other 4xx throw immediately.
 */
async function fetchJsonWithRetry<T>(
  url: string,
  init: RequestInit,
  label: string,
): Promise<{ data: T; headers: Headers }> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      lastErr = err;
      const wait = backoffMs(attempt);
      stats.retries++;
      console.warn(`[retry] ${label}: network error (${String(err)}), waiting ${wait}ms`);
      await sleep(wait);
      continue;
    }
    if (res.ok) {
      try {
        const data = (await res.json()) as T;
        return { data, headers: res.headers };
      } catch (err) {
        lastErr = err;
        const wait = backoffMs(attempt);
        stats.retries++;
        console.warn(`[retry] ${label}: bad/truncated body (${String(err).slice(0, 80)}), waiting ${wait}ms`);
        await sleep(wait);
        continue;
      }
    }

    const status = res.status;
    const retryable = status === 403 || status === 429 || status >= 500;
    if (!retryable) {
      const body = await res.text().catch(() => "");
      throw new Error(`${label}: HTTP ${status} ${body.slice(0, 300)}`);
    }
    const wait = Math.min(MAX_WAIT_MS, rateLimitWaitMs(res, attempt));
    stats.retries++;
    lastErr = new Error(`${label}: HTTP ${status}`);
    await res.text().catch(() => "");
    console.warn(`[retry] ${label}: HTTP ${status}, waiting ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
    await sleep(wait);
  }
  throw new Error(`${label}: giving up after ${MAX_ATTEMPTS} attempts (${String(lastErr)})`);
}

function baseHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": USER_AGENT,
  };
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

export interface RestResult<T> {
  data: T;
  headers: Headers;
}

export async function rest<T>(
  path: string,
  params: Record<string, string | number> = {},
): Promise<RestResult<T>> {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const label = `GET ${path}?page=${params.page ?? 1}`;
  return restLimiter.run(async () => {
    stats.rest++;
    return fetchJsonWithRetry<T>(url.toString(), { headers: baseHeaders() }, label);
  });
}

/** Parse the `rel="last"` page number out of a Link header, if present. */
export function parseLastPage(link: string | null): number | null {
  if (!link) return null;
  const m = link.match(/[?&]page=(\d+)[^>]*>;\s*rel="last"/);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

interface GraphqlError {
  type?: string;
  message: string;
}

export async function graphql<T>(
  query: string,
  variables: Record<string, unknown>,
  label = "graphql",
): Promise<T> {
  return graphqlLimiter.run(async () => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      stats.graphql++;
      const { data: json } = await fetchJsonWithRetry<{ data?: T; errors?: GraphqlError[] }>(
        `${API}/graphql`,
        {
          method: "POST",
          headers: { ...baseHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ query, variables }),
        },
        label,
      );
      if (json.errors && json.errors.length > 0) {
        const rateLimited = json.errors.some((e) => e.type === "RATE_LIMITED");
        const msg = json.errors.map((e) => e.message).join("; ").slice(0, 300);
        const wait = rateLimited ? Math.max(60_000, backoffMs(attempt)) : backoffMs(attempt);
        stats.retries++;
        console.warn(`[retry] ${label}: GraphQL errors (${msg}), waiting ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (!json.data) throw new Error(`${label}: GraphQL response had no data`);
      return json.data;
    }
    throw new Error(`${label}: giving up after ${MAX_ATTEMPTS} GraphQL attempts`);
  });
}
