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
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The release version: package.json is the single source. */
export function releaseOf(repoRoot = REPO) {
  try { return JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version || null; } catch { return null; }
}

/**
 * The exact commit. A deployed copy made with `git archive` carries it in
 * server/src/commit.txt, which git fills in on export (.gitattributes:
 * export-subst). A checkout reads it from git instead, and says when the
 * working tree has changes that are not in that commit.
 */
export function commitOf(repoRoot = REPO) {
  try {
    const stamped = readFileSync(join(repoRoot, 'server', 'src', 'commit.txt'), 'utf8').trim();
    if (/^[0-9a-f]{40}$/.test(stamped)) return { commit: stamped, dirty: false, source: 'archive' };
  } catch { /* not stamped */ }
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
    return { commit, dirty, source: 'git' };
  } catch { return { commit: null, dirty: null, source: null }; }
}

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

/** 12 hex characters over the tool definitions exactly as an assistant receives them. */
export function toolsFingerprint(definitions) {
  return createHash('sha256').update(JSON.stringify(definitions)).digest('hex').slice(0, 12);
}

/**
 * @param {object} [opts]
 * @param {string|(() => string)} [opts.tools]  fingerprint of the served tool list (toolsFingerprint), or a function giving it
 * @returns {() => {release: string|null, commit: string|null, server: string, startedAt: string, stale: boolean, device: string|null, agent: string|null, tools: string|null}}
 */
export function createVersionInfo({ repoRoot = REPO, agentRoot = repoRoot, now = () => new Date(), tools = null } = {}) {
  const loaded = fingerprint(serverFiles(repoRoot));
  const startedAt = now().toISOString();
  const orNull = (files) => (files.length ? fingerprint(files) : null);
  const release = releaseOf(repoRoot);
  const { commit, dirty } = commitOf(repoRoot);
  return () => ({
    release,
    commit: commit ? `${commit.slice(0, 12)}${dirty ? '+dirty' : ''}` : null,
    tools: typeof tools === 'function' ? tools() : tools,
    server: loaded,
    startedAt,
    stale: fingerprint(serverFiles(repoRoot)) !== loaded,
    device: orNull(deviceFiles(repoRoot)),
    agent: orNull(agentFiles(agentRoot)),
  });
}
