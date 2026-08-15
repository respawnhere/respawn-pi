/*
 * RespawnPack · core/lifecycle/machine.js — the host-neutral rollover state machine.
 *
 * ⛔ WHAT THIS REFUSES TO DO, stated first because every one of them was possible in v0.2:
 *   · compact without a handoff whose bytes were written, read back, and compared;
 *   · continue past a compaction it did not OBSERVE the host complete;
 *   · return to ACTIVE without checking, this time, that the conversation identity is the same one;
 *   · apply the same host event twice;
 *   · report success for anything it merely waited for.
 *
 * ⭐ REFUSAL AND HALT ARE DIFFERENT ANSWERS, and the split is the design.
 *   REFUSED  the protocol forbids this step HERE AND NOW. Nothing about the world is broken; the
 *            adapter may verify its handoff, keep observing, or ask the operator, and try again. The
 *            state does not move and the refusal is journaled.
 *   HALTED   an invariant about the WORLD failed, or a proof will never arrive. Terminal, carrying the
 *            specific recovery instruction for that failure code. Nothing resumes past a halt, because
 *            a halt that can be stepped over is advisory.
 *
 * ⛔ THE JOURNAL APPEND IS THE COMMIT POINT. In-memory state moves only after the row is on disk, and a
 * transition that could not be journaled is NOT applied. The snapshot is written after, best-effort;
 * when the two disagree on reopen, the journal wins.
 */
const path = require('path');
const io = require('../_io.js');
const journal = require('./journal.js');
const cycleLib = require('./cycle.js');
const evidence = require('./evidence.js');
const { STATES, TRANSITIONS, legalFrom, isTransition } = require('./states.js');
const { failure, OUTCOME } = require('../policy/failures.js');

const isString = (v) => typeof v === 'string' && v.length > 0;

/*
 * The guards. Each returns null when it holds, or a failure when it does not. They are deliberately
 * separate from the evidence validator: the validator asks "is this a well-formed record of its kind",
 * the guard asks "does what it records permit the transition". A record can be perfectly well-formed
 * and say the digests disagree.
 */
const GUARDS = {
  measurementUsable(st, records) {
    const m = records[evidence.KINDS.CONTEXT_MEASUREMENT];
    if (!(m.usedPercent >= 0 && m.usedPercent <= 100)) {
      return failure('EVIDENCE_MALFORMED', `usedPercent ${m.usedPercent} is outside 0–100; a percentage that is not one measures nothing`);
    }
    return null;
  },

  readbackAgrees(st, records) {
    const r = records[evidence.KINDS.HANDOFF_READBACK];
    if (r.equal !== true) {
      return failure('HANDOFF_READBACK_MISMATCH', `the read-back comparison reported equal=${JSON.stringify(r.equal)} for handoff ${r.handoffId}`);
    }
    if (r.writtenDigest !== r.readBackDigest) {
      // ⛔ The record's own claim is not taken over its own numbers. A wrapper that says `equal:true`
      // above two different digests is exactly the shape a hand-built or optimistic adapter produces.
      return failure('HANDOFF_READBACK_MISMATCH',
        `handoff ${r.handoffId} claims equal:true while its digests differ (${String(r.writtenDigest).slice(0, 12)}… vs ${String(r.readBackDigest).slice(0, 12)}…)`);
    }
    return null;
  },

  verifiedHandoffPresent(st) {
    if (!st.verifiedHandoff) {
      return failure('HANDOFF_UNVERIFIED', 'no read-back verification is recorded for this cycle, so there is nothing on disk this rollover has proven it can restore');
    }
    return null;
  },

  identityAgrees(st, records) {
    const r = records[evidence.KINDS.IDENTITY_VERIFICATION];
    if (r.observedId === null || r.equal === null) {
      return failure('IDENTITY_UNOBSERVABLE', `the host exposed no conversation identity to compare against ${r.expectedId}`);
    }
    if (r.equal !== true || r.expectedId !== r.observedId) {
      return failure('IDENTITY_MISMATCH', `expected ${r.expectedId}, observed ${r.observedId} (record claims equal=${JSON.stringify(r.equal)})`);
    }
    return null;
  },
};

/**
 * Open (or create) the machine for one conversation.
 * @returns {{ok:true, machine, opened}|{ok:false, failure}}
 */
function open({ projectDir, host, conversationId, dir = null }) {
  if (!isString(host) || !isString(conversationId)) {
    return { ok: false, failure: failure('CYCLE_UNESTABLISHED', 'a rollover machine needs a host and a conversation id; neither may be empty') };
  }
  const root = dir || cycleLib.conversationDir(projectDir, host, conversationId);

  const read = journal.read(root);
  if (read.status === 'CORRUPT' || read.status === 'UNREADABLE') {
    return { ok: false, failure: journal.readFailure(read.status, read.detail) };
  }

  const opened = { tornTailDiscarded: false, snapshotStale: false, cycleFileRewritten: false, restored: false };

  let rows = read.rows;
  if (read.tornTail) {
    const rep = journal.repairTornTail(root, rows, read.tornTail);
    if (!rep.ok) return { ok: false, failure: failure('JOURNAL_UNWRITABLE', `an incomplete trailing record could not be repaired: ${rep.detail}`) };
    const again = journal.read(root);
    if (again.status !== 'OK') return { ok: false, failure: journal.readFailure(again.status, again.detail) };
    rows = again.rows;
    opened.tornTailDiscarded = true;
  }

  const st = journal.fold(rows);
  if (st.fork) return { ok: false, failure: failure('CYCLE_FORK', st.fork) };

  if (st.cycle) {
    if (st.cycle.host !== host || st.cycle.conversationId !== conversationId) {
      return {
        ok: false,
        failure: failure('CYCLE_UNESTABLISHED',
          `the journal at ${root} belongs to ${st.cycle.host}:${st.cycle.conversationId}, not ${host}:${conversationId}`),
      };
    }
    opened.restored = true;
  } else {
    // No cycle row: a first run, or a journal whose only record was the one the crash tore. Either way
    // the cycle is MINTED and says so — "cycle 0 because this is the first" and "cycle 0 because the
    // history is gone" are different facts and the second one means latches were lost.
    const c = cycleLib.mint({ host, conversationId, index: 0, provenance: opened.tornTailDiscarded ? 'minted-after-repair' : 'minted' });
    const p = cycleLib.persist(root, c);
    if (!p.ok) return { ok: false, failure: p.failure };
    const a = journal.append(root, { kind: journal.ROW_KINDS.CYCLE_OPEN, seq: st.seq + 1, at: c.startedAt, cycleId: c.cycleId, cycle: c, state: STATES.ACTIVE });
    if (!a.ok) return { ok: false, failure: failure('JOURNAL_UNWRITABLE', a.detail) };
    st.cycle = c;
    st.state = STATES.ACTIVE;
    st.seq += 1;
  }

  // The cycle FILE is a fast path, not the authority. A crash between the cycle write and the journal
  // append leaves it ahead; rewriting it from the fold is what makes the orphaned nonce bind to nothing.
  const persisted = cycleLib.readPersisted(root);
  if (persisted.status !== 'OK' || persisted.cycle.cycleId !== st.cycle.cycleId) {
    const p = cycleLib.persist(root, st.cycle);
    if (!p.ok) return { ok: false, failure: p.failure };
    opened.cycleFileRewritten = true;
  }

  const snap = journal.readSnapshot(root);
  if (snap.status === 'OK' && snap.doc && snap.doc.state !== st.state) opened.snapshotStale = true;

  const m = makeMachine(root, host, conversationId, st);
  m.writeSnapshot();
  return { ok: true, machine: m, opened };
}

function makeMachine(root, host, conversationId, st) {
  const nowISO = () => new Date().toISOString();

  function writeSnapshot() {
    return journal.writeSnapshot(root, {
      v: journal.JOURNAL_VERSION,
      at: nowISO(),
      derivedFrom: 'journal.jsonl — the authority; this file is a fast path and a cross-check',
      state: st.state,
      cycleId: st.cycle.cycleId,
      cycle: st.cycle,
      halted: st.halted,
      verifiedHandoff: st.verifiedHandoff,
      counts: st.counts,
      seq: st.seq,
    });
  }

  function record(row) {
    st.seq += 1;
    const r = journal.append(root, { seq: st.seq, at: nowISO(), cycleId: st.cycle.cycleId, ...row });
    if (!r.ok) st.seq -= 1;
    return r;
  }

  function halt(f, at = null) {
    const row = { kind: journal.ROW_KINDS.HALT, failure: { ...f, at: at || nowISO() } };
    const w = record(row);
    // A halt that cannot be journaled still halts IN MEMORY: continuing because the disk refused the
    // note would be the failure the halt exists to prevent, plus a lost record.
    st.halted = row.failure;
    st.state = STATES.HALTED;
    st.counts.halts += 1;
    writeSnapshot();
    return { status: 'HALTED', state: STATES.HALTED, cycleId: st.cycle.cycleId, failure: row.failure, journaled: w.ok };
  }

  function refuse(transition, eventId, f) {
    record({ kind: journal.ROW_KINDS.REFUSAL, transition, eventId, from: st.state, failure: f });
    st.counts.refusals += 1;
    writeSnapshot();
    return { status: 'REFUSED', state: st.state, cycleId: st.cycle.cycleId, failure: f };
  }

  /** Refusal or halt, decided by the failure's own declared severity — never by the call site. */
  const deny = (transition, eventId, f) => (f.halts ? halt(f) : refuse(transition, eventId, f));

  function apply(event) {
    if (st.halted) {
      return { status: 'HALTED', state: STATES.HALTED, cycleId: st.cycle.cycleId, failure: st.halted, note: 'this rollover halted; nothing resumes past a halt' };
    }
    const transition = event && event.transition;
    const eventId = event && event.eventId;

    if (!isTransition(transition)) {
      return refuse(String(transition), String(eventId), failure('ILLEGAL_TRANSITION',
        `${JSON.stringify(transition)} is not a declared transition; from ${st.state} the legal ones are: ${legalFrom(st.state).join(', ')}`));
    }
    if (!isString(eventId)) {
      return refuse(transition, String(eventId), failure('EVIDENCE_MALFORMED',
        'every event must carry an eventId that identifies the HOST occurrence — it is what makes a redelivery recognisable as one'));
    }

    const t = TRANSITIONS[transition];
    const transitionKey = `${transition}:${eventId}`;
    const key = `${st.cycle.cycleId}::${transitionKey}`;
    const eventKey = `evt:${transition}:${eventId}`;

    // ⛔ DUPLICATE APPLICATION IS A RECORDED NO-OP RETURNING THE ORIGINAL RESULT. Both indexes are
    // consulted: the per-cycle key is the protocol's, and the cross-cycle event key catches the one
    // case the per-cycle key structurally cannot — a redelivered `verify-identity`, whose first
    // application moved the cycle out from under its own key.
    if (st.appliedByKey.has(key) || st.appliedByEvent.has(eventKey)) {
      const original = st.appliedByKey.has(key) ? st.appliedByKey.get(key) : st.appliedByEvent.get(eventKey);
      record({ kind: journal.ROW_KINDS.NOOP, transition, eventId, transitionKey, eventKey, of: original, from: st.state });
      st.counts.noops += 1;
      writeSnapshot();
      return { status: 'NOOP', state: st.state, cycleId: st.cycle.cycleId, original, duplicateOf: eventKey };
    }

    if (transition === 'halt') {
      const code = (event && event.failureCode) || 'ILLEGAL_TRANSITION';
      return halt(failure(code, (event && event.detail) || 'halt requested by the adapter'));
    }

    if (t.from !== '*' && t.from !== st.state) {
      return refuse(transition, eventId, failure('ILLEGAL_TRANSITION',
        `${transition} runs from ${t.from}; this rollover is in ${st.state}. Legal now: ${legalFrom(st.state).join(', ') || 'nothing'}`));
    }

    // Evidence: every required kind must be present, and every supplied record must be well-formed.
    const supplied = Array.isArray(event.evidence) ? event.evidence : [];
    const byKind = {};
    for (const rec of supplied) {
      const v = evidence.validate(rec);
      if (!v.ok) return deny(transition, eventId, v.failure);
      byKind[rec.kind] = rec;
    }
    for (const need of t.requires) {
      if (!byKind[need]) {
        return deny(transition, eventId, failure('EVIDENCE_MISSING', `${transition} requires ${need} evidence and none was supplied`));
      }
    }

    if (t.guard) {
      const g = GUARDS[t.guard](st, byKind);
      if (g) return deny(transition, eventId, g);
    }

    // --- effects, computed before anything is written -----------------------------------------------
    let nextVerified = st.verifiedHandoff;
    if (t.records === 'verifiedHandoff') {
      const r = byKind[evidence.KINDS.HANDOFF_READBACK];
      nextVerified = {
        handoffId: r.handoffId, handoffPath: r.handoffPath || null,
        writtenDigest: r.writtenDigest, readBackDigest: r.readBackDigest,
        verifiedAt: r.observedAt, equal: true,
      };
    }
    if (t.clears === 'verifiedHandoff') nextVerified = null;

    let advance = null;
    if (t.advancesCycle) {
      const next = cycleLib.advance(st.cycle);
      const p = cycleLib.persist(root, next);
      if (!p.ok) return halt(p.failure);
      advance = {
        from: { index: st.cycle.index, nonce: st.cycle.nonce, cycleId: st.cycle.cycleId },
        to: p.record,
      };
    }

    const result = {
      status: 'APPLIED', transition, from: st.state, to: t.to,
      cycleId: advance ? advance.to.cycleId : st.cycle.cycleId,
      cycleAdvanced: Boolean(advance),
      at: nowISO(),
    };

    const w = record({
      kind: journal.ROW_KINDS.TRANSITION,
      transition, transitionKey, eventKey, eventId,
      from: st.state, to: t.to,
      // Raw host payloads travel VERBATIM inside these records — that is what survives a host renaming
      // an undocumented field, and what a later reviewer re-interprets rather than takes on trust.
      evidence: supplied,
      verifiedHandoff: nextVerified,
      ...(advance ? { cycleAdvance: advance } : {}),
      result,
    });
    if (!w.ok) {
      // Not applied. The cycle file may now be ahead of the log if this transition advanced it; the next
      // open() rewrites it from the fold, which is exactly why the journal is the authority.
      return { status: 'REFUSED', state: st.state, cycleId: st.cycle.cycleId, failure: failure('JOURNAL_UNWRITABLE', w.detail) };
    }

    st.state = t.to;
    st.verifiedHandoff = nextVerified;
    st.appliedByKey.set(key, result);
    st.appliedByEvent.set(eventKey, result);
    st.counts.transitions += 1;
    if (advance) {
      st.cycleAdvances.push({ from: advance.from, to: advance.to, eventKey });
      st.cycle = advance.to;
    }
    writeSnapshot();
    return { ...result, state: t.to, cycleId: st.cycle.cycleId };
  }

  /** Record a handoff consumption in the journal. The RECEIPT is the decision; this is the audit trail. */
  function journalConsumption(entry) {
    const w = record({ kind: journal.ROW_KINDS.CONSUMPTION, ...entry });
    if (w.ok) st.counts.consumptions += 1;
    return w;
  }

  return {
    dir: root, host, conversationId,
    apply, halt, journalConsumption, writeSnapshot,
    state: () => st.state,
    cycle: () => ({ ...st.cycle }),
    cycleId: () => st.cycle.cycleId,
    cycleIndex: () => st.cycle.index,
    halted: () => (st.halted ? { ...st.halted } : null),
    verifiedHandoff: () => (st.verifiedHandoff ? { ...st.verifiedHandoff } : null),
    counts: () => ({ ...st.counts }),
    cycleAdvances: () => st.cycleAdvances.slice(),
    /** The journal as it is ON DISK — the suites read this, never the in-memory mirror. */
    rows: () => {
      const r = journal.read(root);
      return r.status === 'OK' ? r.rows : [];
    },
    /**
     * The rollover's overall verdict in the four-outcome vocabulary. A machine that is mid-rollover has
     * not passed anything yet, and says so.
     */
    outcome: () => {
      if (st.halted) return st.halted.outcome;
      if (st.state === STATES.ACTIVE && st.counts.transitions > 0) return OUTCOME.PASS;
      return OUTCOME.CANNOT_DETERMINE;
    },
  };
}

/** Where a conversation's rollover state lives, for callers that want the path without opening it. */
const conversationDir = (projectDir, host, conversationId) => cycleLib.conversationDir(projectDir, host, conversationId);

/** The handoff receipt path for a given conversation directory. One place, so two callers cannot disagree. */
const receiptPathFor = (dir, handoffId) => path.join(dir, `${io.safeSegment(handoffId)}.consumed.json`);

module.exports = { open, conversationDir, receiptPathFor, GUARDS, STATES };
