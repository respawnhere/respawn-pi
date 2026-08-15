/**
 * agents-runtime/agents.ts — discoverable, package-owned agent roster.
 *
 * Reads agents/*.md from a single, NON-overridable package directory so a `pi install` (npm or
 * git URL) of respawn-pi always surfaces exactly the 32 agents shipped with this package, with no
 * dependency on operator-global files and no symlinks. Operators can still drop user-scoped
 * agents into `~/.pi/agent/agents/` when `agentScope: "user" | "both"` is passed; this is the
 * documented Pi behavior, not a respawn-pi addition. Operators may opt into `agentScope:
 * "project" | "both"` (with confirmation) to include `.pi/agents/*.md` near the target cwd, again
 * matching Pi's example.
 *
 * Pi 0.84.0 export alignment (D-011 Phase 1):
 *   - `parseFrontmatter`, `CONFIG_DIR_NAME`, `getAgentDir` are imported directly from
 *     `@earendil-works/pi-coding-agent` via the supported extension runtime import path.
 *     Pi 0.84.0 exports all three. There is NO fallback parser in production — when Pi is
 *     not resolvable the package fails closed (the import throws at module load time) so a
 *     missing Pi install surfaces immediately rather than producing divergent parses.
 *   - The peer dependency on `@earendil-works/pi-coding-agent` is optional only at install
 *     time. At runtime the package REQUIRES the import to succeed.
 *
 * Locked deltas from the Pi example (D-011):
 *   - `package` scope is added and is the default. Pi packages do not expose an `agents`
 *     resource, so package-only discovery is the only clean-install-supported surface.
 *   - package files are regular-file-only (symlinks refused); the example follows symlinks via
 *     `entry.isFile() || entry.isSymbolicLink()`. This is the D-007 no-symlink contract.
 *   - the project scope requires explicit confirmation; the example defaults to confirming too,
 *     so the package mirrors that behavior rather than weakening it.
 *   - intermediate directory symlink components are also rejected (the example only checks
 *     `entry.isFile() || entry.isSymbolicLink()` on the leaf file). D-007 hostile fixtures
 *     cover both the file and the directory intermediates.
 *
 * Source/version evidence for the upstream-aligned helpers (D-011 requirement):
 *   - `parseFrontmatter`, `CONFIG_DIR_NAME`, `getAgentDir` are imported from
 *     `@earendil-works/pi-coding-agent` (Pi 0.84.0). The values used by the package were
 *     verified against the installed dist (the exact installation root is operator-specific
 *     and is intentionally NOT embedded in this file — operators can resolve it via
 *     `npm root -g` or by exporting PI_DIST) during D-011 Phase 1 acceptance:
 *       - `parseFrontmatter(content)` returns `{ frontmatter: object, body: string }`
 *         (source: dist/utils/frontmatter.js — uses `yaml.parse` for the frontmatter block)
 *       - `CONFIG_DIR_NAME` is the string `".pi"` (source: dist/config.js)
 *       - `getAgentDir()` returns the absolute path to the user agent directory (source:
 *         dist/config.js). It expects `process.env.PI_AGENT_DIR` when the operator wants to
 *         override the default; otherwise it falls back to `<homedir>/.pi/agent`.
 *     Pi 0.84.0 does NOT export `getPiInvocation`; that helper is replicated locally in
 *     subagent.ts with a source/version comment naming the Pi example file it mirrors.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFrontmatter as piParseFrontmatter,
  CONFIG_DIR_NAME as PI_CONFIG_DIR_NAME,
  getAgentDir as piGetAgentDir,
} from "@earendil-works/pi-coding-agent";

export type AgentScope = "user" | "project" | "package" | "both";
export type AgentSource = "package" | "user" | "project";

export interface AgentConfig {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  systemPrompt: string;
  source: AgentSource;
  filePath: string;
  frontmatter: Record<string, unknown>;
}

export interface AgentDiscoveryResult {
  agents: AgentConfig[];
  packageDir: string | null;
  userDir: string | null;
  projectDir: string | null;
  errors: { filePath: string; error: string }[];
}

const PACKAGE_AGENTS_DIRNAME = "agents";

/** Hard limits for runtime input validation. Exposed for tests; the schema in index.ts
 *  uses the same bounds so the dispatcher and the public tool surface agree.
 *
 *  - `MAX_TASK_LEN` is the public UTF-16 code-unit limit (mirrors JSON Schema's maxLength
 *    which is defined in JS code units by both Ajv and the TypeBox integer schema validator).
 *  - `MAX_TASK_BYTES` is the BYTE length a hostile caller could actually occupy when every
 *    code unit is 4 bytes (U+10000..U+10FFFF). Both checks are enforced; the byte check is
 *    the safe cap, the code-unit check is the schema-level cap.
 *
 *  Note (D-011, E2BIG mitigation): Linux enforces a per-argument MAX_ARG_STRLEN ceiling of
 *  approximately 128 KiB (PAGE_SIZE*32 on most builds). After prepending the dispatcher
 *  prefix `Task: ` plus chain-substitution overhead, a UTF-16 task of ~30,000 code units
 *  (= up to 120,000 UTF-8 bytes at worst case) stays below the per-argument cap with
 *  margin. The previous Phase-1 limits (200,000 code units / 800,000 bytes) could trigger
 *  E2BIG for hostile Unicode tasks; the new bounds keep the child spawn safe.
 */
export const MAX_AGENT_NAME_LEN = 64;
export const MAX_TASK_LEN = 30_000;
export const MAX_TASK_BYTES = 120_000;
export const MAX_CWD_LEN = 4096;
export const MAX_CWD_BYTES = 16_384;
/** Max retained task preview in a structured SingleResult. The retained preview MUST NOT
 *  exceed this byte count so the serialized details object stays below DETAILS_JSON_CAP. */
export const MAX_TASK_PREVIEW_BYTES = 1024;
/** Max retained errorMessage in a structured SingleResult (caps the model-visible string). */
export const MAX_ERROR_MESSAGE_BYTES = 4 * 1024;

/**
 * Tool name translation table (D-011 Phase 3, fail-closed contract).
 *
 * Phase 3 normalizes the agent frontmatter to Pi's lowercase native tool names. Pi
 * 0.84.0 native tool names (from dist/core/tools/{read,write,edit,bash,grep,find,ls}.js)
 * are lowercase. Pi DOES ship native lowercase `grep` and `find` (verified against
 * dist/core/tools/grep.js and dist/core/tools/find.js in Pi 0.84.0); the package maps
 * the agent's declared lowercase `grep` and `find` to the bounded package wrappers
 * (`respawn_pi_grep` / `respawn_pi_glob`) because Pi's native `grep` / `find` do NOT
 * carry this package's cwd/symlink containment contract (D-007). The wrappers
 * translate the agent's declared lowercase names to the bounded package tools so the
 * child is granted the package's contained wrappers, not Pi's native (uncontained)
 * primitives. Pi does not ship a `glob` primitive; the package exposes
 * `respawn_pi_glob` for agents that need a file-list wrapper. Declare the wrapper by
 * its literal name (`respawn_pi_glob`) rather than via a non-Pi `glob` alias so the
 * agent intent is honest.
 *
 * Inputs not in this table (PascalCase, missing, unknown) are REJECTED before spawn —
 * the dispatch fails closed rather than silently downgrading to no-tools or to an
 * unknown child tool. Uppercase PascalCase declarations must be rewritten as lowercase
 * in the agent frontmatter; the runner does NOT translate them.
 */
const TOOL_NAME_TRANSLATION: Record<string, string> = {
  // Pi 0.84.0 native lowercase tool names that the package grants the child verbatim
  // (identity map). Pi ships `read` / `write` / `edit` / `ls` / `bash` as native
  // primitives; the package's security deltas (cwd/symlink containment, dispatch
  // gate) live at the dispatcher layer, not in the per-tool wrappers.
  "read": "read",
  "write": "write",
  "edit": "edit",
  "ls": "ls",
  "bash": "bash",
  // Pi DOES ship native lowercase `grep` and `find`; the package's wrappers
  // (`respawn_pi_grep` / `respawn_pi_glob`) add cwd/symlink containment that Pi's
  // native primitives do not provide (D-007). The 32 shipped agents declare
  // `read, grep, find` (plus `write` for the two onboarding mappers); the runner
  // translates the declared lowercase `grep` AND `find` to the bounded package
  // wrappers so the child receives the contained wrappers, not the uncontained
  // native primitives. Direct literal declarations of the wrapper names also
  // resolve (the package wrappers are registered tools).
  "grep": "respawn_pi_grep",
  "find": "respawn_pi_glob",
  // Package wrappers by literal name so an agent author who writes
  // `tools: [respawn_pi_grep]` or `tools: [respawn_pi_glob]` resolves directly.
  "respawn_pi_grep": "respawn_pi_grep",
  "respawn_pi_glob": "respawn_pi_glob",
};

export function translateToolName(declared: string): string | null {
  return TOOL_NAME_TRANSLATION[declared] ?? null;
}

export function translateToolList(declared: readonly string[]): { tools: string[]; unknown: string[] } {
  const tools: string[] = [];
  const unknown: string[] = [];
  for (const name of declared) {
    const mapped = TOOL_NAME_TRANSLATION[name];
    if (mapped) tools.push(mapped);
    else unknown.push(name);
  }
  return { tools, unknown };
}

function lstatIsRegularFile(p: string): boolean {
  let st;
  try { st = fs.lstatSync(p); } catch { return false; }
  if (st.isSymbolicLink()) return false;
  return st.isFile();
}

/**
 * Reject symlink components anywhere along the path. `fs.lstatSync` on the directory itself is
 * the first check; for every nested component the same check is run. This stops
 *   `package/agents` -> symlinked `agents-evil` -> symlinked inside
 * and any other hostile `.pi -> /etc/...` attack on the project root. Refuses a symlinked leaf
 * file too.
 */
function assertNoSymlinkComponents(filePath: string): void {
  let cursor = path.dirname(filePath);
  const seen = new Set<string>();
  while (cursor && cursor !== path.dirname(cursor)) {
    if (seen.has(cursor)) return;
    seen.add(cursor);
    let st: fs.Stats;
    try { st = fs.lstatSync(cursor); } catch { return; }
    if (st.isSymbolicLink()) {
      throw new Error(`refused symlink path component: ${cursor}`);
    }
    cursor = path.dirname(cursor);
  }
}

function listPackageAgents(packageRoot: string): { dir: string | null; entries: string[] } {
  // packageRoot is the directory containing adapters/pi/package. The agents directory always
  // sits at <packageRoot>/adapters/pi/package/agents for the respawn-pi layout. We resolve
  // defensively via two paths to be robust against tests that run the loader from inside the
  // package directory itself.
  const candidates = [
    path.resolve(packageRoot, "adapters", "pi", "package", PACKAGE_AGENTS_DIRNAME),
    path.resolve(packageRoot, PACKAGE_AGENTS_DIRNAME),
  ];
  for (const c of candidates) {
    let st: fs.Stats;
    try { st = fs.lstatSync(c); } catch { continue; }
    if (st.isSymbolicLink()) continue;        // ⛔ D-007: no symlinks
    if (!st.isDirectory()) continue;
    // Walk every parent of `c` (up to and including `packageRoot`) and refuse if any
    // intermediate is a symlink. Catches a hostile fixture that links `adapters/pi/package`
    // itself to an external dir.
    try { assertNoSymlinkComponents(c); } catch { continue; }
    const entries = fs.readdirSync(c)
      .filter((n) => n.endsWith(".md"))
      .filter((n) => {
        const p = path.join(c, n);
        return lstatIsRegularFile(p);          // ⛔ refuse symlink-leaf files
      })
      .sort();
    return { dir: c, entries };
  }
  return { dir: null, entries: [] };
}

function listUserAgents(userAgentsDir: string): string[] {
  if (!userAgentsDir) return [];
  try {
    const st = fs.lstatSync(userAgentsDir);
    if (st.isSymbolicLink()) return [];        // ⛔ D-007: no symlinks
    if (!st.isDirectory()) return [];
    try { assertNoSymlinkComponents(userAgentsDir); } catch { return []; }
    return fs.readdirSync(userAgentsDir)
      .filter((n) => n.endsWith(".md"))
      .filter((n) => lstatIsRegularFile(path.join(userAgentsDir, n)))
      .sort();
  } catch { return []; }
}

/**
 * Production parser. Uses Pi 0.84.0's `parseFrontmatter` directly via the supported
 * extension-runtime import path. When Pi is not resolvable the import fails at module
 * load time — there is no fallback parser in production. Tests that exercise the
 * production path use a jiti loader with a Pi alias so the static import resolves.
 *
 * If Pi throws (parse error etc.) the agent is still loaded with a parse-error marker
 * on the frontmatter and a structured error in discovery.errors — so a hostile fixture
 * fails closed in discovery rather than crashing the loader.
 */
export function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  try {
    const parsed = piParseFrontmatter(content);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("parseFrontmatter returned a non-object value");
    }
    const fm = (parsed.frontmatter && typeof parsed.frontmatter === "object") ? parsed.frontmatter as Record<string, unknown> : {};
    const body = typeof parsed.body === "string" ? parsed.body : content;
    return { frontmatter: fm, body };
  } catch (error) {
    return { frontmatter: { __parseError: String((error as Error).message || error) }, body: content };
  }
}

function readAgent(filePath: string, source: AgentSource): AgentConfig | { error: string } {
  if (!lstatIsRegularFile(filePath)) return { error: "not a regular file (symlink or directory rejected)" };
  // Refuse symlink components along the path (D-007): a hostile `package/agents/foo.md` whose
  // parent `agents` is a symlink is caught here.
  try { assertNoSymlinkComponents(filePath); } catch (e) { return { error: (e as Error).message }; }
  let content: string;
  try { content = fs.readFileSync(filePath, "utf-8"); }
  catch (e) { return { error: String((e as Error).message) }; }
  let parsed: { frontmatter: Record<string, unknown>; body: string };
  try { parsed = parseFrontmatter(content); }
  catch (e) { return { error: `parseFrontmatter failed: ${(e as Error).message}` }; }
  const { frontmatter, body } = parsed;
  const name = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : "";
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
  if (!name || !description) return { error: "missing required `name` or `description` frontmatter" };
  // ⛔ refuse traversal/shape violations up front
  if (name.includes("/") || name.includes("..") || /\s/.test(name)) return { error: `invalid agent name "${name}"` };
  if (name.length > MAX_AGENT_NAME_LEN) return { error: `agent name "${name}" exceeds ${MAX_AGENT_NAME_LEN} characters` };
  const toolsRaw = Array.isArray(frontmatter.tools) ? frontmatter.tools.join(",") : (typeof frontmatter.tools === "string" ? frontmatter.tools : "");
  const tools = toolsRaw.split(",").map((t) => t.trim()).filter(Boolean);
  return {
    name,
    description,
    tools: tools.length ? tools : undefined,
    model: typeof frontmatter.model === "string" ? frontmatter.model : undefined,
    systemPrompt: body.trim(),
    source,
    filePath,
    frontmatter,
  };
}

function loadAgentsFromDir(dir: string, source: AgentSource): { agents: AgentConfig[]; errors: { filePath: string; error: string }[] } {
  const agents: AgentConfig[] = [];
  const errors: { filePath: string; error: string }[] = [];
  let entries: string[];
  try { entries = fs.readdirSync(dir); }
  catch { return { agents: [], errors: [{ filePath: dir, error: "directory not readable" }] }; }
  // ⛔ dedup-by-name (case-insensitive) keeps the first file that wins alphabetically; operators who
  // want a different file win should pick a different name, not depend on readdir order
  const seen = new Set<string>();
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const filePath = path.join(dir, name);
    const result = readAgent(filePath, source);
    if ("error" in result) { errors.push({ filePath, error: result.error }); continue; }
    const key = result.name.toLowerCase();
    if (seen.has(key)) { errors.push({ filePath, error: `duplicate agent name "${result.name}"` }); continue; }
    seen.add(key);
    agents.push({ ...result, source });
  }
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { agents, errors };
}

export function discoverAgents(packageRoot: string, scope: AgentScope, userAgentsDir: string, projectCwd?: string): AgentDiscoveryResult {
  const errors: { filePath: string; error: string }[] = [];
  // ⛔ resolve user agents dir; refuse symlinks at every level
  let userDir: string | null = null;
  if (userAgentsDir) {
    try {
      const st = fs.lstatSync(userAgentsDir);
      if (st.isSymbolicLink()) {
        errors.push({ filePath: userAgentsDir, error: `refused symlink user-agents directory: ${userAgentsDir}` });
      } else if (st.isDirectory()) {
        try { assertNoSymlinkComponents(userAgentsDir); userDir = userAgentsDir; }
        catch (e) { errors.push({ filePath: userAgentsDir, error: (e as Error).message }); }
      }
    } catch { /* missing */ }
  }
  const packageListing = listPackageAgents(packageRoot);
  const packageDir = packageListing.entries.length > 0 ? packageListing.dir : null;
  // ⛔ resolve project agents dir (only when the scope asks for it); refuse symlinks at every level
  let projectDir: string | null = null;
  if ((scope === "project" || scope === "both") && projectCwd) {
    const candidate = findNearestProjectAgentsDir(projectCwd, errors);
    if (candidate) {
      try {
        const st = fs.lstatSync(candidate);
        if (st.isSymbolicLink()) {
          errors.push({ filePath: candidate, error: `refused symlink project-agents directory: ${candidate}` });
        } else if (st.isDirectory()) {
          try { assertNoSymlinkComponents(candidate); projectDir = candidate; }
          catch (e) { errors.push({ filePath: candidate, error: (e as Error).message }); }
        }
      } catch { /* missing */ }
    }
  }

  const pickPackage = scope === "user" || scope === "project" ? false : true;
  const pickUser = scope === "package" || scope === "project" ? false : true;
  const pickProject = scope === "package" || scope === "user" ? false : true;

  const pkg = pickPackage && packageDir ? loadAgentsFromDir(packageDir, "package") : { agents: [], errors: [] };
  const usr = pickUser && userDir ? loadAgentsFromDir(userDir, "user") : { agents: [], errors: [] };
  const prj = pickProject && projectDir ? loadAgentsFromDir(projectDir, "project") : { agents: [], errors: [] };

  const merged = new Map<string, AgentConfig>();
  // ⛔ deterministic precedence (D-011): project > package > user. The package is the supported
  // surface; user agents are an opt-in fallback. The project scope is only honored when the
  // operator explicitly opted in (and confirmed). All three lists are merged case-insensitively.
  if (scope === "both") {
    for (const a of usr.agents) merged.set(a.name.toLowerCase(), a);
    for (const a of pkg.agents) merged.set(a.name.toLowerCase(), a);
    for (const a of prj.agents) merged.set(a.name.toLowerCase(), a);
  } else if (scope === "user") {
    for (const a of usr.agents) merged.set(a.name.toLowerCase(), a);
  } else if (scope === "project") {
    for (const a of prj.agents) merged.set(a.name.toLowerCase(), a);
  } else if (scope === "package") {
    for (const a of pkg.agents) merged.set(a.name.toLowerCase(), a);
  }
  errors.push(...usr.errors, ...pkg.errors, ...prj.errors);
  return { agents: Array.from(merged.values()), packageDir, userDir, projectDir, errors };
}

export function findUserAgentsDir(): string {
  const dir = piGetAgentDir();
  return path.join(dir, "agents");
}

function lstatIsRegularDirectory(p: string): boolean {
  try {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) return false;
    return st.isDirectory();
  } catch { return false; }
}

/**
 * Walk up from `cwd` looking for the nearest `${CONFIG_DIR_NAME}/agents` directory. Mirrors the
 * `findNearestProjectAgentsDir` helper in Pi's example; the package just substitutes the
 * fallback `CONFIG_DIR_NAME = ".pi"` when Pi is not resolvable. Refuses symlinks.
 *
 * Returns the resolved directory or null. When the candidate path is a symlink (or contains a
 * symlink component) the result is null AND `errors` receives a structured entry so callers
 * can surface the refusal rather than silently producing zero agents.
 */
export function findNearestProjectAgentsDir(cwd: string, errors?: { filePath: string; error: string }[]): string | null {
  if (!cwd) return null;
  const cfg = PI_CONFIG_DIR_NAME;
  let cursor = path.resolve(cwd);
  for (let i = 0; i < 64; i++) {
    const candidate = path.join(cursor, cfg, "agents");
    let st: fs.Stats;
    try { st = fs.lstatSync(candidate); } catch { st = null as unknown as fs.Stats; }
    if (st && st.isSymbolicLink()) {
      if (errors) errors.push({ filePath: candidate, error: `refused symlink project-agents directory: ${candidate}` });
      return null;
    }
    if (lstatIsRegularDirectory(candidate)) {
      try { assertNoSymlinkComponents(candidate); return candidate; }
      catch (e) {
        if (errors) errors.push({ filePath: candidate, error: (e as Error).message });
        return null;
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
  return null;
}

/* ----------------------------- packageRoot location -----------------------------
 * Pi calls pi.on(...) from inside an extension factory; the factory receives
 * the active ctx at every event, so we resolve the package root lazily inside
 * the factory: packageRoot = ctx.cwd, with a discovery walk if that fails.
 */

export function resolvePackageRoot(packageRootCandidates: string[]): string | null {
  for (const c of packageRootCandidates) {
    try {
      const st = fs.lstatSync(c);
      if (st.isSymbolicLink()) continue;
      if (!st.isDirectory()) continue;
      // The canonical signs that this IS the package root:
      //   - has package.json declaring pi.extensions
      //   - OR has adapters/pi/package/agents/*.md as a directory
      const pkgPath = path.join(c, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          if (pkg && pkg.pi && Array.isArray(pkg.pi.extensions || pkg.pi.skills)) return c;
        } catch { /* keep searching */ }
      }
      if (fs.existsSync(path.join(c, "adapters", "pi", "package", PACKAGE_AGENTS_DIRNAME))) return c;
    } catch { /* missing */ }
  }
  return null;
}

/**
 * Resolve the installed package authority from the location of this source file. Used by
 * `subagent.ts` so an arbitrary target cwd still discovers the 32 packaged agents. Walks up
 * the tree to find the root package.json (the one that declares `pi.extensions`).
 */
export function resolveInstalledPackageRoot(): string | null {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    let cursor = here;
    for (let i = 0; i < 16; i++) {
      const pkgPath = path.join(cursor, "package.json");
      try {
        const st = fs.lstatSync(pkgPath);
        if (!st.isSymbolicLink() && st.isFile()) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
          if (pkg && pkg.pi && Array.isArray(pkg.pi.extensions || pkg.pi.skills)) {
            // Reject any symlink component between this file and `cursor`.
            try { assertNoSymlinkComponents(pkgPath); return cursor; }
            catch { return null; }
          }
        }
      } catch { /* keep walking */ }
      const parent = path.dirname(cursor);
      if (parent === cursor) return null;
      cursor = parent;
    }
    return null;
  } catch { return null; }
}

/**
 * The wiring contract.
 *
 * - `mode: "package"` (the default for respawn-pi subagents) reads ONLY the package's
 *   own agents/ directory. No global state. This is the supported install path.
 * - `mode: "user"` mirrors Pi's example: read ~/.pi/agent/agents/*.md only.
 * - `mode: "both"` merges, with package agents winning on name collision.
 *
 * The subagent tool documented for respawn-pi is the same one Pi ships in
 * examples/extensions/subagent: a tool that spawns a child `pi` process with the
 * agent's system prompt as --append-system-prompt. We adapt its discovery to
 * the package-owned roster, and we deliberately do NOT use the helper name
 * "subagent" if Pi already provides one global tool of that name.
 */
export type ResolveMode = "package" | "user" | "project" | "both";

export interface ListAgentsArgs { mode?: ResolveMode; }

// TypeBox is provided by Pi at runtime (peer dep). Kept out of the require graph so this
// module is testable from node --test without depending on typebox being resolvable.
export const ListAgentsParams = { type: 'object', properties: { mode: { type: 'string', enum: ['package', 'user', 'project', 'both'] } } } as const;

export function listAgentsText(agents: AgentConfig[], packageDir: string | null, userDir: string | null, projectDir: string | null): string {
  const lines: string[] = [];
  lines.push(`${agents.length} agents discovered`);
  if (packageDir) lines.push(`package: ${packageDir}`);
  if (userDir) lines.push(`user    : ${userDir}`);
  if (projectDir) lines.push(`project : ${projectDir}`);
  for (const a of agents) lines.push(`- ${a.name} (${a.source}) — ${a.description.slice(0, 80)}${a.description.length > 80 ? "…" : ""}`);
  return lines.join("\n");
}

export const __test__ = {
  parseFrontmatter,
  readAgent,
  listPackageAgents,
  listUserAgents,
  loadAgentsFromDir,
  findNearestProjectAgentsDir,
  assertNoSymlinkComponents,
  resolveInstalledPackageRoot,
  translateToolName,
  translateToolList,
  MAX_AGENT_NAME_LEN,
  MAX_TASK_LEN,
  MAX_TASK_BYTES,
  MAX_CWD_LEN,
  MAX_CWD_BYTES,
  MAX_TASK_PREVIEW_BYTES,
  MAX_ERROR_MESSAGE_BYTES,
};
export type ListAgentsParamsType = { mode?: ResolveMode };
