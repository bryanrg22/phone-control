#!/usr/bin/env node
// matrix.mjs — the connector evals for several models at once, then the comparison.
//
//   node evals/connector/matrix.mjs                         the newest models of each company
//   node evals/connector/matrix.mjs --models claude-opus-5-5,gpt-6.1-sol --trials 3 --cases hitl
//   node evals/connector/matrix.mjs --dry-run               what would run, and the preflight
//
// Each model runs as its own run.mjs process, in parallel (each trial has its
// own server and simulated phone, so runs cannot disturb each other), named
// <date>_<commit>_<model>_<effort> so every result says which code produced it.
// Afterwards compare.mjs writes evals/results/connector/compare-<date>_<commit>.md.
//
// Refuses to start from uncommitted changes (a result must name the code that
// produced it), and checks first, with one tiny request per provider, that
// every key works: on 2026-10-16 an exhausted OpenAI balance surfaced only as
// a test error inside the first trial, after the other provider's runs had
// started spending.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };

// The newest model of each family, as of 2026-10-16.
export const NEWEST = ['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'];
const models = (opt('models', '') || '').split(',').filter(Boolean);
const list = models.length ? models : NEWEST;
const effort = opt('effort', 'high');
const trials = opt('trials', '3');
const cases = opt('cases', null);
const userModel = opt('user-model', 'gpt-6.1-sol');
const dryRun = argv.includes('--dry-run');

const familyOf = (m) => (m.startsWith('claude') ? 'anthropic' : m.startsWith('gpt') ? 'openai' : null);
for (const m of list) if (!familyOf(m)) { console.error(`unknown model family: ${m}`); process.exit(2); }

const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
const dirty = git('status', '--porcelain', '--untracked-files=no');
if (dirty && !argv.includes('--allow-dirty')) { console.error(`uncommitted changes; commit first so every result names its code (or --allow-dirty):\n${dirty}`); process.exit(2); }
const commit = git('rev-parse', '--short=7', 'HEAD');
const date = new Date().toISOString().slice(0, 10);

// ─── preflight: one tiny request per provider in use ───
// Assistants, the cross-family judges and the simulated user all count.
const providers = new Set(list.map(familyOf));
for (const m of list) providers.add(familyOf(m) === 'anthropic' ? 'openai' : 'anthropic');   // the judge
providers.add(familyOf(userModel));
async function preflight(provider) {
  try {
    if (provider === 'openai') {
      const OpenAI = (await import('openai')).default;
      await new OpenAI({ maxRetries: 0 }).responses.create({ model: 'gpt-6-luna', input: 'Reply with: ok', max_output_tokens: 16, store: false });
    } else {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      await new Anthropic({ maxRetries: 0 }).messages.create({ model: 'claude-haiku-5-5', max_tokens: 8, messages: [{ role: 'user', content: 'Reply with: ok' }] });
    }
    return null;
  } catch (e) { return `${provider}: ${e.status ?? ''} ${String(e.message).slice(0, 160)}`; }
}
const problems = (await Promise.all([...providers].map(preflight))).filter(Boolean);
if (problems.length) { console.error(`preflight failed, nothing started:\n  ${problems.join('\n  ')}`); process.exit(2); }

const runs = list.map((m) => ({
  model: m,
  name: `${date}_${commit}_${m}_${effort}`,
  args: [join(HERE, 'run.mjs'), '--assistant', familyOf(m) === 'anthropic' ? 'claude' : 'openai', '--model', m, '--effort', effort, '--trials', trials, '--user-model', userModel,
    '--run', `${date}_${commit}_${m}_${effort}`, ...(cases ? ['--cases', cases] : [])],
}));
console.log(`connector matrix at ${commit}: ${list.length} model(s) × ${trials} trial(s)${cases ? `, cases ${cases}` : ''}, simulated user ${userModel}; preflight ok (${[...providers].join(', ')})`);
for (const r of runs) console.log(`  ${r.name}`);
if (dryRun) process.exit(0);

const logDir = join(REPO, 'evals', 'results', 'connector', `matrix-${date}_${commit}`);
mkdirSync(logDir, { recursive: true });
const t0 = Date.now();
const results = await Promise.all(runs.map((r) => new Promise((resolve) => {
  const log = createWriteStream(join(logDir, `${r.model}.log`));
  const child = spawn(process.execPath, r.args, { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log); child.stderr.pipe(log);
  child.on('close', (code) => { console.log(`  ${code === 0 ? 'done  ' : `exit ${code}`} ${r.model}  (${Math.round((Date.now() - t0) / 60000)} min)`); resolve({ ...r, code }); });
})));

const finished = results.filter((r) => r.code === 0).map((r) => join(REPO, 'evals', 'results', 'connector', r.name));
const out = join(REPO, 'evals', 'results', 'connector', `compare-${date}_${commit}.md`);
if (finished.length) execFileSync(process.execPath, [join(HERE, 'compare.mjs'), ...finished, '--out', out], { cwd: REPO, stdio: 'ignore' });
console.log(`\n${finished.length}/${runs.length} runs finished · logs ${logDir}${finished.length ? `\ncomparison: ${out}` : ''}`);
process.exit(finished.length === runs.length ? 0 : 1);
