#!/usr/bin/env node
/*
 * RespawnPack · scripts/respawn-savepoint.mjs — Pi-native savepoint.
 *
 * Writes a revision-validated, schema-conformant `docs/derived/STATE.json` (per
 * `schemas/state.schema.json`) AND a pending handoff note at
 * `<project>/.respawnpack/runtime/rollover/_pi-pending-note.json` whose shape matches
 * what `adapters/pi/bridge/rollover-bridge.js#peekPendingNote` actually consumes.
 *
 * The Pi-native counterpart to the legacy `.claude/respawnpack` savepoint path — do not
 * restore that command.
 *
 *   node scripts/respawn-savepoint.mjs [--project <path>] [--note <text>]
 *                                      [--revision-validated <shortSHA>]
 *                                      [--atomic-action-id <id>]
 *                                      [--constraint <line>]... [--question <line>]...
 *                                      [--candidate <id>]...
 *
 * Exit codes: 0 PASS/success · 1 FAIL · 2 CANNOT_DETERMINE.
 *
 * ⛔ INVENTORY DERIVES FROM THE CANONICAL MANIFEST, NEVER A DIRECTORY GUESS.
 * `schemas/state.schema.json` forbids extra fields, so package-capability inventory is
 * built from the installed package manifest, while revision, requirements, evidence,
 * candidate tree, generated STATE, and pending note are all target-project authority.
 *
 * ⛔ TRACK ONLY AN APPROVED, SEMANTICALLY VALID DENOMINATOR.
 * Root requirements.json selects the tracked schema branch. When it is absent the
 * compiler preserves the honest untracked shape; when present but invalid the write
 * fails closed rather than silently shrinking or ignoring the denominator.
 *
 * ⛔ PENDING NOTE FIELDS MATCH THE BRIDGE CONSUMER.
 * `adapters/pi/bridge/rollover-bridge.js#peekPendingNote` reads: `exactNextAction`,
 * `atomicActionId`, `userConstraints`, `unresolvedQuestions`, `candidateMemories`,
 * `verificationEvidence`. The note may carry Tier-2 metadata, but its consumer-tested
 * field projection must match that exact set.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';
import {
  candidateTree as computeCompletionCandidateTree,
  loadAdmissibleEvidence,
  validateRequirementsDocument,
} from './completion-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Package files are executable implementation authority only. All mutable project
// state and completion inputs are resolved from --project (default: cwd).
const PACKAGE_ROOT = path.resolve(HERE, '..');
const STATE_SCHEMA = path.join(PACKAGE_ROOT, 'schemas', 'state.schema.json');

function projectPaths(projectRoot) {
  return {
    stateFile: path.join(projectRoot, 'docs', 'derived', 'STATE.json'),
    requirementsFile: path.join(projectRoot, 'requirements.json'),
    fenceRegistryFile: path.join(projectRoot, 'scripts', 'fence-registry.json'),
    evidenceDir: path.join(projectRoot, '.respawnpack', 'runtime', 'evidence'),
    productFile: path.join(projectRoot, 'docs', 'PRODUCT.md'),
  };
}
const MAX_CANDIDATE_FILES = 50_000;
const MAX_CANDIDATE_FILE_BYTES = 128 * 1024 * 1024;
const MAX_CANDIDATE_TOTAL_BYTES = 512 * 1024 * 1024;
const GIT_TIMEOUT_MS = (() => {
  const raw = Number(process.env.RESPAWNPACK_GIT_TIMEOUT_MS);
  return Number.isInteger(raw) && raw >= 100 && raw <= 30_000 ? raw : 30_000;
})();
const BOUNDED_GIT = path.join(PACKAGE_ROOT, 'scripts', 'bounded-git.mjs');
const { projectPendingNoteFields } = createRequire(import.meta.url)(path.join(PACKAGE_ROOT, 'adapters', 'pi', 'bridge', 'pending-note.js'));

function safeRun(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function candidateSizeError(cwd) {
  const listed = safeRun('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], cwd);
  if (listed.status !== 0) return `candidate inventory unavailable: ${listed.error?.message || listed.stderr.trim()}`;
  const files = listed.stdout.split('\0').filter(Boolean);
  if (files.length > MAX_CANDIDATE_FILES) return `candidate has ${files.length} files; limit is ${MAX_CANDIDATE_FILES}`;
  let total = 0;
  for (const rel of files) {
    let stat;
    try { stat = fs.lstatSync(path.join(cwd, rel)); }
    catch (error) { if (error.code === 'ENOENT') continue; return `cannot inspect candidate ${rel}: ${error.message}`; }
    const size = stat.isFile() ? stat.size : 0;
    if (size > MAX_CANDIDATE_FILE_BYTES) return `candidate file ${rel} is ${size} bytes; per-file limit is ${MAX_CANDIDATE_FILE_BYTES}`;
    total += size;
    if (total > MAX_CANDIDATE_TOTAL_BYTES) return `candidate is at least ${total} bytes; total limit is ${MAX_CANDIDATE_TOTAL_BYTES}`;
  }
  return null;
}

function sha256OfFile(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
  catch { return 'UNREADABLE'; }
}

function sha256OfString(s) {
  return crypto.createHash('sha256').update(s || '').digest('hex');
}

function shortHead(head) {
  return head ? head.slice(0, 7) : null;
}

function parseArgs(argv) {
  const out = {
    project: process.cwd(), note: null, atomicActionId: null, revisionValidated: null,
    constraints: [], questions: [], candidates: [], mode: 'write', json: false,
  };
  const flat = argv.slice(2);
  const valueFor = (flag, index) => {
    const value = flat[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    return value;
  };
  for (let i = 0; i < flat.length; i++) {
    const a = flat[i];
    if (a === '--status' || a === '--verify') {
      const mode = a.slice(2);
      if (out.mode !== 'write' && out.mode !== mode) throw new Error('--status and --verify are mutually exclusive');
      out.mode = mode;
    } else if (a === '--json') out.json = true;
    else if (a === '--project') out.project = path.resolve(valueFor(a, i++));
    else if (a === '--note') out.note = valueFor(a, i++);
    else if (a === '--revision-validated') out.revisionValidated = valueFor(a, i++);
    else if (a === '--atomic-action-id') out.atomicActionId = valueFor(a, i++);
    else if (a === '--constraint') out.constraints.push(valueFor(a, i++));
    else if (a === '--question') out.questions.push(valueFor(a, i++));
    else if (a === '--candidate') out.candidates.push(valueFor(a, i++));
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

function printHelp() {
  console.log(`node scripts/respawn-savepoint.mjs [--project <path>] [--note <text>]
       [--revision-validated <SHA>] [--atomic-action-id <id>]
       [--constraint <line>]... [--question <line>]... [--candidate <id>]...
       [--status | --verify] [--json]

  Write mode: regenerates <project>/docs/derived/STATE.json and writes
              <project>/.respawnpack/runtime/rollover/_pi-pending-note.json.
  --status:   validates STATE schema, HEAD, and every sourceManifest digest.
  --verify:   runs --status plus the actual bridge pending-note consumer.
  Exit codes: 0 PASS · 1 FAIL · 2 CANNOT_DETERMINE.`);
}

// --- sourceRevision + sourceManifest inputs ---------------------------------------------------------

/** Returns the FULL 40-char sourceRevision from `git rev-parse HEAD`, or null. */
function getHead(cwd) {
  const r = safeRun('git', ['rev-parse', 'HEAD'], cwd);
  if (r.status !== 0) return null;
  const h = r.stdout.trim();
  return /^[0-9a-f]{40}$/.test(h) ? h : null;
}

/** Build an immutable Git tree for the exact bounded candidate, including untracked non-ignored files. */
function computeCandidateSnapshot(cwd) {
  const sizeError = candidateSizeError(cwd);
  if (sizeError) return { ok: false, reason: sizeError };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-savepoint-index-'));
  fs.chmodSync(tempDir, 0o700);
  const objectDir = path.join(tempDir, 'objects');
  fs.mkdirSync(objectDir, { mode: 0o700 });
  const objects = safeRun('git', ['rev-parse', '--path-format=absolute', '--git-path', 'objects'], cwd);
  if (objects.status !== 0) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    return { ok: false, reason: `git object directory unavailable: ${objects.stderr.trim()}` };
  }
  const env = {
    ...process.env,
    GIT_INDEX_FILE: path.join(tempDir, 'index'),
    GIT_OBJECT_DIRECTORY: objectDir,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: objects.stdout.trim(),
  };
  const run = (args) => spawnSync(process.execPath, [BOUNDED_GIT, '--timeout', String(GIT_TIMEOUT_MS), '--', ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS + 1_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const failure = (label, result) => `${label} failed: ${result.error?.message || result.stderr.trim() || `exit ${result.status}`}`;
    const read = run(['read-tree', 'HEAD']);
    if (read.status !== 0) return { ok: false, reason: failure('git read-tree', read) };
    const add = run(['add', '-A', '--', '.']);
    if (add.status !== 0) return { ok: false, reason: failure('git add to temporary index', add) };
    // Generated continuity state cannot contribute to the tree it fingerprints.
    // Resetting in the private index preserves any committed baseline bytes while
    // excluding runtime/generated mutations and never touches the caller's index.
    const resetOwn = run(['reset', '-q', 'HEAD', '--', 'docs/derived/STATE.json', '.respawnpack']);
    if (resetOwn.status !== 0) return { ok: false, reason: failure('git reset generated state in temporary index', resetOwn) };
    const write = run(['write-tree']);
    if (write.status !== 0) return { ok: false, reason: failure('git write-tree', write) };
    const headTree = run(['rev-parse', 'HEAD^{tree}']);
    if (headTree.status !== 0) return { ok: false, reason: failure('git HEAD tree', headTree) };
    const tree = write.stdout.trim();
    const committedTree = headTree.stdout.trim();
    if (!/^[0-9a-f]{40,64}$/.test(tree) || !/^[0-9a-f]{40,64}$/.test(committedTree)) {
      return { ok: false, reason: 'git returned a malformed tree id' };
    }
    return { ok: true, algorithm: 'git-tree', tree, headTree: committedTree, dirty: tree !== committedTree };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * SHA256 the compiler inputs.
 * The schema's `manifest` shape requires {algorithm: "sha256", inputs: {<key>: "<sha>|ABSENT|UNREADABLE"}}.
 * Every file the compiler actually read is named explicitly so a reviewer can see what
 * changed if a hash does. ABSENT = path missing (with reason), UNREADABLE = read failed.
 */
function evidenceDirectoryDigest(evidenceDir) {
  try {
    const stat = fs.lstatSync(evidenceDir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return 'UNREADABLE';
    const hash = crypto.createHash('sha256');
    const entries = fs.readdirSync(evidenceDir).sort();
    if (entries.length > 128) return 'UNREADABLE';
    for (const name of entries) {
      const file = path.join(evidenceDir, name);
      const item = fs.lstatSync(file);
      if (item.isSymbolicLink() || !item.isFile() || item.size > 256 * 1024) return 'UNREADABLE';
      hash.update(name); hash.update('\0'); hash.update(fs.readFileSync(file)); hash.update('\0');
    }
    return hash.digest('hex');
  } catch (error) { return error.code === 'ENOENT' ? 'ABSENT' : 'UNREADABLE'; }
}

function computeSourceManifest(projectRoot, paths = projectPaths(projectRoot)) {
  const inputPaths = {
    'implementation/package.json': path.join(PACKAGE_ROOT, 'package.json'),
    'implementation/scripts/respawn-savepoint.mjs': path.join(PACKAGE_ROOT, 'scripts', 'respawn-savepoint.mjs'),
    'implementation/scripts/bounded-git.mjs': BOUNDED_GIT,
    'implementation/schemas/state.schema.json': path.join(PACKAGE_ROOT, 'schemas', 'state.schema.json'),
    'implementation/schemas/validate.mjs': path.join(PACKAGE_ROOT, 'schemas', 'validate.mjs'),
    'implementation/schemas/requirements.schema.json': path.join(PACKAGE_ROOT, 'schemas', 'requirements.schema.json'),
    'implementation/schemas/evidence.schema.json': path.join(PACKAGE_ROOT, 'schemas', 'evidence.schema.json'),
    'implementation/scripts/completion-contract.mjs': path.join(PACKAGE_ROOT, 'scripts', 'completion-contract.mjs'),
    'project/package.json': path.join(projectRoot, 'package.json'),
    'project/docs/PRODUCT.md': paths.productFile,
    'project/scripts/fence-registry.json': paths.fenceRegistryFile,
    'project/requirements.json': paths.requirementsFile,
  };
  const inputs = {};
  for (const [name, file] of Object.entries(inputPaths)) {
    inputs[name] = fs.existsSync(file) ? sha256OfFile(file) : 'ABSENT';
  }
  inputs['project/.respawnpack/runtime/evidence'] = evidenceDirectoryDigest(paths.evidenceDir);
  return { algorithm: 'sha256', inputs };
}

// --- inventory from the canonical manifest ------------------------------------------------------------

/**
 * The canonical inventory is the manifest the Pi loader reads. Reading the directory
 * instead would re-invent every drift the manifest guards against. This function
 * accepts the exact manifest shape Pi's `readPiManifest` returns (extensions[], skills[]).
 */
function inventoryFromManifest(manifest) {
  const skills = Array.isArray(manifest.skills) ? manifest.skills : [];
  const extensions = Array.isArray(manifest.extensions) ? manifest.extensions : [];
  return {
    extensions: { count: extensions.length, source: 'manifest.pi.extensions' },
    skills: { count: skills.length, source: 'manifest.pi.skills' },
  };
}

/** Read the root package's `pi` field. Returns the parsed field or null. */
function readRootManifest() {
  try {
    const p = path.join(PACKAGE_ROOT, 'package.json');
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    return doc && typeof doc.pi === 'object' && doc.pi !== null ? doc.pi : null;
  } catch { return null; }
}

// --- state compilation -------------------------------------------------------------------------------

function readCompletionAuthority(sourceRevision, projectRoot, paths = projectPaths(projectRoot)) {
  if (!fs.existsSync(paths.requirementsFile)) return null;
  if (!fs.existsSync(paths.fenceRegistryFile)) {
    throw new Error(`requirements authority exists but target fence registry is missing: ${paths.fenceRegistryFile}`);
  }
  if (!fs.existsSync(paths.productFile)) {
    throw new Error(`requirements authority exists but target product inventory is missing: ${paths.productFile}`);
  }
  const requirements = JSON.parse(fs.readFileSync(paths.requirementsFile, 'utf8'));
  const fenceRegistry = JSON.parse(fs.readFileSync(paths.fenceRegistryFile, 'utf8'));
  const productText = fs.readFileSync(paths.productFile, 'utf8');
  const productIds = new Set([...productText.matchAll(/^\|\s*(RP-[A-Z]+-\d{3})\s*\|/gm)].map((match) => match[1]));
  const checked = validateRequirementsDocument(requirements, { productIds, fenceRegistry, root: projectRoot, schemaRoot: PACKAGE_ROOT });
  if (!checked.ok) throw new Error(`requirements semantic validation failed: ${checked.errors.join('; ')}`);
  const tree = computeCompletionCandidateTree(projectRoot);
  const evidence = loadAdmissibleEvidence({
    evidenceDir: paths.evidenceDir, requirements, fenceRegistry, sourceRevision,
    candidateTree: tree, root: projectRoot, schemaRoot: PACKAGE_ROOT,
  });
  return { requirements, fenceRegistry, evidence, candidateTree: tree };
}

function trackedProjection(authority) {
  const rows = authority.requirements.requirements.map((row) => {
    const supporting = authority.evidence.accepted.filter(({ document }) => document.requirementId === row.id && document.verdict === 'PASS');
    const hasIndependent = supporting.some(({ document }) => document.qualification === 'independent');
    const hasImplementer = supporting.some(({ document }) => document.qualification === 'implementer');
    const needsIndependent = row.evidenceRequirements.qualification.includes('independent');
    const status = row.waiver ? 'waived'
      : supporting.length === 0 ? 'unevidenced'
      : needsIndependent && !hasIndependent ? 'candidate'
      : 'conformant';
    const why = status === 'conformant' ? 'all declared dimensions and qualification constraints satisfied'
      : status === 'candidate' ? 'passing implementer evidence awaits independent qualification'
      : status === 'waived' ? `owner waiver: ${row.waiver.reason}`
      : row.fenceIds.length ? 'no current admissible passing evidence' : 'no qualifying fence is adopted yet';
    return {
      id: row.id, title: row.title, mandatory: row.mandatory, risk: row.risk,
      priority: row.priority || null, gate: row.gate || null, status, why,
      evidence: supporting.map(({ file }) => file), blockedBy: row.blockedBy || [],
      claimTypes: supporting.length ? ['served-boundary tested'] : [],
    };
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const gates = Object.entries(authority.requirements.gates).map(([id, gate]) => {
    const missingRows = gate.requires.filter((requirementId) => !byId.has(requirementId));
    const conformant = gate.requires.filter((requirementId) => ['conformant', 'waived'].includes(byId.get(requirementId)?.status)).length;
    const complete = missingRows.length === 0 && conformant === gate.requires.length;
    return {
      id, title: gate.title, denominator: gate.requires.length, conformant, complete, missingRows,
      status: missingRows.length ? 'INCOMPLETE_MISSING_ROWS' : complete ? 'COMPLETE' : 'INCOMPLETE',
      note: null,
    };
  });
  const counts = {
    total: rows.length,
    mandatory: rows.filter((row) => row.mandatory).length,
    conformant: rows.filter((row) => row.status === 'conformant').length,
    candidate: rows.filter((row) => row.status === 'candidate').length,
    unevidenced: rows.filter((row) => row.status === 'unevidenced').length,
    waived: rows.filter((row) => row.status === 'waived').length,
    blocked: rows.filter((row) => row.blockedBy.length).length,
    staleEvidence: authority.evidence.rejected.length,
  };
  const openP0P1 = rows.filter((row) => row.mandatory && ['P0', 'P1'].includes(row.priority) && !['conformant', 'waived'].includes(row.status)).map((row) => row.id);
  const projectBlocked = openP0P1.length > 0;
  return { rows, gates, counts, openP0P1, projectBlocked };
}

/** Build a STATE that conforms to the tracked or untracked schema branch. */
function buildState({ sourceRevision, sourceManifest, inventory, authority }) {
  const tracked = authority ? trackedProjection(authority) : null;
  const state = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    generatedBy: 'scripts/respawn-savepoint.mjs',
    sourceRevision,
    sourceManifest,
    tracksRequirements: Boolean(authority),
    denominatorVersion: authority?.requirements.denominatorVersion || null,
    ongoingGoalId: null,
    goal: null,
    forbidden: [],
    authority: authority ? ['requirements.json', 'scripts/fence-registry.json', '.respawnpack/runtime/evidence'] : [],
    milestone: null,
    milestoneComplete: tracked ? !tracked.projectBlocked && tracked.gates.every((gate) => gate.complete) : false,
    goalComplete: tracked ? !tracked.projectBlocked && tracked.gates.every((gate) => gate.complete) : false,
    goalCompletion: {
      status: tracked ? (!tracked.projectBlocked && tracked.gates.every((gate) => gate.complete) ? 'MET' : 'UNMET') : 'CANNOT_DETERMINE',
      why: tracked ? 'computed from mandatory requirement rows and declared gates' : 'no approved requirements source — untracked state shape',
      criteria: [
        {
          text: 'state compiled from canonical manifest and sourceRevision',
          kind: 'manual',
          status: 'MET',
          detail: `sourceRevision=${sourceRevision || 'null'}; inventory extensions=${inventory.extensions.count}, skills=${inventory.skills.count}${tracked ? `; denominator=${tracked.counts.total}` : ''}`,
        },
      ],
    },
    currentAtomicTask: tracked?.rows.find((row) => !['conformant', 'waived'].includes(row.status))?.id || null,
    nextUnblockedWork: tracked ? tracked.rows.filter((row) => !['conformant', 'waived'].includes(row.status) && row.blockedBy.length === 0).map((row) => ({ id: row.id, title: row.title, status: row.status })) : [],
    lastQualified: authority?.evidence.accepted.length ? { revision: sourceRevision, at: new Date().toISOString() } : null,
    evidence: authority ? { accepted: authority.evidence.accepted.length, rejected: authority.evidence.rejected } : { accepted: 0, rejected: [] },
    constraints: [
      'No push, no tag, no publish, no deploy until an authorized operator GO.',
      'No symlinks anywhere in the shipped solution.',
      'STATE is regenerated; never hand-edit.',
    ],
    killedFeatures: authority ? authority.requirements.requirements.filter((row) => row.applicability === 'killed-absence').flatMap((row) => row.featureIds.map((id) => ({
      id, status: tracked.rows.find((item) => item.id === row.id)?.status === 'conformant' ? 'clear' : 'unverified',
      risk: 'high', why: tracked.rows.find((item) => item.id === row.id)?.why,
    }))) : [],
    removals: {
      status: 'CANNOT_DETERMINE',
      why: 'the Pi-native state compiler has no configured removal-registry scanner',
      scannedAtRevision: sourceRevision,
      corpusManifest: sourceManifest,
    },
    reconciliation: {
      status: 'NOT_CONFIGURED',
      why: 'no project reconciliation adapter is configured for this package',
      counts: { tasks: 0, project: 0, drift: 0 },
      driftIds: [],
      driftTruncated: false,
    },
    cannotDetermine: [
      'Fresh Debian VM end-to-end activation of the full R8–R14 stack',
      'Live execution of the 32-role bench through a pi subprocess',
      ...(tracked?.rows.filter((row) => row.status === 'unevidenced').map((row) => `${row.id}: ${row.why}`) || ['Killed-feature removal scan (no configured removal-registry scanner)']),
    ],
  };
  if (tracked) Object.assign(state, {
    counts: tracked.counts,
    requirements: tracked.rows,
    gates: tracked.gates,
    openP0P1: tracked.openP0P1,
    blockers: tracked.rows.filter((row) => row.blockedBy.length).map((row) => ({ id: row.id, blockedBy: row.blockedBy })),
    transitivelyBlocked: [],
    projectBlocked: tracked.projectBlocked,
  });
  return state;
}

// --- schema fence -----------------------------------------------------------------------------------

/** @returns {{ok:true}|{ok:false, errors:string[]}} */
function validateStateAgainstSchema(state) {
  try {
    const require_ = createRequire(import.meta.url);
    const { validate } = require_(path.join(PACKAGE_ROOT, 'schemas', 'validate.mjs'));
    const schema = JSON.parse(fs.readFileSync(STATE_SCHEMA, 'utf8'));
    const r = validate(state, schema);
    return r.valid ? { ok: true } : { ok: false, errors: r.errors };
  } catch (e) {
    return { ok: false, errors: [`schema validator unavailable: ${e && e.message}`] };
  }
}

// --- atomic write + readback -------------------------------------------------------------------------

/**
 * Write STATE.json atomically: write to a sibling tempfile, fsync, rename, then read back
 * and compare bytes. Returns the read-back result so callers can fail loudly on mismatch.
 */
function assertNoSymlinkComponents(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  const relativeParts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of relativeParts) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`refusing symlink path component: ${current}`);
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
}

function writeAtomicVerified(file, body) {
  const dir = path.dirname(file);
  assertNoSymlinkComponents(file);
  fs.mkdirSync(dir, { recursive: true });
  assertNoSymlinkComponents(file);
  // A predictable sibling filename opened with "w" can be pre-seeded as a symlink.
  // mkdtemp creates an unpredictable, mode-0700 directory atomically; opening the file
  // with wx adds an exclusive-create fence before the same-filesystem rename.
  const tempDir = fs.mkdtempSync(path.join(dir, `.${path.basename(file)}.tmp-`));
  fs.chmodSync(tempDir, 0o700);
  const tmp = path.join(tempDir, 'content');
  const bytes = Buffer.from(body, 'utf8');
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(tmp, file);
  } finally {
    try { fs.unlinkSync(tmp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { fs.rmdirSync(tempDir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const back = fs.readFileSync(file);
  const equal = back.equals(bytes);
  const written = sha256OfString(body);
  const readback = sha256OfString(back.toString('utf8'));
  return { equal, written, readback, bytes: bytes.length };
}

// --- the pending note (bridge-shaped) ---------------------------------------------------------------

/**
 * The pending note fields are EXACTLY what `adapters/pi/bridge/rollover-bridge.js#peekPendingNote`
 * consumes. Any other field would be dropped on read. Verification of this contract is in
 * scripts/state-contract.test.mjs (the test reads back via the actual bridge consumer).
 */
const PENDING_NOTE_FIELDS = Object.freeze([
  'exactNextAction', 'atomicActionId', 'userConstraints', 'unresolvedQuestions',
  'candidateMemories', 'verificationEvidence',
]);

function buildPendingNote(args, sourceRevision, short, snapshot) {
  return {
    schemaVersion: '2.0.0',
    kind: 'respawn-pi-pending-note',
    at: new Date().toISOString(),
    sessionId: short,
    goal: null,
    decisionsLocked: ['D-007', 'D-008', 'D-009', 'D-010'],
    // Fields the bridge peekPendingNote consumes (only):
    exactNextAction: args.note ? String(args.note) : null,
    atomicActionId: args.atomicActionId || null,
    userConstraints: Array.from(new Set(args.constraints)).filter(Boolean),
    unresolvedQuestions: Array.from(new Set(args.questions)).filter(Boolean),
    candidateMemories: Array.from(new Set(args.candidates)).filter(Boolean),
    verificationEvidence: [],
    workingTree: {
      branch: null,
      headShort: short,
      revisionValidated: short,
      sourceRevision,
      snapshotAlgorithm: snapshot.algorithm,
      candidateTree: snapshot.tree,
      headTree: snapshot.headTree,
      dirty: snapshot.dirty,
    },
    fileRefs: [
      'docs/audit/pi-native/REAUDIT-581242f.md',
      'docs/audit/pi-native/REMEDIATION.md',
      'docs/derived/STATE.json',
      'docs/PRODUCT.md',
    ],
    _consumedFields: PENDING_NOTE_FIELDS,
  };
}

function pendingNotePath(projectDir) {
  return path.join(projectDir, '.respawnpack', 'runtime', 'rollover', '_pi-pending-note.json');
}

function writePendingNote(projectDir, note) {
  const file = pendingNotePath(projectDir);
  const dir = path.dirname(file);
  const body = JSON.stringify(note, null, 2) + '\n';
  const verified = writeAtomicVerified(file, body);
  return { file, ...verified };
}

// --- status / verification -------------------------------------------------------------------------

function sameManifest(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function validatePendingNote(note, head, snapshot) {
  const errors = [];
  const plain = note && typeof note === 'object' && !Array.isArray(note);
  if (!plain) return ['pending note must be a JSON object'];
  if (note.schemaVersion !== '2.0.0') errors.push('pending note schemaVersion must be 2.0.0');
  if (note.kind !== 'respawn-pi-pending-note') errors.push('pending note kind mismatch');
  if (!Number.isFinite(Date.parse(note.at))) errors.push('pending note at must be an ISO timestamp');
  if (note.exactNextAction !== null && typeof note.exactNextAction !== 'string') errors.push('pending note exactNextAction must be string|null');
  if (note.atomicActionId !== null && typeof note.atomicActionId !== 'string') errors.push('pending note atomicActionId must be string|null');
  for (const field of ['userConstraints', 'unresolvedQuestions', 'candidateMemories', 'verificationEvidence']) {
    if (!Array.isArray(note[field]) || note[field].some((value) => typeof value !== 'string' && (field !== 'verificationEvidence' || !value || typeof value !== 'object'))) {
      errors.push(`pending note ${field} has invalid shape`);
    }
  }
  if (!Array.isArray(note._consumedFields) || note._consumedFields.slice().sort().join(',') !== [...PENDING_NOTE_FIELDS].sort().join(',')) {
    errors.push('pending note _consumedFields mismatch');
  }
  if (!note.workingTree || typeof note.workingTree !== 'object') errors.push('pending note workingTree missing');
  else {
    if (note.workingTree.sourceRevision !== head) errors.push('pending note sourceRevision does not match HEAD');
    if (!snapshot?.ok) errors.push(`candidate snapshot unavailable: ${snapshot?.reason || 'unknown'}`);
    else {
      if (note.workingTree.snapshotAlgorithm !== snapshot.algorithm) errors.push('pending note snapshot algorithm mismatch');
      if (note.workingTree.candidateTree !== snapshot.tree) errors.push('pending note candidate tree does not match current working tree');
      if (note.workingTree.headTree !== snapshot.headTree) errors.push('pending note HEAD tree mismatch');
      if (note.workingTree.dirty !== snapshot.dirty) errors.push('pending note dirty flag mismatch');
    }
  }
  return errors;
}

function captureWriteTarget(file, boundary) {
  assertNoSymlinkComponents(file);
  const absentDirs = [];
  let dir = path.dirname(file);
  const stop = path.resolve(boundary);
  while (dir !== stop) {
    const rel = path.relative(stop, dir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) break;
    try { fs.lstatSync(dir); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      absentDirs.push(dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`refusing non-regular write target: ${file}`);
    return { file, kind: 'file', bytes: fs.readFileSync(file), absentDirs };
  } catch (error) {
    if (error.code === 'ENOENT') return { file, kind: 'absent', bytes: null, absentDirs };
    throw error;
  }
}

function restoreWriteTarget(snapshot) {
  try { fs.unlinkSync(snapshot.file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (snapshot.kind === 'file') writeAtomicVerified(snapshot.file, snapshot.bytes.toString('utf8'));
  for (const dir of snapshot.absentDirs.sort((a, b) => b.length - a.length)) {
    try { fs.rmdirSync(dir); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function verifyCurrent({ projectDir, requirePending }) {
  const errors = [];
  const indeterminate = [];
  const paths = projectPaths(projectDir);
  let state = null;
  try { state = JSON.parse(fs.readFileSync(paths.stateFile, 'utf8')); }
  catch (error) { indeterminate.push(`STATE unavailable: ${error.message}`); }
  if (state) {
    const schema = validateStateAgainstSchema(state);
    if (!schema.ok) errors.push(...schema.errors);
    const head = getHead(projectDir);
    if (!head) indeterminate.push('target git HEAD unavailable');
    else if (state.sourceRevision !== head) indeterminate.push(`STATE revision ${state.sourceRevision} != target HEAD ${head}`);
    const currentManifest = computeSourceManifest(projectDir, paths);
    if (!sameManifest(state.sourceManifest, currentManifest)) indeterminate.push('STATE sourceManifest does not match current target/compiler inputs');
  }
  if (requirePending) {
    try {
      const require_ = createRequire(import.meta.url);
      const bridge = require_(path.join(PACKAGE_ROOT, 'adapters', 'pi', 'bridge', 'rollover-bridge.js'));
      const file = pendingNotePath(projectDir);
      assertNoSymlinkComponents(file);
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      const snapshot = computeCandidateSnapshot(projectDir);
      errors.push(...validatePendingNote(raw, getHead(projectDir), snapshot));
      const peeked = bridge.peekPendingNote(projectDir);
      const keys = peeked?.fields ? Object.keys(peeked.fields).sort() : [];
      if (!peeked?.present) indeterminate.push('pending note unavailable to bridge.peekPendingNote');
      else if (keys.join(',') !== [...PENDING_NOTE_FIELDS].sort().join(',')) errors.push(`pending note consumer fields mismatch: ${keys.join(',')}`);
    } catch (error) { errors.push(`pending note verification failed: ${error.message}`); }
  }
  const outcome = errors.length ? 'FAIL' : indeterminate.length ? 'CANNOT_DETERMINE' : 'PASS';
  return { outcome, errors, cannotDetermine: indeterminate, stateFile: paths.stateFile, sourceRevision: state?.sourceRevision ?? null };
}

function emitVerification(result, json) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.outcome}: ${result.stateFile}`);
    for (const error of result.errors) console.log(`  FAIL: ${error}`);
    for (const reason of result.cannotDetermine) console.log(`  CANNOT_DETERMINE: ${reason}`);
  }
  return result.outcome === 'PASS' ? 0 : result.outcome === 'FAIL' ? 1 : 2;
}

// --- main -------------------------------------------------------------------------------------------

function main() {
  let args;
  try { args = parseArgs(process.argv); }
  catch (error) {
    console.error(`savepoint: ${error.message}`);
    printHelp();
    process.exit(1);
  }
  const projectDir = path.resolve(args.project);
  let projectStat;
  try { projectStat = fs.lstatSync(projectDir); }
  catch (error) { console.error(`savepoint aborted: target project unavailable: ${error.message}`); process.exit(1); }
  if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) {
    console.error(`savepoint aborted: target project must be a real directory, not a symlink: ${projectDir}`);
    process.exit(1);
  }
  const paths = projectPaths(projectDir);
  if (args.mode !== 'write') {
    process.exit(emitVerification(verifyCurrent({ projectDir, requirePending: args.mode === 'verify' }), args.json));
  }
  const head = getHead(projectDir);
  if (!head) {
    console.error('savepoint aborted: target project is not in a git working tree (no HEAD)');
    process.exit(1);
  }
  const short = shortHead(head);
  if (args.revisionValidated && args.revisionValidated !== head && args.revisionValidated !== short) {
    console.error(`savepoint aborted: --revision-validated ${args.revisionValidated} does not match HEAD ${head}`);
    process.exit(1);
  }

  const manifest = readRootManifest();
  if (!manifest) {
    console.error('savepoint aborted: root package.json has no `pi` field');
    process.exit(1);
  }
  const inventory = inventoryFromManifest(manifest);
  let authority;
  try { authority = readCompletionAuthority(head, projectDir, paths); }
  catch (error) {
    console.error(`savepoint aborted: ${error.message}`);
    process.exit(1);
  }
  const sourceManifest = computeSourceManifest(projectDir, paths);
  const state = buildState({ sourceRevision: head, sourceManifest, inventory, authority });

  const v = validateStateAgainstSchema(state);
  if (!v.ok) {
    console.error('savepoint aborted: STATE failed schema validation:');
    for (const e of v.errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const noteFile = pendingNotePath(projectDir);
  let stateBefore;
  let noteBefore;
  try {
    // Refuse unsafe destinations and capture both authorities before either is changed.
    stateBefore = captureWriteTarget(paths.stateFile, projectDir);
    noteBefore = captureWriteTarget(noteFile, projectDir);
    const stateBody = JSON.stringify(state, null, 2) + '\n';
    const stateVerified = writeAtomicVerified(paths.stateFile, stateBody);
    if (!stateVerified.equal) throw new Error(`STATE write/readback mismatch (${stateVerified.written.slice(0, 12)}… vs ${stateVerified.readback.slice(0, 12)}…)`);
    const snapshot = computeCandidateSnapshot(projectDir);
    if (!snapshot.ok) throw new Error(`exact candidate snapshot unavailable (${snapshot.reason})`);
    const note = buildPendingNote(args, head, short, snapshot);
    const noteVerified = writePendingNote(projectDir, note);
    if (!noteVerified.equal) throw new Error('pending-note write/readback mismatch');

    // Verify raw metadata and the bridge's consumed projection before admitting success.
    const rawErrors = validatePendingNote(JSON.parse(fs.readFileSync(noteFile, 'utf8')), head, snapshot);
    if (rawErrors.length) throw new Error(rawErrors.join('; '));
    const projected = projectPendingNoteFields(JSON.parse(fs.readFileSync(noteFile, 'utf8')));
    const peekShapeOk = projected.dropped.length === 0
      && Object.keys(projected.fields).sort().join(',') === [...PENDING_NOTE_FIELDS].sort().join(',');
    if (!peekShapeOk) throw new Error(`shared pending-note consumer did not round-trip (${projected.dropped.join(',')})`);

    console.log(`savepoint written:`);
    console.log(`  STATE     : ${paths.stateFile}  (sha256 ${stateVerified.written.slice(0, 12)}…, verified equal)`);
    console.log(`  pending   : ${noteVerified.file}  (sha256 ${noteVerified.written.slice(0, 12)}…)`);
    console.log(`  sourceRev : ${head}`);
    console.log(`  tree      : ${snapshot.tree}${snapshot.dirty ? ' (dirty candidate)' : ' (HEAD)'}`);
    console.log(`  inventory : ${inventory.extensions.count} extensions, ${inventory.skills.count} skills (manifest-derived)`);
  } catch (error) {
    const rollbackErrors = [];
    if (noteBefore) try { restoreWriteTarget(noteBefore); } catch (e) { rollbackErrors.push(`pending: ${e.message}`); }
    if (stateBefore) try { restoreWriteTarget(stateBefore); } catch (e) { rollbackErrors.push(`STATE: ${e.message}`); }
    console.error(`savepoint aborted: ${error.message}${rollbackErrors.length ? `; rollback failed (${rollbackErrors.join('; ')})` : '; both authorities restored'}`);
    process.exit(1);
  }
}

main();