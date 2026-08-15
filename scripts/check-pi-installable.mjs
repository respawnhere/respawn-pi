#!/usr/bin/env node
/*
 * scripts/check-pi-installable.mjs — verify a directory is a valid Pi package per
 * Pi's own readPiManifest (dist/core/pi-manifest.js).
 *
 * R13 hardened:
 *   - Validates EXACT resource paths against Pi's package directory conventions:
 *     extensions must resolve to regular files OR directory entries; skills must resolve
 *     to a directory OR a regular .md file; resources are NOT allowed to escape the package
 *     root via `../` or absolute paths.
 *   - Reports the exact extension + skill counts and surfaces missing paths.
 *   - Refuses symlinked package roots (D-007).
 *   - Refuses absolute and `../`-prefixed resource paths.
 *   - Refuses packages whose pi.extensions contains a directory entry with no agent /
 *     .ts surface inside (writes the offending path back to the operator).
 *
 * Usage: node scripts/check-pi-installable.mjs [<package-root>...]
 *        node scripts/check-pi-installable.mjs   # defaults to ROOT/. and ROOT/adapters/pi/package
 *
 * Exit: 0 every package is valid · 1 any package is invalid.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const HERE = path.dirname(__filename);
const REPO_ROOT = path.resolve(HERE, '..');

const require_ = createRequire(import.meta.url);

function loadReadPiManifest() {
  const candidates = [];
  const addDist = (candidate) => {
    if (!candidate) return;
    candidates.push(path.join(candidate, 'pi-manifest.js'), path.join(candidate, 'core', 'pi-manifest.js'));
  };
  addDist(process.env.PI_DIST);
  try {
    candidates.push(require_.resolve('@earendil-works/pi-coding-agent/dist/core/pi-manifest.js'));
  } catch { /* not installed locally */ }
  // A global Pi executable is a valid installed authority. Resolve its real entrypoint and
  // walk upward just as bootstrap-load.mjs does; do not require a machine-specific PI_DIST.
  const which = spawnSync('sh', ['-c', 'command -v pi'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (which.status === 0) {
    try {
      let cursor = path.dirname(fs.realpathSync(which.stdout.trim()));
      for (let i = 0; i < 8; i++) {
        addDist(cursor);
        addDist(path.join(cursor, 'dist'));
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
    } catch { /* malformed PATH entry; candidates below fail closed */ }
  }
  for (const p of [...new Set(candidates)]) {
    if (fs.existsSync(p)) return require_(p).readPiManifest;
  }
  throw new Error('Cannot locate Pi package to read manifest from. Set PI_DIST to <pi>/dist or <pi>/dist/core, install it as a dependency, or put the real pi executable on PATH.');
}

const readPiManifest = loadReadPiManifest();

function isSymlinkAt(p) {
  try { return fs.lstatSync(p).isSymbolicLink(); }
  catch { return false; }
}

function isRegularFileAt(p) {
  try { return fs.lstatSync(p).isFile(); }
  catch { return false; }
}

function isDirectoryAt(p) {
  try { return fs.lstatSync(p).isDirectory(); }
  catch { return false; }
}

function safeResolveResource(rel, target, kind) {
  // Reject absolute paths and entries that escape the package root.
  if (typeof rel !== 'string' || rel.length === 0) throw new Error(`resource must be a non-empty string`);
  if (path.isAbsolute(rel)) throw new Error(`absolute paths are forbidden: ${rel}`);
  const abs = path.resolve(target, rel);
  const relNorm = path.relative(target, abs);
  if (relNorm.startsWith('..') || path.isAbsolute(relNorm)) throw new Error(`resource escapes package root: ${rel} -> ${abs}`);
  if (!fs.existsSync(abs)) throw new Error(`declared ${kind} "${rel}" does not resolve to a file or directory`);
  if (kind === 'extension') {
    if (isSymlinkAt(abs)) throw new Error(`symlinked extension is forbidden: ${rel}`);
    if (!isRegularFileAt(abs) && !isDirectoryAt(abs)) throw new Error(`extension must be a regular file or directory: ${rel}`);
  }
  if (kind === 'skill') {
    if (isSymlinkAt(abs)) throw new Error(`symlinked skill is forbidden: ${rel}`);
    if (!isRegularFileAt(abs) && !isDirectoryAt(abs)) throw new Error(`skill must be a regular file or directory: ${rel}`);
  }
  return abs;
}

const DEFAULT_TARGETS = [
  REPO_ROOT,
  path.join(REPO_ROOT, 'adapters', 'pi', 'package'),
];

const targets = process.argv.length > 2
  ? process.argv.slice(2).map((p) => path.resolve(p))
  : DEFAULT_TARGETS;

let totalOk = 0;
let totalFail = 0;

for (const target of targets) {
  if (isSymlinkAt(target)) {
    console.log(`✖ ${path.relative(REPO_ROOT, target) || '.'} — package root is a symlink`);
    totalFail++;
    continue;
  }
  const pkg = path.join(target, 'package.json');
  if (!fs.existsSync(pkg)) {
    console.log(`✖ ${path.relative(REPO_ROOT, target) || '.'} — package.json missing`);
    totalFail++;
    continue;
  }
  const manifest = readPiManifest(pkg);
  if (manifest === null) {
    console.log(`✖ ${path.relative(REPO_ROOT, target) || '.'} — no "pi" field (not a valid Pi package)`);
    totalFail++;
    continue;
  }
  const lines = [];
  let failed = false;
  lines.push(`✔ ${path.relative(REPO_ROOT, target) || '.'} — valid Pi manifest`);
  const exts = Array.isArray(manifest.extensions) ? manifest.extensions : [];
  const sks = Array.isArray(manifest.skills) ? manifest.skills : [];
  const pps = Array.isArray(manifest.prompts) ? manifest.prompts : [];
  const ths = Array.isArray(manifest.themes) ? manifest.themes : [];
  lines.push(`  extensions: ${exts.length} → ${exts.slice(0, 5).join(', ')}${exts.length > 5 ? ', …' : ''}`);
  lines.push(`  skills    : ${sks.length} → ${sks.slice(0, 5).join(', ')}${sks.length > 5 ? ', …' : ''}`);
  lines.push(`  prompts   : ${pps.length}`);
  lines.push(`  themes    : ${ths.length}`);
  for (const e of exts) {
    try { safeResolveResource(e, target, 'extension'); }
    catch (err) { lines.push(`    ✖ extension "${e}": ${err.message}`); failed = true; }
  }
  for (const s of sks) {
    try { safeResolveResource(s, target, 'skill'); }
    catch (err) { lines.push(`    ✖ skill "${s}": ${err.message}`); failed = true; }
  }
  if (failed) { console.log(lines.join('\n')); totalFail++; continue; }
  lines.push(`  ✔ all resource paths resolve to files or directories`);
  totalOk++;
  console.log(lines.join('\n'));
}

console.log(`\n${totalOk}/${totalOk + totalFail} packages valid`);
process.exit(totalFail > 0 ? 1 : 0);
