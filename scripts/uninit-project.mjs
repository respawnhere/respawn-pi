#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MANAGED_START, MANAGED_END, CANONICAL_DOCS, atomicWrite, assertManagedPath, snapshot, restore } from './init-project.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(SCRIPT), '..');
const TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'templates', 'project', 'docs');

function parseArgs(argv) {
  let target = null;
  let dryRun = false;
  let removeStubs = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--remove-stubs') removeStubs = true;
    else if (arg === '--help' || arg === '-h') return { help: true };
    else if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`);
    else if (target === null) target = arg;
    else throw new Error('exactly one target project is required');
  }
  if (!target) throw new Error('target project is required');
  return { help: false, target: path.resolve(target), dryRun, removeStubs };
}

function stripManagedBlock(text) {
  const start = text.indexOf(MANAGED_START);
  const end = text.indexOf(MANAGED_END);
  if (start === -1 && end === -1) return text;
  if (start === -1 || end === -1 || end < start || text.indexOf(MANAGED_START, start + 1) !== -1 || text.indexOf(MANAGED_END, end + 1) !== -1) {
    throw new Error('AGENTS.md contains incomplete or duplicate respawn-pi managed markers');
  }
  return `${text.slice(0, start)}${text.slice(end + MANAGED_END.length)}`.trim() ? `${text.slice(0, start)}${text.slice(end + MANAGED_END.length)}`.trimEnd() + '\n' : '';
}

function stripRuntimeIgnore(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '# respawn-pi runtime state' && lines[i + 1]?.trim() === '.respawnpack/') { i++; continue; }
    out.push(lines[i]);
  }
  return out.join('\n').replace(/\s+$/, '') + (out.some((line) => line.trim()) ? '\n' : '');
}

function uninitialize({ target, dryRun = false, removeStubs = false }) {
  target = path.resolve(target);
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`target must be a real directory, not a symlink: ${target}`);
  const agentsFile = path.join(target, 'AGENTS.md');
  const ignoreFile = path.join(target, '.gitignore');
  const configFile = path.join(target, 'respawnpack.config.json');
  const candidates = [agentsFile, ignoreFile, configFile, ...CANONICAL_DOCS.map((name) => path.join(target, 'docs', name))];
  for (const file of candidates) assertManagedPath(target, file);

  const operations = [];
  if (fs.existsSync(agentsFile)) {
    const current = fs.readFileSync(agentsFile, 'utf8');
    const next = stripManagedBlock(current);
    if (next !== current) operations.push({ kind: 'write', file: agentsFile, body: next });
  }
  if (fs.existsSync(ignoreFile)) {
    const current = fs.readFileSync(ignoreFile, 'utf8');
    const next = stripRuntimeIgnore(current);
    if (next !== current) operations.push({ kind: 'write', file: ignoreFile, body: next });
  }
  if (fs.existsSync(configFile)) {
    try {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      if (config?.managedBy === 'respawn-pi:init-project@1'
        && Object.keys(config).sort().join(',') === 'governance,managedBy,opsTargets,schemaVersion,spine') {
        operations.push({ kind: 'delete', file: configFile });
      }
    } catch { /* customized or malformed target config remains project-owned */ }
  }
  if (removeStubs) {
    for (const name of CANONICAL_DOCS) {
      const file = path.join(target, 'docs', name);
      const template = path.join(TEMPLATE_DIR, name);
      if (fs.existsSync(file) && fs.readFileSync(file).equals(fs.readFileSync(template))) operations.push({ kind: 'delete', file });
    }
  }

  if (!dryRun && operations.length) {
    const before = snapshot(operations.map(({ file }) => file), target);
    try {
      for (const op of operations) {
        if (op.kind === 'delete') fs.unlinkSync(op.file);
        else atomicWrite(op.file, op.body);
      }
    } catch (error) { restore(before); throw new Error(`uninitialization failed (${error.message}); managed paths restored`); }
  }
  return { target, dryRun, removeStubs, changes: operations.map(({ kind, file }) => `${kind}:${path.relative(target, file)}`) };
}

function usage() {
  return `Usage: node scripts/uninit-project.mjs <target> [--dry-run] [--remove-stubs]\n\nRemoves only respawn-pi managed instructions and runtime ignore. Project docs are preserved by default. --remove-stubs deletes only byte-identical, still-uninitialized templates. Package removal remains Pi's responsibility (pi remove -l).`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) console.log(usage());
    else {
      const result = uninitialize(args);
      console.log(`${result.dryRun ? 'Would uninitialize' : 'Uninitialized'} ${result.changes.length} path(s) in ${result.target}`);
      for (const change of result.changes) console.log(`- ${change}`);
    }
  } catch (error) { console.error(`respawn-pi uninit failed: ${error.message}`); process.exitCode = 1; }
}

export { parseArgs, stripManagedBlock, stripRuntimeIgnore, uninitialize, usage };
