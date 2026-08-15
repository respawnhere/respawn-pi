#!/usr/bin/env node
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const separator = argv.indexOf('--');
if (separator < 2 || argv[0] !== '--timeout') {
  console.error('usage: node scripts/bounded-git.mjs --timeout <ms> -- <git-args...>');
  process.exit(2);
}
const timeoutMs = Number(argv[1]);
if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
  console.error('bounded-git: timeout must be an integer from 100 to 30000 ms');
  process.exit(2);
}
const gitArgs = argv.slice(separator + 1);
if (gitArgs.length === 0) {
  console.error('bounded-git: git arguments are required');
  process.exit(2);
}

const MAX_STREAM_BYTES = 8 * 1024 * 1024;
const append = (current, chunk) => {
  if (current.length >= MAX_STREAM_BYTES) return current;
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  return Buffer.concat([current, incoming.subarray(0, MAX_STREAM_BYTES - current.length)]);
};

const detached = process.platform !== 'win32';
const child = spawn('git', gitArgs, {
  cwd: process.cwd(),
  env: process.env,
  detached,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = Buffer.alloc(0);
let stderr = Buffer.alloc(0);
let timedOut = false;
let settled = false;
let killTimer;

const signalTree = (signal) => {
  try {
    if (detached && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch { /* already gone */ }
};
const finish = (code) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  if (killTimer) clearTimeout(killTimer);
  if (stdout.length) process.stdout.write(stdout);
  if (stderr.length) process.stderr.write(stderr);
  if (timedOut) {
    process.stderr.write(`bounded-git: timed out after ${timeoutMs} ms\n`);
    process.exit(124);
  }
  process.exit(code ?? 1);
};
const timer = setTimeout(() => {
  timedOut = true;
  signalTree('SIGTERM');
  killTimer = setTimeout(() => {
    signalTree('SIGKILL');
    // Settlement is bounded even if a hostile descendant held an inherited pipe.
    child.stdout?.destroy();
    child.stderr?.destroy();
    killTimer = setTimeout(() => finish(124), 50);
  }, 100);
}, timeoutMs);

child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
child.on('error', (error) => {
  stderr = append(stderr, `${error.message}\n`);
  finish(1);
});
child.on('close', (code) => {
  if (timedOut) {
    // Preserve the scheduled SIGKILL: Git may exit on TERM before its filter descendants.
    return;
  }
  finish(code);
});
