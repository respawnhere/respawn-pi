'use strict';

const EMPTY_NOTE_FIELDS = Object.freeze({
  exactNextAction: null,
  atomicActionId: null,
  userConstraints: [],
  unresolvedQuestions: [],
  candidateMemories: [],
  verificationEvidence: [],
});

/**
 * The one field projector used by both rollover injection and savepoint readback.
 * Authority/freshness checks remain with each caller; this function owns the exact
 * consumed shape and the sanitisation that prevents authored noise from propagating.
 */
function projectPendingNoteFields(doc) {
  const dropped = [];
  const strOrNull = (key) => {
    if (doc[key] === undefined || doc[key] === null) return null;
    if (typeof doc[key] === 'string' && doc[key].length) return doc[key];
    dropped.push(key);
    return null;
  };
  const strArray = (key) => {
    if (doc[key] === undefined || doc[key] === null) return [];
    if (!Array.isArray(doc[key])) { dropped.push(key); return []; }
    const kept = doc[key].filter((value) => typeof value === 'string' && value.length);
    if (kept.length !== doc[key].length) dropped.push(`${key}[]`);
    return kept;
  };
  const anyArray = (key) => Array.isArray(doc[key])
    ? doc[key]
    : (doc[key] === undefined ? [] : (dropped.push(key), []));
  return {
    fields: {
      exactNextAction: strOrNull('exactNextAction'),
      atomicActionId: strOrNull('atomicActionId'),
      userConstraints: strArray('userConstraints'),
      unresolvedQuestions: strArray('unresolvedQuestions'),
      candidateMemories: strArray('candidateMemories'),
      verificationEvidence: anyArray('verificationEvidence'),
    },
    dropped,
  };
}

module.exports = { EMPTY_NOTE_FIELDS, projectPendingNoteFields };
