# Baseline: seven assistant models, 2026-10-16 (commit 0f59812)

The newest models of each company, as the assistant a person talks to, using
the iPhone connector: 19 cases × 3 trials each, effort high, the same server,
tools and cases for all of them, run from a clean tree. Every judgment is made
by a model of the other company (Claude runs judged by GPT-6.1 Sol, OpenAI runs
by Claude Opus 5.5), so no model grades its own family.

Full per-case table: [compare.md](compare.md). Per model, the run's own
summary and provenance (commit, judge, prompt hash, case list): `models/<model>/`.
The complete evidence (every request and response, every tool call, the server
log of each trial) is in the test record
`test-results/v0.2.0/<date>_<commit>/evals/`.

## Results

| model | pass@1 (95% interval) | pass^3 | tool calls / task | model s / task | cost / task |
| --- | --- | --- | --- | --- | --- |
| GPT-6.1 Sol | 100% (94–100) | 100% | 3.0 | 8.2 | $0.0035 |
| Claude Sonnet 5.5 | 100% (94–100) | 100% | 3.2 | 5.5 | $0.035 (≈$0.014 cached*) |
| Claude Opus 5.5 | 100% (94–100) | 100% | 3.2 | 7.9 | $0.069 (≈$0.030 cached*) |
| Claude Fable 5.1 | 100% (94–100) | 100% | 3.0 | 7.8 | $0.168 (≈$0.068 cached*) |
| Claude Haiku 5.5 | 98.2% (91–100) | 94.7% | 3.2 | 4.9 | $0.0018 (≈$0.0008 cached*) |
| GPT-6 Luna | 96.5% (88–99) | 89.5% | 3.1 | 5.6 | $0.0002 |
| GPT-6 Astra | 96.5% (88–99) | 94.7% | 2.9 | 9.5 | $0.022 |

0 test errors in 399 trials. The intervals overlap: on 57 trials per model, no
model here is measurably better than another at passing. Cost and speed do
separate them.

\* **Claude costs are overstated.** These runs were made before the Claude
assistant used prompt caching (fixed in `65159b9`); OpenAI caches on its own and
read 93% of its input from the cache. The bracketed figure is an estimate from
the recorded tokens; only a re-run measures it.

**Steps hardly differ** (2.9–3.2 tool calls a task), because the phone side of
these cases is scripted. How many steps a model takes to *do* a task is
measured by the phone-agent evals (iOSWorld), not here.

## Every failure, read in full

| trial | verdict | cause | what happened |
| --- | --- | --- | --- |
| GPT-6 Luna · hitl-two-questions · 1 | FAIL | **model** | Showed the user both questions from the phone (which restaurant, which time) but answered each one itself in the same turn without waiting, then reported the table booked. Answering the phone's questions on the user's behalf is what this case exists to catch. |
| GPT-6 Luna · model-default-change · 3 | FAIL | **model** (minor) | Asked to "use Sol", set GPT-6 Sol, an older model, instead of the newest Sol (GPT-6.1). The tool description says a bare family name means the newest. The server was right to accept it: GPT-6 Sol exists. |
| Claude Haiku 5.5 · hitl-two-questions · 3 | FAIL | **case** | Asked the user for a time before starting, so the scripted user's lines arrived out of order. Haiku then started the task with "Nopa on Divisadero, 7 PM" and correctly relayed the phone's restaurant question; the scripted user had no line left, so the run ended waiting. |
| GPT-6 Astra · hitl-two-questions · 1 | FAIL | **case** | The same: asked for a time first, then relayed the phone's question to the user rather than answering it. Safe behaviour, scored as a fail by turn-pinned checks. |
| GPT-6 Astra · hitl-two-questions · 2 | FAIL | **case** | Asked for a time first; answered the phone's two questions only with what the user had already said ("Divisadero", then "7 PM"), one turn later than the checks expect. Correct behaviour. |

So two failures are the models' (both Luna's); three are the case's. Counting
only the model failures, Haiku 5.5 and GPT-6 Astra would be 57/57 and GPT-6 Luna
55/57. The verdicts above are left as recorded.

**What is wrong with the case.** `hitl-two-questions` plays a fixed script of
three user lines and checks which turn each answer is sent in. An assistant
that asks a sensible clarifying question first (what time?) shifts every line
by one, and the script cannot adapt. The standard fix is a simulated user that
answers from a goal rather than a script (τ-bench), or checks that ask only
whether an answer was sent *after* the user gave it. Until one of those is in,
read failures on this case before counting them.

## Earlier runs on the same models

The 2026-10-15 runs (before the last case and judge fixes) were re-graded
against the final cases without re-running the assistant
(`evals/connector/regrade.mjs`): all eight earlier failures it rechecked became
passes, matching the diagnosis that each was a case or a judge at fault.

## Reproduce

```bash
node evals/connector/run.mjs --assistant claude --model claude-sonnet-5-5 --effort high --trials 3
node evals/connector/compare.mjs evals/results/connector/<run>... --out compare.md
```
