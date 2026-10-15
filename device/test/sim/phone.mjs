// phone.mjs — the simulated phone.
//
// It models only what the HOST can observe of an iPhone, because that is all
// device/supervisor.mjs ever sees. Every rule is a behaviour MEASURED on a real
// phone (iPhone 15 Pro, iOS 27, over a Tailscale relay; August and October 2026):
//
//   front door   remoted's RSD listener (:49152) ACCEPTS only on Wi-Fi. On
//                cellular the phone REFUSES it (an answer, in ~2 s). A tunnel
//                can only be BORN through it.
//   unreachable  powered off, restarted-and-never-unlocked, or VPN down: the
//                phone answers NOTHING — connects time out, they are not
//                refused. That difference is how the host tells "on cellular"
//                from "not there", so it is modelled with real kernel timeouts
//                (see Blackhole) wherever the platform allows.
//   roam         an established tunnel session survives Wi-Fi → cellular.
//   VPN outage   back within the grace window → the session resumes. Longer →
//                the phone has dropped the session, the host is never told: its
//                helper stays alive, its interface stays configured, nothing
//                routes. The GHOST tunnel.
//   power-off    every session is dropped WITHOUT a goodbye. The host's anchor
//                therefore does NOT exit (seen alive 8 min later, and after the
//                tunnel under it was rebuilt). The phone comes back locked, with
//                the Disk Image unmounted, unreachable until its first unlock,
//                and its first automation start shows a passcode prompt.
//   passcode     "Enter iPhone Passcode for XCTest — Enable UI Automation",
//                once per boot. Until it is answered the session is authorised
//                but no runner starts. Dismissed → that attempt never completes.
//   DDI          testmanagerd is in the service map only while the Disk Image
//                is mounted; mounting fails DeviceLocked while locked.
//   lock         locking does NOT end a session: the runner keeps answering,
//                and its view hierarchy shows the lock screen. But a NEW session
//                cannot start on a locked phone: the request goes unanswered and
//                go-ios gives up ("cannot initiate a IDE session: Timed out").
//                `lockedStartSilent` selects the other observed form — the
//                session is authorised and then nothing happens.
//   runner       host-anchored. The anchor learns that a session ended only if
//                the phone can TELL it — i.e. while the tunnel still routes
//                (volume-button stop, a runner crash). Otherwise it lingers.
//
// NOT modelled (say so rather than imply coverage): latency and packet loss,
// Tailscale itself, TLS-PSK pairing, a WRONG passcode (never
// measured), and anything an app on the phone does.

import { createServer as createNetServer, connect as netConnect } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';

function onLines(sock, fn) {
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); fn(line); }
  });
}

const listen = (server, port, host) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, host, () => { server.removeListener('error', reject); resolve(server.address().port); });
});

const tryConnect = (host, port, ms) => new Promise((resolve) => {
  const s = netConnect({ host, port });
  const t = setTimeout(() => { s.destroy(); resolve(null); }, ms);
  s.on('connect', () => { clearTimeout(t); resolve(s); });
  s.on('error', () => { clearTimeout(t); resolve(null); });
});

/**
 * A port that answers NOTHING — the loopback stand-in for a phone that is off.
 *
 * Loopback cannot drop packets, but a listening socket that nobody accept()s
 * can: once its queue is full the kernel discards further SYNs and the caller's
 * connect() times out, exactly as it does against a dead phone. Node always
 * accepts, so the listener is a tiny python3 process that binds, listens and
 * sleeps; the queue is then filled from here.
 */
const BLACKHOLE_PY = [
  'import socket,sys,time',
  's=socket.socket(socket.AF_INET,socket.SOCK_STREAM)',
  's.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)',
  's.bind((sys.argv[1],int(sys.argv[2])))',
  's.listen(0)',
  'sys.stdout.write("ready\\n");sys.stdout.flush()',
  'time.sleep(900)',
].join('\n');

export class Blackhole {
  constructor() { this.child = null; this.fillers = []; }

  async start(ip, port) {
    const child = spawn('python3', ['-c', BLACKHOLE_PY, ip, String(port)], { stdio: ['ignore', 'pipe', 'ignore'] });
    this.child = child;
    const ready = await new Promise((resolve) => {
      child.once('error', () => resolve(false));
      child.once('exit', () => resolve(false));
      child.stdout.once('data', () => resolve(true));
    });
    if (!ready) { this.child = null; return false; }
    // Fill the accept queue; the first connect that gets no answer means full.
    for (let i = 0; i < 16; i++) {
      const s = await tryConnect(ip, port, 350);
      if (!s) return true;
      s.on('error', () => {});
      this.fillers.push(s);
    }
    return false;   // never filled: this platform keeps accepting
  }

  stop() {
    for (const s of this.fillers) s.destroy();
    this.fillers = [];
    if (this.child) { this.child.kill('SIGKILL'); this.child = null; }
  }

  /** Can this platform produce a connect() timeout on loopback at all? */
  static async supported(ip) {
    const probe = createNetServer();
    const port = await listen(probe, 0, ip);
    await new Promise((r) => probe.close(r));
    const b = new Blackhole();
    const ok = await b.start(ip, port);
    b.stop();
    return ok;
  }
}

/** One of the phone's ports: listening, refusing, or answering nothing. */
class PortSlot {
  constructor(ip, port, makeServer, canBlackhole) {
    this.ip = ip; this.port = port; this.makeServer = makeServer; this.canBlackhole = canBlackhole;
    this.mode = 'refuse'; this.server = null; this.hole = null;
  }

  async set(mode) {
    // Without kernel timeouts the best available is the old behaviour: refuse.
    const want = mode === 'silent' && !this.canBlackhole ? 'refuse' : mode;
    if (want === this.mode) return;
    if (this.server) { this.server.close(); if (this.server.closeAllConnections) this.server.closeAllConnections(); this.server = null; }
    if (this.hole) { this.hole.stop(); this.hole = null; }
    this.mode = want;
    if (want === 'listen') {
      // A fresh server each time: established sessions must outlive the port
      // closing, and re-listening on a server with live connections is fragile.
      const s = this.makeServer();
      for (let i = 0; ; i++) {
        try { await listen(s, this.port, this.ip); break; } catch (e) {
          if (e.code !== 'EADDRINUSE' || i > 20) throw e;
          await new Promise((r) => setTimeout(r, 50));   // the blackhole is still letting go
        }
      }
      this.server = s;
    } else if (want === 'silent') {
      this.hole = new Blackhole();
      await this.hole.start(this.ip, this.port);
    }
  }

  async close() { await this.set('refuse'); }
}

export class SimPhone {
  constructor(world, { name, ip, udid }) {
    this.world = world;
    this.name = name;
    this.ip = ip;
    this.udid = udid;
    this.sessions = new Map();   // sid → { sock, dead }
    this.runner = null;          // { env, sock, sid }
    this.orphans = new Set();    // anchor channels the phone could not say goodbye on
    this.pendingStarts = [];     // runner launches parked behind the passcode prompt
    this.graceTimer = null;
    this.frontDoor = new PortSlot(ip, world.rsdListenPort, () => createNetServer((s) => this.onFrontDoor(s)), world.canBlackhole);
    this.runnerPort = new PortSlot(ip, world.runnerPort, () => createHttpServer((req, res) => this.onRunnerHttp(req, res)), world.canBlackhole);
    this.resetState();
    this.counters = { hellos: 0, deniedHellos: 0, runnerStarts: 0, mounts: 0, mountsRefused: 0, passcodePrompts: 0 };
  }

  resetState() {
    this.powered = true;
    this.unlockedSinceBoot = true;
    this.wifi = true;
    this.vpn = true;
    this.locked = false;
    this.ddiMounted = true;
    this.passcodeNeeded = false;
    this.lockedStartSilent = false;
    this.banner = null;            // another app's Live Activity expanded over the top: { text }
    this.foregroundApp = 'com.apple.springboard';
    this.swipes = [];
  }

  snapshot() { return { ...this.counters }; }

  /** Does anything the host sends get an answer at all? */
  get reachable() { return this.powered && this.unlockedSinceBoot && this.vpn; }

  /** Bring both ports in line with the current state. Serialised: state can
   *  change again while a port is still switching. */
  sync() {
    const run = async () => {
      await this.frontDoor.set(!this.reachable ? 'silent' : (this.wifi ? 'listen' : 'refuse'));
      await this.runnerPort.set(!this.reachable ? 'silent' : (this.runner ? 'listen' : 'refuse'));
    };
    this.syncing = (this.syncing || Promise.resolve()).then(run, run);
    return this.syncing;
  }

  // ── the front door (:49152) ────────────────────────────────────────────────
  onFrontDoor(sock) {
    sock.on('error', () => {});
    let sid = null;
    onLines(sock, (line) => {
      const hello = line.match(/^HELLO (\S+)$/);
      if (hello && sid === null) {
        if (hello[1] !== this.udid) {
          // No pairing record for that identity on this phone.
          this.counters.deniedHellos += 1;
          sock.end('DENY PairingError: device does not recognise this host identity\n');
          return;
        }
        sid = `s${++this.world.seq}`;
        this.sessions.set(sid, { sock, dead: false });
        this.counters.hellos += 1;
        sock.write(`OK ${sid} ${this.world.allocateRsdAddress()}\n`);
        return;
      }
      const ping = line.match(/^PING (\d+)$/);
      if (ping && sid) {
        const s = this.sessions.get(sid);
        // Silence IS the model: on a dropped session, or with the phone
        // unreachable, the host's packets go nowhere and nothing comes back.
        if (s && !s.dead && this.reachable) sock.write(`PONG ${ping[1]}\n`);
      }
    });
    sock.on('close', () => {
      if (!sid) return;
      this.sessions.delete(sid);
      // The host tore the tunnel down: whatever ran over it goes with it.
      if (this.runner && this.runner.sid === sid) this.killRunner();
    });
  }

  sessionLive(sid) {
    const s = this.sessions.get(sid);
    return !!s && !s.dead && this.reachable;
  }

  /** Drop every session WITHOUT telling the host. */
  ghostAllSessions() {
    for (const s of this.sessions.values()) s.dead = true;
    this.killRunner();
  }

  // ── the runner (:22087) ────────────────────────────────────────────────────
  onRunnerHttp(req, res) {
    const send = (obj) => { const b = JSON.stringify(obj); res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) }); res.end(b); };
    if (req.url === '/deviceInfo') return send({ sim: true, udid: this.udid, widthPoints: 393, heightPoints: 852 });
    if (req.url === '/hostInfo') return send({ env: this.runner ? this.runner.env : {} });
    if (req.url === '/viewHierarchy') return send(this.viewHierarchy());
    if (req.method === 'POST' && ['/swipeV2', '/launchApp', '/runningApp'].includes(req.url)) {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        let j = {};
        try { j = JSON.parse(body || '{}'); } catch { /* treated as empty */ }
        if (req.url === '/swipeV2') {
          this.swipes.push(j);
          // An upward swipe that STARTS on the banner sends it back to the island.
          const b = this.banner;
          if (b && j.startX >= 16 && j.startX <= 377 && j.startY >= 20 && j.startY <= 108 && j.endY < j.startY - 15) {
            if (b.stubborn > 0) b.stubborn -= 1; else this.banner = null;
          }
          return send({});
        }
        if (req.url === '/launchApp') { this.foregroundApp = j.bundleId; return send({}); }
        return send({ runningAppBundleId: (j.appIds || []).includes(this.foregroundApp) ? this.foregroundApp : 'com.apple.springboard' });
      });
      return undefined;
    }
    res.writeHead(404); res.end();
  }

  /** SpringBoard's tree, in the shape and with the strings the real phone returned. */
  viewHierarchy() {
    const statusBar = [
      { label: 'T-Mobile', elementType: 48 },
      { label: 'Cellular', value: '3 of 4 bars, signal strength', elementType: 48 },
    ];
    if (this.wifi) statusBar.push({ label: 'Wi-Fi', identifier: '3 of 3 Wi-Fi bars', value: 'SSID, 3 of 3 Wi-Fi bars', elementType: 48 });
    const screen = this.locked
      ? [{ identifier: 'SBCoverSheetWindow', children: [
          { identifier: 'proud-lock', label: 'Locked' },
          { identifier: 'lockscreen-date-view', children: [{ label: 'Sun Oct 11' }, { label: '9:56 PM' }] },
          { label: 'Swipe up to unlock' },
          { identifier: 'flashlight-orb-button', label: 'Flashlight', value: 'Off' },
        ] }]
      : [{ identifier: 'Home screen icons', children: [{ label: 'Maps' }, { label: 'Settings' }] }];
    // The Claude app's Live Activity, expanded: a container with a frame whose
    // children carry the visible text (the shape is a guess until one is
    // captured from the real phone — see device/screen-state.mjs).
    const banner = this.banner
      ? [{ identifier: 'live-activity-banner', frame: { X: 16, Y: 20, Width: 361, Height: 88 }, children: [{ label: this.banner.text, frame: { X: 0, Y: 0, Width: 0, Height: 0 } }, { label: 'Stop' }] }]
      : [];
    return { axElement: { identifier: '', children: [{ identifier: 'statusBar', children: statusBar }, ...banner, ...screen] }, depth: 4 };
  }

  async startRunner({ sid, env, sock }) {
    this.killRunner();
    const runner = { env, sock, sid };
    this.runner = runner;
    this.counters.runnerStarts += 1;
    sock.on('close', () => { if (this.runner === runner) this.killRunner(); });
    sock.on('error', () => {});
    await this.sync();
  }

  killRunner() {
    const r = this.runner;
    if (!r) return;
    this.runner = null;
    // The anchor hears that its session ended only if the phone can reach it.
    // Over a tunnel that no longer routes there is no goodbye, and it lingers.
    if (this.sessionLive(r.sid)) r.sock.destroy();
    else if (!r.sock.destroyed) this.orphans.add(r.sock);
    this.sync().catch(() => {});
  }

  // ── what a person (or iOS) does to the phone ───────────────────────────────
  async setWifi(on) { this.wifi = on; await this.sync(); }

  async setVpn(on) {
    this.vpn = on;
    clearTimeout(this.graceTimer);
    this.graceTimer = null;
    if (!on) {
      this.graceTimer = setTimeout(() => { this.graceTimer = null; this.ghostAllSessions(); }, this.world.graceMs);
    }
    await this.sync();
  }

  lock() { this.locked = true; }

  /** The first unlock after a boot is what brings the VPN and Wi-Fi back. */
  async unlock() {
    this.locked = false;
    if (this.powered && !this.unlockedSinceBoot) { this.unlockedSinceBoot = true; await this.sync(); }
  }

  unmountDdi() { this.ddiMounted = false; }

  /** The runner dies on the phone — jetsam, a crash, or both volume buttons held. */
  crashRunner() { this.killRunner(); }

  /** Power cut: nothing is told anything. */
  async powerOff() {
    clearTimeout(this.graceTimer); this.graceTimer = null;
    this.powered = false;
    this.ghostAllSessions();
    this.dropPendingStarts();
    await this.sync();
  }

  /** Boot: locked, Disk Image unmounted, unreachable until the first unlock, passcode prompt armed. */
  async powerOn() {
    this.powered = true;
    this.unlockedSinceBoot = false;
    this.locked = true;
    this.ddiMounted = false;
    this.passcodeNeeded = true;
    this.vpn = true;
    await this.sync();
  }

  async reboot() { await this.powerOff(); await this.powerOn(); }

  // ── the "Enter iPhone Passcode for XCTest" prompt ──────────────────────────
  /** The owner types the passcode: every parked launch goes ahead. */
  async enterPasscode() {
    this.passcodeNeeded = false;
    const parked = this.pendingStarts; this.pendingStarts = [];
    for (const p of parked) {
      if (p.sock.destroyed) continue;
      await this.startRunner({ sid: p.sid, env: p.env, sock: p.sock });
      p.sock.write('{"ok":true}\n');
    }
  }

  /** The prompt is dismissed or ignored: parked launches never complete. */
  dropPendingStarts() { this.pendingStarts = []; }

  /** Back to a healthy phone on Wi-Fi with nothing running. */
  async reset() {
    clearTimeout(this.graceTimer); this.graceTimer = null;
    this.ghostAllSessions();
    for (const s of this.sessions.values()) s.sock.destroy();
    this.sessions.clear();
    for (const s of this.orphans) s.destroy();
    this.orphans.clear();
    this.dropPendingStarts();
    this.resetState();
    await this.sync();
  }

  async close() {
    clearTimeout(this.graceTimer);
    this.killRunner();
    for (const s of this.sessions.values()) s.sock.destroy();
    this.sessions.clear();
    for (const s of this.orphans) s.destroy();
    this.orphans.clear();
    await this.frontDoor.close();
    await this.runnerPort.close();
  }
}

export class SimWorld {
  /**
   * @param {object} o
   * @param {number} o.runnerPort      what RUNNER_PORT is set to for the supervisor
   * @param {number} o.rsdListenPort   what RSD_LISTEN_PORT is set to
   * @param {number} [o.graceMs]       VPN outage the phone tolerates (real: ~12 s)
   * @param {() => string} o.allocateRsdAddress  host-side address for a new tunnel
   * @param {boolean} [o.canBlackhole] whether unreachable ports can time out here
   */
  constructor({ runnerPort, rsdListenPort, graceMs = 3000, allocateRsdAddress, canBlackhole = false }) {
    this.runnerPort = runnerPort;
    this.rsdListenPort = rsdListenPort;
    this.graceMs = graceMs;
    this.allocateRsdAddress = allocateRsdAddress;
    this.canBlackhole = canBlackhole;
    this.phones = new Map();
    this.seq = 0;
    this.ctrl = null;
    this.ctrlPort = 0;
  }

  async start() {
    this.ctrl = createNetServer((sock) => {
      sock.on('error', () => {});
      let handled = false;
      onLines(sock, (line) => {
        if (handled) return;
        handled = true;
        let req;
        try { req = JSON.parse(line); } catch { sock.end('{"ok":false,"error":"bad json"}\n'); return; }
        this.handle(req, sock).catch((e) => { try { sock.end(JSON.stringify({ ok: false, error: String(e.message || e) }) + '\n'); } catch { /* gone */ } });
      });
    });
    this.ctrlPort = await listen(this.ctrl, 0, '127.0.0.1');
    return this.ctrlPort;
  }

  async addPhone(spec) {
    const p = new SimPhone(this, spec);
    this.phones.set(spec.ip, p);
    await p.sync();
    return p;
  }

  async handle(req, sock) {
    const reply = (obj) => sock.write(JSON.stringify(obj) + '\n');

    // The mesh's view of every phone — what `tailscale status` prints.
    if (req.op === 'mesh') {
      reply({ ok: true, peers: [...this.phones.values()].map((p) => ({ ip: p.ip, name: `simphone-${p.name.toLowerCase()}`, online: p.reachable })) });
      sock.end();
      return;
    }

    const phone = this.phones.get(req.phone);
    if (!phone) { reply({ ok: false, error: `no such phone ${req.phone}` }); sock.end(); return; }
    if (!phone.sessionLive(req.sid)) { reply({ ok: false, error: 'tunnel session is not routing' }); sock.end(); return; }

    if (req.op === 'services') {
      const services = ['com.apple.mobile.lockdown.remote.trusted', 'com.apple.coredevice.appservice'];
      if (phone.ddiMounted) services.push('com.apple.dt.testmanagerd.remote');
      reply({ ok: true, services }); sock.end();
      return;
    }
    if (req.op === 'mount') {
      if (phone.locked) { phone.counters.mountsRefused += 1; reply({ ok: false, error: 'DeviceLocked' }); sock.end(); return; }
      phone.ddiMounted = true; phone.counters.mounts += 1;
      reply({ ok: true }); sock.end();
      return;
    }
    if (req.op === 'runner-start') {
      if (req.udid !== phone.udid) { reply({ ok: false, error: `device ${req.udid} not found` }); sock.end(); return; }
      // Without the Disk Image there is no testmanagerd: go-ios resolves port :0.
      if (!phone.ddiMounted) { reply({ ok: false, error: "testmanagerd port :0 — can't assign requested address" }); sock.end(); return; }
      if (phone.locked) {
        if (phone.lockedStartSilent) { phone.pendingStarts.push({ sid: req.sid, env: req.env || {}, sock, locked: true }); return; }
        reply({ ok: false, error: 'ide-timeout' }); sock.end();
        return;
      }
      if (phone.passcodeNeeded) {
        // The prompt is on screen. Nothing comes back until it is answered.
        phone.counters.passcodePrompts += 1;
        phone.pendingStarts.push({ sid: req.sid, env: req.env || {}, sock });
        return;
      }
      await phone.startRunner({ sid: req.sid, env: req.env || {}, sock });
      reply({ ok: true });      // socket stays open: it IS the anchor's session
      return;
    }
    reply({ ok: false, error: `unknown op ${req.op}` }); sock.end();
  }

  async close() {
    for (const p of this.phones.values()) await p.close();
    if (this.ctrl) this.ctrl.close();
  }
}
