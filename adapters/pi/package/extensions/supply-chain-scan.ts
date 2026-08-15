/*
 * RespawnPack · adapters/pi/package/extensions/supply-chain-scan.ts
 *
 * Pi extension port of the round3 T1-1 supply-chain-scan (see ATTRIBUTION.md). Preserves the
 * load-bearing semantic: ADVISORY notification when a Bash command fetches third-party code at
 * tool-invocation time without a version pin (or, separately, when it pins but does not vendor).
 *
 * Prior-art evidence: six independently-mined repos ship a runtime-third-party-execution pattern:
 *   - ECC:           npx ecc-agentshield (no pin)
 *   - SuperClaude:   uvx --from git+https://.../airis-agent
 *   - wshobson:      npx --yes protect-mcp@<pinned>  (pinned, unvendored — different risk class)
 *   - BMAD:          npx @kayvan/markdown-tree-parser (no pin)
 *   - spec-kit:      .specify/extensions.yml — auto-executing unaudited extension marketplace
 *   - ruflo:         npx -y ruflo@latest mcp start + live IPFS/Pinata-fetched plugin registry
 *
 * What this hook flags (ADVISORY — a notification, never a block; round3 RESHAPED guidance):
 *   1. npx --yes / -y <pkg>                  without @<version>    → unpinned
 *   2. npx --yes / -y <pkg>@latest            (explicit latest)    → unpinned
 *   3. npx --yes / -y <pkg>@<anything>        (some pin)           → pinned-but-unvendored
 *   4. npx --yes / -y <scoped-pkg>            without @<version>   → unpinned (the @ in scope
 *                                                                breaks naive regexes)
 *   5. pnpm dlx / yarn dlx <pkg>             without @<version>    → unpinned
 *   6. bunx <pkg>                            without @<version>    → unpinned
 *   7. uvx --from <git+...> / uvx <pkg>      without @<version>    → unpinned or git-fetch
 *   8. pip install git+https://...                                  → git-fetch
 *
 * What this hook does NOT flag:
 *   - npm install <pkg>@<version> / pnpm add / yarn add — these go through package.json/lockfile
 *     discipline (the pack's `/secure` Step 2 already covers that surface).
 *   - cargo add / go get — handled by language-native lockfile discipline, not by runtime fetch.
 *   - docker pull — the round3 T1-1 RESHAPED notes explicitly leave container pulls to mcp-reaper's
 *     session-tag / reaper surface, not this hook.
 *   - npm run <script> / npx --no <pkg> — `--no` short-circuits the auto-install, the risk class
 *     disappears. Listed only as a possible opt-in via marker.
 *
 * The wire format mirrors cct's own narrow-as-possible approach: pattern-match the substring
 * `npx`/`pnpm dlx`/etc. followed by a flag-or-arg shape, and report ONE line per match. A single
 * command can fire multiple flags; we report the most-severe class only (pinned-unvendored >
 * unpinned > git-fetch), not a cascade.
 *
 * ⛔ NEVER BLOCKS. The round3 T1-1 RESHAPED audit: "frame the lens as EXTENDING `/secure` Step 2's
 * existing dependency-manifest supply-chain hygiene to the repo's own scripts/hooks/CI/MCP-config
 * surfaces, not as filling a void." The mechanical action is a notification that names the
 * specific risk class and the upstream-source-references the operator should read before
 * re-running. A `block: true` decision would be a different product — and `/secure`'s prose
 * discipline, not this hook's job.
 *
 * ⛔ OPT-OUT: `.respawnpack/supply-chain-scan.off` silences the notification entirely. Symmetric
 *   with the rest of the pack's opt-out markers.
 *
 * ⛔ NO `g` FLAG ON THESE REGEXES. With `g`, exec() mutates `lastIndex` between calls and the
 *   second invocation silently starts the search mid-string, missing earlier matches. Without `g`,
 *   each call searches from index 0 — the only behavior classify() can rely on.
 *
 * ⛔ URL PATTERNS USE `new RegExp(string)` CONSTRUCTOR. A regex literal containing `//`
 *   (e.g. `https?://...`) is parsed as a TypeScript line comment by Node 26+'s native TS stripping,
 *   which fires BEFORE jiti (which is registered via module hooks, after TS stripping). The
 *   string-form constructor sidesteps this entirely; the source still reads as ordinary regex.
 *
 * ⛔ WHAT GETS PASSED THROUGH `classify()` IS THE RAW COMMAND STRING, just like the existing
 *   push-guard / shell-guard / worktree-guard hooks. A wrapper (`sh -c "..."`, `bash -c "..."`,
 *   `eval ...`) does not defeat this hook the way it defeats shell-guard — patterns are anchored
 *   to the substring `npx`/`uvx`/etc. inside the string, so the wrapper just preserves the inner
 *   command (the hook is reading the string the user sees, not the AST).
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

type RiskClass = "unpinned" | "git-fetch" | "pinned-unvendored";

interface Match {
  risk: RiskClass;
  tool: string;
  pkg: string;
  pin: string | null;
  index: number;
}

// NO `g` flag — see file header. Package-name char class excludes `@` so the regex stops at the
// first `@` (the version separator); a naive class that includes `@` is greedy and consumes the
// version too, breaking the match.
const UNPINNED_PATTERNS: Array<{ tool: string; re: RegExp }> = [
  { tool: "npx", re: /\bnpx\b\s+(?:-[yY]\b|--yes\b)\s+(@?[\w./+-]+)/ },
  { tool: "pnpm dlx", re: /\bpnpm\s+dlx\b\s+(@?[\w./+-]+)/ },
  { tool: "yarn dlx", re: /\byarn\s+dlx\b\s+(@?[\w./+-]+)/ },
  { tool: "bunx", re: /\bbunx\b\s+(@?[\w./+-]+)/ },
];

const PINNED_UNVENDORED_PATTERNS: Array<{ tool: string; re: RegExp }> = [
  { tool: "npx", re: /\bnpx\b\s+(?:-[yY]\b|--yes\b)\s+(@?[\w./+-]+)@([^\s/]+)/ },
  { tool: "pnpm dlx", re: /\bpnpm\s+dlx\b\s+(@?[\w./+-]+)@([^\s/]+)/ },
  { tool: "yarn dlx", re: /\byarn\s+dlx\b\s+(@?[\w./+-]+)@([^\s/]+)/ },
  { tool: "bunx", re: /\bbunx\b\s+(@?[\w./+-]+)@([^\s/]+)/ },
];

// Constructed via `new RegExp(string)` rather than a literal so the regex body can contain `//`
// (e.g. the `https?://` in URL patterns) without being parsed as a TS line comment by Node 26+'s
// native TypeScript stripping. The pattern strings are still written as plain regex source so
// they read identically to literal form.
const GIT_FETCH_PATTERNS: Array<{ tool: string; re: RegExp }> = [
  { tool: "uvx", re: new RegExp("\\buvx\\b\\s+(?:--from\\s+)?(git\\+\\S+|https?://\\S+)") },
  // pip install git+... — the (git\+...) capture group is REQUIRED; without it the match returns
  // but m[1] is undefined and classify() cannot name the package.
  { tool: "pip", re: new RegExp("\\bpip(?:3)?\\s+install\\b[^|;&]*(git\\+\\S+)") },
  { tool: "pipx", re: new RegExp("\\bpipx\\s+install\\b[^|;&]*(git\\+\\S+)") },
];

/**
 * Walk every pattern, return the strongest match. Pure.
 *  Ordering matters: PINNED_UNVENDORED matches BEFORE UNPINNED because `npx -y foo@1.2.3` is a
 *  SHAPE that both patterns match (the unpinned one stops at `foo` and ignores the pin); the
 *  riskier classification must win.
 */
function classify(cmd: string): Match | null {
  if (!cmd) return null;
  for (const { tool, re } of PINNED_UNVENDORED_PATTERNS) {
    const m = re.exec(cmd);
    if (m && m[1] && m[2]) {
      return { risk: "pinned-unvendored", tool, pkg: m[1], pin: m[2], index: m.index };
    }
  }
  for (const { tool, re } of UNPINNED_PATTERNS) {
    const m = re.exec(cmd);
    if (m && m[1]) {
      return { risk: "unpinned", tool, pkg: m[1], pin: null, index: m.index };
    }
  }
  for (const { tool, re } of GIT_FETCH_PATTERNS) {
    const m = re.exec(cmd);
    if (m && m[1]) {
      return { risk: "git-fetch", tool, pkg: m[1], pin: null, index: m.index };
    }
  }
  return null;
}

function riskDescription(m: Match): string {
  switch (m.risk) {
    case "unpinned":
      return `${m.tool} ${m.pkg} with no version pin — fetches whatever is current at run time.`;
    case "git-fetch":
      return `${m.tool} ${m.pkg} — fetches and executes code directly from a git URL or HTTP endpoint at run time.`;
    case "pinned-unvendored":
      return `${m.tool} ${m.pkg}@${m.pin} — pinned, but the package is still fetched from the registry at run time (not vendored into the repo).`;
  }
}

function projectDirOf(event: any): string {
  const e = event || {};
  const candidates = [
    e.cwd,
    e.input && e.input.cwd,
    e.projectDir,
    typeof process !== "undefined" && process.env
      ? (process.env.RESPAWN_PI_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR)
      : null,
    typeof process !== "undefined" ? process.cwd() : ".",
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c) return c;
  }
  return ".";
}

function readCommand(event: any): string {
  if (!event || event.toolName !== "bash") return "";
  const input = event.input || {};
  return (typeof input.command === "string" ? input.command : "") || "";
}

export default function (pi: any) {
  pi.on("tool_call", (event: any, ctx: any) => {
    const projectDir = projectDirOf(event);
    try {
      if (existsSync(join(projectDir, ".respawnpack", "supply-chain-scan.off"))) return undefined;
    } catch { /* best-effort */ }

    const cmd = readCommand(event);
    const match = classify(cmd);
    if (!match) return undefined;

    if (ctx && ctx.ui && typeof ctx.ui.notify === "function") {
      const upstream = "round3 T1-1 (6-repo convergence — ECC, SuperClaude, wshobson, BMAD, spec-kit, ruflo; all MIT/Apache-2.0)";
      try {
        ctx.ui.notify(
          `supply-chain-scan: ${riskDescription(match)} ` +
          `Prior-art evidence: ${upstream}. ` +
          `This is ADVISORY (round3 RESHAPED guidance: notify, don't block) — review before re-running, ` +
          `or drop .respawnpack/supply-chain-scan.off to silence.`,
          "warn",
        );
      } catch { /* best-effort */ }
    }
    return undefined; // advisory — never blocks
  });
}

export {
  UNPINNED_PATTERNS,
  PINNED_UNVENDORED_PATTERNS,
  GIT_FETCH_PATTERNS,
  classify,
  riskDescription,
  projectDirOf,
  readCommand,
};
