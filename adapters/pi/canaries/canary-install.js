#!/usr/bin/env node
/*
 * RespawnPack · adapters/pi/canaries/canary-install.js — is there a Pi, and which one?
 *
 * PROVES: an executable named `pi` is reachable and answers `--version`.
 * DOES NOT PROVE: that it is a trusted install, that extensions load, that RPC works, or that any
 * capability of this adapter is active. Those are the other three canaries, and conflating them is how
 * "installed" becomes a synonym for "working" in a status table.
 *
 *   node adapters/pi/canaries/canary-install.js [--pi <path>]
 *
 * Exit: 0 PASS · 2 CANNOT_DETERMINE (pi not installed / found but unresponsive). There is no FAIL branch
 * for absence, deliberately — a machine without Pi has not failed anything.
 */
'use strict';
const c = require('./_canary.js');
const supervisor = require('../rpc-supervisor/supervisor.js');

const NAME = 'canary-install';

function run({ piPath = null, env = process.env, cwd = process.cwd() } = {}) {
  const p = supervisor.probe({ piPath, env, cwd });

  if (p.outcome === c.OUTCOME.PASS) {
    return c.pass(NAME, {
      proves: 'an executable named pi is on PATH (or at the supplied path) and answered --version',
      detail: `pi ${p.version || '(version string unreadable)'} at ${p.piPath}`,
      notes: [
        'this says nothing about trust, extensions, RPC or unattended write mode — run canary-extension, canary-rpc and canary-isolation for those',
      ],
      raw: p.raw,
    });
  }

  if (p.precondition === 'pi found but did not answer --version') {
    return c.cannotDetermine(NAME, c.PRECONDITIONS.PI_UNRESPONSIVE, { detail: p.detail, recovery: p.recovery, raw: p.raw });
  }

  return c.cannotDetermine(NAME, c.PRECONDITIONS.PI_NOT_INSTALLED, {
    detail: p.detail,
    recovery: p.recovery,
    notes: [
      'every other Pi canary is blocked behind this one; nothing in adapters/pi/ may be declared SUPPORTED while this is CANNOT_DETERMINE',
    ],
    raw: p.raw,
  });
}

if (require.main === module) {
  const args = c.parseArgs(process.argv.slice(2));
  c.guard(NAME, () => run({ piPath: typeof args.pi === 'string' ? args.pi : null })).then(c.emit);
}

module.exports = { NAME, run };
