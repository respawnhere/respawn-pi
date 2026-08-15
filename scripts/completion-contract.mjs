import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../schemas/validate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, '..');
const BOUNDED_GIT = path.join(HERE, 'bounded-git.mjs');
const GIT_TIMEOUT_MS = (() => {
  const configured = Number(process.env.RESPAWNPACK_GIT_TIMEOUT_MS);
  return Number.isInteger(configured) && configured >= 100 && configured <= 30_000 ? configured : 30_000;
})();
const MAX_EVIDENCE_FILES = 128;
const MAX_EVIDENCE_FILE_BYTES = 256 * 1024;
const MAX_WITNESS_FILE_BYTES = 1024 * 1024;
const MAX_WITNESS_TOTAL_BYTES = 4 * 1024 * 1024;

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashRequirement(requirement) { return sha256(canonical(requirement)); }
export function hashFence(fence) { return sha256(canonical(fence)); }

function loadSchema(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'schemas', name), 'utf8'));
}

function duplicates(values) {
  const seen = new Set();
  return values.filter((value) => seen.has(value) || !seen.add(value));
}

function cycleIn(rows) {
  const graph = new Map(rows.map((row) => [row.id, row.dependsOn || []]));
  const active = new Set();
  const done = new Set();
  const visit = (id, trail) => {
    if (active.has(id)) return [...trail, id];
    if (done.has(id)) return null;
    active.add(id);
    for (const child of graph.get(id) || []) {
      const found = visit(child, [...trail, id]);
      if (found) return found;
    }
    active.delete(id);
    done.add(id);
    return null;
  };
  for (const id of graph.keys()) {
    const found = visit(id, []);
    if (found) return found;
  }
  return null;
}

export function validateRequirementsDocument(document, { productIds = new Set(), fenceRegistry, root = DEFAULT_ROOT, schemaRoot = root } = {}) {
  const structural = validate(document, loadSchema(schemaRoot, 'requirements.schema.json'));
  const errors = [...structural.errors];
  if (!structural.valid) return { ok: false, errors };
  const rows = document.requirements;
  const ids = new Set(rows.map((row) => row.id));
  for (const id of new Set(duplicates(rows.map((row) => row.id)))) errors.push(`duplicate requirement id: ${id}`);
  for (const row of rows) {
    for (const featureId of row.featureIds) if (!productIds.has(featureId)) errors.push(`${row.id}: unknown feature ${featureId}`);
    for (const dependency of [...(row.dependsOn || []), ...(row.blockedBy || [])]) {
      if (!ids.has(dependency)) errors.push(`${row.id}: unknown requirement dependency ${dependency}`);
    }
    for (const fenceId of row.fenceIds) {
      if (!fenceRegistry?.fences?.[fenceId]) errors.push(`${row.id}: unknown fence ${fenceId}`);
    }
    if (row.waiver && row.mandatory) errors.push(`${row.id}: waiver contradicts mandatory=true`);
    if (row.waiver && row.fenceIds.length) errors.push(`${row.id}: waived row may not claim qualifying fences`);
    if (row.risk === 'high' && !row.evidenceRequirements.qualification.includes('independent')) {
      errors.push(`${row.id}: high-risk requirement must require independent qualification`);
    }
  }
  for (const [gateId, gate] of Object.entries(document.gates)) {
    for (const id of gate.requires) if (!ids.has(id)) errors.push(`gate ${gateId}: unknown requirement ${id}`);
    for (const id of new Set(duplicates(gate.requires))) errors.push(`gate ${gateId}: duplicate requirement ${id}`);
  }
  const cycle = cycleIn(rows);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' -> ')}`);
  return { ok: errors.length === 0, errors };
}

function confinedRegularFile(root, relative, limits) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) {
    throw new Error(`unsafe relative path: ${relative}`);
  }
  const absolute = path.resolve(root, relative);
  const rel = path.relative(root, absolute);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path escapes root: ${relative}`);
  let cursor = root;
  for (const part of rel.split(path.sep)) {
    cursor = path.join(cursor, part);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`symlink refused: ${relative}`);
  }
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile()) throw new Error(`not a regular file: ${relative}`);
  if (stat.size > limits.maxFileBytes) throw new Error(`${relative} exceeds ${limits.maxFileBytes} bytes`);
  return { absolute, size: stat.size };
}

export function hashWitnesses(root, witnesses) {
  let total = 0;
  const hash = crypto.createHash('sha256');
  for (const relative of [...witnesses].sort()) {
    const file = confinedRegularFile(root, relative, { maxFileBytes: MAX_WITNESS_FILE_BYTES });
    total += file.size;
    if (total > MAX_WITNESS_TOTAL_BYTES) throw new Error(`witnesses exceed ${MAX_WITNESS_TOTAL_BYTES} aggregate bytes`);
    hash.update(Buffer.from(relative));
    hash.update(Buffer.from([0]));
    hash.update(fs.readFileSync(file.absolute));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

function sameDimensions(actual, required) {
  for (const key of ['surface', 'topology', 'adversarial', 'runtime']) {
    const have = new Set(actual[key] || []);
    for (const needed of required[key] || []) if (!have.has(needed)) return `${key} missing ${needed}`;
  }
  return null;
}

export function validateEvidenceDocument(document, { requirements, fenceRegistry, root = DEFAULT_ROOT, schemaRoot = root } = {}) {
  const structural = validate(document, loadSchema(schemaRoot, 'evidence.schema.json'));
  const errors = [...structural.errors];
  if (!structural.valid) return { ok: false, errors };
  const row = requirements?.requirements?.find((item) => item.id === document.requirementId);
  const fence = fenceRegistry?.fences?.[document.fenceId];
  if (!row) errors.push(`unknown requirement ${document.requirementId}`);
  if (!fence) errors.push(`unknown fence ${document.fenceId}`);
  if (row && !row.fenceIds.includes(document.fenceId)) errors.push(`${document.fenceId} is not declared by ${row.id}`);
  if (row && document.requirementHash !== hashRequirement(row)) errors.push('requirement hash mismatch');
  if (fence && document.fenceHash !== hashFence(fence)) errors.push('fence hash mismatch');
  if (fence) {
    try {
      if (document.witnessHash !== hashWitnesses(root, fence.witnesses)) errors.push('witness hash mismatch');
    } catch (error) { errors.push(`witness hash unavailable: ${error.message}`); }
  }
  if (row) {
    const missing = sameDimensions(document.dimensions, row.evidenceRequirements);
    if (missing) errors.push(`evidence dimensions insufficient: ${missing}`);
  }
  if (document.verdict === 'PASS') {
    if (document.exitCode !== 0) errors.push('PASS requires exitCode 0');
    if (document.output.truncated) errors.push('truncated output cannot qualify PASS');
    if (document.controls.positive !== 'PASS' || document.controls.negative !== 'PASS') errors.push('PASS requires discriminating positive and negative controls');
  }
  if (document.finishedAt < document.startedAt) errors.push('finishedAt precedes startedAt');
  return { ok: errors.length === 0, errors, row, fence };
}

function currentHead(root) {
  const run = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  const head = run.status === 0 ? run.stdout.trim() : '';
  if (!/^[0-9a-f]{40}$/.test(head)) throw new Error('source revision unavailable');
  return head;
}

function createCandidateSnapshot(root) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-evidence-index-'));
  fs.chmodSync(temp, 0o700);
  const objectDir = path.join(temp, 'objects');
  fs.mkdirSync(objectDir, { mode: 0o700 });
  const objects = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'objects'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  if (objects.status !== 0) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw new Error('git object directory unavailable');
  }
  const env = {
    ...process.env,
    GIT_INDEX_FILE: path.join(temp, 'index'),
    GIT_OBJECT_DIRECTORY: objectDir,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: objects.stdout.trim(),
  };
  // Git filters and hooks can spawn descendants that survive spawnSync's direct-child
  // timeout. Use the package's process-group runner so every private-index operation
  // terminates and reaps the whole Git subtree before returning.
  const run = (args) => spawnSync(process.execPath, [BOUNDED_GIT, '--timeout', String(GIT_TIMEOUT_MS), '--', ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS + 2_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const cleanup = () => fs.rmSync(temp, { recursive: true, force: true });
  try {
    if (run(['read-tree', 'HEAD']).status !== 0) throw new Error('candidate read-tree failed');
    const prefixResult = run(['rev-parse', '--show-prefix']);
    const gitPrefix = prefixResult.status === 0 ? prefixResult.stdout.trim() : '';
    if (prefixResult.status !== 0 || gitPrefix.includes('\0') || gitPrefix.includes('\n')) {
      throw new Error('candidate Git prefix unavailable');
    }
    const fromRepositoryTop = (relativePath) => `:(top,literal)${gitPrefix}${relativePath}`;
    // Let Git apply ignore rules during add; explicitly naming an ignored directory
    // as an exclude pathspec makes `git add` reject that directory. Then restore the
    // two package-owned projections in the private index only, relative to the real
    // repository root. This also removes newly staged projection paths and restores
    // tracked projection paths without touching the caller's working tree.
    const add = run(['add', '-A', '--', '.']);
    if (add.status !== 0) throw new Error(`candidate add failed: ${add.stderr.trim()}`);
    const restoreProjections = run([
      'reset', '-q', 'HEAD', '--',
      fromRepositoryTop('docs/derived/STATE.json'),
      fromRepositoryTop('.respawnpack'),
    ]);
    if (restoreProjections.status !== 0) throw new Error(`candidate projection reset failed: ${restoreProjections.stderr.trim()}`);
    const write = run(['write-tree']);
    const tree = write.status === 0 ? write.stdout.trim() : '';
    if (!/^[0-9a-f]{40,64}$/.test(tree)) throw new Error('candidate write-tree failed');
    // `git write-tree` honors the current Git prefix and writes the package subtree
    // when this module runs from a package nested in a larger repository. This is
    // the same package-scoped tree hash candidateTree() has always returned.
    return { tree, packageTree: tree, run, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function candidateTree(root = DEFAULT_ROOT) {
  const snapshot = createCandidateSnapshot(root);
  try { return snapshot.tree; }
  finally { snapshot.cleanup(); }
}

export function writeCandidateArchive(root = DEFAULT_ROOT, outputPath) {
  if (!path.isAbsolute(outputPath) || outputPath.includes('\0')) throw new Error('candidate archive output must be an absolute non-NUL path');
  const requestedParent = path.dirname(outputPath);
  if (fs.lstatSync(requestedParent).isSymbolicLink()) throw new Error('candidate archive parent cannot be a symlink');
  const parent = fs.realpathSync(requestedParent);
  const tempRoot = fs.realpathSync(os.tmpdir());
  const fromTemp = path.relative(tempRoot, parent);
  if (fromTemp.startsWith('..') || path.isAbsolute(fromTemp)) throw new Error('candidate archive output must be inside the system temporary directory');
  if (fs.existsSync(outputPath) && fs.lstatSync(outputPath).isSymbolicLink()) throw new Error('candidate archive output cannot be a symlink');
  const snapshot = createCandidateSnapshot(root);
  try {
    const archive = snapshot.run(['archive', '--format=tar', '-o', outputPath, snapshot.packageTree]);
    if (archive.status !== 0) throw new Error(`candidate archive failed: ${archive.stderr.trim()}`);
    const stat = fs.lstatSync(outputPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 512 * 1024 * 1024) {
      throw new Error('candidate archive output is not a bounded regular file');
    }
    return { tree: snapshot.tree, packageTree: snapshot.packageTree, bytes: stat.size };
  } finally { snapshot.cleanup(); }
}

export function sourceRevision(root = DEFAULT_ROOT) { return currentHead(root); }

export function loadAdmissibleEvidence({ evidenceDir, requirements, fenceRegistry, sourceRevision: revision, candidateTree: tree, root = DEFAULT_ROOT, schemaRoot = root }) {
  const accepted = [];
  const rejected = [];
  let entries;
  try {
    const dirStat = fs.lstatSync(evidenceDir);
    if (dirStat.isSymbolicLink()) return { accepted, rejected: [{ file: evidenceDir, reason: 'evidence directory is a symlink' }] };
    if (!dirStat.isDirectory()) return { accepted, rejected: [{ file: evidenceDir, reason: 'evidence path is not a directory' }] };
    entries = fs.readdirSync(evidenceDir).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return { accepted, rejected };
    return { accepted, rejected: [{ file: evidenceDir, reason: error.message }] };
  }
  if (entries.length > MAX_EVIDENCE_FILES) entries.slice(MAX_EVIDENCE_FILES).forEach((file) => rejected.push({ file, reason: `evidence inventory exceeds ${MAX_EVIDENCE_FILES} files` }));
  for (const file of entries.slice(0, MAX_EVIDENCE_FILES)) {
    const absolute = path.join(evidenceDir, file);
    try {
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error('evidence file is a symlink');
      if (!stat.isFile()) throw new Error('evidence entry is not a regular file');
      if (stat.size > MAX_EVIDENCE_FILE_BYTES) throw new Error(`evidence file exceeds ${MAX_EVIDENCE_FILE_BYTES} bytes`);
      const document = JSON.parse(fs.readFileSync(absolute, 'utf8'));
      // Freshness is checked before contract hashes so a stale artifact receives the
      // actionable stale diagnosis instead of an incidental current-witness mismatch.
      if (document.sourceRevision !== revision) throw new Error('stale source revision');
      if (document.candidateTree !== tree) throw new Error('stale candidate tree');
      const checked = validateEvidenceDocument(document, { requirements, fenceRegistry, root, schemaRoot });
      if (!checked.ok) throw new Error(checked.errors.join('; '));
      accepted.push({ file, document });
    } catch (error) { rejected.push({ file, reason: error.message }); }
  }
  return { accepted, rejected };
}
