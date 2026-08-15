#!/usr/bin/env node
/*
 * RespawnPack · adapters/pi/canaries/canary-all.js — run every Pi canary once and roll the answers up.
 *
 * ⛔ THE ROLLUP IS core/policy/failures.js's, AND THE WORST ANSWER WINS. There is no averaging, no "three
 * of four passed", and CANNOT_DETERMINE does not round down to PASS: a suite where the isolation canary
 * could not run has not established isolation, and reporting anything green for it would be the exact
 * inference this pack exists to refuse.
 *
 * ⛔ AND canary-rpc IS SKIPPED UNLESS ASKED FOR. It attaches to a live session, takes an exclusive lock,
 * and performs three real compactions — side effects nobody should get from a status command. Pass
 * `--with-rpc` to include it; without the flag it is reported NOT_APPLICABLE with that reason stated,
 * never omitted, because an inventory built from what ran cannot report what did not.
 *
 *   node adapters/pi/canaries/canary-all.js [--project <dir>] [--with-rpc] [--isolation-cmd "<cmd>"]
 *
 * Exit: core's own codes for the rolled-up outcome — 0 PASS/NOT_APPLICABLE · 1 FAIL · 2 CANNOT_DETERMINE.
 */
'use strict';
const path = require('path');

const c = require('./_canary.js');
const core = require(path.join(__dirname, '..', '..', '..', 'core', 'index.js'));
const install = require('./canary-install.js');
const extension = require('./canary-extension.js');
const rpc = require('./canary-rpc.js');
const isolation = require('./canary-isolation.js');

const NAME = 'canary-all';

async function run({ projectDir = process.cwd(), withRpc = false, isolationArgv = null, piPath = null } = {}) {
  const results = [];
  results.push(await c.guard(install.NAME, () => install.run({ piPath, cwd: projectDir })));
  results.push(await c.guard(extension.NAME, () => extension.run({ projectDir })));
  results.push(withRpc
    ? await c.guard(rpc.NAME, () => rpc.run({ projectDir, piPath }))
    : c.notApplicable(rpc.NAME, {
      detail: 'canary-rpc was not run: it attaches to a live Pi session, takes an exclusive lock on it, and performs three real compactions. Pass --with-rpc to include it.',
      notes: ['NOT_APPLICABLE here means "deliberately not run", NOT "nothing to check" — the three-rollover proof is the central evidence for the managed profile'],
    }));
  results.push(await c.guard(isolation.NAME, () => isolation.run({ isolationArgv, projectDir })));

  const outcome = core.failures.rollup(results.map((r) => r.outcome));
  return {
    schemaVersion: c.SCHEMA_VERSION,
    kind: 'pi-canary-rollup',
    canary: NAME,
    outcome,
    exitCode: core.failures.exitCodeFor(outcome),
    observedAt: new Date().toISOString(),
    summary: results.map((r) => `${r.canary}: ${r.outcome}${r.precondition ? ` (${r.precondition})` : ''}`),
    results,
  };
}

if (require.main === module) {
  const args = c.parseArgs(process.argv.slice(2));
  const iso = typeof args['isolation-argv'] === 'string'
    ? (() => { try { const a = JSON.parse(args['isolation-argv']); return Array.isArray(a) ? a.map(String) : null; } catch { return null; } })()
    : (typeof args['isolation-cmd'] === 'string' ? isolation.splitCommand(args['isolation-cmd']) : null);

  run({
    projectDir: typeof args.project === 'string' ? path.resolve(args.project) : process.cwd(),
    withRpc: args['with-rpc'] === true,
    isolationArgv: iso,
    piPath: typeof args.pi === 'string' ? args.pi : null,
  }).then((r) => {
    for (const one of r.results) process.stdout.write(`${c.render(one)}\n\n`);
    process.stdout.write(`RespawnPack · Pi canaries rolled up: ${r.outcome}\n${r.summary.map((s) => `  - ${s}`).join('\n')}\n`);
    process.exit(r.exitCode);
  });
}

module.exports = { NAME, run };
