#!/usr/bin/env node
// record-tests.mjs — run every test suite and file the evidence under the exact version tested.
//
//   npm run test:record
//   node scripts/record-tests.mjs --evals evals/results/connector/<run> [--evals …] [--note "why this run"]
//   node scripts/record-tests.mjs --skip lifecycle,e2e          (a quicker record, marked as partial)
//
// Writes test-results/v<release>/<date>_<commit>/ and never overwrites one:
//
//   RECORD.md           what was tested, at which version, with what result
//   record.json         the same, for tools
//   suites/<name>.log   the complete output of each suite
//   evals/<run>/        complete evidence of each included eval run (transcripts, server logs,
//                       and events as events.jsonl.gz: every model exchange, compressed)
//   record.png          the results page as an image (needs Google Chrome; skipped if absent)
//
// Each record names what changed since the previous record (commits, and
// whether the tools an assistant sees changed), so "what got tested" and "what
// got updated" can always be lined up. Eval runs carry the commit they ran on;
// when that differs from the recorded commit, the record says so and lists
// what changed in between.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, cpSync, statSync, rmSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release as osRelease, homedir } from 'node:os';

import { createToolApi } from '../server/src/tool-api.mjs';
import { createMcpHandler, servedTools } from '../server/src/mcp.mjs';
import { createRunStore } from '../server/src/runs.mjs';
import { releaseOf, toolsFingerprint } from '../server/src/version.mjs';
import { compressEvents } from '../evals/lib/events.mjs';
import { evalRows } from './lib/eval-rows.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const all = (name) => argv.flatMap((a, i) => (a === `--${name}` ? [argv[i + 1]] : []));
const skip = new Set((all('skip')[0] || '').split(',').filter(Boolean));
// Every argument must be a known flag or its value: an unknown one used to be
// ignored, so "--evals a --evals b" passed as one word filed a record without
// its evals and still reported success (2026-10-16).
const FLAGS = new Set(['--skip', '--evals', '--note']);
for (let i = 0; i < argv.length; i += 2) {
  if (!FLAGS.has(argv[i]) || argv[i + 1] === undefined) { console.error(`unknown or incomplete argument: ${JSON.stringify(argv[i])} (expected ${[...FLAGS].join(', ')}, each with a value)`); process.exit(2); }
}
const evalRuns = all('evals').map((p) => resolve(p));
for (const run of evalRuns) if (!existsSync(join(run, 'run_info.json'))) { console.error(`not an eval run folder (no run_info.json): ${run}`); process.exit(2); }
const note = all('note')[0] || '';

const git = (...args) => { try { return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } };

const SUITES = [
  { name: 'lint', cmd: ['npm', 'run', 'lint'] },
  { name: 'unit', cmd: ['npm', 'test'] },
  { name: 'lifecycle', cmd: ['npm', 'run', 'test:lifecycle'] },
  { name: 'e2e', cmd: ['npm', 'run', 'test:e2e'] },
  { name: 'conformance', cmd: ['npm', 'run', 'test:conformance'] },
  { name: 'eval-harness-self-test', cmd: ['npm', 'run', 'test:evals:self'] },
];

/** Best-effort counts from a suite's own summary lines. */
function countsFrom(log) {
  const strip = log.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), ''); // colour codes
  const node = strip.match(/ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/);
  if (node) return { passed: Number(node[1]), failed: Number(node[2]) };
  const ours = [...strip.matchAll(/(\d+) passed · (\d+) failed(?: · (\d+) skipped)?/g)];
  if (ours.length) {
    return ours.reduce((a, m) => ({ passed: a.passed + Number(m[1]), failed: a.failed + Number(m[2]), skipped: (a.skipped || 0) + Number(m[3] || 0) }), { passed: 0, failed: 0 });
  }
  const self = [...strip.matchAll(/Assistant: (\w+)[^\n]*\n[\s\S]*?pass@1 (\d+)%[^\n]*?(\d+) graded trials/g)];
  if (self.length) return Object.fromEntries(self.map((m) => [`${m[1]} assistant`, `${m[2]}% of ${m[3]} trials passed`]));
  const conf = strip.match(/Total: (\d+) passed, (\d+) failed/);
  if (conf) return { passed: Number(conf[1]), failed: 0, expected_failures: Number(conf[2]) };
  return null;
}

// Records are published, so a suite's output is cleaned before it is filed:
// sign-in tokens of the throwaway test servers (they print in URLs) and this
// machine's paths. TOKEN matches what server/src/auth.mjs mints.
const TOKEN = /iac_[A-Za-z0-9_-]{16,}/g;
const redact = (text) => text
  .replace(TOKEN, 'iac_<redacted>')
  .replace(/Bearer [A-Za-z0-9._~+/=-]{16,}/g, 'Bearer <redacted>')
  .split(REPO).join('<repo>')
  .split(homedir()).join('~');

/** Every file under a folder, for the final check that nothing secret is filed. */
const filesUnder = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(join(d, e.name)) : [join(d, e.name)]));

function runSuite({ name, cmd }, dir) {
  return new Promise((done) => {
    const t0 = Date.now();
    let out = '';
    const c = spawn(cmd[0], cmd.slice(1), { cwd: REPO, env: { ...process.env, FORCE_COLOR: '0' } });
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => {
      writeFileSync(join(dir, 'suites', `${name}.log`), redact(out));
      const notVerified = [...out.matchAll(/skipped \(NOT verified here\): (.*)/g)].flatMap((m) => m[1].split(' | '));
      done({ name, command: cmd.join(' '), exit_code: code, ok: code === 0, seconds: Math.round((Date.now() - t0) / 1000), counts: countsFrom(out), not_verified: notVerified });
    });
  });
}

async function servedToolsNow() {
  const api = createToolApi({ store: createRunStore({}), devices: { status: async () => ({}) }, startRun: () => {}, prefs: { modelFor: () => null, setModel: () => {} } });
  const res = await createMcpHandler({ api }).handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { uid: 'record' });
  return res.result.tools;
}

function previousRecord() {
  const root = join(REPO, 'test-results');
  if (!existsSync(root)) return null;
  const records = [];
  for (const v of readdirSync(root)) {
    const vdir = join(root, v);
    if (!statSync(vdir).isDirectory()) continue;
    for (const r of readdirSync(vdir)) {
      const f = join(vdir, r, 'record.json');
      if (existsSync(f)) records.push(JSON.parse(readFileSync(f, 'utf8')));
    }
  }
  return records.sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)).pop() || null;
}

const countText = (c) => (c ? Object.entries(c).map(([k, v]) => (typeof v === 'number' ? `${v} ${k.replace('_', ' ')}` : `${k}: ${v}`)) : []);
const notVerifiedOf = (suites) => suites.flatMap((s) => (s.not_verified || []).map((t) => `${s.name}: ${t}`));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function renderHtml(r) {
  const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
  const badge = (ok) => `<span class="b ${ok ? 'ok' : 'bad'}">${ok ? 'PASS' : 'FAIL'}</span>`;
  const counts = (c) => countText(c).join(' · ');
  return `<!doctype html><meta charset="utf-8"><title>Test record ${esc(r.release)}</title>
<style>body{font:15px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;margin:0;padding:28px 32px;background:#fbfaf7;color:#1f2328;width:1100px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:26px 0 8px}.sub{color:#57606a;margin-bottom:6px}
table{border-collapse:collapse;width:100%;background:#fff;border:1px solid #d0d7de;border-radius:8px}td,th{padding:7px 10px;border-bottom:1px solid #eaeef2;text-align:left;vertical-align:top}th{background:#f6f8fa;font-weight:600}
.b{display:inline-block;padding:1px 8px;border-radius:10px;font-weight:600;font-size:12.5px}.ok{background:#dafbe1;color:#1a7f37}.bad{background:#ffebe9;color:#cf222e}code{font:13px ui-monospace,Menlo,monospace}</style>
<h1>phone-control ${esc(r.release)} — test record</h1>
<div class="sub">commit <code>${esc(r.commit)}</code>${r.dirty ? ' (with uncommitted changes)' : ''} · recorded ${esc(r.recorded_at)} · ${esc(r.environment.platform)} · Node ${esc(r.environment.node)}</div>
<div class="sub">tools an assistant sees: <code>${esc(r.tools_fingerprint)}</code>${r.changes.tools_changed === null ? '' : r.changes.tools_changed ? ' — <b>changed since the previous record</b>' : ' — unchanged since the previous record'}</div>
${r.note ? `<div class="sub">${esc(r.note)}</div>` : ''}
<h2>Suites</h2><table><tr><th>suite</th><th>result</th><th>counts</th><th>time</th><th>command</th></tr>
${r.suites.map((s) => row([esc(s.name), s.skipped ? 'skipped' : badge(s.ok), esc(counts(s.counts)), s.skipped ? '' : `${s.seconds}s`, `<code>${esc(s.command || '')}</code>`])).join('')}</table>
${notVerifiedOf(r.suites).length ? `<h2>Not verified by this record</h2><table>${notVerifiedOf(r.suites).map((t) => row([esc(t)])).join('')}</table>` : ''}
${r.evals.length ? `<h2>Evals</h2><table><tr><th>run</th><th>assistant</th><th>judge</th><th>pass@1 (95%)</th><th>pass^k</th><th>trials</th><th>ran on</th></tr>
${r.evals.map((e) => row([esc(e.run), esc(e.assistant), esc(e.judge), esc(`${e.pass_at_1}${e.regraded ? ` → ${e.regraded.pass_at_1} re-graded` : ''}`), esc(`${e.pass_hat_k}${e.regraded ? ` → ${e.regraded.pass_hat_k}` : ''}`), esc(e.trials), `<code>${esc(e.commit)}</code>${e.differs_from_record ? ' (earlier commit)' : ''}`])).join('')}</table>` : ''}
<h2>Changed since the previous record</h2>
<div class="sub">${r.changes.previous ? `previous: ${esc(r.changes.previous.release)} at <code>${esc(r.changes.previous.commit)}</code>` : 'first record'}</div>
<table>${(r.changes.commits.length ? r.changes.commits : ['(no commits listed)']).map((c) => row([`<code>${esc(c)}</code>`])).join('')}</table>`;
}

// ─── record ──────────────────────────────────────────────────────────────────
const release = releaseOf(REPO);
const commit = git('rev-parse', 'HEAD');
const dirty = (git('status', '--porcelain') || '').length > 0;
const stamp = new Date().toISOString();
const dir = join(REPO, 'test-results', `v${release}`, `${stamp.slice(0, 10)}_${commit.slice(0, 7)}${dirty ? '_dirty' : ''}`);
if (existsSync(dir)) { console.error(`${dir} already exists; records are never overwritten`); process.exit(2); }
mkdirSync(join(dir, 'suites'), { recursive: true });
if (dirty) console.log('!! the working tree has uncommitted changes: this record will say so. Commit first for a clean record.\n');

console.log(`test record — phone-control ${release} at ${commit.slice(0, 12)}${dirty ? ' (dirty)' : ''}\n  ${dir}\n`);
const suites = [];
for (const s of SUITES) {
  if (skip.has(s.name)) { suites.push({ name: s.name, skipped: true }); console.log(`  –    ${s.name} (skipped)`); continue; }
  const r = await runSuite(s, dir);
  suites.push(r);
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'} ${s.name}  (${r.seconds}s${r.counts ? `, ${JSON.stringify(r.counts)}` : ''})`);
}

const tools = await servedToolsNow();
const toolsFp = toolsFingerprint(servedTools(tools));
const prev = previousRecord();
const changes = {
  previous: prev ? { release: prev.release, commit: prev.commit, recorded_at: prev.recorded_at } : null,
  commits: prev ? (git('log', '--oneline', `${prev.commit}..${commit}`) || '').split('\n').filter(Boolean) : (git('log', '--oneline', '-15') || '').split('\n').filter(Boolean),
  tools_changed: prev ? prev.tools_fingerprint !== toolsFp : null,
};

const evals = [];
try {
  for (const run of evalRuns) {
    const info = JSON.parse(readFileSync(join(run, 'run_info.json'), 'utf8'));
    const summary = JSON.parse(readFileSync(join(run, 'summary.json'), 'utf8'));
    // A run re-graded after a case was corrected (evals/connector/regrade.mjs)
    // is shown with its latest re-grade beside the original, never instead of it.
    const latestRegrade = readdirSync(run).filter((d) => d.startsWith('regrade-') && existsSync(join(run, d, 'summary.json'))).sort().at(-1) ?? null;
    const regraded = latestRegrade ? JSON.parse(readFileSync(join(run, latestRegrade, 'summary.json'), 'utf8')) : null;
    // Rows first (a run the record cannot describe fails here, before anything is copied).
    evals.push(...evalRows({
      runName: basename(run), info, summary, regraded, regradedFolder: latestRegrade, recordCommit: commit,
      changedSince: (from, to) => (git('diff', '--stat', from, to, '--', 'server', 'device', 'agent', 'evals') || '').split('\n').slice(-1)[0].trim(),
    }));
    cpSync(run, join(dir, 'evals', basename(run)), { recursive: true });
    // The raw model exchanges are most of a run's size: kept, compressed (evals/lib/events.mjs).
    compressEvents(join(dir, 'evals', basename(run)));
  }
} catch (e) {
  // A record is complete or absent: never a folder with the suites and no RECORD.md (2026-10-16).
  rmSync(dir, { recursive: true, force: true });
  console.error(`\ncould not file the evals, record removed: ${e.message}`);
  process.exit(1);
}

const record = {
  release, commit, dirty, recorded_at: stamp, note,
  tools_fingerprint: toolsFp,
  environment: {
    node: process.version, platform: `${platform()} ${osRelease()} ${process.arch}`,
    xcode: platform() === 'darwin' ? (() => { try { return execFileSync('xcodebuild', ['-version'], { encoding: 'utf8' }).split('\n')[0]; } catch { return null; } })() : null,
  },
  suites, evals, changes,
  complete: suites.every((s) => !s.skipped),
  all_passed: suites.every((s) => s.skipped || s.ok),
};
writeFileSync(join(dir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
writeFileSync(join(dir, 'tools.json'), `${JSON.stringify(tools, null, 2)}\n`);

const md = [
  `# phone-control ${release} — test record`, '',
  `- **Commit:** \`${commit}\`${dirty ? ' (with uncommitted changes)' : ''}`,
  `- **Recorded:** ${stamp} on ${record.environment.platform}, Node ${process.version}${record.environment.xcode ? `, ${record.environment.xcode}` : ''}`,
  `- **Tools an assistant sees:** \`${toolsFp}\` (full list in \`tools.json\`)${changes.tools_changed === null ? '' : changes.tools_changed ? ' — **changed since the previous record**' : ' — unchanged since the previous record'}`,
  `- **Result:** ${record.all_passed ? 'every suite passed' : 'SOME SUITES FAILED'}${record.complete ? '' : ' (partial record: some suites were skipped)'}`,
  ...(note ? [`- **Note:** ${note}`] : []), '',
  '## Suites', '', '| suite | result | counts | time | full output |', '| --- | --- | --- | --- | --- |',
  ...suites.map((s) => `| ${s.name} | ${s.skipped ? 'skipped' : s.ok ? 'PASS' : 'FAIL'} | ${countText(s.counts).join(', ')} | ${s.skipped ? '' : `${s.seconds}s`} | ${s.skipped ? '' : `[suites/${s.name}.log](suites/${s.name}.log)`} |`), '',
  ...(notVerifiedOf(suites).length ? ['## Not verified by this record', '', 'These scenarios were skipped on this machine, so nothing here vouches for them:', '', ...notVerifiedOf(suites).map((t) => `- ${t}`), ''] : []),
  ...(evals.length ? ['## Evals', '', '| run | assistant | judge | pass@1 (95% interval) | pass^k | trials | ran on commit |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...evals.map((e) => `| [${e.run}](evals/${e.run}/summary.md) | ${e.assistant} | ${e.judge} | ${e.pass_at_1}${e.regraded ? ` → **${e.regraded.pass_at_1}** re-graded` : ''} | ${e.pass_hat_k}${e.regraded ? ` → **${e.regraded.pass_hat_k}**` : ''} | ${e.trials} | \`${e.commit}\`${e.differs_from_record ? ` (earlier; since then: ${e.changed_since_eval || 'no changes in server, device, agent or evals'})` : ''} |`), ''] : []),
  '## Changed since the previous record', '',
  changes.previous ? `Previous record: ${changes.previous.release} at \`${changes.previous.commit.slice(0, 12)}\` (${changes.previous.recorded_at}).` : 'This is the first record; the most recent commits are listed.', '',
  ...changes.commits.map((c) => `- \`${c.slice(0, 7)}\` ${c.slice(8)}`), '',
];
writeFileSync(join(dir, 'RECORD.md'), md.join('\n'));

// The results page as an image, so the evidence can be shown, not only read.
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const html = join(dir, 'record.html');
writeFileSync(html, renderHtml(record));
if (existsSync(chrome)) {
  try {
    execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
      '--window-size=1164,1400', `--screenshot=${join(dir, 'record.png')}`, `file://${html}`], { stdio: 'ignore', timeout: 60000 });
  } catch { /* the image is a convenience; the record stands without it */ }
}

// Last line of defence before anything is committed: no token survives anywhere in the record.
const leaks = filesUnder(dir).filter((f) => !f.endsWith('.png') && new RegExp(TOKEN.source).test(readFileSync(f, 'utf8')));
if (leaks.length) {
  console.error(`\nA sign-in token is in ${leaks.map((f) => f.slice(dir.length + 1)).join(', ')}. Do not commit this record; fix the redaction and record again.`);
  process.exit(1);
}

// An index of every record, newest first.
const root = join(REPO, 'test-results');
const rows = [];
for (const v of readdirSync(root).sort().reverse()) {
  const vdir = join(root, v);
  if (!statSync(vdir).isDirectory()) continue;
  for (const r of readdirSync(vdir).sort().reverse()) {
    const f = join(vdir, r, 'record.json');
    if (!existsSync(f)) continue;
    const rec = JSON.parse(readFileSync(f, 'utf8'));
    rows.push(`| [${v}/${r}](${v}/${r}/RECORD.md) | ${rec.release} | \`${rec.commit.slice(0, 7)}\`${rec.dirty ? ' (dirty)' : ''} | ${rec.all_passed ? 'all passed' : 'failures'}${rec.complete ? '' : ' (partial)'} | ${rec.evals.length} | ${rec.recorded_at.slice(0, 16).replace('T', ' ')} |`);
  }
}
writeFileSync(join(root, 'README.md'), ['# Test records', '', 'One folder per test run, filed under the release it tested. Each holds the full output of every suite, the complete evidence of any eval runs, and what changed since the record before it. Created with `npm run test:record`; never edited afterwards.', '',
  '| record | release | commit | result | eval runs | recorded (UTC) |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n'));

console.log(`\n${record.all_passed ? 'every suite passed' : 'SOME SUITES FAILED'} — ${join(dir, 'RECORD.md')}`);
process.exit(record.all_passed ? 0 : 1);
