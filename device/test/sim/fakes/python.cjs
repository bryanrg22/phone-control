#!/usr/bin/env node
// Fake TUNNEL_PYTHON. The supervisor uses its interpreter for three things, so
// this one binary plays all three:
//
//   <python> <.../tunnel.py> <UDID> <phoneIP>         the tunnel helper
//   <python> -m pymobiledevice3 remote rsd-info --rsd A P  the service map
//   <python> -m pymobiledevice3 mounter auto-mount --rsd A P
//
// Run as `node <this> <.../tunnel.py> <UDID> …`, so the process argv
// contains "tunnel.py <UDID>" — what the supervisor's pgrep/pkill match.
'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');
const { onLines, ctrl, dialRsd, capLifetime, STATE_DIR } = require('./simlib.cjs');

const argv = process.argv.slice(2);
const log = (m) => process.stderr.write(`[tunnel] ${m}\n`);

if (argv[0] === '-m' && argv[1] === 'pymobiledevice3') pmd3(argv.slice(2));
else if (/tunnel\.py$/.test(argv[0] || '')) tunnel(argv[1], argv[2]);
else { process.stderr.write(`fake python: unsupported invocation: ${argv.join(' ')}\n`); process.exit(2); }

// ─── pymobiledevice3 subcommands ─────────────────────────────────────────────
async function pmd3(a) {
  const i = a.indexOf('--rsd');
  const address = a[i + 1]; const port = a[i + 2];
  let rsd;
  try { rsd = await dialRsd(address, port); } catch (e) {
    process.stderr.write(`ConnectionRefusedError: cannot reach RSD [${address}]:${port} (${e.message})\n`);
    process.exit(1);
  }
  if (a[0] === 'remote' && a[1] === 'rsd-info') {
    const { res } = await ctrl({ op: 'services', phone: rsd.phone, sid: rsd.sid });
    if (!res.ok) { process.stderr.write(`${res.error}\n`); process.exit(1); }
    const map = {};
    for (const s of res.services) map[s] = { Port: '49200' };
    process.stdout.write(JSON.stringify({ Services: map }, null, 2) + '\n');
    process.exit(0);
  }
  if (a[0] === 'mounter' && a[1] === 'auto-mount') {
    const { res } = await ctrl({ op: 'mount', phone: rsd.phone, sid: rsd.sid });
    if (!res.ok) {
      process.stderr.write(`Traceback (most recent call last):\npymobiledevice3.exceptions.${res.error}Error: ${res.error}\n`);
      process.exit(1);
    }
    process.stdout.write('DeveloperDiskImage mounted successfully\n');
    process.exit(0);
  }
  process.stderr.write(`fake pymobiledevice3: unsupported: ${a.join(' ')}\n`);
  process.exit(2);
}

// ─── the tunnel helper ───────────────────────────────────────────────────────
// Mirrors scripts/tunnel.py's contract: handshake against the phone's
// front door (:49152 — refused unless the phone is on Wi-Fi with its VPN up),
// print exactly one "RSD <addr> <port>" line on stdout, then HOLD.
//
// "Routing" is modelled by a heartbeat on the session socket. While the phone
// answers, the RSD endpoint accepts connections. When it stops answering — a
// VPN outage, or a session the phone has dropped for good — this process stays
// ALIVE with its interface still configured but its endpoint closed: the ghost
// tunnel. If the phone answers again within its grace window, routing resumes.
function tunnel(udid, phoneIP) {
  const frontDoor = Number(process.env.RSD_LISTEN_PORT || 49152);
  const HB_MS = Number(process.env.SIM_HEARTBEAT_MS || 100);
  const ifaceFile = path.join(STATE_DIR, 'ifaces', String(process.pid));
  log(`RSD handshake to ${phoneIP}:${frontDoor} …`);
  const sess = net.connect({ host: phoneIP, port: frontDoor });
  let established = false;
  // Against a phone that answers nothing the connect would hang for minutes.
  const dialTimer = setTimeout(() => { if (!established) { log('FAIL handshake: TimeoutError: no answer from the device'); process.exit(1); } }, 6000);
  sess.on('error', (e) => {
    if (!established) { log(`FAIL handshake: ConnectionRefusedError: ${e.message}`); process.exit(1); }
  });
  sess.on('connect', () => sess.write(`HELLO ${udid}\n`));

  let rsdAddr = ''; let rsdPort = 0; let sid = '';
  let server = null; let lastPong = 0; let seq = 0;
  const clients = new Set();

  function openEndpoint(cb) {
    const s = net.createServer((c) => {
      clients.add(c);
      c.on('close', () => clients.delete(c));
      c.on('error', () => {});
      c.write(`SIMRSD ${phoneIP} ${sid}\n`);
    });
    s.on('error', (e) => { log(`endpoint listen error: ${e.message}`); if (server === s) server = null; });
    s.listen(rsdPort, rsdAddr, () => { if (cb) cb(s.address().port); });
    server = s;
  }

  onLines(sess, (line) => {
    const deny = line.match(/^DENY (.*)$/);
    if (deny) { log(`FAIL handshake: ${deny[1]}`); process.exit(1); }
    const ok = line.match(/^OK (\S+) (\S+)$/);
    if (ok && !established) {
      established = true; clearTimeout(dialTimer); sid = ok[1]; rsdAddr = ok[2]; lastPong = Date.now();
      log('handshake completed');
      openEndpoint((port) => {
        rsdPort = port;
        fs.mkdirSync(path.dirname(ifaceFile), { recursive: true });
        fs.writeFileSync(ifaceFile, rsdAddr + '\n');
        process.stdout.write(`RSD ${rsdAddr} ${rsdPort}\n`);
        log(`tunnel endpoint: RSD ${rsdAddr} ${rsdPort} — holding tunnel open`);
        setInterval(() => {
          sess.write(`PING ${++seq}\n`);
          const routing = Date.now() - lastPong < HB_MS * 3.5;
          if (!routing && server) { server.close(); server = null; log('not routing — endpoint closed (process and interface stay)'); }
          else if (routing && !server) { openEndpoint(); log('routing again — endpoint reopened'); }
        }, HB_MS);
      });
      return;
    }
    if (/^PONG /.test(line)) lastPong = Date.now();
  });

  // The phone side going away entirely (the harness exited) is the one case
  // where we leave: nothing would ever reap us otherwise.
  sess.on('close', () => { if (established) { cleanup(); process.exit(1); } });
  function cleanup() { try { fs.unlinkSync(ifaceFile); } catch { /* never written */ } }
  // A helper that is asked to stop tears its interface down (pmd3's `async
  // with`). SIGKILL bypasses this and leaves the interface orphaned — on purpose.
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { cleanup(); process.exit(0); });
  capLifetime();
}
