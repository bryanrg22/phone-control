#!/usr/bin/env node
// regrade.mjs — grade a finished connector-eval run again, without re-running it.
//
//   node evals/connector/regrade.mjs evals/results/connector/<run> [--judge-model M] [--cases id,id]
//
// --cases re-grades only those cases (the ones whose checks or wording were
// corrected); every other case keeps its original verdict, so unchanged
// cases add no judge cost and no judge noise.
//
// For when a case's checks or expectations are corrected after a run: each
// trial's conversation is rebuilt from its events.jsonl (every turn, reply and
// tool call, as recorded), the code checks are recomputed against the CURRENT
// case file, and the expectations are judged again by the run's judge family.
// Nothing the assistant did is re-run, so only judge calls cost anything.
//
// Never overwrites: the new verdicts go next to the originals,
//   <run>/regrade-<stamp>/summary.json, summary.md, changes.md
//   <run>/<case>/trial-<n>/regrade-<stamp>.json
// and changes.md lists every verdict that moved, with the reason.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { codeChecks, verdictFor, renderTranscript, rebuildTurns } from './grade.mjs';
import { createJudge, JUDGE_PROMPT_HASH } from '../lib/judges.mjs';
import { summarize } from '../lib/stats.mjs';
import { scrub } from '../../agent/record.mjs';
import { readEvents } from '../lib/events.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const runDir = argv.find((a) => !a.startsWith('--'));
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const only = (opt('cases', '') || '').split(',').filter(Boolean);
if (!runDir || !existsSync(join(runDir, 'run_info.json'))) { console.error('usage: regrade.mjs <run folder>'); process.exit(2); }

const info = JSON.parse(readFileSync(join(runDir, 'run_info.json'), 'utf8'));
const judge = await createJudge({ provider: info.judge.provider, model: opt('judge-model', info.judge.model) });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const cases = Object.fromEntries(readdirSync(join(HERE, 'cases')).filter((f) => f.endsWith('.json')).map((f) => {
  const c = JSON.parse(readFileSync(join(HERE, 'cases', f), 'utf8'));
  return [c.id, c];
}));

const verdicts = {};
const changes = [];
for (const caseId of readdirSync(runDir).filter((d) => cases[d]).sort()) {
  const kase = cases[caseId];
  verdicts[caseId] = [];
  for (const t of readdirSync(join(runDir, caseId)).filter((d) => d.startsWith('trial-')).sort()) {
    const dir = join(runDir, caseId, t);
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    if (state.error) { verdicts[caseId].push('TEST_ERROR'); continue; }
    if (only.length && !only.includes(caseId)) { verdicts[caseId].push(state.verdict); continue; }   // not re-graded: as recorded  // nothing to grade: the harness broke
    const events = readEvents(dir);
    const turns = rebuildTurns(events, state.checks);
    const trial = { turns, starts: state.starts, finalRun: state.final_run, phone: state.phone, defaultModel: state.default_model };
    const checks = codeChecks(kase, trial);
    const transcript = renderTranscript(turns);
    const judged = [];
    for (const expectation of kase.expect || []) {
      try { judged.push({ expectation, ...(await judge.grade({ transcript, expectation })) }); } catch (e) { judged.push({ expectation, verdict: 'error', reason: `judge call failed: ${e.message}` }); }
    }
    const verdict = verdictFor({ checks, judged, error: null });
    verdicts[caseId].push(verdict);
    writeFileSync(join(dir, `regrade-${stamp}.json`), `${scrub(JSON.stringify({ case: caseId, trial: state.trial, verdict, was: state.verdict, checks, judged, judge: { provider: judge.provider, model: judge.model, prompt_hash: JUDGE_PROMPT_HASH } }, null, 2))}\n`);
    if (verdict !== state.verdict) {
      const why = [...checks.filter((c) => !c.ok).map((c) => `check: ${c.name}`), ...judged.filter((j) => j.verdict !== 'held').map((j) => `${j.verdict}: ${j.reason}`)];
      changes.push(`- \`${caseId}\` ${t}: ${state.verdict} → **${verdict}**${why.length ? ` (${why.join('; ')})` : ''}`);
    }
    console.log(`  ${verdict.padEnd(10)} ${caseId} ${t}${verdict !== state.verdict ? `  (was ${state.verdict})` : ''}`);
  }
}

const out = join(runDir, `regrade-${stamp}`);
mkdirSync(out);
const summary = summarize(verdicts);
const casesHash = createHash('sha256').update(Object.keys(cases).sort().map((id) => JSON.stringify(cases[id])).join('\n')).digest('hex').slice(0, 12);
writeFileSync(join(out, 'summary.json'), `${JSON.stringify({ ...summary, regraded_at: stamp, regraded_cases: only.length ? only : 'all', cases_hash: casesHash, judge: judge.model, original: basename(runDir) }, null, 2)}\n`);
const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(0)}%`);
writeFileSync(join(out, 'summary.md'), [
  `# Re-graded: ${basename(runDir)}`, '', `Cases as of ${stamp} (hash ${casesHash}); judge ${judge.provider} ${judge.model}. The assistant was not re-run.${only.length ? ` Re-graded: ${only.join(', ')}; every other case as recorded.` : ''}`, '',
  `pass@1 ${pct(summary.pass_at_1)} (95% interval ${pct(summary.pass_at_1_ci95.low)}–${pct(summary.pass_at_1_ci95.high)}) · pass^k ${pct(summary.pass_hat_k)} · ${summary.trials} graded · ${summary.test_errors} test errors`, '',
  '| case | verdicts |', '| --- | --- |', ...Object.entries(summary.per_case).map(([id, c]) => `| ${id} | ${c.verdicts.join(', ')} |`), '',
].join('\n'));
writeFileSync(join(out, 'changes.md'), [`# Verdicts that changed on re-grading`, '', ...(changes.length ? changes : ['(none)']), ''].join('\n'));
console.log(`\npass@1 ${pct(summary.pass_at_1)} · pass^k ${pct(summary.pass_hat_k)} · ${changes.length} verdict(s) changed — ${out}`);
