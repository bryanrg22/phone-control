#!/usr/bin/env node
// Fake `tailscale`. `status` prints one line per simulated phone in the real
// CLI's shape, so the supervisor's meshPath() parses it as it would the real
// thing — including the "; offline, last seen …" marker for a phone that is
// not answering.
'use strict';
const { ctrl } = require('./simlib.cjs');
const args = process.argv.slice(2);
if (args[0] !== 'status') process.exit(0);
if (args.includes('--json')) { process.stdout.write('{}\n'); process.exit(0); }
ctrl({ op: 'mesh' }).then(({ res }) => {
  for (const p of res.peers || []) {
    process.stdout.write(`${p.ip}  ${p.name.padEnd(20)} sim@  iOS  active; relay "sim"${p.online ? '' : '; offline, last seen 1m ago'}, tx 1 rx 1\n`);
  }
  process.exit(0);
}).catch(() => process.exit(0));
