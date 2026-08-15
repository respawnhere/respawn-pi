/*
 * RespawnPack · adapters/pi/rpc-supervisor/session-lock.js — the exclusive claim on ONE Pi session.
 *
 * ⛔ WHY A LOCK IS NOT OPTIONAL HERE. R5's documentation check found NO competing-client protection in
 * Pi: two `pi --mode rpc` clients may attach to the same session, and nothing in Pi arbitrates between
 * them. A rollover is a five-step sequence with a state machine behind it — measure, settle, verify a
 * handoff, compact, re-check identity — and a second client that sends `prompt` or `compact` anywhere
 * inside that sequence does not merely interleave: it makes the supervisor's OWN evidence wrong. The
 * `agent_settled` this supervisor waited for was some other client's turn settling; the `compaction_end`
 * it attributes to its own request may be the answer to theirs. Neither is detectable after the fact.
 *
 * ⭐ SO THE CLAIM IS `wx`, THE SAME PRIMITIVE AS THE HANDOFF RECEIPT. `open(path, 'wx')` maps to O_EXCL on
 * POSIX and CREATE_NEW on Windows: exactly one caller across any number of processes creates the file,
 * and everyone else learns it already existed. A read-then-write check would lose the race it exists to
 * win — see core/lifecycle/consumable.js, which makes the same argument about the same primitive.
 *
 * ⛔ AND A LOCK IS NEVER STOLEN, NOT EVEN FROM A DEAD PROCESS. `holderAlive` is REPORTED (via a signal-0
 * probe) and never acted on, for two reasons that are both fatal on their own: pids are reused, so "pid
 * 4312 is alive" does not mean the holder is; and the holder may be on another machine entirely if the
 * session directory is on a network or synced volume, where no local probe can see it at all. Breaking a
 * lock is an OPERATOR action with its own function (`breakLock`), which records who broke what and why.
 *
 * ⛔ THE LOCK KEY IS THE SESSION FILE, NOT THE PROJECT. Two RespawnPack supervisors started from two
 * different working directories against the SAME Pi session are exactly the competing-client case, and a
 * project-scoped lock would not see them. So the lock lives beside Pi's own session file by default. When
 * that directory cannot be written, the lock degrades to a project-scoped path — and `scope` says
 * `project-only` out loud, because a lock that silently protects less than it claims is worse than none.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const core = require(path.join(__dirname, '..', '..', '..', 'core', 'index.js'));

const LOCK_KIND = 'pi-session-lock';
const LOCK_SCHEMA_VERSION = '1.0.0';

const nowISO = () => new Date().toISOString();
const isStr = (v) => typeof v === 'string' && v.length > 0;

/**
 * Where the lock for a session file lives.
 *
 * @returns {{lockPath, scope:'session-file'|'project-only'|'explicit', key, why}}
 */
function lockPathFor(sessionFile, { lockDir = null, projectDir = null } = {}) {
  const key = core.io.digest(path.resolve(String(sessionFile || 'unknown-session'))).slice(0, 16);
  const name = `_pi-session-${key}.lock`;

  if (isStr(lockDir)) {
    return { lockPath: path.join(lockDir, name), scope: 'explicit', key, why: 'an explicit lock directory was supplied' };
  }

  if (isStr(sessionFile)) {
    const dir = path.dirname(path.resolve(sessionFile));
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return { lockPath: path.join(dir, name), scope: 'session-file', key, why: 'the lock sits beside Pi\'s own session file, so any supervisor on this machine sees it regardless of which project it was started from' };
    } catch { /* fall through to the degraded, project-scoped path */ }
  }

  const fallbackRoot = isStr(projectDir) ? path.join(projectDir, core.cycle.RUNTIME_SUBDIR) : path.join(os.tmpdir(), 'respawnpack-pi-locks');
  return {
    lockPath: path.join(fallbackRoot, name),
    scope: 'project-only',
    key,
    why: isStr(sessionFile)
      ? 'Pi\'s session directory could not be written, so this lock is PROJECT-SCOPED: a supervisor started from a different project against the same session will NOT see it'
      : 'no session file was known when the lock was taken, so this lock is PROJECT-SCOPED and keyed on a placeholder',
  };
}

/** Signal-0 liveness. A HINT for the operator's report and nothing else — see the banner. */
function probeHolderAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { known: false, alive: null, why: 'the lock records no usable pid' };
  if (pid === process.pid) return { known: true, alive: true, why: 'the pid in the lock is this process' };
  try {
    process.kill(pid, 0);
    return { known: true, alive: true, why: 'a signal-0 probe reached the pid — but pids are reused, so this is a hint, not proof the original holder lives' };
  } catch (e) {
    const code = e && e.code;
    if (code === 'ESRCH') return { known: true, alive: false, why: 'no process with that pid exists ON THIS MACHINE; the holder may still be running elsewhere if the session directory is shared' };
    if (code === 'EPERM') return { known: true, alive: true, why: 'the pid exists and belongs to another user' };
    return { known: false, alive: null, why: `the liveness probe failed: ${code || (e && e.message)}` };
  }
}

/**
 * Claim the session exclusively.
 *
 * @returns {{status:'ACQUIRED', lockPath, scope, token, lock, release, why}
 *          |{status:'HELD', lockPath, scope, holder, holderAlive, why}
 *          |{status:'CANNOT_DETERMINE', lockPath, scope, failure, why}}
 */
function acquire({ sessionFile, sessionId = null, projectDir = null, lockDir = null, note = null, pid = process.pid } = {}) {
  const where = lockPathFor(sessionFile, { lockDir, projectDir });
  const token = crypto.randomBytes(12).toString('hex');
  const lock = {
    schemaVersion: LOCK_SCHEMA_VERSION,
    kind: LOCK_KIND,
    token,
    pid,
    host: os.hostname(),
    user: (os.userInfo && (() => { try { return os.userInfo().username; } catch { return null; } })()) || null,
    sessionFile: isStr(sessionFile) ? path.resolve(sessionFile) : null,
    sessionId: sessionId || null,
    projectDir: projectDir || null,
    scope: where.scope,
    acquiredAt: nowISO(),
    note,
  };

  const created = core.io.createExclusive(where.lockPath, `${JSON.stringify(lock, null, 2)}\n`);

  if (created.status === 'CREATED') {
    return {
      status: 'ACQUIRED', lockPath: where.lockPath, scope: where.scope, key: where.key, token, lock,
      release: () => release(where.lockPath, token),
      why: where.why,
    };
  }

  if (created.status === 'EXISTS') {
    const back = core.io.readJSONClassified(where.lockPath);
    if (back.status !== 'OK' || !back.doc) {
      return {
        status: 'CANNOT_DETERMINE', lockPath: where.lockPath, scope: where.scope, key: where.key,
        failure: core.failures.failure('CYCLE_UNESTABLISHED', `a session lock exists at ${where.lockPath} and could not be read (${back.detail || back.status}); whether another client is driving this session is UNKNOWN`),
        why: 'an unreadable lock is not an absent one — this supervisor will not speak to a session it cannot prove it owns',
      };
    }
    const holder = back.doc;
    return {
      status: 'HELD', lockPath: where.lockPath, scope: where.scope, key: where.key, holder,
      holderAlive: probeHolderAlive(holder.pid),
      why: `the session is already claimed by pid ${holder.pid} on ${holder.host} since ${holder.acquiredAt}. Pi has no competing-client protection, so this supervisor refuses to attach rather than interleave with it.`,
    };
  }

  return {
    status: 'CANNOT_DETERMINE', lockPath: where.lockPath, scope: where.scope, key: where.key,
    failure: core.failures.failure('CYCLE_UNESTABLISHED', `the session lock at ${where.lockPath} could not be created and does not exist: ${created.detail}`),
    why: 'the lock file could not be created for a reason that is not "it already exists"',
  };
}

/**
 * Give the claim back. Only the holder may: the token is compared before the file is removed.
 *
 * The read-then-unlink is not itself atomic, which is acceptable ONLY because the token check makes the
 * dangerous case — releasing someone else's lock — impossible to reach by accident. A caller with the
 * wrong token gets NOT_OWNER and the lock stays exactly where it is.
 *
 * @returns {{status:'RELEASED'|'NOT_HELD'|'NOT_OWNER'|'CANNOT_DETERMINE', detail}}
 */
function release(lockPath, token) {
  const back = core.io.readJSONClassified(lockPath);
  if (back.status === 'ABSENT') return { status: 'NOT_HELD', detail: 'there was no lock to release' };
  if (back.status !== 'OK' || !back.doc) return { status: 'CANNOT_DETERMINE', detail: `the lock could not be read before release (${back.detail || back.status})` };
  if (!isStr(token) || back.doc.token !== token) {
    return { status: 'NOT_OWNER', detail: `the lock at ${lockPath} is held by pid ${back.doc.pid} with a different token; it was NOT removed` };
  }
  try {
    fs.unlinkSync(lockPath);
    return { status: 'RELEASED', detail: null };
  } catch (e) {
    return { status: 'CANNOT_DETERMINE', detail: `the lock could not be removed: ${(e && e.code) || ''} ${(e && e.message) || ''}`.trim() };
  }
}

/** Look without claiming. FRESH means no lock was found; it reserves nothing. */
function inspect(lockPath) {
  const r = core.io.readJSONClassified(lockPath);
  if (r.status === 'ABSENT') return { status: 'FRESH', holder: null, detail: null };
  if (r.status === 'OK' && r.doc) return { status: 'HELD', holder: r.doc, holderAlive: probeHolderAlive(r.doc.pid), detail: null };
  return { status: 'CANNOT_DETERMINE', holder: null, detail: r.detail || r.status };
}

/**
 * Break a lock DELIBERATELY. There is no automatic path to this function and there must not be: every
 * automatic stale-lock breaker is a race with the holder it declared stale. The reason is required and is
 * written into an audit line beside the lock, so a later "why did two clients drive this session" has an
 * answer other than inference.
 */
function breakLock(lockPath, { reason, operator = null } = {}) {
  if (!isStr(reason)) return { status: 'REFUSED', detail: 'breaking a session lock requires a stated reason — an unexplained break is indistinguishable from a race' };
  const before = inspect(lockPath);
  if (before.status === 'FRESH') return { status: 'NOT_HELD', detail: 'there was no lock to break' };
  try {
    core.io.appendLine(`${lockPath}.broken.jsonl`, JSON.stringify({
      at: nowISO(), kind: 'pi-session-lock-broken', reason,
      operator: operator || null, byPid: process.pid, previousHolder: before.holder || null,
    }));
    fs.unlinkSync(lockPath);
    return { status: 'BROKEN', previousHolder: before.holder || null, detail: null };
  } catch (e) {
    return { status: 'CANNOT_DETERMINE', detail: `the lock could not be removed: ${(e && e.code) || ''} ${(e && e.message) || ''}`.trim() };
  }
}

module.exports = { LOCK_KIND, LOCK_SCHEMA_VERSION, lockPathFor, probeHolderAlive, acquire, release, inspect, breakLock };
