/*
 * RespawnPack · adapters/pi/bridge/rpc-frames.js — the JSONL wire format of `pi --mode rpc`.
 *
 * ⛔ FRAMES ARE SPLIT ON \n AND ON NOTHING ELSE. Node's `readline` — the obvious way to do this — also
 * breaks on \r,   (LINE SEPARATOR) and   (PARAGRAPH SEPARATOR). Every one of those is a legal
 * character INSIDE a JSON string, and a model transcript is exactly the kind of payload that contains
 * them: a Windows path, a quoted file with CRLF endings, a piece of Unicode-heavy prose. Split there and
 * one frame silently becomes two unparseable halves, at which point a supervisor either crashes or —
 * far worse — decides the compaction it was waiting for never arrived. The R5 documentation check states
 * the split rule verbatim ("JSONL split on \n ONLY"); this module is where that rule lives, and
 * `pi-adapter.test.mjs` drives a payload containing all four characters through it.
 *
 * ⛔ AND \r IS NOT STRIPPED. `JSON.parse` treats a trailing carriage return as insignificant whitespace,
 * so nothing needs trimming — and trimming would mean this module edits the host's bytes before anyone
 * else sees them, which is the opposite of the verbatim discipline core/lifecycle/evidence.js requires of
 * every record built from these frames.
 *
 * Current Pi documentation specifies `pi --mode rpc`, strict JSONL, request names under `type`, request
 * parameters at the top level, responses with `type:"response"` and a `command` echo, and events named
 * under `type`. The parser retains a few legacy event-key spellings so captured evidence from an older Pi
 * can still be diagnosed rather than discarded.
 */
'use strict';
const { StringDecoder } = require('string_decoder');

/** The one delimiter. Named so a future reader cannot "helpfully" generalise it to a regex. */
const FRAME_DELIMITER = '\n';

/*
 * Characters a line-oriented reader WOULD split on and this one must not. Kept as data so the suite can
 * assert the splitter's behaviour against the same list rather than against a hand-copied duplicate of it.
 */
const NON_DELIMITERS = Object.freeze(['\r', ' ', ' ', '', '\v', '\f']);

/** The R5-verified command set. `follow_up` is UNDERSCORED — camelCase is a different, nonexistent command. */
const COMMANDS = Object.freeze({
  PROMPT: 'prompt',
  STEER: 'steer',
  ABORT: 'abort',
  COMPACT: 'compact',
  GET_STATE: 'get_state',
  GET_MESSAGES: 'get_messages',
  FOLLOW_UP: 'follow_up',
  FORK: 'fork',
  CLONE: 'clone',
  NEW_SESSION: 'new_session',
  SWITCH_SESSION: 'switch_session',
  SET_MODEL: 'set_model',
  BASH: 'bash',
});

const COMMAND_NAMES = Object.freeze(Object.values(COMMANDS));

/** The compaction events. `compaction_end` is the one that carries a result; `compaction_start` is a boundary marker. */
const EVENTS = Object.freeze({
  COMPACTION_START: 'compaction_start',
  COMPACTION_END: 'compaction_end',
});

const EVENT_NAMES = Object.freeze(Object.values(EVENTS));

/*
 * ⛔ THE ENVELOPE KEY IS A GUESS SET, NOT A CHOICE. Documentation names the events; it does not show the
 * frame that carries one. Picking a single key would make this module silently blind on a live install
 * that used a different one — and "no compaction event ever arrived" is the exact false negative that
 * turns into an unobserved-completion halt. `command` is deliberately ABSENT from this list: it is how a
 * RESPONSE identifies itself (`{command:"compact", success:true}`) and conflating the two would classify
 * every response as an event.
 */
const EVENT_NAME_KEYS = Object.freeze(['event', 'type', 'kind', 'method', 'notification']);

const isStr = (v) => typeof v === 'string' && v.length > 0;
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// --- framing -----------------------------------------------------------------------------------------

/**
 * A stateful splitter over a byte or text stream.
 *
 * Buffers are decoded through `StringDecoder`, not `chunk.toString()`: a multi-byte UTF-8 character split
 * across two stdout chunks would otherwise decode as two replacement characters and corrupt a frame that
 * was never damaged on the wire.
 *
 * @returns {{push(chunk):string[], rest():string, flush():string|null, buffered():number}}
 */
function createFrameSplitter() {
  const decoder = new StringDecoder('utf8');
  let buffered = '';

  return {
    /** @returns {string[]} the COMPLETE frames this chunk finished — never a partial one. */
    push(chunk) {
      buffered += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      const out = [];
      for (;;) {
        const idx = buffered.indexOf(FRAME_DELIMITER);
        if (idx === -1) break;
        out.push(buffered.slice(0, idx));
        buffered = buffered.slice(idx + 1);
      }
      return out;
    },
    /** What is held back awaiting its delimiter. A non-empty rest at stream end is a TRUNCATED frame. */
    rest: () => buffered,
    buffered: () => buffered.length,
    /**
     * End of stream. Returns the incomplete tail if there is one, or null.
     * ⛔ The tail is RETURNED, never parsed-and-accepted: a frame whose delimiter never arrived is a frame
     * whose end nobody has seen, which is the same defect class core/_io.js calls a torn tail.
     */
    flush() {
      buffered += decoder.end();
      const tail = buffered.length ? buffered : null;
      buffered = '';
      return tail;
    },
  };
}

/**
 * Split a whole string at once. Convenience for fixtures and tests; the stream path uses the splitter.
 * @returns {{frames:string[], rest:string}}
 */
function splitFrames(text) {
  const parts = String(text === undefined || text === null ? '' : text).split(FRAME_DELIMITER);
  const rest = parts.pop();
  return { frames: parts, rest };
}

/** Serialise one frame. Exactly one trailing delimiter, and no pretty-printing — a newline inside a frame would BE a frame boundary. */
function encodeFrame(value) {
  return `${JSON.stringify(value)}${FRAME_DELIMITER}`;
}

/**
 * Parse one frame's text.
 * @returns {{ok:true, value:object, text:string}|{ok:false, kind:'blank'|'unparseable'|'not-object', text:string, detail:string}}
 */
function parseFrame(text) {
  const raw = typeof text === 'string' ? text : '';
  if (!raw.trim()) return { ok: false, kind: 'blank', text: raw, detail: 'the frame is empty or whitespace only' };
  let value;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { ok: false, kind: 'unparseable', text: raw, detail: `not valid JSON: ${e.message}` };
  }
  if (!isObj(value)) return { ok: false, kind: 'not-object', text: raw, detail: 'a frame parsed to something that is not a JSON object' };
  return { ok: true, value, text: raw };
}

// --- classification ----------------------------------------------------------------------------------

/** Find the event name under whichever envelope key carries it. @returns {{key,name}|null} */
function eventNameOf(value) {
  if (!isObj(value)) return null;
  for (const key of EVENT_NAME_KEYS) {
    if (isStr(value[key])) return { key, name: value[key] };
  }
  return null;
}

/**
 * Decide what a parsed frame IS.
 *
 * `isKnownId` (optional) lets a correlator answer "did I send this id?" — an echoed id is the strongest
 * available signal that a frame is a response, and it is checked BEFORE the `command` echo because an id
 * is unique to one request while a command name is shared by all of them.
 *
 * @returns {{type:'response'|'event'|'unknown', id:string|null, command:string|null, event:string|null,
 *            nameKey:string|null, matchedBy:string, known:boolean, value:object}}
 */
function classifyFrame(value, { isKnownId = null } = {}) {
  const base = { id: null, command: null, event: null, nameKey: null, known: false, value };
  if (!isObj(value)) return { ...base, type: 'unknown', matchedBy: 'not-an-object' };

  const id = isStr(value.id) ? value.id : null;
  const named = eventNameOf(value);

  // An event first: a frame that names `compaction_end` is that event even if it also carries an id.
  if (named && EVENT_NAMES.includes(named.name)) {
    return { ...base, type: 'event', id, event: named.name, nameKey: named.key, known: true, matchedBy: `event-name:${named.key}` };
  }

  if (id && typeof isKnownId === 'function' && isKnownId(id)) {
    const command = isStr(value.command) ? value.command : null;
    return { ...base, type: 'response', id, command, known: COMMAND_NAMES.includes(command), matchedBy: 'correlated-id' };
  }

  if (isStr(value.command)) {
    return { ...base, type: 'response', id, command: value.command, known: COMMAND_NAMES.includes(value.command), matchedBy: 'command-echo' };
  }

  // A named frame whose name this module does not know is still an EVENT-shaped thing — reported as
  // unknown rather than discarded, because an undeclared signal is data for the canary, not noise.
  if (named) return { ...base, type: 'unknown', id, event: named.name, nameKey: named.key, matchedBy: `unknown-name:${named.key}` };

  return { ...base, type: 'unknown', id, matchedBy: 'no-recognisable-envelope-field' };
}

/**
 * Read the compaction outcome out of a `compaction_end` frame WITHOUT deciding what it means.
 *
 * ⭐ THE TWO FIELDS THAT ARE NOT DETAILS. `aborted:true` says the compaction did NOT happen; `willRetry:
 * true` says Pi intends another attempt, so this is not the settled end of anything. A supervisor that
 * read `compaction_end` as "done" and ignored both would advance a context cycle across a compaction that
 * was abandoned mid-flight. Every field is returned with `present` flags so a missing one is never read
 * as `false`.
 *
 * @returns {{aborted, abortedPresent, willRetry, willRetryPresent, reason, result, tokensBefore,
 *            estimatedTokensAfter, settled:boolean, why:string}}
 */
function readCompactionEnd(value) {
  const v = isObj(value) ? value : {};
  const result = isObj(v.result) ? v.result : null;
  const abortedPresent = Object.prototype.hasOwnProperty.call(v, 'aborted');
  const willRetryPresent = Object.prototype.hasOwnProperty.call(v, 'willRetry');
  const aborted = v.aborted === true;
  const willRetry = v.willRetry === true;

  let why;
  if (aborted) why = 'compaction_end reported aborted:true — the compaction did not complete';
  else if (willRetry) why = 'compaction_end reported willRetry:true — Pi intends another attempt, so this is not the settled end of the compaction';
  else if (!result) why = 'compaction_end carried no result object; the event arrived and reported nothing about what it did';
  else why = 'compaction_end reported neither aborted nor willRetry and carried a result';

  return {
    aborted, abortedPresent, willRetry, willRetryPresent,
    reason: isStr(v.reason) ? v.reason : null,
    result,
    tokensBefore: result && Number.isFinite(result.tokensBefore) ? result.tokensBefore : null,
    estimatedTokensAfter: result && Number.isFinite(result.estimatedTokensAfter) ? result.estimatedTokensAfter : null,
    firstKeptEntryId: result && (isStr(result.firstKeptEntryId) || Number.isFinite(result.firstKeptEntryId)) ? result.firstKeptEntryId : null,
    settled: !aborted && !willRetry && Boolean(result),
    why,
  };
}

/**
 * Read a command response's success flag without inventing one.
 * @returns {{success:boolean|null, present:boolean, error:string|null}}
 */
function readResponse(value) {
  const v = isObj(value) ? value : {};
  const present = Object.prototype.hasOwnProperty.call(v, 'success');
  const error = isStr(v.error) ? v.error : (isObj(v.error) && isStr(v.error.message) ? v.error.message : null);
  return { success: present ? v.success === true : null, present, error };
}

/**
 * `get_state` answers with `{sessionId, sessionFile, sessionName}`. Read them, and say so when they are
 * absent — an identity that could not be read is `null`, never a placeholder string.
 * @returns {{sessionId:string|null, sessionFile:string|null, sessionName:string|null, from:string}}
 */
function readState(value) {
  const v = isObj(value) ? value : {};
  // Some RPC dialects nest the payload under `result`/`state`; both are checked and the winner reported.
  const candidates = [
    ['top-level', v],
    ['result', isObj(v.result) ? v.result : null],
    ['state', isObj(v.state) ? v.state : null],
    ['data', isObj(v.data) ? v.data : null],
  ];
  for (const [from, obj] of candidates) {
    if (obj && isStr(obj.sessionId)) {
      return {
        sessionId: obj.sessionId,
        sessionFile: isStr(obj.sessionFile) ? obj.sessionFile : null,
        sessionName: isStr(obj.sessionName) ? obj.sessionName : null,
        from,
      };
    }
  }
  return { sessionId: null, sessionFile: null, sessionName: null, from: 'absent' };
}

// --- correlation -------------------------------------------------------------------------------------

/**
 * Id minting and outstanding-request bookkeeping.
 *
 * Ids are `<prefix>-<counter>-<random>`: the counter makes a log readable in order, the random suffix
 * makes two supervisors in one project incapable of colliding on one. `settle` returns the registration
 * so a caller can see WHAT it sent — a response matched to an id whose request is forgotten proves
 * nothing about what was asked.
 */
function createCorrelator(prefix = 'rp') {
  let n = 0;
  const outstanding = new Map();
  return {
    newId() {
      n += 1;
      return `${prefix}-${n}-${Math.random().toString(16).slice(2, 10)}`;
    },
    register(id, meta) {
      outstanding.set(id, { id, at: new Date().toISOString(), ...(meta || {}) });
      return id;
    },
    isKnownId: (id) => outstanding.has(id),
    peek: (id) => outstanding.get(id) || null,
    settle(id) {
      const rec = outstanding.get(id) || null;
      outstanding.delete(id);
      return rec;
    },
    outstanding: () => [...outstanding.values()],
    size: () => outstanding.size,
  };
}

// --- typed command builders --------------------------------------------------------------------------

/* Current documented requests put the command name in `type` and parameters at the top level. */
function command(name, fields = {}, id = null) {
  if (!COMMAND_NAMES.includes(name)) throw new Error(`unknown Pi RPC command: ${JSON.stringify(name)}`);
  return { type: name, ...(id ? { id } : {}), ...fields };
}

const build = Object.freeze({
  prompt: (text, id, extra) => command(COMMANDS.PROMPT, { message: text, ...(extra || {}) }, id),
  steer: (text, id, extra) => command(COMMANDS.STEER, { message: text, ...(extra || {}) }, id),
  abort: (id, extra) => command(COMMANDS.ABORT, { ...(extra || {}) }, id),
  compact: (id, extra) => command(COMMANDS.COMPACT, { ...(extra || {}) }, id),
  getState: (id) => command(COMMANDS.GET_STATE, {}, id),
  getMessages: (id, extra) => command(COMMANDS.GET_MESSAGES, { ...(extra || {}) }, id),
  /** `follow_up`, underscored. The camelCase spelling is not a Pi command and this is the only place it could have been typed. */
  followUp: (text, id, extra) => command(COMMANDS.FOLLOW_UP, { message: text, ...(extra || {}) }, id),
  fork: (id, extra) => command(COMMANDS.FORK, { ...(extra || {}) }, id),
  clone: (id, extra) => command(COMMANDS.CLONE, { ...(extra || {}) }, id),
  newSession: (id, extra) => command(COMMANDS.NEW_SESSION, { ...(extra || {}) }, id),
  switchSession: (sessionId, id, extra) => command(COMMANDS.SWITCH_SESSION, { sessionId, ...(extra || {}) }, id),
  setModel: (provider, modelId, id, extra) => command(COMMANDS.SET_MODEL, { provider, modelId, ...(extra || {}) }, id),
  /* Bash uses `type:"bash"`; its shell text therefore safely uses the separate `command` field. */
  bash: (script, id, extra) => command(COMMANDS.BASH, { command: script, ...(extra || {}) }, id),
});

module.exports = {
  FRAME_DELIMITER, NON_DELIMITERS,
  COMMANDS, COMMAND_NAMES, EVENTS, EVENT_NAMES, EVENT_NAME_KEYS,
  createFrameSplitter, splitFrames, encodeFrame, parseFrame,
  eventNameOf, classifyFrame, readCompactionEnd, readResponse, readState,
  createCorrelator, command, build,
};
