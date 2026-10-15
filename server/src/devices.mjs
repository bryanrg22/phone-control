// devices.mjs — which phone belongs to which person.
//
// One small JSON file. Each entry says who the person is (the id a connect code
// is minted for), where their phone is reachable from this server (its Tailscale
// address), and the phone's UDID:
//
//   { "devices": [ { "uid": "u_3f9a…", "email": "you@example.com",
//                    "address": "100.64.0.12", "udid": "00008130-…",
//                    "name": "Your iPhone", "addedAt": "2026-10-12T…" } ] }
//
// It is written by the operator (server/bin/phonectl.mjs) and only ever READ by
// the running server: a chat assistant's credential must never be able to add
// or re-address a phone.
//
// Plain file, atomic rename, mode 0600, no dependencies — at this size a
// database would be ceremony.

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_DEVICES_PATH = '/etc/phone-control/devices.json';

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const validAddress = (a) => { const m = String(a || '').match(IPV4); return !!m && m.slice(1).every((n) => Number(n) <= 255); };
const validUdid = (u) => /^[0-9A-Fa-f-]{20,64}$/.test(String(u || ''));
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || ''));

export function loadDevices(path = process.env.CONNECTOR_DEVICES || DEFAULT_DEVICES_PATH) {
  if (!existsSync(path)) return { devices: [] };
  try {
    const db = JSON.parse(readFileSync(path, 'utf8'));
    return db && Array.isArray(db.devices) ? db : { devices: [] };
  } catch {
    return { devices: [] };
  }
}

export function saveDevices(db, path = process.env.CONNECTOR_DEVICES || DEFAULT_DEVICES_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

/** Add a phone, or update the one already recorded for that email. Returns the record. */
export function upsertDevice(db, { email, address, udid, name = '' }, { now = () => new Date(), random = randomBytes } = {}) {
  const mail = String(email || '').trim().toLowerCase();
  if (!validEmail(mail)) throw new Error(`"${email}" is not an email address`);
  if (!validAddress(address)) throw new Error(`"${address}" is not an IPv4 address (use the phone's Tailscale address)`);
  if (!validUdid(udid)) throw new Error(`"${udid}" does not look like a device UDID`);
  let d = db.devices.find((x) => String(x.email || '').toLowerCase() === mail);
  if (!d) {
    d = { uid: `u_${random(9).toString('hex')}`, email: mail, addedAt: now().toISOString() };
    db.devices.push(d);
  }
  d.address = address;
  d.udid = String(udid).toUpperCase();
  d.name = String(name || d.name || '');
  d.updatedAt = now().toISOString();
  return d;
}

export function removeDevice(db, email) {
  const mail = String(email || '').trim().toLowerCase();
  const before = db.devices.length;
  db.devices = db.devices.filter((x) => String(x.email || '').toLowerCase() !== mail);
  return before - db.devices.length;
}

export function findDeviceByEmail(db, email) {
  const mail = String(email || '').trim().toLowerCase();
  return db.devices.find((x) => String(x.email || '').toLowerCase() === mail) || null;
}
