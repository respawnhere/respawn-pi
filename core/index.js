/*
 * RespawnPack · core/index.js — the host-neutral rollover core's public surface.
 *
 * ⛔ THE DEPENDENCY ARROW POINTS ONE WAY. Nothing under core/ requires from hooks/ or kernel/. Adapters
 * (adapters/claude-code, adapters/codex, adapters/pi) and the kernel consume THIS; the reverse would
 * make the shared core a function of one host's layout, which is the condition the v0.3 split exists to
 * end. `core/_io.js` carries its own atomic-write and classified-read primitives for that reason, and
 * is the migration target for the two existing copies rather than a third dialect of them.
 *
 * ⛔ AND core/ TOUCHES NO HOST. It contains no hook, no SDK call, no process spawn and no path that
 * assumes Claude Code. Everything a host does arrives as an EVIDENCE RECORD carrying the payload
 * verbatim; everything core decides comes back as a typed result. The conformance traces in
 * conformance/fixtures/ are the proof — they drive the real state machine with nothing but JSON.
 */
module.exports = {
  io: require('./_io.js'),

  // lifecycle
  machine: require('./lifecycle/machine.js'),
  states: require('./lifecycle/states.js'),
  evidence: require('./lifecycle/evidence.js'),
  journal: require('./lifecycle/journal.js'),
  cycle: require('./lifecycle/cycle.js'),
  consumable: require('./lifecycle/consumable.js'),

  // policy
  failures: require('./policy/failures.js'),
  capabilities: require('./policy/capabilities.js'),
  thresholds: require('./policy/thresholds.js'),

  // state
  handoff: require('./state/handoff.js'),

  // memory
  candidates: require('./memory/candidates.js'),
};
