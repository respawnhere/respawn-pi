/*
 * RespawnPack · adapters/pi/package/extensions/docker-session-tag.ts
 *
 * Pi extension port of RespawnPack hooks/docker-session-tag.js. Stamps plain, leading
 * `docker run …` / `docker create …` so the container is (a) session-scoped and (b) humanly
 * identifiable — the two properties the owner's container-lifecycle policy needs to reap AI-started
 * containers safely at session boundaries (see mcp-reaper.js). RespawnPack-original (see ATTRIBUTION.md).
 *
 * WHAT IT INJECTS, immediately after the `run`/`create` subcommand:
 *   • `--label respawnpack.session=<session_id>`  — ALWAYS (this is what mcp-reaper filters on at SessionEnd).
 *   • `--name respawnpack-<imagebase>-<4hex>`      — ONLY when the command has no `--name` already AND the
 *                                                     image basename parsed with confidence (else skipped —
 *                                                     the label alone is enough; the name is cosmetic).
 * It deliberately does NOT inject a CLASS label: the human/AI declares `--label respawnpack.class=temp` for a
 * disposable on purpose, and absence-of-class = infra = stop-only at reap time (the safe default). So a wrong
 * guess here can never escalate a container to "removable" — only an explicit temp label does that.
 *
 * PRECISION FIRST — rewrite only the case we can parse with confidence; ADVISE (never mis-rewrite) otherwise:
 *   • Only a SINGLE, plain, LEADING `docker run`/`create` is rewritten. Multi-line / heredoc / `&&`-chained
 *     multiple docker runs / a docker run that is not the first command → advisory notify instead.
 *   • `docker compose up -d` (and legacy `docker-compose up -d`) → advisory ONLY: compose has per-service
 *     label semantics (labels live under each service in the compose file), so this extension never rewrites it.
 *   • Image parsing is best-effort and self-aware: an unknown flag whose value-arity we can't determine → we
 *     skip the NAME (keep the label). The label is always placed right after the subcommand, which is valid
 *     regardless of the rest of the command.
 *   • A malformed/absent session id, or a session id outside [A-Za-z0-9._-] (Claude session ids are UUIDs),
 *     → advisory rather than embedding an unvalidated value into a shell command string.
 *
 * Mirrors websearch-freshness.ts's verified output contract: a rewrite mutates `event.input.command` in
 * place (the equivalent of the source's `hookSpecificOutput.updatedInput` field) and emits a one-line
 * `ctx.ui.notify(...)`; an advisory is a bare `ctx.ui.notify(...)`. Never blocks (a docker run is
 * legitimate; the worst we do is decline to rewrite and remind the convention).
 *
 * Opt-out: `.respawnpack/docker-session-tag.off` in the project dir.
 *
 * Pi contract: subscribes to `tool_call`; only acts when `event.toolName === "bash"`. Reads
 * `event.input.command`. Mutates `event.input.command` (Pi exposes `event.input` as mutable on `tool_call`
 * — see e.g. secret-scan.ts and websearch-freshness.ts). Advisory uses `ctx.ui.notify(...)` — the same
 * channel the source uses for `systemMessage`. Never blocks.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const EXTENSION_NAME = "docker-session-tag";

// Docker `run`/`create` SHORT flags: boolean (consume no following token) vs value-taking (consume one).
// Everything unknown biases toward "skip the name," never toward mistaking a flag value for the image.
const BOOL_SHORT = new Set<string>(["d", "i", "t", "P"]);                    // -d -i -t (and clusters like -it), -P
const VALUE_SHORT = new Set<string>(["e", "p", "v", "l", "u", "w", "m", "h", "a"]); // -e -p -v -l -u -w -m -h -a
const BOOL_LONG = new Set<string>([
  "--detach", "--interactive", "--tty", "--rm", "--privileged", "--init", "--read-only", "--publish-all",
  "--no-healthcheck", "--oom-kill-disable", "--sig-proxy", "--disable-content-trust", "--quiet", "--help",
]);

// Convention reminder string, shared by every advisory path. Source: `CONVENTION` constant, verbatim.
const CONVENTION =
  'Label AI-started containers so they can be closed out: `--label respawnpack.session=<id>`, a human ' +
  '`--name <project>-<service>`, and `--label respawnpack.class=temp` for disposables (stop+rm at session ' +
  'end). Unlabeled = infra = stop-only; `--label respawnpack.keep=true` survives session end.';

// ---------------------------------------------------------------------------------------------------
// shell parsing — byte-for-byte the source's tokenizer / segmenter / quote-masker / lead-parse
// ---------------------------------------------------------------------------------------------------

// Quote-aware tokenizer: split into shell-ish tokens, honoring '…' and "…" as grouping (quotes stripped).
function tokenize(s: string): string[] {
  const toks: string[] = [];
  let cur = "";
  let q: string | null = null;
  let has = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) q = null;
      else cur += ch;
      has = true;
      continue;
    }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { if (has) { toks.push(cur); cur = ""; has = false; } continue; }
    cur += ch;
    has = true;
  }
  if (has) toks.push(cur);
  return toks;
}

// Split a command into shell segments on ; | & (incl. && ||) and newlines that are OUTSIDE quotes.
function splitSegments(s: string): string[] {
  const segs: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { q = ch; cur += ch; continue; }
    if (ch === ";" || ch === "\n" || ch === "|" || ch === "&") {
      segs.push(cur);
      cur = "";
      while (i + 1 < s.length && (s[i + 1] === "|" || s[i + 1] === "&")) i++;
      continue;
    }
    cur += ch;
  }
  if (cur) segs.push(cur);
  return segs.filter((x) => x.trim().length > 0);
}

// Mask quoted spans (contents → spaces) so a docker-run mention that is only quoted DATA can't trip the
// advisory fallback (e.g. `echo "docker run nginx"` stays silent).
function maskQuoted(s: string): string {
  let out = "";
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      out += ch === q ? ((q = null), " ") : " ";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { q = ch; out += " "; continue; }
    out += ch;
  }
  return out;
}

interface SegaLead { word: string; sub: string; after: string; }

// Lead parse of a segment: strip env-assignments + benign prefixes (sudo/env/…), return the binary basename
// (`word`), its next token (`sub`), and everything after the binary (`after`, which starts at `sub`).
function segLead(seg: string): SegaLead {
  let t = seg.replace(/^[\s(]+/, "");
  for (;;) {
    const b = t;
    t = t.replace(/^\w+=\S*\s+/, "");                                              // FOO=bar
    t = t.replace(/^(?:sudo|command|env|time|nice|nohup|exec)\s+/i, "");           // benign launch prefixes
    if (t === b) break;
  }
  const m = /^(\S+)\s*(\S*)/.exec(t);
  if (!m) return { word: "", sub: "", after: "" };
  const word = m[1].toLowerCase().replace(/^.*[\\/]/, "");
  const sub = (m[2] || "").toLowerCase();
  const after = t.slice(m[1].length).replace(/^\s+/, "");
  return { word, sub, after };
}

const isDockerRun = (lead: SegaLead): boolean =>
  lead.word === "docker" && (lead.sub === "run" || lead.sub === "create");

function isComposeUpDetached(lead: SegaLead): boolean {
  let composeArgs: string | null = null;
  if (lead.word === "docker-compose") composeArgs = lead.after;                       // "up -d …"
  else if (lead.word === "docker" && lead.sub === "compose") composeArgs = lead.after.replace(/^compose\s*/i, "");
  else return false;
  const hasUp = /(?:^|\s)up(?:\s|$)/.test(composeArgs);
  const hasDetach =
    /(?:^|\s)(?:-d|--detach)(?:\s|$)/.test(composeArgs) ||
    /(?:^|\s)-[a-z]*d[a-z]*(?:\s|$)/i.test(composeArgs);
  return hasUp && hasDetach;
}

interface ShortFlagClass { consume: boolean; confident: boolean; }

// A short-flag token like "-it": does it consume the NEXT token as a value? {consume, confident}.
function classifyShort(tok: string): ShortFlagClass {
  const body = tok.slice(1);
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (BOOL_SHORT.has(c)) continue;
    if (VALUE_SHORT.has(c)) return { consume: i === body.length - 1, confident: true }; // last→next token, else attached value
    return { consume: false, confident: false };                                        // unknown short flag → bail
  }
  return { consume: false, confident: true };                                           // all-boolean cluster
}

// Walk the args after run/create and return the first non-flag token (the IMAGE), or null if not confident.
function parseImage(argToks: string[]): string | null {
  let i = 0;
  while (i < argToks.length) {
    const tok = argToks[i];
    if (tok === "--") { i++; break; }                         // explicit end-of-flags → next token is the image
    if (tok.startsWith("--")) {
      if (tok.includes("=")) { i++; continue; }               // --flag=value  → self-contained
      if (BOOL_LONG.has(tok)) { i++; continue; }              // known boolean → no value
      i += 2; continue;                                        // assume value-taking long flag → skip its value
    }
    if (tok.startsWith("-") && tok.length > 1) {
      const { consume, confident } = classifyShort(tok);
      if (!confident) return null;
      i += consume ? 2 : 1;
      continue;
    }
    return tok;                                                // first bare token → the image
  }
  return argToks[i] || null;                                   // token right after `--`, if any
}

// image ref → sanitized basename sans registry path / tag / digest. '' if nothing usable survives.
function imageBase(ref: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(ref)) return ""; // not a plausible image ref → not confident
  const noDigest = ref.split("@")[0];
  const afterSlash = noDigest.slice(noDigest.lastIndexOf("/") + 1);       // strip registry/namespace path
  const colon = afterSlash.lastIndexOf(":");
  const noTag = colon >= 0 ? afterSlash.slice(0, colon) : afterSlash;     // strip :tag (safe: after last '/')
  return noTag.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------------------------------
// session id, docker availability, off-marker
// ---------------------------------------------------------------------------------------------------

function projectDirOf(event: any): string {
  const e = event || {};
  if (typeof e.cwd === "string" && e.cwd) return e.cwd;
  if (typeof e.projectDir === "string" && e.projectDir) return e.projectDir;
  if (typeof process !== "undefined" && process.cwd) return process.cwd();
  return ".";
}

function offMarkerEnabled(projectDir: string): boolean {
  try {
    return existsSync(join(projectDir, ".respawnpack", "docker-session-tag.off"));
  } catch {
    return false;
  }
}

/**
 * Best-effort: returns true iff `docker version` is on PATH and answers within 5s. Wrapped in execFileSync
 * (no shell) so a hostile PATH can't relaunch anything. The hook is GRACEFUL when Docker is missing — it
 * simply doesn't rewrite anything, never blocks.
 */
function dockerAvailable(): boolean {
  try {
    execFileSync("docker", ["version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the session id from Pi's context. Mirrors the source's preference order: event.session_id first,
 * then ctx.session_id, then ctx.session.id, then ctx.sessionManager.getSessionId(). Never throws.
 * Returns null when no field is present — the source then treats that as malformed and advises.
 */
function sessionIdOf(ctx: any, event: any): string | null {
  const e = event || {};
  if (typeof e.sessionId === "string" && e.sessionId) return e.sessionId;
  if (typeof e.session_id === "string" && e.session_id) return e.session_id;
  const c = ctx || {};
  if (typeof c.sessionId === "string" && c.sessionId) return c.sessionId;
  if (c.session && typeof c.session.id === "string" && c.session.id) return c.session.id;
  if (c.sessionManager && typeof c.sessionManager.getSessionId === "function") {
    try { const v = c.sessionManager.getSessionId(); if (typeof v === "string" && v) return v; } catch { /* absent */ }
  }
  if (typeof c.getSessionId === "function") {
    try { const v = c.getSessionId(); if (typeof v === "string" && v) return v; } catch { /* absent */ }
  }
  return null;
}

function isValidSessionId(s: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(s);
}

// ---------------------------------------------------------------------------------------------------
// notify
// ---------------------------------------------------------------------------------------------------

function notify(ctx: any, level: "info" | "warning", message: string): void {
  const tagged = `${EXTENSION_NAME}: ${message}`;
  try {
    if (ctx && ctx.ui && typeof ctx.ui.notify === "function") { ctx.ui.notify(tagged, level); return; }
  } catch { /* fall through */ }
  try { if (ctx && typeof ctx.log === "function") { ctx.log(tagged); return; } } catch { /* fall through */ }
  try { if (typeof console !== "undefined") console.error(tagged); } catch { /* nothing left */ }
}

// ---------------------------------------------------------------------------------------------------
// the rewrite itself
// ---------------------------------------------------------------------------------------------------

interface RewriteOutcome {
  readonly rewritten: string | null; // null when we chose NOT to rewrite (advisory path)
  readonly advisory: string | null;   // set → notify; null → silent success
  readonly labelFlag: string | null;
  readonly nameFlag: string | null;
  readonly sub: string | null;
}

/**
 * The decision. Returned in one shape so the handler can branch on a single value. Either:
 *   • `rewritten` is set (with the label/name flag strings populated) → handler mutates event.input.command.
 *   • `advisory` is set → handler notifies and leaves the command alone.
 *   • both null → nothing to do.
 *
 * The conservative parser (heredocs / multi-line / multiple docker runs / unknown flag arity /
 * `docker compose up -d`) is preserved verbatim from the source — load-bearing, since a wrong write
 * could label the wrong container (or worse, escalate a container to removable by mistake).
 */
function decide(cmd: string, sessionId: string): RewriteOutcome {
  const segs = splitSegments(cmd);
  if (segs.length === 0) return { rewritten: null, advisory: null, labelFlag: null, nameFlag: null, sub: null };

  const firstLead = segLead(segs[0]);
  if (!isDockerRun(firstLead)) {
    // Compose up -d path → advisory.
    if (isComposeUpDetached(firstLead)) return {
      rewritten: null,
      advisory:
        '🐳 RespawnPack docker-session-tag: docker compose uses per-service label semantics, so I will not ' +
        'rewrite the command — add labels under each service in the compose file instead (`labels: ' +
        '["respawnpack.session=<id>", "respawnpack.class=temp"]`). Unlabeled services default to infra ' +
        '(stop-only); `respawnpack.keep=true` survives session end.',
      labelFlag: null, nameFlag: null, sub: null,
    };
    // A real (unquoted) docker run/create that wasn't the clean leading command → advise; else stay silent.
    if (/\bdocker\s+(?:run|create)\b/.test(maskQuoted(cmd))) return {
      rewritten: null,
      advisory:
        '🐳 RespawnPack docker-session-tag: left this command unchanged — I only auto-label a single, plain, ' +
        'leading `docker run`/`docker create` (this looked multi-line, chained, wrapped, or otherwise ' +
        'ambiguous, so I did not risk a bad rewrite). ' + CONVENTION,
      labelFlag: null, nameFlag: null, sub: null,
    };
    return { rewritten: null, advisory: null, labelFlag: null, nameFlag: null, sub: null };
  }

  // Leading docker run/create — the only rewrite path.
  if (!isValidSessionId(sessionId)) {
    // Missing/odd session id → advisory rather than embedding an unvalidated value into a shell command.
    return {
      rewritten: null,
      advisory:
        '🐳 RespawnPack docker-session-tag: left this command unchanged — Pi exposed no session id in the ' +
        'expected shape, so I did not risk embedding an unvalidated value into a shell command. ' + CONVENTION,
      labelFlag: null, nameFlag: null, sub: null,
    };
  }

  const runSegs = segs.filter((s) => isDockerRun(segLead(s)));
  const tooComplex = /\n/.test(cmd) || /<</.test(cmd) || runSegs.length > 1; // multi-line / heredoc / multiple runs
  if (tooComplex) {
    return {
      rewritten: null,
      advisory:
        '🐳 RespawnPack docker-session-tag: left this command unchanged — I only auto-label a single, plain, ' +
        'leading `docker run`/`docker create` (this looked multi-line, chained, wrapped, or otherwise ' +
        'ambiguous, so I did not risk a bad rewrite). ' + CONVENTION,
      labelFlag: null, nameFlag: null, sub: null,
    };
  }

  // Build the injection: label always; name only if unnamed and the image parsed with confidence.
  const labelFlag = `--label respawnpack.session=${sessionId}`;
  const argToks = tokenize(firstLead.after.replace(/^\S+\s*/, "")); // args after the subcommand
  const hasName = argToks.some((t) => t === "--name" || t.startsWith("--name="));
  let nameFlag = "";
  if (!hasName) {
    const img = parseImage(argToks);
    const base = img ? imageBase(img) : "";
    if (base) nameFlag = `--name respawnpack-${base}-${randomBytes(2).toString("hex")}`;
  }

  // Anchor at the leading `docker <sub>` (mirroring segLead's prefix stripping) and splice in right after it.
  const anchor = new RegExp(
    `^(\\s*(?:(?:\\w+=\\S*|sudo|command|env|time|nice|nohup|exec)\\s+)*docker\\s+${firstLead.sub})\\b`, "i");
  const m = anchor.exec(cmd);
  if (!m) {
    // Couldn't confidently locate the splice point → advise instead of guess.
    return {
      rewritten: null,
      advisory:
        '🐳 RespawnPack docker-session-tag: left this command unchanged — I only auto-label a single, plain, ' +
        'leading `docker run`/`docker create` (this looked too ambiguous to splice into safely). ' + CONVENTION,
      labelFlag: null, nameFlag: null, sub: null,
    };
  }

  const inject = " " + labelFlag + (nameFlag ? " " + nameFlag : "");
  const rewritten = cmd.slice(0, m[0].length) + inject + cmd.slice(m[0].length);

  return {
    rewritten,
    advisory: null,
    labelFlag,
    nameFlag: nameFlag || null,
    sub: firstLead.sub,
  };
}

// ---------------------------------------------------------------------------------------------------
// the handler
// ---------------------------------------------------------------------------------------------------

export default function (pi: any) {
  // Docker availability is evaluated once per Pi process — the source's `execFileSync` per-call is fine
  // but the answer doesn't change between calls, and the timeout is a noticeable pause on hot paths.
  const docker = dockerAvailable();

  pi.on("tool_call", (event: any, ctx: any) => {
    if (!event || event.toolName !== "bash") return undefined;

    const cmd = (event.input && typeof event.input.command === "string") ? event.input.command : "";
    if (!cmd) return undefined;

    if (!docker) return undefined; // graceful when Docker is missing

    const projectDir = projectDirOf(event);
    if (offMarkerEnabled(projectDir)) return undefined;

    // The source's `adviseGeneric` on a missing/odd session id is preserved — we still invoke decide()
    // with an empty session id so the user gets the convention reminder rather than a silent skip.
    const sid = sessionIdOf(ctx, event) || "";
    const outcome = decide(cmd, sid);

    if (outcome.rewritten !== null) {
      // Pi's `tool_call` exposes `event.input` as mutable — see e.g. secret-scan.ts and websearch-freshness.ts.
      // Mutating the field IS the rewrite, equivalent to the source's hookSpecificOutput.updatedInput.
      event.input.command = outcome.rewritten;
      notify(ctx, "info",
        `🐳 RespawnPack docker-session-tag: added ${outcome.labelFlag}${outcome.nameFlag ? ' ' + outcome.nameFlag : ''}` +
        ` to your docker ${outcome.sub} so this container is session-scoped${outcome.nameFlag ? ' and human-identifiable' : ''}. ` +
        `It defaults to infra (stopped, never removed, at session end) — add \`--label respawnpack.class=temp\` ` +
        `to make it a disposable (stop+rm), or \`--label respawnpack.keep=true\` to survive session end.`);
      return undefined;
    }

    if (outcome.advisory) {
      notify(ctx, "warning", outcome.advisory);
      return undefined;
    }

    return undefined;
  });
}

export {
  EXTENSION_NAME,
  BOOL_SHORT,
  VALUE_SHORT,
  BOOL_LONG,
  CONVENTION,
  tokenize,
  splitSegments,
  maskQuoted,
  segLead,
  isDockerRun,
  isComposeUpDetached,
  classifyShort,
  parseImage,
  imageBase,
  decide,
  dockerAvailable,
  sessionIdOf,
  isValidSessionId,
  offMarkerEnabled,
};
