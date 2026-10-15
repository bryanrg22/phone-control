// device.mjs — the agent's only way to touch the phone: the XCTest runner's HTTP API.
//
// The runner (runner/, a modified copy of Maestro's) runs on the iPhone and
// listens on port 22087. The same routes work on a simulator, which is how the
// iOSWorld evals measure what a phone runs. Every call has a 30 s timeout; a
// failed call throws, and the loop counts consecutive failures to tell a dead
// connection (exit 43) from a bad action.
//
// Coordinates sent to the runner are in points (402×874 on an iPhone 17 Pro).
// The runner returns the foreground app's element tree whatever app list is
// sent, and maps points for the current orientation.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * @param {object} o
 * @param {string} o.host        the runner's address: the phone over the tunnel, or 127.0.0.1 for a simulator
 * @param {number} o.port
 * @param {string[]} [o.knownApps]  bundle IDs of the installed apps (see keyboardVisible)
 */
export function createDevice({ host, port, knownApps = [] }) {
  const base = `http://${host}:${port}`;

  async function call(method, path, body = null) {
    const opts = { method, signal: AbortSignal.timeout(30000) };
    if (body !== null) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    const resp = await fetch(`${base}${path}`, opts);
    if (!resp.ok) throw new Error(`runner ${path} failed (${resp.status}): ${(await resp.text().catch(() => '')).slice(0, 150)}`);
    return resp;
  }
  // Most routes ignore the app list (they read the foreground app themselves)
  // but their request schema requires one.
  const APP_IDS = ['com.apple.springboard'];
  // /keyboard does not: it asks the FIRST app of the list that is in the
  // foreground for its keyboard, and falls back to the home screen. Sent only
  // the home screen's ID it always answered "no keyboard" (caught by
  // e2e/tools-on-simulator.mjs, 2026-10-15). So: the app opened last, then
  // every installed app, then the home screen.
  let lastLaunched = null;
  const foregroundCandidates = () => [...new Set([lastLaunched, ...knownApps, 'com.apple.springboard'].filter(Boolean))];

  const device = {
    address: `${host}:${port}`,
    /** { widthPoints, heightPoints, widthPixels, heightPixels }, orientation-aware. */
    async info() { return (await call('GET', '/deviceInfo')).json(); },
    /** The full-resolution screenshot, as PNG bytes. */
    async screenshot() { return Buffer.from(await (await call('GET', '/screenshot')).arrayBuffer()); },
    /** The foreground app's element tree, as the runner's JSON text. */
    async hierarchy() { return (await call('POST', '/viewHierarchy', { appIds: APP_IDS, excludeKeyboardElements: false })).text(); },
    async keyboardVisible() { return (await (await call('POST', '/keyboard', { appIds: foregroundCandidates() })).json().catch(() => ({}))).isKeyboardVisible === true; },
    async launchApp(bundleId) { await call('POST', '/launchApp', { bundleId }); lastLaunched = bundleId; },
    async tap(x, y, duration = 0.1) { await call('POST', '/touch', { x, y, duration }); },
    async type(text) { await call('POST', '/inputText', { text, appIds: APP_IDS }); },
    async eraseText(chars) { await call('POST', '/eraseText', { charactersToErase: chars, appIds: APP_IDS }); },
    /** A keyboard key: enter, return, delete, tab, space, escape. */
    async pressKey(key) { await call('POST', '/pressKey', { key }); },
    /** A hardware button: home, lock. */
    async pressButton(button) { await call('POST', '/pressButton', { button }); },
    // swipeV2 applies the orientation mapping that /touch and /drag apply; v1 does not.
    async swipe(sx, sy, ex, ey, duration = 0.3) { await call('POST', '/swipeV2', { startX: sx, startY: sy, endX: ex, endY: ey, duration }); },
    async drag(sx, sy, ex, ey, holdDuration = 0.5, dragDuration = 1.0) { await call('POST', '/drag', { startX: sx, startY: sy, endX: ex, endY: ey, holdDuration, dragDuration }); },

    /**
     * A point above the keyboard that no control covers, or null. Tapping
     * there dismisses a keyboard in many apps without pressing anything.
     */
    async emptySpotAboveKeyboard() {
      let root; try { root = JSON.parse(await device.hierarchy()); } catch { return null; }
      const { widthPoints: W = 393, heightPoints: H = 852 } = await device.info().catch(() => ({}));
      const PRESSABLE = new Set([9, 75, 40, 42, 49, 43, 44, 12, 21, 27]);   // button, cell, switch, link, text field, image, icon, checkbox, nav bar, table row
      const frames = [];
      (function walk(n) {
        if (!n) return;
        const f = n.frame;
        if (f && f.Width > 0 && f.Height > 0 && f.Width < W * 0.95 && PRESSABLE.has(n.elementType)) frames.push(f);
        for (const c of n.children || []) walk(c);
      })(root.axElement || root);
      for (let frac = 0.30; frac <= 0.55; frac += 0.05) {
        const x = 8, y = frac * H;
        if (!frames.some((f) => x >= f.X - 6 && x <= f.X + f.Width + 6 && y >= f.Y - 6 && y <= f.Y + f.Height + 6)) return { x, y: Math.round(y) };
      }
      return null;
    },
  };
  return device;
}

// ─── Which apps are installed ────────────────────────────────────────────────

/** Apps every iPhone has, plus common ones: used when the phone cannot be asked. */
export const KNOWN_APPS = {
  Safari: 'com.apple.mobilesafari', Maps: 'com.apple.Maps', Messages: 'com.apple.MobileSMS',
  Calendar: 'com.apple.mobilecal', Photos: 'com.apple.mobileslideshow', Camera: 'com.apple.camera',
  Settings: 'com.apple.Preferences', Notes: 'com.apple.mobilenotes', Reminders: 'com.apple.reminders',
  Contacts: 'com.apple.MobileAddressBook', Phone: 'com.apple.mobilephone', Mail: 'com.apple.mobilemail',
  Weather: 'com.apple.weather', Clock: 'com.apple.mobiletimer', Files: 'com.apple.DocumentsApp',
  News: 'com.apple.news', Health: 'com.apple.Health', Wallet: 'com.apple.Passbook',
  Shortcuts: 'com.apple.shortcuts', Music: 'com.apple.Music', Podcasts: 'com.apple.podcasts',
  'App Store': 'com.apple.AppStore', Calculator: 'com.apple.calculator', Compass: 'com.apple.compass',
  'Voice Memos': 'com.apple.VoiceMemos', Measure: 'com.apple.measure', TV: 'com.apple.tv',
  Passwords: 'com.apple.Passwords', Clips: 'com.apple.clips',
  Spotify: 'com.spotify.client', Instagram: 'com.burbn.instagram', Snapchat: 'com.toyopagroup.picaboo',
  TikTok: 'com.zhiliaoapp.musically', YouTube: 'com.google.ios.youtube', Gmail: 'com.google.Gmail',
  WhatsApp: 'net.whatsapp.WhatsApp', Telegram: 'ph.telegra.Telegraph', Discord: 'com.hammerandchisel.discord',
  Uber: 'com.ubercab.UberClient', Starbucks: 'com.starbucks.mystarbucks', Amazon: 'com.amazon.Amazon',
  Twitter: 'com.atebits.Tweetie2', Reddit: 'com.reddit.Reddit', Netflix: 'com.netflix.Netflix',
  Notion: 'notion.id', Slack: 'com.tinyspeck.chatlyio', ChatGPT: 'com.openai.chat',
  LinkedIn: 'com.linkedin.LinkedIn', GitHub: 'com.github.stormbreaker.prod', Zoom: 'us.zoom.videomeetings',
  Outlook: 'com.microsoft.Office.Outlook', 'Google Calendar': 'com.google.calendar',
  'Nike Run Club': 'com.nike.nrc', Robinhood: 'com.robinhood.release.Robinhood',
  GroupMe: 'com.groupme.iphone', Expedia: 'com.expedia.app',
  SNKRS: 'com.nike.snkrs', Supreme: 'com.supremenewyork.supreme',
};

/** `xcrun simctl listapps <udid>` output → { display name: bundle ID }. */
export function parseSimctlApps(text) {
  const apps = {};
  let name = '';
  for (const line of String(text).split('\n')) {
    const nm = line.match(/CFBundleDisplayName\s*=\s*"?([^";]+)"?/);
    const id = line.match(/CFBundleIdentifier\s*=\s*"?([^";]+)"?/);
    if (nm) name = nm[1].trim();
    if (id && name) {
      const bid = id[1].trim();
      if (!bid.includes('Preview') && name !== 'Watch' && name !== 'Web') apps[name] = bid;
      name = '';
    }
  }
  return apps;
}

/**
 * The apps the agent may open by name. A simulator is asked directly. A phone
 * gets KNOWN_APPS: asking it needs pymobiledevice3 pointed at the tunnel, which
 * is not wired up yet, so an app outside the list cannot be opened by name.
 * @returns {Promise<{ apps: Record<string,string>, source: string }>}
 */
export async function installedApps({ simulatorUdid = null } = {}) {
  if (simulatorUdid) {
    const { stdout } = await execFileP('xcrun', ['simctl', 'listapps', simulatorUdid], { timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    return { apps: parseSimctlApps(stdout), source: 'simctl' };
  }
  return { apps: { ...KNOWN_APPS }, source: 'built-in list' };
}
