// fake-runner.mjs — an HTTP stand-in for the XCTest runner on the phone.
//
// Answers the routes the agent calls (agent/device-backend.mjs) the way the
// real runner does, and records every call, so a test can assert what the
// agent actually did to the "phone": which app it launched, where it tapped
// (in points), what it typed. The screen is whatever the test says it is:
// `screen()` returns the element tree for the current state.

import { createServer } from 'node:http';
import sharp from 'sharp';

export const SCREEN = { widthPoints: 402, heightPoints: 874, widthPixels: 1206, heightPixels: 2622 };

/** One accessibility element as the runner returns it. */
export const el = (label, { x = 100, y = 300, w = 120, h = 44, value = null, type = 9 } = {}) => ({
  identifier: '', label, value, title: null, elementType: type, enabled: true, selected: false, hasFocus: false,
  placeholderValue: null, horizontalSizeClass: 0, verticalSizeClass: 0, windowContextID: 0, displayID: 0,
  frame: { X: x, Y: y, Width: w, Height: h }, children: [],
});
export const tree = (...children) => ({ axElement: { ...el('', { x: 0, y: 0, w: SCREEN.widthPoints, h: SCREEN.heightPoints, type: 2 }), children } });

/**
 * @param {object} [opts]
 * @param {(state) => object} [opts.screen]   the element tree for the current state
 * @param {boolean} [opts.dead]               every route fails (a runner that died)
 */
export async function startFakeRunner({ screen = () => tree(el('Home')), dead = false } = {}) {
  const calls = [];
  const state = { app: 'com.apple.springboard', typed: '', dead };
  const png = await sharp({ create: { width: 402, height: 874, channels: 3, background: { r: 30, g: 30, b: 30 } } }).png().toBuffer();

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const path = req.url.split('?')[0];
      let json = null;
      try { json = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
      calls.push({ method: req.method, path, body: json, at: Date.now() });
      if (state.dead) { res.writeHead(503); res.end('runner gone'); return; }
      const send = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      switch (path) {
        case '/deviceInfo': return send(SCREEN);
        case '/screenshot': res.writeHead(200, { 'content-type': 'image/png' }); return res.end(png);
        case '/viewHierarchy': return send(screen(state));
        case '/keyboard': return send({ isKeyboardVisible: false });
        case '/launchApp': state.app = json?.bundleId; return send({});
        case '/inputText': state.typed += json?.text || ''; return send({});
        case '/touch': case '/pressKey': case '/pressButton': case '/swipeV2': case '/drag': case '/eraseText': return send({});
        default: res.writeHead(404); return res.end(`no route ${path}`);
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: server.address().port,
    calls,
    state,
    /** Calls to one route, in order. */
    callsTo: (path) => calls.filter((c) => c.path === path),
    kill() { state.dead = true; },
    close: () => new Promise((r) => server.close(r)),
  };
}
