#!/usr/bin/env node
// phonectl — the operator's tool. Run it on the server, as the user that owns
// the files in /etc/phone-control.
//
//   phonectl device add --email you@example.com --address 100.64.0.12 --udid 00008130-… [--name "Your iPhone"]
//   phonectl device list
//   phonectl device remove --email you@example.com
//   phonectl link-code --email you@example.com     a connect code: single use, 10 minutes
//   phonectl revoke --email you@example.com        disconnect every assistant that person linked
//
// This is the ONLY way phones and connect codes come into being. It is not a
// new trust path: whoever can run it can already read the files it writes.

import { fileURLToPath } from 'node:url';
import { loadStore, saveStore, createLinkCode, revokeAllForUid, pruneExpired } from '../src/auth.mjs';
import { loadDevices, saveDevices, upsertDevice, removeDevice, findDeviceByEmail } from '../src/devices.mjs';

export function parseArgs(argv) {
  const positional = []; const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { flags[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } else positional.push(a);
  }
  return { positional, flags };
}

/** Runs one command; returns the lines to print. Throws with a message to show. */
export function run(argv, { devicesPath, storePath, now = Date.now } = {}) {
  const { positional, flags } = parseArgs(argv);
  const cmd = positional.join(' ');
  const need = (name) => { if (typeof flags[name] !== 'string' || !flags[name]) throw new Error(`--${name} is required`); return flags[name]; };

  if (cmd === 'device add') {
    const db = loadDevices(devicesPath);
    const d = upsertDevice(db, { email: need('email'), address: need('address'), udid: need('udid'), name: typeof flags.name === 'string' ? flags.name : '' });
    saveDevices(db, devicesPath);
    return [`Registered ${d.email}: phone at ${d.address} (UDID ${d.udid}).`, `Next: phonectl link-code --email ${d.email}`];
  }
  if (cmd === 'device list') {
    const { devices } = loadDevices(devicesPath);
    if (!devices.length) return ['No phones registered. Add one with: phonectl device add --email … --address … --udid …'];
    return devices.map((d) => `${d.email}  ${d.address}  ${d.udid}${d.name ? `  "${d.name}"` : ''}`);
  }
  if (cmd === 'device remove') {
    const db = loadDevices(devicesPath);
    const email = need('email');
    const who = findDeviceByEmail(db, email);
    const n = removeDevice(db, email);
    if (!n) throw new Error(`no phone is registered for ${email}`);
    saveDevices(db, devicesPath);
    // A removed phone must not leave live assistant credentials behind.
    const store = loadStore(storePath);
    const revoked = revokeAllForUid(store, who.uid, now());
    saveStore(store, storePath);
    return [`Removed ${email}; ${revoked} assistant connection(s) revoked.`];
  }
  if (cmd === 'link-code') {
    const email = need('email');
    const who = findDeviceByEmail(loadDevices(devicesPath), email);
    if (!who) throw new Error(`no phone is registered for ${email} — add it first with: phonectl device add`);
    const store = loadStore(storePath);
    const { code, expiresAt } = createLinkCode(store, { uid: who.uid, email: who.email, now: now() });
    pruneExpired(store, now());
    saveStore(store, storePath);
    return [`Connect code: ${code}`, `Expires:      ${expiresAt} (single use)`, 'Enter it on the consent page that opens when the connector is added to the assistant.'];
  }
  if (cmd === 'revoke') {
    const email = need('email');
    const who = findDeviceByEmail(loadDevices(devicesPath), email);
    if (!who) throw new Error(`no phone is registered for ${email}`);
    const store = loadStore(storePath);
    const n = revokeAllForUid(store, who.uid, now());
    saveStore(store, storePath);
    return [`Revoked ${n} assistant connection(s) for ${email}.`];
  }
  throw new Error('usage: phonectl (device add|list|remove | link-code | revoke) [--email …] [--address …] [--udid …] [--name …]');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    for (const line of run(process.argv.slice(2), {
      devicesPath: process.env.CONNECTOR_DEVICES || undefined,
      storePath: process.env.CONNECTOR_STORE || undefined,
    })) console.log(line);
  } catch (e) {
    console.error(`phonectl: ${e.message}`);
    process.exit(1);
  }
}
