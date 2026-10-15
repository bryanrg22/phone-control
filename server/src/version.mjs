// version.mjs — "which code is actually running?", answered by the code itself.
//
// A host is rarely a git checkout, and copying files there does not restart
// anything: a long-running process keeps the code it loaded. So the server
// reports fingerprints of its own code, and scripts/check-deployed.mjs compares
// them with a local checkout.
//
// A fingerprint is a hash over file NAMES and CONTENTS, so it is the same on any
// machine holding the same code. Three are reported:
//   server   computed once, when this process started   → what is LOADED
//   device   computed on demand from disk               → what the next
//   agent    start / stop / status / task will run (both are spawned fresh)
// and `stale` is true when the server's files on disk no longer match what it
// loaded — i.e. someone deployed and did not restart.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 12 hex chars over (basename, bytes) of each file, order-independent. */
export function fingerprint(paths) {
  const h = createHash('sha256');
  for (const p of [...paths].sort((a, b) => basename(a).localeCompare(basename(b)))) {
    let bytes;
    try { bytes = readFileSync(p); } catch { bytes = Buffer.from('<missing>'); }
    h.update(basename(p)); h.update('\0'); h.update(bytes); h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}

const listing = (dir, keep) => {
  try { return readdirSync(dir).filter(keep).map((f) => join(dir, f)); } catch { return []; }
};

/** The long-running process. */
export const serverFiles = (repoRoot = REPO) => listing(join(repoRoot, 'server', 'src'), (f) => f.endsWith('.mjs'));
/** Everything that touches the phone from the host: supervisor, screen reader, tunnel helper. */
export const deviceFiles = (repoRoot = REPO) => listing(join(repoRoot, 'device'), (f) => f.endsWith('.mjs') || f.endsWith('.py'));
/** The loop that drives the phone. */
export const agentFiles = (agentRoot = REPO) => listing(join(agentRoot, 'agent'), (f) => f.endsWith('.mjs'));

/**
 * @returns {() => {server: string, startedAt: string, stale: boolean, device: string|null, agent: string|null}}
 */
export function createVersionInfo({ repoRoot = REPO, agentRoot = repoRoot, now = () => new Date() } = {}) {
  const loaded = fingerprint(serverFiles(repoRoot));
  const startedAt = now().toISOString();
  const orNull = (files) => (files.length ? fingerprint(files) : null);
  return () => ({
    server: loaded,
    startedAt,
    stale: fingerprint(serverFiles(repoRoot)) !== loaded,
    device: orNull(deviceFiles(repoRoot)),
    agent: orNull(agentFiles(agentRoot)),
  });
}
