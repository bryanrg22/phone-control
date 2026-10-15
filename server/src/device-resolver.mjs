// device-resolver.mjs — "which phone does this person own, and what state is
// it in right now?"
//
// Reads the device registry (src/devices.mjs), which the operator writes. It
// never writes to it: an assistant's credential must not be able to add or
// re-address a phone.
//
// State is measured, not assumed. With `inspect` wired in (the normal case) the
// answer comes from the supervisor's own view of the phone — network, tunnel,
// runner, a start in progress — turned into one sentence a person can act on
// (src/preflight.mjs). `status()` only LOOKS; it starts automation only for the
// caller that is about to run a task.

import { describePhoneState } from './preflight.mjs';

const DEFAULT_RUNNER_PORT = 22087;

/** Probe the XCUITest runner over the network. Short timeout: this runs inside a
 *  tool call the model is waiting on. */
export async function probeRunner(address, port = DEFAULT_RUNNER_PORT, timeoutMs = 3000, fetchFn = fetch) {
  try {
    const res = await fetchFn(`http://${address}:${port}/deviceInfo`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ready: false, detail: `runner answered HTTP ${res.status}` };
    return { ready: true };
  } catch (e) {
    return { ready: false, detail: String(e?.message || e).slice(0, 120) };
  }
}

export function createDeviceResolver({
  loadRegistry,
  registryPath = undefined,
  runnerPort = DEFAULT_RUNNER_PORT,
  probe = probeRunner,
  armDelegate = null,
  // The preflight path (src/preflight.mjs). `inspect` reads the host's
  // full view of a phone; `startArm` begins a bring-up and returns at once.
  // Both optional: without `inspect` this resolver behaves exactly as before.
  inspect = null,
  startArm = null,
  overrides = {},
} = {}) {
  if (typeof loadRegistry !== 'function') throw new Error('createDeviceResolver requires loadRegistry');

  /** Registry lookup only — no network. */
  function resolve(uid) {
    const db = loadRegistry(registryPath);
    const d = (db.devices || []).find((x) => x.uid === uid);
    if (!d) return { state: 'not_enrolled' };
    if (d.revokedAt) return { state: 'revoked' };
    if ((d.status || 'approved') !== 'approved') return { state: 'pending' };
    // An operator override wins: it names where the phone actually is (say, its
    // Tailscale address) when that is not the address the registry recorded.
    const over = overrides[String(d.uid).toLowerCase()] || overrides[String(d.email || '').toLowerCase()];
    const address = over?.address || d.address;
    if (!address) return { state: 'no_address' };
    return {
      state: 'enrolled', address, udid: d.udid || '', email: d.email || '',
      slot: d.uid || '',
    };
  }

  /**
   * Registry + live probe. Returns a shape the tool layer can hand almost
   * verbatim to the model, including the sentence to say to the user.
   *
   * READ-ONLY unless `start` is passed. Asking about the phone must never put
   * the "Automation Running" banner on it: the banner dims the screen and
   * belongs on the phone only while an agent is actually driving it. Only
   * the code path that is about to run a task passes `start`.
   */
  async function status(uid, { start = false } = {}) {
    const base = resolve(uid);
    switch (base.state) {
      case 'not_enrolled':
        return { ready: false, state: base.state, message: 'No phone is registered for this account on the server yet (phonectl device add).' };
      case 'pending':
        return { ready: false, state: base.state, message: 'This phone is registered but not approved yet.' };
      case 'revoked':
        return { ready: false, state: base.state, message: 'Access for this phone has been revoked.' };
      case 'no_address':
        return { ready: false, state: base.state, message: 'This phone is registered without an address, so the server cannot reach it. Register it again with its Tailscale address (phonectl device add).' };
      default:
        break;
    }

    if (inspect) return preflight(base, start);

    const probed = await probe(base.address, runnerPort);
    if (probed.ready) {
      return { ready: true, state: 'ready', address: base.address, udid: base.udid, message: 'The phone is connected and ready.' };
    }

    if (armDelegate) {
      const armed = await armDelegate({ uid, address: base.address, udid: base.udid }).catch((e) => ({ armed: false, detail: e.message }));
      if (armed?.armed) {
        return { ready: true, state: 'ready', address: base.address, udid: base.udid, message: 'The phone was woken up and is ready.' };
      }
      return {
        ready: false, state: 'needs_wake', address: base.address, udid: base.udid,
        detail: armed?.detail || probed.detail,
        message: 'The phone could not be woken automatically. Check that it is unlocked and on Wi-Fi, then try again.',
      };
    }

    return {
      ready: false, state: 'needs_wake', address: base.address, udid: base.udid,
      detail: probed.detail,
      message: 'The phone is not connected right now. This server is set not to start automation by itself, so there is nothing I can do from here.',
    };
  }

  // Failures already reported to the user, by phone address → the bring-up that
  // failed. A start that died waiting on the owner must not be retried the
  // instant it fails — that would put the passcode prompt back on an unattended
  // phone in a loop. It is reported once; when the user asks AGAIN (having, one
  // hopes, unlocked the phone) that same failure no longer blocks a new start.
  const reportedFailures = new Map();

  /** Status from the host's own measurements, starting a bring-up if allowed. */
  async function preflight(base, start) {
    const raw = await inspect({ address: base.address, udid: base.udid });
    const d = describePhoneState(raw);
    const where = { address: base.address, udid: base.udid };
    if (d.ready) return { ready: true, running: true, state: 'ready', ...where, message: d.message };
    if (!start) {
      // Just looking. If a task COULD start, say so — and say that nothing is
      // running, because that is how the phone should be between tasks.
      if (d.startable && d.state !== 'needs_attention' && startArm) {
        const onCellular = raw?.phoneNet === 'cellular';
        return {
          ready: false, running: false, startable: true, state: 'standby', ...where,
          message: `${d.message.replace(/Automation is not running on the phone right now\.$/, '').trim()} Your phone is reachable and a task can start right away. Automation is off until you give me one, so nothing is showing on the phone.${onCellular ? ' It is on cellular: starting works because the connection is still warm, but if it drops, starting again will need Wi-Fi.' : ''}`.trim(),
        };
      }
      if (d.startable && d.state !== 'needs_attention') {
        return { ready: false, running: false, state: 'needs_wake', ...where, message: `${d.message} This server is set not to start automation by itself.` };
      }
      return { ready: false, running: false, state: d.state, ...where, message: d.message };
    }
    if (d.state === 'needs_attention') {
      const failure = raw?.arm?.startedAt || 'unknown';
      if (reportedFailures.get(base.address) !== failure) {
        reportedFailures.set(base.address, failure);
        return { ready: false, state: d.state, ...where, message: d.message };
      }
    }
    if (d.startable) {
      if (!startArm) {
        return { ready: false, state: 'needs_wake', ...where, message: `${d.state === 'needs_attention' ? '' : `${d.message} `}This server is set not to start automation by itself.` };
      }
      startArm({ address: base.address, udid: base.udid, slot: base.slot });
      return { ready: false, state: 'waking', ...where, message: 'Starting automation on your phone. This can take up to a minute; ask me again in a few seconds.' };
    }
    return { ready: false, state: d.state, ...where, message: d.message };
  }

  return { resolve, status, runnerPort };
}
