/*
 * RespawnPack · core/lifecycle/journal.js — the append-only rollover journal, and the fold that replays it.
 *
 * ⛔ WHY APPEND-ONLY JSONL IS THE AUTHORITY AND THE SNAPSHOT IS NOT.
 *
 * An atomic snapshot alone (rewrite one state file per transition) is all-or-nothing per write, which
 * sounds like the stronger guarantee and is the weaker one HERE: it keeps only the latest state, and the
 * two properties this machine sells — duplicate suppression and exactly-once consumption — are
 * properties of HISTORY. A snapshot cannot answer "was this event already applied"; it can only answer
 * "what state am I in", which is the question that was never in doubt.
 *
 * The append-only log answers both, and its crash behaviour is better rather than worse:
 *   · a crash mid-append damages AT MOST the final line, because every earlier line was already
 *     complete when it was written and nothing rewrites them;
 *   · that damage is DETECTABLE — the torn tail is the one line that fails to parse, and it is always
 *     last — so recovery discards exactly one record instead of guessing at a whole document;
 *   · a parse failure anywhere EARLIER is corruption, not a crash artifact, and is REFUSED. Skipping it
 *     would silently drop applied transitions and re-open the duplicate window that the log exists to
 *     close.
 *
 * The snapshot is kept anyway, atomically, as a fast path and as a CROSS-CHECK. When the two disagree
 * the journal wins and the disagreement is reported: a snapshot one transition behind the log is the
 * expected shape of a crash between the append and the snapshot write, and calling it drift would be
 * wrong — calling it agreement would be worse.
 *
 * ⛔ THE APPEND IS THE COMMIT POINT. In-memory state is updated only after the row is on disk. A
 * transition that could not be journaled is NOT applied, because a rollover that cannot record what it
 * did cannot prove it did it once.
 */
const path = require('path');
const io = require('../_io.js');
const { failure } = require('../policy/failures.js');

const JOURNAL_VERSION = 1;

const ROW_KINDS = {
  CYCLE_OPEN: 'cycle-open',
  TRANSITION: 'transition',
  NOOP: 'noop',
  REFUSAL: 'refusal',
  HALT: 'halt',
  CONSUMPTION: 'consumption',
  JOURNAL_REPAIR: 'journal-repair',
};

const journalPath = (dir) => path.join(dir, 'journal.jsonl');
const snapshotPath = (dir) => path.join(dir, 'state.json');
const cyclePath = (dir) => path.join(dir, 'cycle.json');

/** Append one row. Returns {ok, detail}; a false here must stop the caller advancing. */
function append(dir, row) {
  const r = io.appendLine(journalPath(dir), JSON.stringify({ v: JOURNAL_VERSION, ...row }));
  return r.ok ? { ok: true, detail: null } : { ok: false, detail: r.detail };
}

/**
 * Read every complete row.
 * @returns {{status:'OK'|'ABSENT'|'UNREADABLE'|'CORRUPT', rows:Array, tornTail:string|null, detail:string|null}}
 */
function read(dir) {
  const r = io.readLinesClassified(journalPath(dir));
  if (r.status === 'ABSENT') return { status: 'ABSENT', rows: [], tornTail: null, detail: null };
  if (r.status !== 'OK') return { status: 'UNREADABLE', rows: [], tornTail: null, detail: r.detail };

  const rows = [];
  for (let i = 0; i < r.lines.length; i++) {
    try { rows.push(JSON.parse(r.lines[i])); }
    catch (e) {
      // Not the tail — the tail was split off before this loop. An unparseable line HERE is corruption.
      return {
        status: 'CORRUPT', rows: [], tornTail: r.tornTail,
        detail: `journal line ${i + 1} of ${r.lines.length} is unparseable (${e.message}); it is not the last line, so this is not a crash artifact`,
      };
    }
  }
  return { status: 'OK', rows, tornTail: r.tornTail, detail: null };
}

/**
 * Rewrite the journal without its torn tail, then record the repair IN the journal.
 *
 * ⛔ THE REWRITE IS NOT OPTIONAL. Discarding the torn tail only in memory leaves the broken bytes in the
 * middle of the file the moment anything appends after them, converting a recoverable crash artifact
 * into permanent corruption — the log would refuse to open forever, one transition after the crash.
 */
function repairTornTail(dir, rows, tornTail) {
  const text = rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
  const w = io.writeAtomicText(journalPath(dir), text);
  if (!w.ok) return { ok: false, detail: w.detail };
  const r = append(dir, {
    kind: ROW_KINDS.JOURNAL_REPAIR, at: new Date().toISOString(),
    discardedBytes: Buffer.byteLength(tornTail || '', 'utf8'),
    discardedDigest: io.digest(tornTail || ''),
    note: 'an incomplete trailing record was discarded; every complete record before it was preserved verbatim',
  });
  return { ok: r.ok, detail: r.detail };
}

/**
 * Replay rows into machine state. PURE — it opens no file, so the suites can fold hand-built histories.
 *
 * ⛔ TWO DEDUPE INDEXES, AND THE SECOND ONE IS NOT REDUNDANT. The primary key is (cycleId,
 * transitionKey), exactly as the protocol specifies. But `verify-identity` ADVANCES the cycle, so the
 * duplicate delivery of that very event arrives when the current cycleId is already the NEXT one and
 * would miss a per-cycle index entirely. A duplicate SessionStart(compact) is the ordinary case, not a
 * corner case, so the event index spans cycles and either hit is a recorded no-op.
 */
function fold(rows) {
  const st = {
    cycle: null,
    state: null,
    halted: null,
    verifiedHandoff: null,
    appliedByKey: new Map(),
    appliedByEvent: new Map(),
    cycleAdvances: [],
    counts: { transitions: 0, noops: 0, refusals: 0, halts: 0, consumptions: 0, repairs: 0 },
    seq: 0,
    fork: null,
  };

  for (const row of rows) {
    if (typeof row.seq === 'number' && row.seq > st.seq) st.seq = row.seq;
    switch (row.kind) {
      case ROW_KINDS.CYCLE_OPEN:
        st.cycle = row.cycle;
        st.state = row.state || 'ACTIVE';
        break;
      case ROW_KINDS.TRANSITION: {
        st.state = row.to;
        if (row.transitionKey) st.appliedByKey.set(`${row.cycleId}::${row.transitionKey}`, row.result || null);
        if (row.eventKey) st.appliedByEvent.set(row.eventKey, row.result || null);
        if (Object.prototype.hasOwnProperty.call(row, 'verifiedHandoff')) st.verifiedHandoff = row.verifiedHandoff;
        st.counts.transitions += 1;
        if (row.cycleAdvance) {
          const from = row.cycleAdvance.from;
          const clash = st.cycleAdvances.find((a) => a.from.index === from.index && a.eventKey !== row.eventKey);
          if (clash && !st.fork) {
            st.fork = `two different events advanced cycle index ${from.index}: ${clash.eventKey} and ${row.eventKey}`;
          }
          st.cycleAdvances.push({ from, to: row.cycleAdvance.to, eventKey: row.eventKey });
          st.cycle = row.cycleAdvance.to;
        }
        break;
      }
      case ROW_KINDS.NOOP: st.counts.noops += 1; break;
      case ROW_KINDS.REFUSAL: st.counts.refusals += 1; break;
      case ROW_KINDS.HALT:
        st.halted = row.failure;
        st.state = 'HALTED';
        st.counts.halts += 1;
        break;
      case ROW_KINDS.CONSUMPTION: st.counts.consumptions += 1; break;
      case ROW_KINDS.JOURNAL_REPAIR: st.counts.repairs += 1; break;
      default: break; // an unknown row kind from a future version is recorded history, not a fatal error
    }
  }
  return st;
}

const writeSnapshot = (dir, snap) => io.writeAtomicJSON(snapshotPath(dir), snap);
const readSnapshot = (dir) => io.readJSONClassified(snapshotPath(dir));

/** The classified failure for a journal that cannot be replayed. Kept here so callers cannot invent one. */
function readFailure(status, detail) {
  if (status === 'CORRUPT') return failure('JOURNAL_CORRUPT', detail);
  return failure('JOURNAL_CORRUPT', `the rollover journal could not be read: ${detail}`);
}

module.exports = {
  JOURNAL_VERSION, ROW_KINDS,
  journalPath, snapshotPath, cyclePath,
  append, read, repairTornTail, fold, writeSnapshot, readSnapshot, readFailure,
};
