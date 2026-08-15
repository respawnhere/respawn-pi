#!/usr/bin/env node
/*
 * scripts/bootstrap-load.mjs — R13 tightens this to assert the EXACT extension set that
 * Pi's package manager resolves, then load it through Pi's own loadExtensionsCached.
 *
 * Resolution rules:
 *   - Repository is computed from import.meta.url, NOT a hard-coded absolute path.
 *   - Pi is resolved through normal package resolution OR an explicit $PI_DIST override.
 *   - The script exits 1 with a clear message when Pi cannot be located so the same harness
 *     still composes under "bare npm test" in environments where only one of the two
 *     known-good Pi locations is reachable.
 *
 * Exit: 0 if all 22 declared extensions load; 1 otherwise.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const pkgJson = path.join(REPO, 'package.json');

const require_ = createRequire(import.meta.url);
function loadPi() {
  const candidates = [];
  const addCandidate = (candidate) => {
    if (!candidate) return;
    candidates.push(candidate, path.join(candidate, 'core'));
  };
  addCandidate(process.env.PI_DIST);
  try {
    const resolvedLoader = require_.resolve('@earendil-works/pi-coding-agent/dist/core/extensions/loader.js');
    addCandidate(path.dirname(path.dirname(resolvedLoader)));
  } catch { /* not installed in the local dependency graph */ }
  const which = spawnSync('sh', ['-c', 'command -v pi'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (which.status === 0) {
    try {
      let cursor = path.dirname(fs.realpathSync(which.stdout.trim()));
      for (let i = 0; i < 8; i++) {
        addCandidate(path.join(cursor, 'dist'));
        addCandidate(cursor);
        const parent = path.dirname(cursor);
        if (parent === cursor) break;
        cursor = parent;
      }
    } catch { /* malformed PATH entry; candidates below will fail closed */ }
  }
  for (const c of [...new Set(candidates)]) {
    const loader = path.join(c, 'extensions/loader.js');
    const manifest = path.join(c, 'pi-manifest.js');
    if (fs.existsSync(loader) && fs.existsSync(manifest)) {
      return { loadExtensionsCached: require_(loader).loadExtensionsCached, readPiManifest: require_(manifest).readPiManifest, from: c };
    }
  }
  console.error('Cannot locate Pi core dist; set PI_DIST to either <pi>/dist or <pi>/dist/core, or install Pi on PATH.');
  process.exit(1);
}
const pi = loadPi();

if (!fs.existsSync(pkgJson)) {
  console.error(`package.json missing at ${pkgJson}`);
  process.exit(1);
}

const manifest = pi.readPiManifest(pkgJson);
if (!manifest) {
  console.error(`package.json has no "pi" field — not a valid Pi package`);
  process.exit(1);
}

const extPaths = manifest.extensions.map((p) => path.resolve(REPO, p));
console.log(`Loading ${extPaths.length} extensions from ${REPO} (root package manifest):`);
const result = await pi.loadExtensionsCached(extPaths, REPO);

console.log(`\nloaded: ${result.extensions.length}/${extPaths.length}`);
console.log(`errors: ${result.errors.length}`);
if (result.errors.length > 0) {
  for (const e of result.errors) console.log(`  ✖ ${path.basename(e.path)}: ${String(e.error).slice(0, 120)}`);
  process.exit(1);
}
for (const e of result.extensions) console.log(`  ✔ ${path.basename(e.path)}`);
if (extPaths.length !== result.extensions.length) process.exit(1);
