#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(SCRIPT), '..');
const TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'templates', 'project', 'docs');
const MANAGED_START = '<!-- respawn-pi:start -->';
const MANAGED_END = '<!-- respawn-pi:end -->';
const TEMPLATE_START = '<!-- respawn-pi:project-template v1 status=uninitialized -->';
const CANONICAL_DOCS = Object.freeze(['ARCHITECTURE.md', 'DECISIONS.md', 'FEATURES-PAGES.md', 'PRODUCT.md', 'ROADMAP.md']);
let failHook = null;
function setFailHook(fn) { failHook = fn; }

function parseArgs(argv) {
  let target = null;
  let mode = null;
  let dryRun = false;
  let governance = 'continuity';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--governance') {
      const value = argv[++i];
      if (!['continuity', 'guarded'].includes(value)) throw new Error('--governance requires continuity or guarded');
      governance = value;
    } else if (arg === '--mode') {
      const value = argv[++i];
      if (!value) throw new Error('--mode requires greenfield or brownfield');
      mode = value;
    } else if (arg === '--help' || arg === '-h') return { help: true };
    else if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`);
    else if (target === null) target = arg;
    else throw new Error('exactly one target project is required');
  }
  if (!target) throw new Error('target project is required');
  if (!['greenfield', 'brownfield'].includes(mode)) throw new Error('--mode must be greenfield or brownfield');
  return { help: false, target: path.resolve(target), mode, governance, dryRun };
}

function isSymlink(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

function assertTarget(target) {
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) { throw new Error(`target project unavailable: ${error.message}`); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`target must be a real directory, not a symlink: ${target}`);
}

function assertManagedPath(target, file) {
  const rel = path.relative(target, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`managed path escapes target: ${file}`);
  let cursor = target;
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part);
    if (isSymlink(cursor)) throw new Error(`managed path contains a symlink: ${cursor}`);
  }
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile()) throw new Error(`managed destination is not a regular file: ${file}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function instructionBlock() {
  return `${MANAGED_START}\n## respawn-pi project workflow\n\nThe target project owns its product truth and its D-* decision namespace. Read target-owned canonical docs under docs/ (PRODUCT, FEATURES-PAGES, ARCHITECTURE, DECISIONS, ROADMAP) when initialized; read generated continuity only under docs/derived/. Package policies are named respawn-pi policies, never target decisions. Use the loadout skill before broad planning and the savepoint skill before pausing or compacting. Preserve unrelated working-tree changes, verify claims with commands or tests, never store credentials in the repository, and remember that Pi has the operating-system user's permissions rather than a built-in sandbox. Review expands once, then converges: freeze one discovery batch, allow at most two remediation cycles, then stop and ask the operator.\n${MANAGED_END}`;
}

function mergeManagedBlock(existing, block = instructionBlock()) {
  const text = String(existing || '');
  const start = text.indexOf(MANAGED_START);
  const end = text.indexOf(MANAGED_END);
  if ((start === -1) !== (end === -1) || (start !== -1 && end < start) || text.indexOf(MANAGED_START, start + 1) !== -1 || text.indexOf(MANAGED_END, end + 1) !== -1) {
    throw new Error('AGENTS.md contains incomplete or duplicate respawn-pi managed markers');
  }
  if (start !== -1) return `${text.slice(0, start)}${block}${text.slice(end + MANAGED_END.length)}`.replace(/\s+$/, '') + '\n';
  return `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${block}\n`;
}

function mergeGitignore(existing) {
  const lines = String(existing || '').split(/\r?\n/);
  if (lines.some((line) => line.trim() === '.respawnpack/')) return String(existing).replace(/\s+$/, '') + '\n';
  const prefix = String(existing || '').trimEnd();
  return `${prefix}${prefix ? '\n\n' : ''}# respawn-pi runtime state\n.respawnpack/\n`;
}

function snapshot(files, target) {
  const result = new Map();
  result.absentDirs = new Set();
  for (const file of files) {
    let dir = path.dirname(file);
    while (dir !== target) {
      if (!fs.existsSync(dir)) result.absentDirs.add(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    try { result.set(file, { exists: true, bytes: fs.readFileSync(file) }); }
    catch (error) { if (error.code === 'ENOENT') result.set(file, { exists: false }); else throw error; }
  }
  return result;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(path.dirname(file), '.respawn-pi-init-'));
  fs.chmodSync(tempDir, 0o700);
  const temp = path.join(tempDir, 'content');
  try {
    fs.writeFileSync(temp, content, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { fs.rmSync(tempDir, { recursive: true, force: true }); }
}

function restore(state) {
  for (const [file, prior] of state.entries()) {
    try { fs.unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (prior.exists) atomicWrite(file, prior.bytes);
  }
  for (const dir of [...state.absentDirs].sort((a, b) => b.length - a.length)) {
    try { fs.rmdirSync(dir); } catch (error) { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
}

function initialize({ target, mode, governance = 'continuity', dryRun = false }) {
  target = path.resolve(target);
  assertTarget(target);
  if (!['continuity', 'guarded'].includes(governance)) throw new Error('governance must be continuity or guarded');
  const agentsFile = path.join(target, 'AGENTS.md');
  const ignoreFile = path.join(target, '.gitignore');
  const configFile = path.join(target, 'respawnpack.config.json');
  const docFiles = CANONICAL_DOCS.map((name) => path.join(target, 'docs', name));
  for (const file of [agentsFile, ignoreFile, configFile, ...docFiles]) assertManagedPath(target, file);

  if (mode === 'greenfield') {
    const existing = docFiles.filter((file) => fs.existsSync(file));
    if (existing.length) throw new Error(`greenfield initialization refuses existing canonical docs (${existing.map((f) => path.relative(target, f)).join(', ')}); use --mode brownfield and /skill:onboard`);
  }

  const writes = [];
  const existingAgents = fs.existsSync(agentsFile) ? fs.readFileSync(agentsFile, 'utf8') : '';
  writes.push([agentsFile, mergeManagedBlock(existingAgents)]);
  const existingIgnore = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, 'utf8') : '';
  writes.push([ignoreFile, mergeGitignore(existingIgnore)]);
  if (!fs.existsSync(configFile)) {
    writes.push([configFile, `${JSON.stringify({
      schemaVersion: '1.0.0',
      managedBy: 'respawn-pi:init-project@1',
      spine: { status: mode === 'greenfield' ? 'uninitialized' : 'onboarding-required' },
      governance: { profile: governance },
      opsTargets: {},
    }, null, 2)}\n`]);
  }
  if (mode === 'greenfield') {
    for (const name of CANONICAL_DOCS) {
      const source = path.join(TEMPLATE_DIR, name);
      const body = fs.readFileSync(source, 'utf8');
      if (!body.startsWith(TEMPLATE_START)) throw new Error(`template is not explicitly uninitialized: ${source}`);
      writes.push([path.join(target, 'docs', name), body]);
    }
  }

  const changed = writes.filter(([file, body]) => !fs.existsSync(file) || !fs.readFileSync(file).equals(Buffer.from(body)));
  if (!dryRun && changed.length) {
    const before = snapshot(changed.map(([file]) => file), target);
    try {
      for (const [file, body] of changed) {
        atomicWrite(file, body);
        if (failHook) failHook(path.relative(target, file));
      }
    }
    catch (error) { restore(before); throw new Error(`initialization failed (${error.message}); managed paths restored`); }
  }
  return { target, mode, governance, dryRun, changes: changed.map(([file]) => path.relative(target, file)) };
}

function usage() {
  return `Usage: node scripts/init-project.mjs <target> --mode <greenfield|brownfield> [--governance <continuity|guarded>] [--dry-run]\n\nThis explicit project initialization never installs the Pi package, changes .pi/settings.json, or chooses a provider/model. Greenfield creates neutral canonical templates. Brownfield creates no canonical docs; use /skill:onboard. Blocking push/shell/index/config policy is opt-in through --governance guarded (default: continuity).`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) console.log(usage());
    else {
      const result = initialize(args);
      console.log(`${result.dryRun ? 'Would initialize' : 'Initialized'} ${result.changes.length} file(s) in ${result.target} (${result.mode})`);
      for (const file of result.changes) console.log(`- ${file}`);
      if (result.mode === 'brownfield') console.log('Next: start Pi in the target and run /skill:onboard; no canonical project docs were created.');
    }
  } catch (error) { console.error(`respawn-pi init failed: ${error.message}`); process.exitCode = 1; }
}

export { MANAGED_START, MANAGED_END, TEMPLATE_START, CANONICAL_DOCS, parseArgs, initialize, mergeManagedBlock, mergeGitignore, atomicWrite, assertManagedPath, snapshot, restore, setFailHook, usage };
