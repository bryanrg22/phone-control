#!/usr/bin/env node
// Fake `ip` (iproute2), first on PATH for the supervisor under test.
//   ip -6 addr   → the simulated tunnel interfaces
//   anything else → nothing
'use strict';
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const dir = path.join(process.env.SIM_STATE_DIR || '', 'ifaces');
if (args[0] === '-6' && args[1] === 'addr') {
  let n = 0;
  let files = [];
  try { files = fs.readdirSync(dir); } catch { /* no tunnels yet */ }
  for (const f of files) {
    // One file per tunnel helper, holding its client-side address. It is NOT
    // checked against a live pid: an orphaned interface outliving a SIGKILLed
    // helper is precisely the "ghost" this whole suite exists to exercise.
    let addr = '';
    try { addr = fs.readFileSync(path.join(dir, f), 'utf8').trim(); } catch { continue; }
    if (!addr) continue;
    n += 1;
    process.stdout.write(`${90 + n}: simtun${n}: <POINTOPOINT,UP,LOWER_UP> mtu 1280 state UNKNOWN\n    inet6 ${addr}/64 scope global\n`);
  }
  process.exit(0);
}
process.exit(1);
