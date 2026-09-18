/**
 * Shared event mechanics for both algorithms (SPEC section 1, "Shared
 * definitions"): which events count as responses, what triggered each one,
 * the reply latency, and merge follow-through.
 *
 * Pure functions; no I/O.
 */

import { isAutomatedBody, isBotLogin, LATENCY_CAP_HOURS } from "../config";
import type { EventRow, ItemRow } from "../types";

export const HOUR_MS = 3_600_000;

export type LatencyExclusion =
  | "follow_up" // immediately previous human event on the item is by the same person
  | "predates_window" // item created before the window and no in-window trigger
  | "draft_creation"; // trigger is creation of a draft PR

export interface ResponseRecord {
  event: EventRow;
  item: ItemRow;
  /** ISO time of the trigger (another human's event, or item creation). */
  triggerAt: string;
  /** Login of the trigger author (item author when trigger is creation). */
  triggerLogin: string;
  /** True when no other human event precedes this one on the item. */
  triggerIsCreation: boolean;
  /** Hours from trigger to this response, capped; null when excluded. */
  latencyHours: number | null;
  latencyExclusion: LatencyExclusion | null;
}

export interface FollowThroughRecord {
  login: string;
  item: ItemRow;
  lastEventAt: string;
  hours: number; // capped
}

/**
 * Does this event count as a response per SPEC? Humans only. Reviews count
 * when APPROVED / CHANGES_REQUESTED / DISMISSED, or COMMENTED with a
 * non-empty body (empty COMMENTED reviews are containers for inline comments).
 */
export function isResponseEvent(e: EventRow): boolean {
  if (isBotLogin(e.authorLogin)) return false;
  if (isAutomatedBody(e.body)) return false;
  if (e.kind !== "review") return true;
  const state = (e.reviewState ?? "").toUpperCase();
  if (state === "APPROVED" || state === "CHANGES_REQUESTED" || state === "DISMISSED") return true;
  if (state === "COMMENTED") return e.body.trim().length > 0;
  return false;
}

function byTime(a: EventRow, b: EventRow): number {
  const d = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Group response events per item number, sorted chronologically. */
export function groupEventsByItem(events: EventRow[]): Map<number, EventRow[]> {
  const map = new Map<number, EventRow[]>();
  for (const e of events) {
    if (!isResponseEvent(e)) continue;
    let arr = map.get(e.itemNumber);
    if (!arr) {
      arr = [];
      map.set(e.itemNumber, arr);
    }
    arr.push(e);
  }
  for (const arr of map.values()) arr.sort(byTime);
  return map;
}

export function capHours(ms: number): number {
  const h = ms / HOUR_MS;
  return Math.min(Math.max(h, 0), LATENCY_CAP_HOURS);
}

/**
 * Compute the trigger and reply latency for every response event.
 *
 * Trigger = most recent human event on the item before t by someone other
 * than the responder, else item creation. Latency excluded when the
 * immediately previous human event (item creation counts as the author's
 * event) is by the same person, when the item predates the window and no
 * in-window trigger exists, or when the trigger is creation of a draft PR.
 *
 * Author events on their own item with no prior event by another human are
 * not responses at all (SPEC assumption 2: replies on one's own PR count
 * only when replying to a human reviewer). Events on unknown items are
 * skipped.
 */
export function computeResponses(
  items: ItemRow[],
  events: EventRow[],
  windowStart: string,
): ResponseRecord[] {
  const itemsByNumber = new Map<number, ItemRow>();
  for (const it of items) itemsByNumber.set(it.number, it);
  const windowStartMs = Date.parse(windowStart);
  const grouped = groupEventsByItem(events);
  const out: ResponseRecord[] = [];

  for (const [number, list] of grouped) {
    const item = itemsByNumber.get(number);
    if (!item) continue;
    const itemPredatesWindow = Date.parse(item.createdAt) < windowStartMs;
    const isDraftPr = item.kind === "pr" && item.isDraft;

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      // Most recent earlier event by someone else.
      let trigger: EventRow | null = null;
      for (let j = i - 1; j >= 0; j--) {
        if (list[j].authorLogin !== e.authorLogin) {
          trigger = list[j];
          break;
        }
      }
      const triggerIsCreation = trigger === null;
      if (triggerIsCreation && e.authorLogin === item.authorLogin) {
        // Author talking on their own item before anyone else has: not a response.
        continue;
      }
      const prev = i > 0 ? list[i - 1] : null;
      const prevLogin = prev ? prev.authorLogin : item.authorLogin;

      let exclusion: LatencyExclusion | null = null;
      if (prevLogin === e.authorLogin) exclusion = "follow_up";
      else if (triggerIsCreation && itemPredatesWindow) exclusion = "predates_window";
      else if (triggerIsCreation && isDraftPr) exclusion = "draft_creation";

      const triggerAt = trigger ? trigger.createdAt : item.createdAt;
      const latencyHours =
        exclusion === null ? capHours(Date.parse(e.createdAt) - Date.parse(triggerAt)) : null;

      out.push({
        event: e,
        item,
        triggerAt,
        triggerLogin: trigger ? trigger.authorLogin : item.authorLogin,
        triggerIsCreation,
        latencyHours,
        latencyExclusion: exclusion,
      });
    }
  }
  return out;
}

/**
 * Merge follow-through: for each (engineer != author, merged PR) pair,
 * merged_at minus the engineer's last response event before merge, capped.
 * Pairs whose events all land after the merge are skipped.
 */
export function computeFollowThrough(items: ItemRow[], events: EventRow[]): FollowThroughRecord[] {
  const merged = new Map<number, ItemRow>();
  for (const it of items) if (it.kind === "pr" && it.mergedAt) merged.set(it.number, it);
  const grouped = groupEventsByItem(events);
  const out: FollowThroughRecord[] = [];

  for (const [number, list] of grouped) {
    const item = merged.get(number);
    if (!item) continue;
    const mergedMs = Date.parse(item.mergedAt as string);
    const last = new Map<string, EventRow>();
    for (const e of list) {
      if (e.authorLogin === item.authorLogin) continue;
      if (Date.parse(e.createdAt) >= mergedMs) continue;
      last.set(e.authorLogin, e); // list is chronological, so the last write wins
    }
    for (const [login, e] of last) {
      out.push({
        login,
        item,
        lastEventAt: e.createdAt,
        hours: capHours(mergedMs - Date.parse(e.createdAt)),
      });
    }
  }
  return out;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
