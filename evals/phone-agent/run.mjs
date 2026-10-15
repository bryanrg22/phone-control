#!/usr/bin/env node
// run.mjs — the phone agent on iOSWorld's apps and tasks, scored by iOSWorld's judge.
//
//   node evals/phone-agent/run.mjs --models anthropic:claude-opus-5-5 --tasks clock-001 --udid <sim> --driver-port 22187
//   node evals/phone-agent/run.mjs --models anthropic:claude-opus-5-5,openai:gpt-6-astra --tasks all
//   node evals/phone-agent/run.mjs --tasks single_app --trials 3 ...       a category: single_app | multi_app | memory
//   node evals/phone-agent/run.mjs --judge-only <run folder>               re-score without re-running
//
// What is iOSWorld's, used unchanged (github.com/ljang0/iOSWorld, Apache-2.0):
// the 26 apps, the 133 tasks and their rubrics (tasks.json), the reset before
// every task (iosworld_reset.py calls their code), the 50-step budget with no
// time limit, and the judge (scripts/judge_trajectories.py, GPT-5.4 Mini by
// default, the judge they validated against human labels). A task passes when
// every rubric criterion holds; that and the rubric score are their metrics.
//
// What is ours: the agent, run exactly as the server runs it on a phone
// (agent/agent.mjs with the phone toolset, single-image mode, guard off),
// except that the simulator is the device and nobody answers its questions
// (--askuser-timeout 1: an unanswered question returns "no answer").
//
// Output (never overwritten): evals/results/phone-agent/<run>/
//   run_info.json                              versions, protocol, models, judge
//   <provider>_<model>/trial-<k>/              one iOSWorld run folder, judged by their script
//       summary.json                           iOSWorld's summary (pass rate, rubric score)
//       <NN>-<task>/task.json, trajectory.json iOSWorld's format
//       <NN>-<task>/agent-trace/               every image the model saw, steps.jsonl
//       <NN>-<task>/final.png                  the screen when the run ended
//       <NN>-<task>/app-state/                 every app's saved data after the run
//       <NN>-<task>/agent.log, record.json     the agent's output; our timing, tokens, exit
//   summary.json, summary.md                   every model side by side, by category
//
// Needs: a simulator prepared by iOSWorld's bootstrap, our runner running on
// it (see README), OPENAI_API_KEY (the judge and the apps' own replies) and
// the key of each model under test.

import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync, readdirSync, cpSync, createWriteStream } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';

import { toTrajectory, readSteps, outcomeOf, usageOf } from './trajectory.mjs';
import { wilson } from '../lib/stats.mjs';
import { costOf, PRICES_AS_OF } from '../lib/prices.mjs';

export const HARNESS_VERSION = '0.1.0';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

// iOSWorld's protocol (paper §4; scripts/bootstrap_release.sh): 50 steps, no time limit.
export const PROTOCOL = { max_steps: 50, time_limit: 'none', start: 'home screen, every app reset and reseeded', judge_default: 'gpt-5.4-mini' };

// ─── arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const IOSWORLD = resolve(opt('iosworld', process.env.IOSWORLD_DIR || join(homedir(), 'dev', 'GitHub', 'iOSWorld')));
const PY = join(IOSWORLD, '.venv', 'bin', 'python');
const udid = opt('udid', process.env.IOSWORLD_UDID);
const driverPort = opt('driver-port', '22187');
const trials = Number(opt('trials', '1'));
const judgeModel = opt('judge-model', PROTOCOL.judge_default);
// A run that hangs is an infrastructure fault, not a slow agent: generous, and
// recorded as a test error, never as a failure.
const hangLimitMin = Number(opt('hang-limit-min', '45'));
const models = (opt('models', '') || '').split(',').filter(Boolean).map((m) => {
  const [provider, ...rest] = m.split(':');
  return { provider, model: rest.join(':') };
});
const judgeOnly = opt('judge-only', null);

const run = (cmd, args, o = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...o }).trim();
const git = (dir, ...a) => { try { return run('git', ['-C', dir, ...a]); } catch { return null; } };
const slug = (s) => s.replace(/[^a-zA-Z0-9.-]+/g, '-');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── tasks ───────────────────────────────────────────────────────────────────
const TASKS_FILE = join(IOSWORLD, 'tasks.json');
const allTasks = JSON.parse(readFileSync(TASKS_FILE, 'utf8'));
function selectTasks(spec) {
  if (!spec || spec === 'all') return allTasks;
  const parts = spec.split(',');
  const picked = allTasks.filter((t) => parts.some((p) => t.name === p || t.category === p));
  const unknown = parts.filter((p) => !allTasks.some((t) => t.name === p || t.category === p));
  if (unknown.length) throw new Error(`no task or category named ${unknown.join(', ')}`);
  return picked;
}

// ─── the judge: iOSWorld's own script ────────────────────────────────────────
function judge(runDir) {
  const out = run(PY, [join(IOSWORLD, 'scripts', 'judge_trajectories.py'), '--run-dir', runDir, '--tasks', TASKS_FILE, '--judge-model', judgeModel, '--judge-provider', 'openai'],
    { cwd: IOSWORLD, maxBuffer: 64 * 1024 * 1024 });
  writeFileSync(join(runDir, 'judge.log'), `${out}\n`);
  return JSON.parse(readFileSync(join(runDir, 'summary.json'), 'utf8'));
}

// ─── one task ────────────────────────────────────────────────────────────────
async function runner(path, body) {
  const r = await fetch(`http://127.0.0.1:${driverPort}${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`runner ${path} → HTTP ${r.status}`);
  return r;
}

/** Copy every iOSWorld app's saved data, for checking the outcome against the apps' own state later. */
function saveAppState(dest) {
  const manifest = JSON.parse(readFileSync(join(IOSWORLD, 'iphone', 'bootstrap', '.app_manifest.json'), 'utf8'));
  for (const [app, { bundle_id: bid }] of Object.entries(manifest)) {
    try {
      const container = run('xcrun', ['simctl', 'get_app_container', udid, bid, 'data']);
      const docs = join(container, 'Documents');
      if (existsSync(docs)) cpSync(docs, join(dest, app), { recursive: true });
    } catch { /* an app with no data container yet: nothing to save */ }
  }
}

async function runTask({ task, index, model, taskDir }) {
  mkdirSync(taskDir, { recursive: true });
  const record = { task: task.name, category: task.category, difficulty: task.difficulty, apps: task.apps, provider: model.provider, model: model.model };
  const t0 = Date.now();

  // 1. iOSWorld's start state.
  try {
    const reset = JSON.parse(run(PY, [join(HERE, 'iosworld_reset.py'), '--iosworld', IOSWORLD, '--udid', udid], { timeout: 10 * 60 * 1000 }).split('\n').pop());
    if (!reset.ok) throw new Error(reset.error);
    record.reset_seconds = reset.seconds;
    await runner('/pressButton', { button: 'home' });
    await sleep(1000);
  } catch (e) {
    return finish({ status: 'error', error: `reset failed: ${e.message}` });
  }

  // 2. The agent, as the server runs it on a phone; fresh state so no trial sees another.
  const traceDir = join(taskDir, 'agent-trace');
  const stateDir = mkdtempSync(join(tmpdir(), 'phone-agent-eval-state-'));
  const args = [join(REPO, 'agent', 'agent.mjs'), task.goal,
    '--provider', model.provider, '--model', model.model,
    '--backend', 'direct-http-sim', '--device-profile', 'phone', '--udid', udid, '--driver-port', driverPort,
    '--max-steps', String(PROTOCOL.max_steps), '--agent-mode', 'single-image', '--runtime-guard', 'off',
    '--askuser-timeout', '1', '--trace-dir', traceDir, '--log-run-id', `${slug(model.model)}-${task.name}`];
  record.agent_args = args.slice(1).map((a) => (a === task.goal ? '<goal>' : a));
  const agentStart = Date.now();
  const log = createWriteStream(join(taskDir, 'agent.log'));
  const exit = await new Promise((done) => {
    const c = spawn(process.execPath, args, { cwd: REPO, env: { ...process.env, PHONE_CONTROL_STATE_DIR: stateDir } });
    c.stdout.pipe(log); c.stderr.pipe(log);
    const hang = setTimeout(() => { c.kill('SIGTERM'); done({ code: null, hung: true }); }, hangLimitMin * 60 * 1000);
    c.on('close', (code) => { clearTimeout(hang); done({ code, hung: false }); });
  });
  rmSync(stateDir, { recursive: true, force: true });
  record.agent_seconds = Math.round((Date.now() - agentStart) / 1000);
  record.exit_code = exit.code;

  // 3. The end state: the screen, and what every app saved.
  const finalShot = join(taskDir, 'final.png');
  try { run('xcrun', ['simctl', 'io', udid, 'screenshot', finalShot]); } catch { /* recorded as missing */ }
  saveAppState(join(taskDir, 'app-state'));

  // 4. iOSWorld's format.
  const steps = readSteps(traceDir);
  const outcome = outcomeOf(steps);
  // Without a final tool call, the agent's own log says why it stopped: its
  // no-progress stop (a product feature, kept as the server runs it) or the budget.
  if (outcome.ended === 'no_conclusion') {
    const agentLog = readFileSync(join(taskDir, 'agent.log'), 'utf8');
    if (agentLog.includes('no-progress circuit breaker')) outcome.ended = 'stopped_no_progress';
    else if (agentLog.includes('Max steps reached')) outcome.ended = 'step_budget';
  }
  Object.assign(record, usageOf(steps), { ended: outcome.ended });
  record.cost_usd = costOf(model.provider, model.model, record);
  writeFileSync(join(taskDir, 'trajectory.json'), JSON.stringify(toTrajectory(traceDir, existsSync(finalShot) ? finalShot : null), null, 2));

  // Exit 42: the model API failed for good; 43: the device connection died; a
  // hang: something stopped answering. None of these is the agent failing the
  // task, so the judge skips them and they are reported as test errors.
  if (exit.hung) return finish({ status: 'error', error: `no exit after ${hangLimitMin} minutes` });
  if (exit.code === 42) return finish({ status: 'error', error: 'model API failed (exit 42), see agent.log' });
  if (exit.code === 43) return finish({ status: 'error', error: 'device connection died (exit 43), see agent.log' });
  if (!steps.length) return finish({ status: 'error', error: `the agent recorded no steps (exit ${exit.code}), see agent.log` });
  return finish({ status: 'ok', answer: outcome.answer });

  function finish({ status, error = null, answer = null }) {
    record.status = status; record.error = error; record.total_seconds = Math.round((Date.now() - t0) / 1000);
    writeFileSync(join(taskDir, 'record.json'), `${JSON.stringify(record, null, 2)}\n`);
    // iOSWorld's task.json: the judge reads task, goal, status and agent_answer.
    writeFileSync(join(taskDir, 'task.json'), `${JSON.stringify({ index, task: task.name, goal: task.goal, apps: task.apps, category: task.category, status, error, agent_answer: answer }, null, 2)}\n`);
    console.log(`  ${status === 'ok' ? '·' : '!'} ${task.name.padEnd(14)} ${status === 'ok' ? `${record.ended}, ${record.steps} steps` : error}  (${record.total_seconds}s)`);
    return record;
  }
}

// ─── summary across models ───────────────────────────────────────────────────
function summarize(outRoot, cells) {
  const rows = [];
  for (const { model, trial, dir } of cells) {
    const s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
    const records = readdirSync(dir).filter((d) => existsSync(join(dir, d, 'record.json'))).map((d) => JSON.parse(readFileSync(join(dir, d, 'record.json'), 'utf8')));
    const ev = Object.fromEntries((s.tasks || []).map((t) => [t.task, t.evaluation]));
    const passed = (t) => { const e = ev[t]; return !!e && (e.rubric_results ? e.rubric_results.length > 0 && e.rubric_results.every((r) => r.satisfied) : !!e.success); };
    const byCat = {};
    for (const r of records) {
      if (r.status !== 'ok') continue;
      const c = (byCat[r.category] ||= { n: 0, pass: 0, steps: 0 });
      c.n += 1; c.steps += r.steps; if (passed(r.task)) c.pass += 1;
    }
    const ok = records.filter((r) => r.status === 'ok');
    const n = ok.length; const p = ok.filter((r) => passed(r.task)).length;
    rows.push({
      provider: model.provider, model: model.model, trial,
      tasks: records.length, judged: n, test_errors: records.length - n,
      pass_rate: n ? p / n : null, pass_ci95: wilson(p, n), rubric_score: s.judge?.rubric_score ?? null,
      by_category: Object.fromEntries(Object.entries(byCat).map(([k, c]) => [k, { n: c.n, pass_rate: c.pass / c.n, avg_steps: Math.round((c.steps / c.n) * 10) / 10 }])),
      avg_steps: n ? Math.round((ok.reduce((a, r) => a + r.steps, 0) / n) * 10) / 10 : null,
      ask_user_calls: ok.reduce((a, r) => a + r.ask_user_calls, 0),
      input_tokens: records.reduce((a, r) => a + (r.input_tokens || 0), 0),
      output_tokens: records.reduce((a, r) => a + (r.output_tokens || 0), 0),
      cache_read_input_tokens: records.reduce((a, r) => a + (r.cache_read_input_tokens || 0), 0),
      agent_minutes: Math.round(records.reduce((a, r) => a + (r.agent_seconds || 0), 0) / 6) / 10,
      cost_usd: Math.round(records.reduce((a, r) => a + (r.cost_usd || 0), 0) * 100) / 100,
      served_models: [...new Set(records.flatMap((r) => r.served_models || []))],
      judge: s.judge?.model ?? null,
    });
  }
  writeFileSync(join(outRoot, 'summary.json'), `${JSON.stringify(rows, null, 2)}\n`);
  const pct = (x) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)}%`);
  const cats = ['single_app', 'multi_app', 'memory'];
  const md = ['# Phone agent on iOSWorld', '', `Judge: ${judgeModel} (iOSWorld's script, unchanged) · protocol: ${PROTOCOL.max_steps} steps, no time limit`, '',
    `| model | trial | pass rate (95% interval) | ${cats.join(' | ')} | rubric score | avg steps | test errors | agent cost (list prices of ${PRICES_AS_OF}) |`,
    `| --- | --- | --- | ${cats.map(() => '---').join(' | ')} | --- | --- | --- | --- |`,
    ...rows.map((r) => `| ${r.provider}:${r.model} | ${r.trial} | ${pct(r.pass_rate)} (${pct(r.pass_ci95.low)}–${pct(r.pass_ci95.high)}) of ${r.judged} | ${cats.map((c) => (r.by_category[c] ? `${pct(r.by_category[c].pass_rate)} of ${r.by_category[c].n}` : '–')).join(' | ')} | ${r.rubric_score ?? '–'} | ${r.avg_steps ?? '–'} | ${r.test_errors} | $${r.cost_usd.toFixed(2)} |`), ''];
  writeFileSync(join(outRoot, 'summary.md'), md.join('\n'));
  console.log(`\n${md.slice(4).join('\n')}`);
}

// ─── main ────────────────────────────────────────────────────────────────────
if (judgeOnly) {
  const cells = JSON.parse(readFileSync(join(judgeOnly, 'run_info.json'), 'utf8')).cells.map((c) => ({ ...c, dir: join(judgeOnly, c.dir) }));
  for (const c of cells) judge(c.dir);
  summarize(judgeOnly, cells);
  process.exit(0);
}
if (!udid) { console.error('--udid <simulator> is required (or IOSWORLD_UDID)'); process.exit(2); }
if (!models.length) { console.error('--models provider:model[,provider:model…] is required'); process.exit(2); }
for (const k of ['OPENAI_API_KEY']) if (!process.env[k]) { console.error(`${k} is required (the judge, and the apps' own replies)`); process.exit(2); }
try { await runner('/deviceInfo'); } catch (e) { console.error(`our runner is not answering on port ${driverPort}: ${e.message}. See evals/phone-agent/README.md`); process.exit(2); }

const tasks = selectTasks(opt('tasks', 'all'));
const runName = opt('run', `${new Date().toISOString().replace(/[:.]/g, '-')}_${models.map((m) => slug(m.model)).join('+')}`);
const outRoot = join(opt('out', join(REPO, 'evals', 'results')), 'phone-agent', runName);
if (existsSync(outRoot)) { console.error(`${outRoot} exists; runs are never overwritten`); process.exit(2); }
mkdirSync(outRoot, { recursive: true });

const sim = JSON.parse(run('xcrun', ['simctl', 'list', 'devices', '-j'])).devices;
const simInfo = Object.entries(sim).flatMap(([rt, ds]) => ds.map((d) => ({ ...d, runtime: rt }))).find((d) => d.udid === udid);
const cells = models.flatMap((model) => Array.from({ length: trials }, (_, i) => ({ model, trial: i + 1, dir: join(`${model.provider}_${slug(model.model)}`, `trial-${i + 1}`) })));
const runInfo = {
  harness_version: HARNESS_VERSION, run: runName, started: new Date().toISOString(), protocol: PROTOCOL,
  phone_control: { release: JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version, commit: git(REPO, 'rev-parse', 'HEAD'), dirty: (git(REPO, 'status', '--porcelain') || '').length > 0 },
  iosworld: { commit: git(IOSWORLD, 'rev-parse', 'HEAD'), dirty: (git(IOSWORLD, 'status', '--porcelain', '--untracked-files=no') || '').length > 0, tasks_sha256: createHash('sha256').update(readFileSync(TASKS_FILE)).digest('hex').slice(0, 16) },
  device: { udid, name: simInfo?.name ?? null, runtime: simInfo?.runtime ?? null, xcode: run('xcodebuild', ['-version']).split('\n')[0] },
  judge: { script: 'iOSWorld scripts/judge_trajectories.py', provider: 'openai', model: judgeModel },
  agent: { entry: 'agent/agent.mjs', mode: 'single-image', toolset: 'phone', guard: 'off', ask_user: 'unanswered (1 s timeout)', reasoning: 'provider default' },
  models, trials, tasks: tasks.map((t) => t.name), cells: cells.map(({ model, trial, dir }) => ({ model, trial, dir })),
  node: process.version,
};
writeFileSync(join(outRoot, 'run_info.json'), `${JSON.stringify(runInfo, null, 2)}\n`);
console.log(`phone agent on iOSWorld — ${models.map((m) => `${m.provider}:${m.model}`).join(', ')}; ${tasks.length} task(s) × ${trials} trial(s); judge ${judgeModel}\n  ${outRoot}\n`);

for (const cell of cells) {
  const dir = join(outRoot, cell.dir);
  console.log(`${cell.model.provider}:${cell.model.model}, trial ${cell.trial}`);
  for (let i = 0; i < tasks.length; i++) {
    const taskDir = join(dir, `${String(i + 1).padStart(2, '0')}-${tasks[i].name}`);
    await runTask({ task: tasks[i], index: i + 1, model: cell.model, taskDir });
  }
  const s = judge(dir);
  console.log(`  judged: ${s.judge?.passes ?? 0} of ${s.judge?.judged_tasks ?? 0} passed\n`);
}
summarize(outRoot, cells.map((c) => ({ ...c, dir: join(outRoot, c.dir) })));
runInfo.finished = new Date().toISOString();
writeFileSync(join(outRoot, 'run_info.json'), `${JSON.stringify(runInfo, null, 2)}\n`);
