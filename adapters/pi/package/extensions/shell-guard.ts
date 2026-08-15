/*
 * RespawnPack · adapters/pi/package/extensions/shell-guard.ts
 *
 * Pi extension port of RespawnPack's shell-guard.js PreToolUse hook. Denies categorically-destructive
 * shell commands before the bash tool runs them. Mirrors the JS hook's semantic exactly:
 *
 *   • COMMAND-AWARE detection — not blind string-matching. The command is split quote-aware into
 *     segments and each segment's LEAD WORD is examined. A destructive detector fires only when the
 *     lead word IS that destructive command, so `rm -rf /` denies but `echo "rm -rf /"` and
 *     `git commit -m "rm -rf /"` (the scary text is a quoted ARG = data) do not.
 *
 *   • Layer 1 — direct danger classes on the operative command:
 *       recursive force-remove of a ROOT / HOME / DRIVE-ROOT target only (`rm -rf / | ~ | C:\`,
 *       incl. `--no-preserve-root`) — a specific/relative path like `rm -rf node_modules` is ALLOWED;
 *       filesystem creation (`mkfs …`); raw disk writes (`dd of=/dev/sd…`, `> /dev/sd…`); fork bombs
 *       (`:(){ :|:& };:`); blanket recursive perms on a root (`chmod -R … /`); remote/base64 script
 *       piped into a shell (`curl … | sh`, `base64 -d | sh`).
 *
 *   • Layer 2 — wrapper detection: the SAME analysis re-runs against the inner command of a real
 *     execution wrapper — `sh -c '…'` / `bash -c "…"`, `eval …`, `$(…)`, backticks, `xargs …`. This
 *     is why the upstream pair matters: `sh -c "rm -rf /"`'s raw string ends in `/"`, not `/`, so a
 *     direct anchor misses it until the wrapper is unwrapped. Only *executed* inner strings are
 *     unwrapped (a substitution inside single quotes is literal → left alone), matching real shell
 *     semantics.
 *
 * This is a high-precision safety net, not a sandbox: deeply-obfuscated payloads (opaque base64,
 * variable indirection) are out of scope by design — the goal is to stop the catastrophic-by-accident
 * command.
 *
 * Escape hatch (house convention, same as worktree-guard's .off marker): create
 * <project>/.respawnpack/shell-guard.off to disable, or remove this extension from package.json.
 *
 * Pi contract: this extension subscribes to `tool_call`; only acts when `event.toolName === "bash"`.
 * Reads `event.input.command`. Returns `{block: true, reason}` on hit; returns nothing on miss.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { guardedGovernanceEnabled } from "./governance-profile.ts";

const EXTENSION_NAME = "shell-guard";

// Wrapper/substitution recursion ceiling — guards against pathological nesting.
const MAX_DEPTH = 4;

// A bare root / home / drive-root argument: /, /*, ~, ~/, C:\, C:/, C:\* — but NOT /home, ~/proj, C:\dir.
const ROOT_TARGET = /(?:^|\s)(?:\/\*?|~\/?|[A-Za-z]:[\\/]?\*?)(?=\s|$)/;
// A short-flag cluster containing r/R (-r, -rf, -fr, -R…) — `rm` is recursive only when one is present.
const RECURSIVE = /(?:^|\s)-[a-z]*r/i;
const isRecursive = (s: string): boolean => RECURSIVE.test(s) || /--recursive\b/i.test(s);
const DD_OF_DISK = /\bof=\/dev\/(?:sd|nvme|disk|hd|vd|mmcblk)/i;
const SHELLS = "(?:bash|zsh|dash|ksh|csh|ash|sh)";

// Structural classes (operators live OUTSIDE quotes → tested against a quote-masked view of the command).
const REDIR_DISK = /[>]{1,2}\s*\/dev\/(?:sd|nvme|disk|hd|vd|mmcblk)/i;
const FORKBOMB = /([:\w]+)\s*\(\s*\)\s*\{[^{}]*\|\s*\1[^{}]*&[^{}]*\}\s*;\s*\1/;
const REMOTE_PIPE = new RegExp(`(?:^|[\\n;&|(])\\s*(?:sudo\\s+)?(?:curl|wget|fetch)\\b[^\\n|]*\\|\\s*(?:sudo\\s+)?${SHELLS}\\b`, "i");
const B64_PIPE = new RegExp(`\\bbase64\\b[^\\n|]*(?:-d|--decode)\\b[^\\n|]*\\|\\s*(?:sudo\\s+)?${SHELLS}\\b`, "i");

// Danger-class strings (each quotes the matched class back to the model in the deny reason).
const CLS = {
  RM_ROOT: "recursive force-remove of a root / home / drive-root path (rm -rf / | ~ | C:\\)",
  RM_NPR: "recursive force-remove of the filesystem root (rm … --no-preserve-root)",
  CHMOD_ROOT: "blanket recursive permission change on a root path (chmod -R … /)",
  MKFS: "filesystem creation (mkfs …) — reformats a device",
  DD: "raw write to a disk device (dd of=/dev/sd…)",
  REDIR: "redirect into a disk device (> /dev/sd…)",
  FORK: "fork bomb (self-replicating :(){ :|:& };: shape) — exhausts the process table",
  REMOTE: "remote script piped straight into a shell (curl … | sh) — runs unreviewed remote code",
  B64: "base64-decoded payload piped into a shell — obfuscated code execution",
} as const;

// Replace the CONTENTS of quoted spans with spaces so quoted DATA can't trip a structural operator check,
// while operators outside quotes survive. (Used only for the structural pass.)
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

// Split on shell separators (; | & newline, incl. && ||) that are OUTSIDE quotes.
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

// Capture $( … ) and ` … ` substitutions that actually execute — i.e. anywhere EXCEPT inside single
// quotes (which are literal). Substitutions stay active inside double quotes, matching real shell semantics.
function extractSubstitutions(s: string): string[] {
  const out: string[] = [];
  let single = false;
  let dbl = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (single) { if (ch === "'") single = false; continue; } // literal span — nothing executes
    if (ch === "'") { single = true; continue; }
    if (ch === '"') { dbl = !dbl; continue; }                  // double quotes don't suppress substitution
    if (ch === "`") {
      const j = s.indexOf("`", i + 1);
      if (j > i) { out.push(s.slice(i + 1, j)); i = j; }
      continue;
    }
    if (ch === "$" && s[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      for (; j < s.length && depth; j++) {
        if (s[j] === "(") depth++;
        else if (s[j] === ")") depth--;
      }
      out.push(s.slice(i + 2, j - 1));
      i = j - 1;
    }
  }
  return out;
}

function stripOuterQuotes(t: string): string {
  let s = t.trim();
  const q = s[0];
  if (q === '"' || q === "'" || q === "`") {
    if (s[s.length - 1] === q) return s.slice(1, -1);
    return s.replace(/['"`]/g, " "); // unbalanced → dissolve strays
  }
  return s;
}

// Lead command word of a segment (basename), after stripping env-assignments and benign prefixes.
function leadWord(seg: string): { word: string; args: string } {
  let t = seg.replace(/^[\s(){]+/, "");
  for (;;) {
    const b = t;
    t = t.replace(/^\w+=\S*\s+/, "");                                              // FOO=bar
    t = t.replace(/^(?:sudo|command|env|time|nice|nohup|exec|builtin)\s+/i, "");
    if (t === b) break;
  }
  const m = /^(\S+)/.exec(t);
  const word = m ? m[1] : "";
  return { word: word.toLowerCase().replace(/^.*[\\/]/, ""), args: t.slice(word.length) };
}

function rmDanger(args: string): string | null {
  if (/--no-preserve-root\b/i.test(args)) return CLS.RM_NPR;
  if (!isRecursive(args)) return null;
  return ROOT_TARGET.test(args) ? CLS.RM_ROOT : null;
}

function chmodDanger(args: string): string | null {
  return isRecursive(args) && ROOT_TARGET.test(args) ? CLS.CHMOD_ROOT : null;
}

// Analyse one command string. depth bounds wrapper/substitution recursion. Returns {cls, viaWrapper} or null.
function classify(s: string, depth: number, viaWrapper: boolean): { cls: string; viaWrapper: boolean } | null {
  if (!s || depth > MAX_DEPTH) return null;

  // Structural classes — tested on a quote-masked view so quoted data never trips them.
  const masked = maskQuoted(s);
  if (FORKBOMB.test(masked)) return { cls: CLS.FORK, viaWrapper };
  if (REMOTE_PIPE.test(masked)) return { cls: CLS.REMOTE, viaWrapper };
  if (B64_PIPE.test(masked)) return { cls: CLS.B64, viaWrapper };
  if (REDIR_DISK.test(masked)) return { cls: CLS.REDIR, viaWrapper };

  // Per-segment, command-aware detection.
  for (const seg of splitSegments(s)) {
    const { word, args } = leadWord(seg);

    // Execution wrappers → unwrap and re-analyse the inner command.
    const SHELLS_RE = new RegExp(`^${SHELLS}$`);
    if (SHELLS_RE.test(word)) {
      const m = /(?:^|\s)-c\s+(.+)$/is.exec(args);
      if (m) {
        const r = classify(stripOuterQuotes(m[1]), depth + 1, true);
        if (r) return r;
        continue;
      }
    }
    if (word === "eval") {
      const r = classify(stripOuterQuotes(args.replace(/^\s+/, "")), depth + 1, true);
      if (r) return r;
      continue;
    }
    if (word === "xargs") {
      const after = args.replace(/^(?:\s+-\S+)*\s*/, "");
      const r = classify(after, depth + 1, true);
      if (r) return r;
      continue;
    }

    // Destructive commands — quotes around args are just grouping, so strip them before target analysis.
    const unq = args.replace(/['"`]/g, " ");
    let cls: string | null = null;
    if (word === "rm") cls = rmDanger(unq);
    else if (word === "chmod") cls = chmodDanger(unq);
    else if (word === "dd") cls = DD_OF_DISK.test(unq) ? CLS.DD : null;
    else if (/^mkfs(?:\.[a-z0-9]+)?$/.test(word)) cls = CLS.MKFS;
    if (cls) return { cls, viaWrapper };
  }

  // Command substitutions anywhere (execute unless single-quoted) → recurse.
  for (const inner of extractSubstitutions(s)) {
    const r = classify(inner, depth + 1, true);
    if (r) return r;
  }
  return null;
}

// Resolve the project directory for the off-marker escape hatch. Tolerant: any missing field → cwd.
function projectDirOf(event: any, ctx: any = {}): string {
  const e = event || {};
  if (typeof ctx.cwd === "string" && ctx.cwd) return ctx.cwd;
  if (typeof e.cwd === "string" && e.cwd) return e.cwd;
  if (typeof e.projectDir === "string" && e.projectDir) return e.projectDir;
  if (typeof process !== "undefined" && process.cwd) return process.cwd();
  return ".";
}

function offMarkerEnabled(projectDir: string): boolean {
  try {
    return existsSync(join(projectDir, ".respawnpack", "shell-guard.off"));
  } catch {
    return false;
  }
}

export default function (pi: any) {
  pi.on("tool_call", (event: any, ctx: any) => {
    if (!event || event.toolName !== "bash") return undefined;
    if (!guardedGovernanceEnabled(event, ctx)) return undefined;
    const cmd: string = (event.input && typeof event.input.command === "string") ? event.input.command : "";
    if (!cmd) return undefined;

    const projectDir = projectDirOf(event, ctx);
    if (offMarkerEnabled(projectDir)) return undefined;

    const hit = classify(cmd, 0, false);
    if (!hit) return undefined;

    const reason =
      `🔒 shell-guard blocked this command — ${hit.cls}` +
      (hit.viaWrapper ? " (reached through a shell wrapper / substitution)" : "") +
      `. This class of command is categorically destructive with no legitimate autonomous use in RespawnPack's ` +
      `flows, so it is always denied. If you genuinely need it, disable shell-guard for this repo — create ` +
      `.respawnpack/shell-guard.off (or remove the extension from package.json) — then run it yourself.`;
    return { block: true, reason };
  });
}

export { EXTENSION_NAME, classify, maskQuoted, splitSegments, extractSubstitutions, leadWord };