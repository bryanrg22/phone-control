#!/usr/bin/env node
// tool-snapshots.test.mjs — the tools exactly as an assistant receives them.
//
// The tool list is the whole of what Claude learns about this server: Claude's
// apps do not pass a server's `instructions` to the model
// (anthropics/claude-ai-mcp#93), so the names, descriptions, input schemas and
// annotations ARE the instructions. A wording change there changes how the
// assistant behaves, so it must show up in review as a diff, never silently.
//
// The snapshot is server/test/__snapshots__/tools.json. When a change to the
// tools is intended, regenerate it and commit it with the change:
//
//   UPDATE_SNAPSHOTS=1 node server/test/tool-snapshots.test.mjs
//
// In CI a missing snapshot is a failure, so nothing can pass by being new.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createToolApi } from '../src/tool-api.mjs';
import { createMcpHandler } from '../src/mcp.mjs';
import { createRunStore } from '../src/runs.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(HERE, '__snapshots__', 'tools.json');
const UPDATE = process.env.UPDATE_SNAPSHOTS === '1';
const IN_CI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';

// Clients cut tool descriptions off past 2,048 characters, silently (reported
// for Claude Code; not part of the MCP spec). Stay well clear of it.
const DESCRIPTION_LIMIT = 2048;
const NAME = /^[a-z][a-z0-9_]{0,63}$/;

let passed = 0;
async function ok(name, fn) {
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); } catch (e) {
    console.error(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`);
    process.exitCode = 1;
  }
}

/** The tools/list result, through the real MCP handler, with every optional tool switched on. */
async function servedTools() {
  const api = createToolApi({
    store: createRunStore({}),
    devices: { status: async () => ({ ready: false, state: 'standby', message: '' }) },
    startRun: () => {},
    prefs: { modelFor: () => null, setModel: () => {} },
  });
  const mcp = createMcpHandler({ api });
  const res = await mcp.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { uid: 'snapshot' });
  return res.result.tools;
}

const tools = await servedTools();
const rendered = `${JSON.stringify(tools, null, 2)}\n`;

console.log('tool definitions as served');

await ok('matches the committed snapshot (UPDATE_SNAPSHOTS=1 to accept an intended change)', () => {
  if (UPDATE) {
    mkdirSync(dirname(SNAPSHOT), { recursive: true });
    writeFileSync(SNAPSHOT, rendered);
    console.log(`    wrote ${SNAPSHOT}`);
    return;
  }
  if (!existsSync(SNAPSHOT)) {
    assert.fail(`no snapshot at ${SNAPSHOT}${IN_CI ? '' : ' (run with UPDATE_SNAPSHOTS=1 to create it)'}`);
  }
  const committed = readFileSync(SNAPSHOT, 'utf8');
  if (committed === rendered) return;
  const before = JSON.parse(committed); const after = tools;
  const names = (list) => list.map((t) => t.name);
  const lines = [];
  for (const t of after) {
    const old = before.find((b) => b.name === t.name);
    if (!old) { lines.push(`+ new tool: ${t.name}`); continue; }
    for (const key of Object.keys({ ...old, ...t })) {
      if (JSON.stringify(old[key]) !== JSON.stringify(t[key])) lines.push(`~ ${t.name}.${key} changed`);
    }
  }
  for (const n of names(before)) if (!names(after).includes(n)) lines.push(`- removed tool: ${n}`);
  if (JSON.stringify(names(before)) !== JSON.stringify(names(after)) && !lines.length) lines.push('~ tool order changed');
  assert.fail(`the tools Claude sees have changed:\n${lines.join('\n')}\nIf intended: UPDATE_SNAPSHOTS=1 node server/test/tool-snapshots.test.mjs, and commit the snapshot.`);
});

await ok('every name is short, lowercase and unique', () => {
  const seen = new Set();
  for (const t of tools) {
    assert.match(t.name, NAME, `bad tool name "${t.name}"`);
    assert.ok(!seen.has(t.name), `duplicate tool name "${t.name}"`);
    seen.add(t.name);
  }
});

await ok(`every description, and every parameter description, fits in ${DESCRIPTION_LIMIT} characters`, () => {
  for (const t of tools) {
    assert.ok(t.description.length > 0, `${t.name} has no description`);
    assert.ok(t.description.length <= DESCRIPTION_LIMIT, `${t.name}: description is ${t.description.length} characters`);
    for (const [param, schema] of Object.entries(t.inputSchema.properties || {})) {
      assert.ok(String(schema.description || '').length <= DESCRIPTION_LIMIT, `${t.name}.${param}: description too long`);
    }
  }
});

await ok('every input schema is closed and lists its required fields', () => {
  for (const t of tools) {
    assert.equal(t.inputSchema.type, 'object', `${t.name}: input is not an object`);
    assert.equal(t.inputSchema.additionalProperties, false, `${t.name}: accepts undeclared arguments`);
    for (const r of t.inputSchema.required || []) {
      assert.ok(r in (t.inputSchema.properties || {}), `${t.name}: requires "${r}", which is not declared`);
    }
  }
});

// Clients use these to decide whether to ask the user before a call: Claude
// asks before destructive tools and may run read-only ones without asking.
// The spec's defaults are the pessimistic ones, so every hint is stated.
await ok('every tool states readOnlyHint, destructiveHint and openWorldHint', () => {
  for (const t of tools) {
    for (const hint of ['readOnlyHint', 'destructiveHint', 'openWorldHint']) {
      assert.equal(typeof t.annotations?.[hint], 'boolean', `${t.name}: ${hint} is not stated`);
    }
    assert.ok(!(t.annotations.readOnlyHint && t.annotations.destructiveHint), `${t.name}: read-only and destructive at once`);
  }
});

await ok('the tool that acts on the phone is marked destructive, so Claude asks before it by default', () => {
  const run = tools.find((t) => t.name === 'run_phone_task');
  assert.ok(run, 'run_phone_task is missing');
  assert.equal(run.annotations.destructiveHint, true);
  assert.equal(run.annotations.readOnlyHint, false);
});

await ok('the tools that only look are marked read-only', () => {
  for (const name of ['get_phone_status', 'get_run_status']) {
    assert.equal(tools.find((t) => t.name === name)?.annotations.readOnlyHint, true, `${name} is not read-only`);
  }
});

console.log(`\n${passed} tool-definition assertions passed`);
