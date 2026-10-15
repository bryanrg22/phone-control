#!/usr/bin/env node
// Fake go-ios, installed as `ios-cableout-sim` so the supervisor's anchor
// pattern (`ios[^ ]* runtest.*--udid=<UDID>`) matches its argv.
//
// `runtest` models the XCTest ANCHOR: it dials the tunnel's RSD endpoint, asks
// the phone to launch the runner, then simply stays alive. The runner is
// host-anchored — it lives exactly as long as this process does — so:
//   kill this process        → the phone's runner stops (suspend)
//   runner ends on the phone → the phone drops our channel → we log "lost
//                              connection to testmanagerd" and exit
//   tunnel stops routing     → NOTHING reaches us. We stay alive, holding a
//                              session that no longer exists. Real go-ios does
//                              exactly this after a power-off (seen 2026-10-12);
//                              the supervisor has to clear us away.
//
// The log lines are go-ios's own, because the supervisor reads them: "authorized"
// followed by silence is how it recognises a phone waiting on its owner.
'use strict';
const { ctrl, dialRsd, capLifetime } = require('./simlib.cjs');

const argv = process.argv.slice(2);
if (argv[0] !== 'runtest') { console.error('fake go-ios: only runtest is modelled'); process.exit(2); }
const opt = (name) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : ''; };
const env = {};
for (const a of argv.filter((x) => x.startsWith('--env='))) {
  const kv = a.slice(6); const i = kv.indexOf('=');
  if (i > 0) env[kv.slice(0, i)] = kv.slice(i + 1);
}
const udid = opt('udid'); const address = opt('address'); const port = opt('rsd-port');

(async () => {
  let rsd;
  try {
    rsd = await dialRsd(address, port, { hold: true });
  } catch (e) {
    // The real failure text over a dead/ghost tunnel.
    console.log(`{"level":"fatal","msg":"dial tcp [${address}]:${port}: connect: can't assign requested address (${e.message})"}`);
    process.exit(1);
  }
  console.log(`{"authorized":true,"level":"info","msg":"authorized","time":"${new Date().toISOString()}"}`);
  let started;
  try {
    // No short timeout: behind the passcode prompt the phone says nothing for
    // as long as its owner takes.
    started = await ctrl({ op: 'runner-start', phone: rsd.phone, sid: rsd.sid, udid, env, bundle: opt('bundle-id') }, { hold: true, timeoutMs: 15 * 60 * 1000 });
  } catch (e) {
    console.log(`{"level":"fatal","msg":"testmanagerd: ${e.message}"}`);
    process.exit(1);
  }
  if (!started.res.ok && started.res.error === 'ide-timeout') {
    // A locked or sleeping phone: real go-ios waits, logs this, and exits 0.
    await new Promise((r) => setTimeout(r, 1200));
    console.log('{"error":"runXUITestWithBundleIdsXcode15Ctx: cannot initiate a IDE session: Timed out waiting for response for message:1 channel:1","level":"info","msg":"Failed running Xcuitest"}');
    process.exit(0);
  }
  if (!started.res.ok) {
    console.log(`{"level":"fatal","msg":"runtest failed: ${started.res.error}"}`);
    process.exit(1);
  }
  console.log(`{"level":"info","msg":"device called local method","sel":"_XCT_didFormPlanWithData:","time":"${new Date().toISOString()}"}`);
  rsd.sock.on('close', () => { /* the tunnel went away: no one tells us, so we linger */ });
  rsd.sock.on('error', () => {});
  started.sock.on('close', () => {
    console.log('{"error":"lost connection to testmanagerd. the test-runner may have been killed","level":"info","msg":"Failed running Xcuitest"}');
    process.exit(1);
  });
  started.sock.on('error', () => {});
  capLifetime();
})();
