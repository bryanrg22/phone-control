// simlib.cjs — shared by the fake binaries of the tunnel simulator.
// CommonJS on purpose: these files are copied OUT of the repo into a temp dir
// and run extensionless (`ip`, `ios-cableout-sim`) or as `tunnel.py`, where
// Node treats them as CJS. See ../harness.mjs.
'use strict';
const net = require('net');

const CTRL_PORT = Number(process.env.SIM_CTRL_PORT || 0);
const STATE_DIR = process.env.SIM_STATE_DIR || '';
// Nothing here may outlive a crashed harness for long: a fake that lingers on
// the real host is a process whose argv looks like the real thing.
const MAX_LIFETIME_MS = Number(process.env.SIM_MAX_LIFETIME_MS || 15 * 60 * 1000);

/** Read '\n'-terminated lines from a socket. */
function onLines(sock, fn) {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); fn(line); }
  });
}

/**
 * One JSON request → one JSON reply on the simulator's control port.
 * With { hold: true } the socket is returned OPEN: its lifetime then means
 * something to the phone (the runner lives exactly as long as its anchor's).
 */
function ctrl(req, { hold = false, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port: CTRL_PORT });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('sim control timeout')); }, timeoutMs);
    let done = false;
    sock.on('error', (e) => { if (!done) { clearTimeout(timer); reject(e); } });
    sock.on('connect', () => sock.write(JSON.stringify(req) + '\n'));
    onLines(sock, (line) => {
      if (done) return;
      done = true; clearTimeout(timer);
      let res;
      try { res = JSON.parse(line); } catch (e) { sock.destroy(); reject(e); return; }
      if (!hold) sock.end();
      resolve({ res, sock });
    });
  });
}

/** Dial a tunnel's RSD endpoint and read its greeting ("SIMRSD <phoneIP> <sid>"). */
function dialRsd(address, port, { hold = false, timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: address, port: Number(port) });
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('timed out')); }, timeoutMs);
    let done = false;
    sock.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
    onLines(sock, (line) => {
      if (done) return;
      done = true; clearTimeout(timer);
      const m = line.match(/^SIMRSD (\S+) (\S+)$/);
      if (!m) { sock.destroy(); reject(new Error(`unexpected RSD greeting: ${line}`)); return; }
      if (!hold) sock.end();
      resolve({ phone: m[1], sid: m[2], sock });
    });
  });
}

function capLifetime() {
  setTimeout(() => process.exit(0), MAX_LIFETIME_MS).unref();
}

module.exports = { onLines, ctrl, dialRsd, capLifetime, STATE_DIR, CTRL_PORT };
