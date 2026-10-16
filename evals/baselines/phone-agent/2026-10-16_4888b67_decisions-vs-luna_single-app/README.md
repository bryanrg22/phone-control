# 2026-10-16, the 27 single-app tasks: a decision model beside an LLM, one commit

The phone agent on iOSWorld's 27 single-app tasks, commit `4888b67`, judge
gpt-5.4-mini (iOSWorld's script, unchanged), one trial each. Two agents, the same
model under both: **GPT-6 Luna through OpenAI's Decisions API** (the decision
mode, `agent/decision/`: one choice question per step over the actions the
harness enumerates, no screenshot, no text written) and **GPT-6 Luna as an LLM**
(the product's loop: screenshot plus element list, tools, prompt).

| agent | pass rate (95%) | rubric score | avg steps | model time / task | cost / task | endings |
| --- | --- | --- | --- | --- | --- | --- |
| openai-decisions:gpt-6-luna | **11%** (4–28%) of 27 | 0.61 | 15.4 | 17.7 s | $0.005 | completed 16, failed 1, no_progress 10 |
| openai:gpt-6-luna | **78%** (59–89%) of 27 | 0.89 | 14.1 | 41.9 s | $0.008 | completed 22, failed 2, no_progress 3 |

`summary.md`, `summary.json`, `run_info.json` are the harness's own; `per-task.md`
lists every task's verdict and failed criteria for both agents. The full run
(every request and response, every screen, the apps' saved data; 230 MB) is in
`evals/results/phone-agent/2026-10-16_4888b67_decisions-vs-luna_single-app`
on the machine that ran it.

What the decision run's 24 failures are (each read in `agent.log` and the
judge's reasons; the harness defects found in the earlier passes were fixed
before this run and verified, see `docs/research/decision-models-jev-handoff-2026-10-16.md`):

- **3 did every action and only lacked the answer** (clouddrive-001, megamart-001,
  tasterank-001): `done` carries a fixed summary. With an answer step they pass: 6 of 27.
- **7 needed written text** (a reply, a bullet, a note): lockedin-003/004,
  quickchat-003, teamchat-003, notes-001, clouddocs-004, cloudslides-002.
- **14 are the model's judgment**: conclusions at p 0.15–0.5 (cityride-001 after
  3 steps, caltrack-001), multi-step controls with no goal value (SkyTrip's date
  picker, SplitPay's keypad, the alarm's time this time), and long lists where
  every option sits at p 0.1–0.3 until the no-progress stop.

Cost and speed: the decision agent's **tokens are input only** (1.3M, no cache);
the LLM read 4.7M input tokens, 65% from the cache, and wrote 45k. The Decisions
API answered every call first time (417 calls, all 200) but 49 of them took
3–9 s, against 0.1–0.3 s in the morning's probes; the LLM's 42 s a task is its
reasoning. At list prices the two cost about the same per task.

Calibration (27 points, too few): runs ended with `done` at p ≥ 0.8 passed 2 of 5;
at p < 0.5, 1 of 7; the 11 runs that never said `done` passed 0.

The LLM's 6 failures, for the record: caltrack-001 and quickbite-001 (checkout
and reporting), cloudsheets-003 (edited a cell already 'Pending'), freshcart-001
(lost on the store screen), mybank-003 (gave up before sending), weather-004
(never reached Dallas).
