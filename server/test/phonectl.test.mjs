#!/usr/bin/env node
// phonectl.test.mjs — the operator CLI and the device registry behind it.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, parseArgs } from '../bin/phonectl.mjs';
import { loadDevices } from '../src/devices.mjs';
import { loadStore, redeemLinkCode, issueClientToken, findClientByToken, saveStore } from '../src/auth.mjs';
import { createDeviceResolver } from '../src/device-resolver.mjs';

let passed = 0;
async function ok(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

const dir = mkdtempSync(join(tmpdir(), 'phonectl-'));
const paths = { devicesPath: join(dir, 'etc', 'devices.json'), storePath: join(dir, 'etc', 'connector.json') };
const ADD = ['device', 'add', '--email', 'Ana@Example.com', '--address', '100.64.0.12', '--udid', '00008130-000a1b2c3d4e5f60', '--name', 'Ana iPhone'];

await ok('flags and positionals are separated; a flag without a value is true', () => {
  assert.deepEqual(parseArgs(['device', 'add', '--email', 'a@b.c', '--dry']), { positional: ['device', 'add'], flags: { email: 'a@b.c', dry: true } });
});

await ok('device add registers a phone, creating the directory and a private file', () => {
  const out = run(ADD, paths);
  assert.match(out[0], /Registered ana@example\.com: phone at 100\.64\.0\.12/);
  const { devices } = loadDevices(paths.devicesPath);
  assert.equal(devices.length, 1);
  assert.deepEqual([devices[0].email, devices[0].udid, devices[0].name], ['ana@example.com', '00008130-000A1B2C3D4E5F60', 'Ana iPhone']);
  assert.match(devices[0].uid, /^u_[0-9a-f]{18}$/);
  assert.equal(statSync(paths.devicesPath).mode & 0o777, 0o600, 'the registry must not be world-readable');
});

await ok('adding the same email again updates the phone and keeps the person\'s identity', () => {
  const before = loadDevices(paths.devicesPath).devices[0].uid;
  run(['device', 'add', '--email', 'ana@example.com', '--address', '100.64.0.99', '--udid', '00008130-000A1B2C3D4E5F60'], paths);
  const { devices } = loadDevices(paths.devicesPath);
  assert.equal(devices.length, 1);
  assert.deepEqual([devices[0].uid, devices[0].address, devices[0].name], [before, '100.64.0.99', 'Ana iPhone']);
});

await ok('bad input is refused with a reason, and nothing is written', () => {
  const count = () => loadDevices(paths.devicesPath).devices.length;
  assert.throws(() => run(['device', 'add', '--email', 'nope', '--address', '100.64.0.1', '--udid', '00008130-000A1B2C3D4E5F60'], paths), /not an email/);
  assert.throws(() => run(['device', 'add', '--email', 'b@c.d', '--address', '100.64.0.999', '--udid', '00008130-000A1B2C3D4E5F60'], paths), /not an IPv4/);
  assert.throws(() => run(['device', 'add', '--email', 'b@c.d', '--address', '100.64.0.1', '--udid', 'x; rm -rf /'], paths), /UDID/);
  assert.throws(() => run(['device', 'add', '--email', 'b@c.d'], paths), /--address is required/);
  assert.throws(() => run(['frobnicate'], paths), /usage:/);
  assert.equal(count(), 1);
});

await ok('the registry is what the server resolves a person\'s phone from', () => {
  const who = loadDevices(paths.devicesPath).devices[0];
  const r = createDeviceResolver({ loadRegistry: loadDevices, registryPath: paths.devicesPath });
  assert.deepEqual(r.resolve(who.uid), { state: 'enrolled', address: '100.64.0.99', udid: '00008130-000A1B2C3D4E5F60', email: 'ana@example.com', slot: who.uid });
  assert.equal(r.resolve('u_nobody').state, 'not_enrolled');
});

await ok('link-code mints a code that redeems to that person exactly once', () => {
  const out = run(['link-code', '--email', 'ana@example.com'], paths);
  const code = out[0].match(/Connect code: (\S+)/)[1];
  assert.match(code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(readFileSync(paths.storePath, 'utf8').includes(code.replace('-', '')), false, 'the code itself must not be stored, only its hash');
  const db = loadStore(paths.storePath);
  const who = redeemLinkCode(db, code.toLowerCase());
  assert.equal(who.email, 'ana@example.com');
  assert.equal(redeemLinkCode(db, code), null, 'a connect code worked twice');
});

await ok('link-code refuses someone with no phone registered', () => {
  assert.throws(() => run(['link-code', '--email', 'stranger@example.com'], paths), /no phone is registered/);
});

await ok('revoke and device remove both kill that person\'s assistant connections', () => {
  const uid = loadDevices(paths.devicesPath).devices[0].uid;
  const mint = () => { const db = loadStore(paths.storePath); const t = issueClientToken(db, { uid, email: 'ana@example.com', platform: 'claude' }).token; saveStore(db, paths.storePath); return t; };
  const t1 = mint();
  assert.ok(findClientByToken(loadStore(paths.storePath), t1));
  assert.match(run(['revoke', '--email', 'ana@example.com'], paths)[0], /Revoked 1/);
  assert.equal(findClientByToken(loadStore(paths.storePath), t1), null);
  const t2 = mint();
  assert.match(run(['device', 'remove', '--email', 'ana@example.com'], paths)[0], /Removed ana@example\.com; 1 assistant connection\(s\) revoked/);
  assert.equal(findClientByToken(loadStore(paths.storePath), t2), null, 'a removed phone left a live credential behind');
  assert.equal(loadDevices(paths.devicesPath).devices.length, 0);
  assert.match(run(['device', 'list'], paths)[0], /No phones registered/);
});

rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} phonectl assertions passed`);
