/*
 * RespawnPack · adapters/pi/package/extensions/config-protection.ts
 *
 * Pi extension port of the ECC `config-protection` hook (MIT, see ATTRIBUTION.md). Preserves the
 * load-bearing semantic: ENFORCED block on edits to lint / formatter / typecheck configuration files
 * — closing the "fix a lint error by weakening the rule" failure mode at the tool layer rather than
 * relying on prose discipline or review-time catch.
 *
 * Prior-art evidence: round3 T3-5 (catalog-walk-cct-hooks.md §47 "plan-gate" / §48 "scope-guard" /
 * the config-protection hook census line). The hook is small, single-purpose, and well-evidenced.
 * round3 verifier's own audit: "S-effort, one PreToolUse hook blocking edits to lint/format config
 * files. ECC's own text calls it 'narrow, high-value' — closer to the Tier-2 floor than most Tier-3
 * rows in scale of value, but its actual build size (~one file, single check) is far below every
 * existing Tier-2 row's scope."
 *
 * What it blocks (case-insensitive on the basename, anchored to the FILE NAME not a directory):
 *   - eslint:    .eslintrc, .eslintrc.{js,cjs,mjs,yaml,yml,json}, eslint.config.{js,cjs,mjs}
 *   - prettier:  .prettierrc, .prettierrc.{js,cjs,mjs,yaml,yml,json,toml}, prettier.config.{js,cjs,mjs},
 *                .prettierignore
 *   - biome:     biome.json, biome.jsonc, biome.{js,cjs,mjs}
 *   - editorconfig: .editorconfig
 *   - tsconfig:  tsconfig.json, tsconfig.*.json, tsconfig.base.json (the project-root ones; per-
 *                package tsconfigs in monorepos are caught too because the match is by name only)
 *   - stylelint: .stylelintrc, .stylelintrc.{js,cjs,mjs,yaml,yml,json}, stylelint.config.{js,cjs,mjs}
 *   - commitlint: .commitlintrc, .commitlintrc.{js,cjs,mjs,yaml,yml,json}, commitlint.config.{js,cjs,mjs}
 *   - markdownlint: .markdownlint{,rc}{,.json,.yaml,.yml,.cjs,.js}
 *   - husky:     .huskyrc, .huskyrc.{js,cjs,mjs,yaml,yml,json}
 *   - lint-staged: .lintstagedrc, .lintstagedrc.{js,cjs,mjs,yaml,yml,json}, lint-staged.config.{js,cjs,mjs}
 *   - knip:      knip.json, knip.jsonc, knip.config.{js,cjs,mjs}
 *   - oxlint:    .oxlintrc.json
 *   - tap:       .taprc, tap.config.{js,cjs,mjs}
 *   - nyc:       .nycrc, .nycrc.{js,cjs,mjs,yaml,yml,json}
 *   - vitest:    vitest.config.{js,cjs,mjs,ts}, vite.config.{js,cjs,mjs,ts}
 *
 * What it does NOT block:
 *   - `package.json` — this is the project's OWN meta-config (dependencies, scripts). Touching
 *     package.json is a normal part of build/ship work, and the operator has their own review
 *     process. Blocking it would block every legitimate dependency bump.
 *   - `.env*` — that is `secret-scan`'s lane, not this hook's.
 *   - `tsconfig.json` inside `node_modules/` — segment-prefix exempt (see below).
 *   - `dist/build/coverage/.next`-built copies — segment-prefix exempt.
 *   - editor-specific files (`*.swp`, `*~`) — not configuration, not in scope.
 *
 * ⛔ MATCHING IS BY BASENAME ONLY, NOT BY PATH. `packages/foo/tsconfig.json` matches (and the user
 *   gets the same deny reason — "fixing a build error by weakening the typecheck" is the same
 *   failure mode regardless of which package's tsconfig). This is INTENTIONAL: a per-path allow
 *   list is an allow list that has to be maintained, and the whole point of this hook is that
 *   the deny does not depend on per-project configuration.
 *
 * ⛔ OPT-OUT: a `.respawnpack/config-protection.off` marker disables the protection entirely. A
 *   founder editing their own lint config (the legitimate "I'm migrating from prettier to biome"
 *   moment) lifts the marker, edits, drops the marker again. Symmetric with the rest of the pack's
 *   opt-out shape. NEVER honor a one-shot or per-file opt-out — either the hook is on for the
 *   project or it is off.
 *
 * ⛔ REASON TEXT names the failure mode, not just the rule. A deny that says "blocked tsconfig.json
 *   edit" is unhelpful; one that says "editing tsconfig.json weakens the project's typecheck; this
 *   hook blocks the failure mode 'fix a build error by weakening the rule' — drop
 *   .respawnpack/config-protection.off to lift for one edit" tells the agent (and the operator
 *   reading the logs) WHY.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { guardedGovernanceEnabled } from "./governance-profile.ts";

const PROTECTED_BASENAMES: ReadonlySet<string> = new Set([
  // eslint
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.mjs",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  ".eslintrc.json",
  "eslint.config.js",
  "eslint.config.cjs",
  "eslint.config.mjs",
  // prettier
  ".prettierrc",
  ".prettierrc.js",
  ".prettierrc.cjs",
  ".prettierrc.mjs",
  ".prettierrc.yaml",
  ".prettierrc.yml",
  ".prettierrc.json",
  ".prettierrc.toml",
  "prettier.config.js",
  "prettier.config.cjs",
  "prettier.config.mjs",
  ".prettierignore",
  // biome
  "biome.json",
  "biome.jsonc",
  "biome.js",
  "biome.cjs",
  "biome.mjs",
  // editorconfig
  ".editorconfig",
  // tsconfig (matches every per-package variant too — by design, see file header)
  "tsconfig.json",
  "tsconfig.base.json",
  "tsconfig.build.json",
  "tsconfig.node.json",
  // stylelint
  ".stylelintrc",
  ".stylelintrc.js",
  ".stylelintrc.cjs",
  ".stylelintrc.mjs",
  ".stylelintrc.yaml",
  ".stylelintrc.yml",
  ".stylelintrc.json",
  "stylelint.config.js",
  "stylelint.config.cjs",
  "stylelint.config.mjs",
  // commitlint
  ".commitlintrc",
  ".commitlintrc.js",
  ".commitlintrc.cjs",
  ".commitlintrc.mjs",
  ".commitlintrc.yaml",
  ".commitlintrc.yml",
  ".commitlintrc.json",
  "commitlint.config.js",
  "commitlint.config.cjs",
  "commitlint.config.mjs",
  // markdownlint (the `.markdownlint.json` variant and the bare `.markdownlint` both)
  ".markdownlint",
  ".markdownlintrc",
  ".markdownlint.json",
  ".markdownlint.yaml",
  ".markdownlint.yml",
  ".markdownlint.cjs",
  ".markdownlint.js",
  // husky
  ".huskyrc",
  ".huskyrc.js",
  ".huskyrc.cjs",
  ".huskyrc.mjs",
  ".huskyrc.yaml",
  ".huskyrc.yml",
  ".huskyrc.json",
  // lint-staged
  ".lintstagedrc",
  ".lintstagedrc.js",
  ".lintstagedrc.cjs",
  ".lintstagedrc.mjs",
  ".lintstagedrc.yaml",
  ".lintstagedrc.yml",
  ".lintstagedrc.json",
  "lint-staged.config.js",
  "lint-staged.config.cjs",
  "lint-staged.config.mjs",
  // knip
  "knip.json",
  "knip.jsonc",
  "knip.config.js",
  "knip.config.cjs",
  "knip.config.mjs",
  // oxlint
  ".oxlintrc.json",
  // tap
  ".taprc",
  "tap.config.js",
  "tap.config.cjs",
  "tap.config.mjs",
  // nyc
  ".nycrc",
  ".nycrc.js",
  ".nycrc.cjs",
  ".nycrc.mjs",
  ".nycrc.yaml",
  ".nycrc.yml",
  ".nycrc.json",
  // vitest + vite (vite's config often doubles as vitest's config in vitest projects)
  "vitest.config.js",
  "vitest.config.cjs",
  "vitest.config.mjs",
  "vitest.config.ts",
  "vite.config.js",
  "vite.config.cjs",
  "vite.config.mjs",
  "vite.config.ts",
]);

// tsconfig files use a NAME PATTERN, not a fixed basename — `tsconfig.foo.json`, `tsconfig.bar.json`
// are equally protected. Same for `tsconfig.build.json` etc. (already in the literal set above;
// the pattern catches anything named `tsconfig.*.json`).
function isTsconfigFamily(basename: string): boolean {
  return basename === "tsconfig.json"
      || /^tsconfig\.[\w-]+\.json$/.test(basename);
}

// Files under any of these path segments are exempt — vendored configs (e.g. a tsconfig inside
// node_modules/, a .prettierrc copied into dist/) are not what this hook is for.
const EXEMPT_SEGMENT_PREFIXES: ReadonlyArray<string> = [
  "node_modules",
  ".git",
  ".respawnpack",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  "vendor",
];

function projectDirOf(event: any, ctx: any = {}): string {
  const e = event || {};
  const candidates = [
    ctx && ctx.cwd,
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

function basenameOf(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i === -1 ? p : p.slice(i + 1);
}

function isExemptBySegment(rel: string): boolean {
  const segs = rel.split(/[/\\]/).filter(Boolean);
  for (const seg of segs) {
    for (const ex of EXEMPT_SEGMENT_PREFIXES) {
      if (seg === ex || seg.startsWith(ex + ".")) return true;
    }
  }
  return false;
}

function readFilePath(event: any): string | null {
  const input = (event && event.input) || {};
  const raw = input.file_path || input.path;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.trim();
}

/** Decide whether an edit event should be blocked. Pure: no I/O. */
function classify(event: any, projectDir: string): { shouldBlock: boolean; basename?: string; rel?: string; reason?: string } {
  if (!event) return { shouldBlock: false };
  // The hook fires on tool_call for file-mutating tools. Different Pi surfaces name them
  // differently; be permissive on the input toolName shape and rely on the file_path payload.
  const allowed = event.toolName === "edit"
               || event.toolName === "write"
               || event.toolName === "multi_edit"
               || event.toolName === "notebook_edit";
  if (!allowed) return { shouldBlock: false };

  const filePath = readFilePath(event);
  if (!filePath) return { shouldBlock: false };

  const basename = basenameOf(filePath);
  if (!PROTECTED_BASENAMES.has(basename) && !isTsconfigFamily(basename)) {
    return { shouldBlock: false };
  }

  // Compute the project-relative path for exempt-by-segment checking. We do NOT require the file
  // to be inside projectDir — an absolute path the agent supplies is checked by basename only
  // (the policy is "no editing of these names anywhere reachable", not "no editing in the project").
  // For relative paths we honor the segment exemption (vendored configs).
  let rel = filePath;
  if (!filePath.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(filePath)) {
    rel = filePath;
    if (isExemptBySegment(rel)) return { shouldBlock: false };
  }

  return {
    shouldBlock: true,
    basename,
    rel,
    reason: `editing ${basename} weakens the project's lint/typecheck configuration. ` +
            `config-protection blocks the failure mode "fix a build error by weakening the rule". ` +
            `Drop .respawnpack/config-protection.off if you genuinely need to edit it.`,
  };
}

export default function (pi: any) {
  pi.on("tool_call", (event: any, ctx: any) => {
    if (!guardedGovernanceEnabled(event, ctx)) return undefined;
    const projectDir = projectDirOf(event, ctx);
    // Opt-out marker — read on every call so a mid-session drop takes effect immediately.
    try {
      if (existsSync(join(projectDir, ".respawnpack", "config-protection.off"))) return undefined;
    } catch { /* best-effort */ }

    const decision = classify(event, projectDir);
    if (!decision.shouldBlock) return undefined;

    if (ctx && ctx.ui && typeof ctx.ui.notify === "function") {
      try {
        ctx.ui.notify(`config-protection: blocked edit to ${decision.basename}`, "warn");
      } catch { /* best-effort */ }
    }

    return { block: true, reason: decision.reason };
  });
}

export {
  PROTECTED_BASENAMES,
  EXEMPT_SEGMENT_PREFIXES,
  projectDirOf,
  basenameOf,
  isExemptBySegment,
  isTsconfigFamily,
  readFilePath,
  classify,
};
