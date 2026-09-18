/**
 * Algorithm B per-comment quality (SPEC section 1, Algorithm B table).
 * Rule-based, no sentiment. Every point value comes from QUALITY in
 * lib/config so the methodology panel matches the computation.
 */

import { QUALITY } from "../config";

export interface QualityFeatures {
  words: number; // word count after stripping quotes and fenced code
  substance: number; // 0 | 0.5 | 1 multiplier applied to QUALITY.substance
  code: boolean;
  reference: boolean;
  question: boolean;
  actionable: boolean;
  rationale: boolean;
  ritualOnly: boolean;
}

export interface CommentQuality {
  q: number; // 0-1
  features: QualityFeatures;
}

const FENCED_CODE_RE = /(```|~~~)[\s\S]*?(\1|$)/g;
const SUGGESTION_RE = /```\s*suggestion\b/i;
const URL_RE = /\bhttps?:\/\/[^\s)>\]]+/i;
const ISSUE_REF_RE = /(^|[\s(])#\d+\b/;
// Something like `frontend/src/foo.tsx`, `foo.py:12`, `lib/a/b`, or `L123`/`line 45`.
const PATH_RE = /(^|[\s(`'"])(?:[\w.-]+\/)+[\w.-]+(?::\d+)?\b/;
const FILE_RE = /\b[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|rb|java|kt|sql|md|json|ya?ml|toml|css|scss|html|sh|txt)(?::\d+)?\b/i;
const LINE_REF_RE = /\b(?:L\d+(?:-L?\d+)?|lines?\s+\d+)\b/;
const ACTIONABLE_RE =
  /\b(?:should|could|consider|suggest(?:ion|ed|s)?|instead|what if|nit|let'?s|we can|try)\b/i;
const RATIONALE_RE = /\b(?:because|since|so that|otherwise|leads to|this causes)\b/i;

const RITUAL_TOKENS = new Set([
  "lgtm",
  "+1",
  "thanks",
  "thank",
  "you",
  "thx",
  "ty",
  "done",
  "nice",
  "ok",
  "okay",
  "yes",
  "yep",
  "yup",
  "cool",
  "great",
  "awesome",
  "perfect",
  "sgtm",
  "ship",
  "it",
  "approved",
  "approving",
  "fixed",
  "good",
  "job",
  "work",
  "nit",
  "same",
  "here",
  "wow",
  "amazing",
  "love",
  "this",
  "sure",
  "sounds",
  "agreed",
  "agree",
  "ack",
  "np",
  "yay",
  "looks",
  "me",
  "to",
  "all",
  "lot",
  "a",
  "much",
  "so",
  "very",
  "well",
  "will",
  "do",
]);

// Emoji / symbol / GitHub :shortcode: tokens.
const EMOJI_OR_SYMBOL_RE =
  /(?::[a-z0-9_+-]+:|[\p{Extended_Pictographic}\p{Emoji_Presentation}‍️]|[☀-➿])/gu;

/** Remove quoted (`> ...`) lines and fenced code blocks. */
export function stripQuotesAndCode(body: string): string {
  const noCode = body.replace(FENCED_CODE_RE, " ");
  return noCode
    .split(/\r?\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
}

export function countWords(text: string): number {
  const cleaned = text.replace(EMOJI_OR_SYMBOL_RE, " ");
  const tokens = cleaned.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
  return tokens.length;
}

/**
 * True when the body carries no substance: only ritual words (lgtm, +1,
 * thanks, done, nice...), emoji, or punctuation. Empty bodies are ritual.
 */
export function isRitualOnly(body: string): boolean {
  const text = stripQuotesAndCode(body).replace(EMOJI_OR_SYMBOL_RE, " ").toLowerCase();
  const tokens = text
    .split(/[\s,.!;:()\-]+/)
    .map((t) => t.replace(/^[^\w+]+|[^\w+]+$/g, ""))
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return true;
  // Bounded so a long comment made of ritual words is not mistaken for ritual.
  if (tokens.length > 6) return false;
  return tokens.every((t) => RITUAL_TOKENS.has(t) || /^\+1+$/.test(t));
}

export function scoreComment(body: string): CommentQuality {
  const raw = body ?? "";
  const text = stripQuotesAndCode(raw);
  const words = countWords(text);
  const ritualOnly = isRitualOnly(raw);

  const substance =
    words >= QUALITY.substanceFullWords ? 1 : words >= QUALITY.substanceHalfWords ? 0.5 : 0;
  const code = FENCED_CODE_RE.test(raw) || SUGGESTION_RE.test(raw);
  FENCED_CODE_RE.lastIndex = 0;
  // Quoted lines are someone else's words; references inside them do not count.
  const unquoted = raw
    .split(/\r?\n/)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n");
  const reference =
    URL_RE.test(unquoted) ||
    ISSUE_REF_RE.test(unquoted) ||
    PATH_RE.test(unquoted) ||
    FILE_RE.test(unquoted) ||
    LINE_REF_RE.test(unquoted);
  const question = text.includes("?");
  const actionable = ACTIONABLE_RE.test(text);
  const rationale = RATIONALE_RE.test(text);

  const features: QualityFeatures = {
    words,
    substance,
    code,
    reference,
    question,
    actionable,
    rationale,
    ritualOnly,
  };

  if (ritualOnly) return { q: 0, features };

  let q = 0;
  q += QUALITY.substance * substance;
  if (code) q += QUALITY.code;
  if (reference) q += QUALITY.reference;
  if (question) q += QUALITY.question;
  if (actionable) q += QUALITY.actionable;
  if (rationale) q += QUALITY.rationale;
  q = Math.min(1, Math.max(0, Math.round(q * 1000) / 1000));
  return { q, features };
}
