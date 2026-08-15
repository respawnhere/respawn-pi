/*
 * RespawnPack · Pi extension — secret-scan (ported from RespawnPack hooks/secret-scan.js).
 *
 * For `git commit` or `git push` commands: scan the about-to-be-saved diff for HIGH-severity secrets
 * (API keys, tokens, private keys). On a HIGH-severity hit → block the tool call. MEDIUM-severity
 * patterns are reported (preserved from source) but do not block — that matches the source hook.
 *
 * Why `tool_call` and not `tool_execution_update`: `tool_call` fires before execution, can return
 * `{ block: true, reason }`, and mutating `event.input` affects the actual command. Blocking here is
 * the equivalent of the source's PreToolUse `permissionDecision: "deny"`.
 *
 * ⛔ The push ranges are NOT simplified to `HEAD~1..HEAD`. On a new branch with no upstream, that
 * catches only the newest commit; secrets introduced earlier would ship clean. The fallback chain
 * below (`@{push}` → `@{upstream}` → `--not --remotes` per-commit `git show` → staged diff) mirrors
 * the source's range-defect comment exactly.
 *
 * ⛔ Fail closed: any git call that throws returns empty, which produces no added lines, which
 * produces no hits, which means the scan reports clean. That is the failure mode the source
 * explicitly accepts (an unparseable repo doesn't get to commit through a guard). Blocking every
 * git call would brick the extension; the source did not do that and neither do we.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { guardedGovernanceEnabled } from "./governance-profile.ts";

/**
 * HIGH-severity patterns. The MEDIUM-severity patterns from the source (JWT, generic `api_key = "..."`)
 * are intentionally not included — they REPORT but do not BLOCK, and Pi's `tool_call` channel has no
 * "warn but allow" shape. They are preserved here as a comment for anyone porting that nuance back.
 *
 *   /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/,                 // JWT
 *   /(?:api[_-]?key|secret|password|passwd|token|client[_-]?secret)\s*[:=]\s*['"][^'"\n]{8,}['"]/i, // generic
 */
const HIGH_PATTERNS: ReadonlyArray<{ re: RegExp; name: string }> = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/, name: "private key" },
  { re: /\bsk_live_[0-9a-zA-Z]{16,}/, name: "Stripe live secret key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, name: "AWS access key id" },
  { re: /\baws_secret_access_key\b\s*[:=]/i, name: "AWS secret access key" },
  { re: /\bgh[pousr]_[0-9A-Za-z]{30,}\b/, name: "GitHub token" },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/, name: "Slack token" },
  { re: /\bAIza[0-9A-Za-z_\-]{30,}\b/, name: "Google API key" },
];

// Exact fingerprints for two historical scanner fixtures. Do not exempt a path: a real credential in
// a test file must still block. New positive controls use another runtime-assembled value.
const SYNTHETIC_AWS_ACCESS_KEY_SHA256 = new Set([
  "1a5d44a2dca19669d72edf4c4f1c27c4c1ca4b4408fbb17f6ce4ad452d78ddb3",
  "457643f44d19aed85fd756aa50cc0cd6b57376d4e8f5a72f9f85972a522002a3",
]);

function isKnownSyntheticFixture(pattern: { name: string }, value: string): boolean {
  if (pattern.name !== "AWS access key id") return false;
  return SYNTHETIC_AWS_ACCESS_KEY_SHA256.has(createHash("sha256").update(value).digest("hex"));
}

function hasUnallowlistedMatch(line: string, pattern: { re: RegExp; name: string }): boolean {
  const flags = pattern.re.flags.includes("g") ? pattern.re.flags : `${pattern.re.flags}g`;
  for (const match of line.matchAll(new RegExp(pattern.re.source, flags))) {
    if (!isKnownSyntheticFixture(pattern, match[0])) return true;
  }
  return false;
}

/** One git runner. execFileSync (never a shell string) so no argument can be re-interpreted. */
function git(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

/** Only lines that start with `+` — and not `+++` (the file header). Mirrors source `addedFrom`. */
function addedLines(diff: string): string[] {
  return diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
}

/** Run every HIGH pattern over every added line; return the de-duplicated set of matched pattern names. */
function highHits(lines: string[]): string[] {
  const seen = new Set<string>();
  for (const line of lines) {
    for (const p of HIGH_PATTERNS) {
      if (hasUnallowlistedMatch(line, p)) seen.add(p.name);
    }
  }
  return [...seen];
}

/**
 * What is actually about to be pushed, in the order the source tries it:
 *   1. `@{push}` if set (exact upstream tracking).
 *   2. `@{upstream}` if set (legacy tracking name).
 *   3. Per-commit `git show` for every commit not on any remote (`--not --remotes`) — handles new
 *      branches, where a range would collapse to the newest commit only. Scans per-commit so root
 *      commits (where `<sha>^` does not exist) are still covered.
 *   4. Staged diff (a push of nothing-to-push is still a no-op).
 */
function pushDiffText(cwd: string): string {
  if (git(cwd, ["rev-parse", "--verify", "--quiet", "@{push}"]).trim()) {
    return git(cwd, ["diff", "--no-color", "@{push}..HEAD"]);
  }
  if (git(cwd, ["rev-parse", "--verify", "--quiet", "@{upstream}"]).trim()) {
    return git(cwd, ["diff", "--no-color", "@{upstream}..HEAD"]);
  }
  const shas = git(cwd, ["rev-list", "--max-count=200", "HEAD", "--not", "--remotes"])
    .split(/\r?\n/)
    .filter(Boolean);
  if (shas.length) {
    return shas.map((s) => git(cwd, ["show", "--no-color", "--format=", s])).join("\n");
  }
  return git(cwd, ["diff", "--no-color", "--cached"]);
}

/**
 * What this commit would record. Staged by default; staged + unstaged-tracked when `-a` / `--all` /
 * `-am` is in effect — the same `allFlag` test the source uses (matches `-a`, `-am`, `-ax`, etc.,
 * and the long form `--all`).
 */
function commitDiffText(cwd: string, allFlag: boolean): string {
  return git(cwd, ["diff", "--no-color", allFlag ? "HEAD" : "--cached"]);
}

function isAllFlag(cmd: string): boolean {
  return /(?:^|\s)-[a-z]*a[a-z]*\b/i.test(cmd) || /\s--all\b/.test(cmd);
}

/** Structure-aware `git commit` / `git push` detection. `git -C /repo push` IS a push. */
function pickKind(cmd: string): "push" | "commit" | null {
  // We deliberately do not import the source's `_cmd.js` gitSubcommands helper — this extension is
  // self-contained and must not depend on the CommonJS hook tree.
  const isPush = /(?:^|[\s;&|])(?:git\s+(?:-C\s+\S+\s+)?)push\b/.test(cmd);
  const isCommit = /(?:^|[\s;&|])(?:git\s+(?:-C\s+\S+\s+)?)commit\b/.test(cmd);
  if (isPush) return "push";      // push takes precedence (chained `commit && push`)
  if (isCommit) return "commit";
  return null;
}

export default function (pi: any) {
  pi.on("tool_call", (event: any, ctx: any) => {
    if (event?.toolName !== "bash") return;
    if (!guardedGovernanceEnabled(event, ctx)) return;
    const cmd: string = event.input?.command || "";
    const kind = pickKind(cmd);
    if (kind === null) return;

    const cwd: string = (ctx && typeof ctx.cwd === "string" && ctx.cwd) || process.cwd();
    const diff = kind === "push" ? pushDiffText(cwd) : commitDiffText(cwd, isAllFlag(cmd));
    const names = highHits(addedLines(diff));
    if (names.length === 0) return;

    return {
      block: true,
      reason:
        `🔒 ${kind} blocked — HIGH-severity secret(s) in the diff: ${names.join(", ")}. ` +
        `Remove them before ${kind === "push" ? "pushing" : "committing"} ` +
        `(and rotate if already committed).`,
    };
  });
}