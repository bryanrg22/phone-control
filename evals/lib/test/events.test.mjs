#!/usr/bin/env node
// events.test.mjs — a trial's evidence reads the same compressed or not, and
// compressing a record loses nothing.

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readEvents, compressEvents } from '../events.mjs';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

const root = mkdtempSync(join(tmpdir(), 'events-test-'));
// A run: two cases, a trial each, plus a re-grade folder and a file named alike.
const EVENTS = [{ turn: 1, type: 'user', text: 'Text Sam — “quoted”, emoji 📱' }, { turn: 1, type: 'model_call', usage: { input_tokens: 10 } }];
const body = `${EVENTS.map((e) => JSON.stringify(e)).join('\n')}\n`;
for (const c of ['case-a', 'case-b']) { mkdirSync(join(root, c, 'trial-1'), { recursive: true }); writeFileSync(join(root, c, 'trial-1', 'events.jsonl'), body); writeFileSync(join(root, c, 'trial-1', 'state.json'), '{}'); }
writeFileSync(join(root, 'case-a', 'trial-1', 'events.jsonl.bak'), 'not events');

ok('a fresh trial is read from events.jsonl', () => assert.deepEqual(readEvents(join(root, 'case-a', 'trial-1')), EVENTS));

const r = compressEvents(root);
ok('every events.jsonl, at any depth, is replaced by events.jsonl.gz', () => {
  assert.equal(r.files, 2);
  for (const c of ['case-a', 'case-b']) {
    assert.ok(!existsSync(join(root, c, 'trial-1', 'events.jsonl')));
    assert.ok(existsSync(join(root, c, 'trial-1', 'events.jsonl.gz')));
  }
});
ok('nothing else is touched', () => {
  assert.equal(readFileSync(join(root, 'case-a', 'trial-1', 'events.jsonl.bak'), 'utf8'), 'not events');
  assert.equal(readFileSync(join(root, 'case-b', 'trial-1', 'state.json'), 'utf8'), '{}');
});
ok('a compressed trial reads back exactly (non-ASCII included)', () => assert.deepEqual(readEvents(join(root, 'case-b', 'trial-1')), EVENTS));
ok('compressing again finds nothing to do', () => assert.equal(compressEvents(root).files, 0));
ok('a trial with no events says so, naming the folder', () => {
  mkdirSync(join(root, 'empty'));
  assert.throws(() => readEvents(join(root, 'empty')), /no events\.jsonl or events\.jsonl\.gz in .*empty/);
});

rmSync(root, { recursive: true, force: true });
console.log(`\n${passed} passed`);
