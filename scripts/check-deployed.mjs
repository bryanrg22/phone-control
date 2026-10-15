#!/usr/bin/env node
// check-deployed.mjs — is the server running the code in this checkout?
//
//   npm run check:deployed -- https://your-server.example.ts.net
//   CONNECTOR_PUBLIC_URL=https://your-server.example.ts.net npm run check:deployed
//
// Compares fingerprints of this checkout's code with what the server reports
// about itself at /healthz (see server/src/version.mjs).
// Exit 0 = up to date, 1 = something differs, 2 = could not ask.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint, serverFiles, deviceFiles, agentFiles, releaseOf, commitOf } from '../server/src/version.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (process.argv[2] || process.env.CONNECTOR_PUBLIC_URL || '').replace(/\/+$/, '');
if (!url) { console.error('usage: check-deployed.mjs <server base URL>   (or set CONNECTOR_PUBLIC_URL)'); process.exit(2); }

const local = {
  server: fingerprint(serverFiles(REPO)),
  device: fingerprint(deviceFiles(REPO)),
  agent: fingerprint(agentFiles(REPO)),
};

let remote;
try {
  const r = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) {
    // The public address answered, but nothing is behind it: the server is
    // stopped or still starting. Say that, not a JSON parsing error.
    console.error(`the server is not answering (HTTP ${r.status} from ${url}/healthz) — it is stopped or still starting. On the host: systemctl status phone-control`);
    process.exit(2);
  }
  remote = (await r.json()).version;
} catch (e) { console.error(`could not reach ${url}/healthz: ${e.message}`); process.exit(2); }
if (!remote) { console.error('the server answered but reports no version'); process.exit(1); }
if (remote.server === undefined) {
  console.error('the server reports versions in a different shape — it is not running phone-control (an older deployment?)');
  process.exit(1);
}

const here = commitOf(REPO);
console.log(`server: ${remote.release ? `phone-control ${remote.release} at ${remote.commit}` : 'release not reported (deployed before 0.2.0)'}${remote.tools ? `, tools ${remote.tools}` : ''}`);
console.log(`local:  phone-control ${releaseOf(REPO)} at ${here.commit ? `${here.commit.slice(0, 12)}${here.dirty ? '+dirty' : ''}` : 'unknown commit'}\n`);

let bad = 0;
const row = (name, mine, theirs, note = '') => {
  const same = mine === theirs;
  if (!same) bad += 1;
  console.log(`${same ? '✓' : '✗'} ${name.padEnd(7)} local ${mine}   server ${theirs ?? '(not reported)'}${same ? '' : '   ← DIFFERENT'}${note}`);
};
row('server', local.server, remote.server, `   (running since ${remote.startedAt})`);
row('device', local.device, remote.device);
row('agent', local.agent, remote.agent);
if (remote.stale) { bad += 1; console.log('✗ the server\'s files were changed AFTER it started — it needs a restart to load them'); }
console.log(bad ? '\nNOT up to date.' : '\nUp to date: the server is running this checkout\'s code.');
process.exit(bad ? 1 : 0);
