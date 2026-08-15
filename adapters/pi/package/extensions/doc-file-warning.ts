/*
 * RespawnPack · adapters/pi/package/extensions/doc-file-warning.ts
 *
 * Pi extension port of the ECC pre:write:doc-file-warning hook (MIT, see ATTRIBUTION.md). Preserves
 * the load-bearing semantic: ADVISORY notification when the agent writes a documentation file to a
 * non-canonical location. Not a block — pattern-matching on filenames is too imprecise to deny
 * work over, and a legitimate `.md` file in an unexpected place is a learning opportunity, not a
 * failure. The notification asks the agent to reconsider in the rare case the placement is wrong.
 *
 * Prior-art evidence: catalog-walk-cct-hooks.md §10 (file-protection, plan-gate, scope-guard) names
 * a family of "where SHOULD this file go" hooks. cct's `doc-file-warning` is the simplest member
 * of that family — `📁 → 📝`, "you just wrote a doc, is that the right place?" — and the ECC
 * re-implementation is what we port. RespawnPack's own docs spine (`docs/`, `.claude/`, `README.md`,
 * `AGENTS.md`) is the canonical answer, with no judgement-call heuristics.
 *
 * The pack's spine (spine/README.md: "The #1 cause of documentation drift is treating all four
 * [canonical/derived/reference/_archive] classes the same") treats canonical-location confusion as
 * one of the load-bearing drift vectors. This extension is the lightest possible mechanical nudge
 * against it — a systemMessage, not a block, and only for the patterns most likely to be drift.
 *
 * Pi contract: subscribes to `tool_call` for write. Filters on `event.toolName === "write"` AND
 * `event.input.file_path` ending in a documentation extension (`.md`, `.mdx`, `.markdown`,
 * `.txt`, `.rst`, `.adoc`). Acts ONLY when the resolved path is OUTSIDE the canonical set, and
 * only when the file does not yet exist (a fresh write, not an edit — edits to an already-placed
 * file are not drift, they're the canonical file being maintained).
 *
 * Canonical = the path resolves under any of:
 *   - <project>/docs/                              — the docs spine
 *   - <project>/.claude/                           — the harness config dir (CLAUDE.md, settings docs)
 *   - <project>/spine/                             — the spine templates (when the agent's repo IS the pack)
 *   - the file is the project's <root>/README.md   — the conventional top-level doc
 *   - the file is the project's <root>/AGENTS.md   — the cross-tool conventions file
 *   - the file is the project's <root>/CONTRIBUTING.md — the conventional contribution doc
 *   - the file is the project's <root>/CHANGELOG.md   — the conventional history doc
 *
 * Anything else with a doc extension gets a notification naming the canonical directories it should
 * have lived in. Exempt from the notification:
 *   - files inside any `node_modules/`, `.git/`, `.respawnpack/runtime/`, `dist/`, `build/`, or
 *     `.next/` tree (vendored or generated docs are someone else's problem);
 *   - files whose basename starts with `.` (hidden dotfiles — e.g. a `.changelog.md`);
 *   - non-doc extensions (this hook is doc-only; `README.md` is the load-bearing case, not
 *     `package.json`, but a `.txt` of release notes under `releases/` is also out of scope and
 *     in scope simultaneously — pattern-match is the right boundary, not file-type judgement).
 *
 * ⛔ NEVER BLOCKS. The cct upstream's own header ("only warns") and the round3 verifier's
 * T3-3 audit ("evidence is one hooks-census line from a single repo, no elaboration on the
 * detection mechanism") both land on the same place: a notification, not a deny. The pack's own
 * behavior-standards are an agent-read concern, not a hook-enforced one, and this extension is
 * the lightest possible nudge in that direction.
 *
 * ⛔ OPT-OUT: a `.respawnpack/doc-file-warning.off` marker disables the notification entirely. The
 * marker is read on every tool_call so dropping it in mid-session takes effect immediately.
 * Symmetric with shell-guard / push-guard / worktree-guard / docker-session-tag / mcp-reaper's
 * own opt-out markers — a single opt-out shape across the pack.
 */

import { existsSync } from "node:fs";
import { join, relative, resolve as resolvePath, sep } from "node:path";

const DOC_EXTS: ReadonlySet<string> = new Set([
  ".md", ".mdx", ".markdown", ".txt", ".rst", ".adoc",
]);

// Canonical paths under the project root — files under any of these are NOT warned about.
const CANONICAL_DIRS: ReadonlyArray<string> = [
  "docs",
  ".claude",
  "spine", // when the project IS the pack, the spine templates live under spine/
];

// Canonical root-level doc files — basename-only match, case-sensitive on Linux/macOS.
const CANONICAL_ROOT_FILES: ReadonlySet<string> = new Set([
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
]);

// Paths under any of these segment-prefixes are exempt — vendored / generated / runtime docs are
// not drift we want to surface. Matched on path SEGMENT, not substring, so `.respawnpack/` matches
// but `docs.notrespawnpack/` doesn't.
const EXEMPT_SEGMENT_PREFIXES: ReadonlyArray<string> = [
  "node_modules",
  ".git",
  ".respawnpack",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".cache",
  "coverage",
  "vendor",
];

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

function extOf(p: string): string {
  const i = p.lastIndexOf(".");
  return i === -1 ? "" : p.slice(i).toLowerCase();
}

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf(sep));
  return i === -1 ? p : p.slice(i + 1);
}

function isExemptBySegment(rel: string): boolean {
  // Split on every separator; reject if ANY leading-or-trailing-empty segment matches an exempt prefix.
  const segs = rel.split(/[/\\]/).filter(Boolean);
  for (const seg of segs) {
    for (const ex of EXEMPT_SEGMENT_PREFIXES) {
      if (seg === ex || seg.startsWith(ex + ".")) return true;
    }
  }
  return false;
}

function isCanonical(relPath: string): boolean {
  // Root-level canonical doc file: relPath === "README.md" (etc.) — no directory component.
  if (CANONICAL_ROOT_FILES.has(relPath)) return true;
  // Canonical subdirectory: any segment match. Match the FIRST segment of relPath (the topmost dir).
  const top = relPath.split(/[/\\]/, 1)[0];
  if (CANONICAL_DIRS.includes(top)) return true;
  return false;
}

function readFilePath(event: any): string | null {
  const input = (event && event.input) || {};
  const raw = input.file_path || input.path;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

function resolveAgainstProject(projectDir: string, filePath: string): string {
  return resolvePath(projectDir, filePath);
}

/** Decide whether a `tool_call` event matches a doc-write we should notify about. Pure: no I/O. */
function classify(event: any, projectDir: string): { shouldNotify: boolean; reason?: string; resolvedAbs?: string; rel?: string } {
  if (!event || event.toolName !== "write") return { shouldNotify: false };
  const filePath = readFilePath(event);
  if (!filePath) return { shouldNotify: false };
  const ext = extOf(filePath);
  if (!DOC_EXTS.has(ext)) return { shouldNotify: false };

  const abs = resolveAgainstProject(projectDir, filePath);
  const rel = relative(projectDir, abs);

  // Out-of-project writes (absolute path that resolved outside projectDir) are not our concern —
  // they're a different boundary (worktree-guard's lane, not this hook's).
  if (rel.startsWith(".." + sep) || rel === "..") return { shouldNotify: false };
  if (rel.startsWith("..")) return { shouldNotify: false };

  if (isExemptBySegment(rel)) return { shouldNotify: false };
  if (isCanonical(rel)) return { shouldNotify: false };

  // Skip edits to already-existing files — only FRESH writes are drift signal.
  // (Read tool_calls don't reach this hook; only write/edit/multi_edit do, and edit/multi_edit
  // aren't doc-extension writes in the typical case anyway.)
  try { if (existsSync(abs)) return { shouldNotify: false }; } catch { /* unreadable — treat as new */ }

  return {
    shouldNotify: true,
    resolvedAbs: abs,
    rel,
    reason: `non-canonical location for a ${ext} doc (canonical: docs/, .claude/, spine/, or root README/AGENTS/CONTRIBUTING/CHANGELOG)`,
  };
}

export default function (pi: any) {
  pi.on("tool_call", (event: any, ctx: any) => {
    const projectDir = projectDirOf(event);
    // Opt-out marker — read on every call so a mid-session drop takes effect immediately.
    try {
      if (existsSync(join(projectDir, ".respawnpack", "doc-file-warning.off"))) return undefined;
    } catch { /* best-effort */ }

    const decision = classify(event, projectDir);
    if (!decision.shouldNotify) return undefined;

    if (ctx && ctx.ui && typeof ctx.ui.notify === "function") {
      try {
        ctx.ui.notify(
          `doc-file-warning: writing ${decision.rel} to a non-canonical location. Canonical doc roots are docs/, .claude/, spine/, or a top-level README.md / AGENTS.md / CONTRIBUTING.md / CHANGELOG.md. If this placement is intentional, create .respawnpack/doc-file-warning.off to silence this notification.`,
          "info",
        );
      } catch { /* best-effort */ }
    }
    return undefined; // advisory — never blocks
  });
}

export {
  DOC_EXTS,
  CANONICAL_DIRS,
  CANONICAL_ROOT_FILES,
  EXEMPT_SEGMENT_PREFIXES,
  projectDirOf,
  readFilePath,
  resolveAgainstProject,
  extOf,
  basenameOf,
  isExemptBySegment,
  isCanonical,
  classify,
};
