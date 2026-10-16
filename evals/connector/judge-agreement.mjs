#!/usr/bin/env node
// judge-agreement.mjs — how far can the judge be trusted?
//
//   node evals/connector/judge-agreement.mjs <run folder>... [--out dir] [--sample 40]
//
// Two measurements, the ones a benchmark reports for an LLM judge:
//
// 1. Reliability: a SECOND judge from the other model family grades every
//    expectation of every trial again, from the same transcript. Agreement
//    with the first judge, overall and split by what the first judge said,
//    plus Cohen's kappa (chance-corrected; 0.6-0.8 is substantial, >0.8
//    near-perfect, as in iOSWorld's own judge validation, kappa 0.77).
//    Disagreements are listed in full, so each can be read.
//
// 2. Validity, prepared for a person: a labelling sheet (labels.md) with a
//    stratified sample of judgments: every one the judges disagreed on or
//    called not_held/unknown, plus random held ones, each with the transcript
//    and the expectation and a blank for the label. `--labels <file>` scores a
//    filled-in sheet against both judges (agreement and kappa per judge).
//
// Nothing is re-run and nothing in the run folders is modified: results go
// to --out (default evals/results/connector/judge-agreement-<stamp>/).

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createJudge, JUDGE_PROMPT_HASH } from '../lib/judges.mjs';
import { kappa } from '../lib/stats.mjs';
import { renderTranscript, rebuildTurns } from './grade.mjs';
import { readEvents } from '../lib/events.mjs';
import { scrub } from '../../agent/record.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const skipValue = new Set(['out', 'sample', 'labels'].map((n) => argv.indexOf(`--${n}`) + 1));
const runs = argv.filter((a, i) => !a.startsWith('--') && !skipValue.has(i));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = opt('out', join('evals', 'results', 'connector', `judge-agreement-${stamp}`));
const sampleN = Number(opt('sample', '40'));
const labelsFile = opt('labels', null);

const OTHER = { openai: { provider: 'anthropic', model: 'claude-opus-5-5' }, anthropic: { provider: 'openai', model: 'gpt-6.1-sol' } };

/** Every judgment of every trial of a run, with the transcript it was made on. */
function judgmentsOf(runDir) {
  const info = JSON.parse(readFileSync(join(runDir, 'run_info.json'), 'utf8'));
  const items = [];
  for (const caseId of readdirSync(runDir).filter((d) => existsSync(join(runDir, d, 'trial-1')))) {
    for (const t of readdirSync(join(runDir, caseId)).filter((d) => d.startsWith('trial-')).sort()) {
      const dir = join(runDir, caseId, t);
      const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
      if (state.error) continue;
      // The latest re-grade's judgments where there is one (the current cases), else the run's own.
      const latest = readdirSync(dir).filter((f) => /^regrade-.*\.json$/.test(f)).sort().at(-1);
      const judged = latest ? JSON.parse(readFileSync(join(dir, latest), 'utf8')).judged : state.judged;
      const transcript = renderTranscript(rebuildTurns(readEvents(dir), state.checks));
      judged.forEach((j, k) => items.push({ run: basename(runDir), model: info.assistant.model, case: caseId, trial: t, k, expectation: j.expectation, first: { provider: info.judge.provider, model: info.judge.model, verdict: j.verdict, reason: j.reason }, transcript }));
    }
  }
  return { info, items };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const fmtK = (k) => (k === null ? 'n/a' : k.toFixed(2));

// ─── scoring a filled-in labelling sheet ───
if (labelsFile) {
  const items = JSON.parse(readFileSync(join(out, 'items.json'), 'utf8'));
  const labels = new Map();
  for (const line of readFileSync(labelsFile, 'utf8').split('\n')) {
    const m = line.match(/^\|\s*(\S+)\s*\|.*\|\s*(held|not_held|unknown)\s*\|\s*$/);
    if (m) labels.set(m[1], m[2]);
  }
  const labelled = items.filter((i) => labels.has(i.id));
  const lines = [`# Judges against ${labelled.length} human labels (${labelsFile})`, ''];
  for (const which of ['first', 'second']) {
    const pairs = labelled.map((i) => [labels.get(i.id), i[which].verdict]);
    const byLabel = {};
    for (const [h, j] of pairs) { (byLabel[h] ||= { n: 0, agree: 0 }).n += 1; if (h === j) byLabel[h].agree += 1; }
    lines.push(`## ${which} judge`, '', `agreement ${pct(pairs.filter(([a, b]) => a === b).length / pairs.length)} · kappa ${fmtK(kappa(pairs))}`, '',
      ...Object.entries(byLabel).map(([h, c]) => `- when the person said ${h}: the judge agreed ${c.agree}/${c.n}`), '');
  }
  writeFileSync(join(out, 'validity.md'), `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));
  process.exit(0);
}

// ─── the second judge ───
if (!runs.length) { console.error('usage: judge-agreement.mjs <run folder>... [--out dir] [--sample N] | --labels <sheet>'); process.exit(2); }
mkdirSync(out, { recursive: true });
const all = [];
for (const r of runs) {
  const { info, items } = judgmentsOf(r);
  const second = OTHER[info.judge.provider];
  const judge = await createJudge(second);
  console.log(`${basename(r)}: ${items.length} judgments by ${info.judge.model}; second judge ${second.model}`);
  for (const it of items) {
    let g;
    try { g = await judge.grade({ transcript: it.transcript, expectation: it.expectation }); } catch (e) { g = { verdict: 'error', reason: `judge call failed: ${e.message}` }; }
    it.second = { provider: second.provider, model: second.model, verdict: g.verdict, reason: g.reason, usage: g.usage ?? null, request_id: g.request_id ?? null };
    it.id = `${it.model}/${it.case}/${it.trial}/${it.k}`;
    all.push(it);
  }
}
writeFileSync(join(out, 'items.json'), scrub(JSON.stringify(all.map((i) => { const c = { ...i }; delete c.transcript; return c; }), null, 2)));

const graded = all.filter((i) => i.second.verdict !== 'error');
const pairs = graded.map((i) => [i.first.verdict, i.second.verdict]);
const agree = pairs.filter(([a, b]) => a === b).length;
const byFirst = {};
for (const i of graded) { const c = (byFirst[i.first.verdict] ||= { n: 0, agree: 0 }); c.n += 1; if (i.first.verdict === i.second.verdict) c.agree += 1; }
const matrix = {};
for (const [a, b] of pairs) (matrix[a] ||= {})[b] = ((matrix[a] ||= {})[b] || 0) + 1;
const disagreements = graded.filter((i) => i.first.verdict !== i.second.verdict);
// Agreement on the trial verdict that follows (any not_held → FAIL), which is what the pass rate counts.
const trialPairs = [...new Map(graded.map((i) => [`${i.id.split('/').slice(0, 3).join('/')}`, null])).keys()].map((key) => {
  const js = graded.filter((i) => i.id.startsWith(`${key}/`));
  const v = (which) => (js.some((i) => i[which].verdict === 'not_held') ? 'FAIL' : js.some((i) => i[which].verdict === 'unknown') ? 'REVIEW' : 'PASS');
  return [v('first'), v('second')];
});
const cats = ['held', 'not_held', 'unknown'];
const md = [
  '# Judge agreement', '',
  `${graded.length} judgments across ${runs.length} run(s); each expectation graded by the run's judge and by a judge of the other family, from the same transcript (judge prompt ${JUDGE_PROMPT_HASH}).`, '',
  `**Judgment level:** agreement ${pct(agree / graded.length)} (${agree}/${graded.length}) · Cohen's kappa ${fmtK(kappa(pairs))}`, '',
  `**Trial level** (any not_held → FAIL): agreement ${pct(trialPairs.filter(([a, b]) => a === b).length / trialPairs.length)} (${trialPairs.length} trials) · kappa ${fmtK(kappa(trialPairs))}`, '',
  '| first judge said | n | second judge agreed |', '| --- | --- | --- |',
  ...cats.filter((c) => byFirst[c]).map((c) => `| ${c} | ${byFirst[c].n} | ${byFirst[c].agree} (${pct(byFirst[c].agree / byFirst[c].n)}) |`), '',
  '| first \\ second | ' + cats.join(' | ') + ' |', '| --- | ' + cats.map(() => '---').join(' | ') + ' |',
  ...cats.map((a) => `| ${a} | ${cats.map((b) => matrix[a]?.[b] || 0).join(' | ')} |`), '',
  `## Disagreements (${disagreements.length})`, '',
  ...disagreements.flatMap((i) => [`### ${i.id}`, '', `> ${i.expectation}`, '', `- ${i.first.model}: **${i.first.verdict}** — ${i.first.reason}`, `- ${i.second.model}: **${i.second.verdict}** — ${i.second.reason}`, '']),
  ...(all.length !== graded.length ? [`${all.length - graded.length} second-judge call(s) failed and are left out.`, ''] : []),
];
writeFileSync(join(out, 'agreement.md'), md.join('\n'));

// ─── the labelling sheet ───
const seeded = (s) => () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
const rnd = seeded(20261016);
const contested = graded.filter((i) => i.first.verdict !== i.second.verdict || i.first.verdict !== 'held' || i.second.verdict !== 'held');
const plain = graded.filter((i) => !contested.includes(i)).sort(() => rnd() - 0.5).slice(0, Math.max(0, sampleN - contested.length));
const sample = [...contested, ...plain].sort(() => rnd() - 0.5);
const sheet = [
  '# Labelling sheet', '',
  `${sample.length} judgments: every one the judges disagreed on or did not call held (${contested.length}), plus ${plain.length} they both called held, in random order. The judges' verdicts are hidden. Read the transcript, decide whether the expectation held, and write held, not_held or unknown in the last column of the table at the end. Then: node evals/connector/judge-agreement.mjs --out ${out} --labels <this file>`, '',
  ...sample.flatMap((i, n) => [`## ${n + 1}. \`${i.id}\``, '', `**Expectation:** ${i.expectation}`, '', '```', i.transcript, '```', '']),
  '## Labels', '', '| id | # | label (held / not_held / unknown) |', '| --- | --- | --- |',
  ...sample.map((i, n) => `| ${i.id} | ${n + 1} |  |`), '',
];
writeFileSync(join(out, 'labels.md'), scrub(sheet.join('\n')));
console.log(`\n${md.slice(4, 7).join('\n')}\n\n${disagreements.length} disagreement(s) — ${join(out, 'agreement.md')}\nlabelling sheet (${sample.length} items): ${join(out, 'labels.md')}`);
