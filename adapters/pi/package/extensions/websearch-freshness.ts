/*
 * RespawnPack · adapters/pi/package/extensions/websearch-freshness.ts
 *
 * Pi extension port of RespawnPack hooks/websearch-freshness.js. PreToolUse-shaped nudge for the
 * `websearch` tool: if the query pins a year older than the current one, raise the user's awareness
 * so the agent doesn't unknowingly search stale. Complements `/build`'s source-verify-or-UNVERIFIED
 * discipline.
 *
 * ⛔ TWO TIERS, precision-ordered (load-bearing — derived directly from the source hook):
 *
 *   1. AUTO-REWRITE (high-precision only). A stale year paired with a freshness word
 *      ("latest"/"current"/"recent"/…) is a near-certain mistake, so the stale year is rewritten to
 *      the current one via direct mutation of `event.input.query`. A `ctx.ui.notify(...)` reports
 *      the change. This is the narrowest, highest-confidence subset — it does NOT auto-rewrite on a
 *      bare recent year with no freshness word (often deliberate), and NEVER appends a year to a
 *      query that has none (that would pollute evergreen queries like "python list comprehension
 *      syntax").
 *
 *   2. ADVISORY (lower-precision). A recent stale year (within ~4 years) with NO freshness word only
 *      raises a `ctx.ui.notify(...)` suggesting the current year; nothing is rewritten, nothing
 *      blocked. Plainly-historical queries (e.g. "2011 census") stay silent — older than the
 *      "recent-stale" window AND no freshness word, so the user clearly means that year.
 *
 * ⛔ THE PLAINLY-HISTORIAL GATE IS LOAD-BEARING. Without it, the advisory would fire on
 * "2022 world cup final score" (asking about 2022 deliberately). The source's `recentStale = y >= now-4`
 * is preserved verbatim: a year older than that AND no freshness word means the user meant that year.
 *
 * ⛔ NEVER ADD A YEAR. Only substitute a year that is already present in the query. If `matchAll` finds
 * no 20\d{2} token, the extension returns immediately at the top — no advisory, no rewrite.
 *
 * ⛔ THE TIDY STEP IS LOAD-BEARING. The substitution turns "latest 2024 trends" into "latest 2026
 * trends", but a query with TWO stale years (e.g. "compare 2024 vs 2023") collapses to
 * "compare 2026 vs 2026", which is nonsensical. The de-duplication step collapses any \bYYYY(?:\s+YYYY\b)+
 * run into a single current year.
 *
 * Pi contract: subscribes to `tool_call`; only acts when `event.toolName === "websearch"`. Reads
 * `event.input.query`. Mutates `event.input.query` for the rewrite. Pi exposes `event.input` as
 * mutable on `tool_call` (see e.g. secret-scan.ts), which is the equivalent of the source's
 * `hookSpecificOutput.updatedInput` field. Advisory uses `ctx.ui.notify(...)` — the same channel the
 * source uses for `systemMessage`. Never blocks (a year in a query is often deliberate).
 *
 * The freshness-word regex, the year regex, the recent-stale window, the substitution semantics, and
 * the de-duplication step are byte-identical to the source — so findings produced here read identically
 * to findings produced by the Claude Code hook on the same query.
 */

const EXTENSION_NAME = "websearch-freshness";

// Freshness words. Source's FRESH regex, verbatim. A query containing any of these next to a stale
// year is treated as a near-certain typo and auto-rewritten.
const FRESH = /\b(?:latest|current|recent|newest|most[-\s]?recent|up[-\s]?to[-\s]?date|this\s+year|nowadays|today)\b/i;

// 20\d{2} year, used both for detection (`matchAll`) and for per-token substitution (`.replace`).
// Source uses one regex literal for both — same here. Captured group `(\d{4})` is intentional for
// readability; the source uses `m[1]`.
const YEAR_RE = /\b(20\d{2})\b/g;

// Recent-stale window: a year within the last 4 years is plausibly a typo for "current"; anything
// older without a freshness word is treated as plainly historical. Source: `recentStale = y >= now-4`.
const RECENT_STALE_YEARS = 4;

interface RewriteResult {
  readonly rewrote: boolean;
  readonly query: string;
  readonly staleYears: readonly number[];
}

interface TierDecision {
  readonly action: "auto-rewrite" | "advisory" | "silent";
  readonly query: string;
  readonly staleYears: readonly number[];
  readonly worstStale: number | null;
  readonly notify: string | null;
}

// --- tiny readers / normalizers -------------------------------------------------------------------

function currentYear(): number {
  return new Date().getFullYear();
}

/** Extract the de-duplicated list of stale years (>= 2000 && < now) present in `query`. */
function staleYearsOf(query: string, now: number): number[] {
  const found = new Set<number>();
  for (const m of query.matchAll(YEAR_RE)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 2000 && n < now) found.add(n);
  }
  return [...found];
}

/**
 * Substitute every 20\d{2} year that is < now with `now`. Leaves current-year mentions intact.
 * Then collapses any "YYYY YYYY" run the substitution produced (e.g. "2024 vs 2023" → "2026 vs 2026"
 * → "2026") into a single current year. Returns the rewritten string and whether it actually changed.
 */
function rewriteQuery(query: string, now: number): RewriteResult {
  const before = query;
  const stale = staleYearsOf(query, now);
  if (stale.length === 0) return { rewrote: false, query: before, staleYears: [] };

  const rewritten = query.replace(YEAR_RE, (m) => {
    const n = Number(m);
    return n >= 2000 && n < now ? String(now) : m;
  });
  const tidied = rewritten.replace(new RegExp(`\\b${now}(?:\\s+${now}\\b)+`, "g"), String(now));

  return { rewrote: tidied !== before, query: tidied, staleYears: stale };
}

/**
 * The two-tier decision. Returns the action, the (possibly-rewritten) query, the worst stale year,
 * and the notify message to emit — or null notify when the action is silent.
 */
function decide(query: string, now: number): TierDecision {
  const stale = staleYearsOf(query, now);
  if (stale.length === 0) {
    // No year at all — the prompt's "NEVER add a year to a query that has none" rule.
    return { action: "silent", query, staleYears: [], worstStale: null, notify: null };
  }

  const worst = Math.max(...stale);
  const fresh = FRESH.test(query);
  const recentStale = stale.some((y) => y >= now - RECENT_STALE_YEARS);

  // Plainly historical (e.g. "2011 census"): old AND no freshness word → stay silent.
  if (!fresh && !recentStale) {
    return { action: "silent", query, staleYears: stale, worstStale: worst, notify: null };
  }

  // Tier 1 — high-precision auto-rewrite: stale year + freshness word.
  if (fresh) {
    const rw = rewriteQuery(query, now);
    if (rw.rewrote) {
      return {
        action: "auto-rewrite",
        query: rw.query,
        staleYears: rw.staleYears,
        worstStale: worst,
        notify:
          `🔎 websearch-freshness: your websearch query pinned ${worst} next to a freshness word, but ` +
          `the current year is ${now} — I rewrote it to search ${now} instead ("${query}" → ` +
          `"${rw.query}"). If ${worst} was deliberate, search again with the year you meant.`,
      };
    }
    // Fell through (no net change after substitution) → drop to advisory rather than emit a no-op.
  }

  // Tier 2 — advisory only.
  return {
    action: "advisory",
    query,
    staleYears: stale,
    worstStale: worst,
    notify:
      `🔎 websearch-freshness: your websearch query pins ${worst}, but the current year is ${now}. ` +
      `If you want the most up-to-date results, search for ${now} instead (or drop the year). ` +
      `(Advisory — the search was not blocked.)`,
  };
}

// --- notify ----------------------------------------------------------------------------------------

/**
 * User-facing notification. Tries `ctx.ui.notify` first (the documented channel); falls back to
 * `ctx.log`, then `console.error`. Never throws.
 */
function notify(ctx: any, level: "info" | "warning", message: string): void {
  const tagged = `${EXTENSION_NAME}: ${message}`;
  try {
    if (ctx && ctx.ui && typeof ctx.ui.notify === "function") { ctx.ui.notify(tagged, level); return; }
  } catch { /* fall through */ }
  try { if (ctx && typeof ctx.log === "function") { ctx.log(tagged); return; } } catch { /* fall through */ }
  try { if (typeof console !== "undefined") console.error(tagged); } catch { /* nothing left */ }
}

// --- the event handler -----------------------------------------------------------------------------

export default function (pi: any) {
  pi.on("tool_call", (event: any, ctx: any) => {
    if (!event) return undefined;
    if (event.toolName !== "websearch") return undefined;

    const query = (event.input && typeof event.input.query === "string") ? event.input.query : "";
    if (!query) return undefined;

    const now = currentYear();
    const decision = decide(query, now);

    if (decision.action === "silent") return undefined;

    if (decision.action === "auto-rewrite") {
      // Pi's `tool_call` exposes `event.input` as mutable — see e.g. secret-scan.ts header comment.
      // Mutating the field IS the rewrite, equivalent to the source's hookSpecificOutput.updatedInput.
      event.input.query = decision.query;
      notify(ctx, "info", decision.notify!);
      return undefined;
    }

    // Tier 2 — advisory only.
    notify(ctx, "warning", decision.notify!);
    return undefined;
  });
}

export {
  EXTENSION_NAME,
  FRESH,
  YEAR_RE,
  RECENT_STALE_YEARS,
  currentYear,
  staleYearsOf,
  rewriteQuery,
  decide,
  notify,
};
