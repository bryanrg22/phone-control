# To do

Open work, in rough order. Each item says what blocks it and what it costs.

- [ ] **Run the phone agent on the full iOSWorld benchmark.** The harness is ready
  (`evals/phone-agent/`, pilot on commit `c808997`: `clock-001` passed,
  `caltrack-001` failed). Two sizes: 3 models × the 27 single-app tasks, about
  $15 and an hour; or all 133 tasks × 7 models, about $100 and most of a day on
  one simulator. Needs the prepared simulator and runner (`prepare-simulator.sh`,
  `start-runner.sh`) and `OPENAI_API_KEY` for the judge. Decided 2026-10-16 to
  hold until Bryan picks a size.
- [ ] **Label the judge-validation sheet.** 40 judgments with verdicts hidden, about
  20 minutes: `evals/baselines/connector/2026-10-16_9711802_seven-models/judge-agreement/six-runs/labels.md`,
  then `node evals/connector/judge-agreement.mjs --out <that folder> --labels <the sheet>`.
- [ ] **Decide on the decision-model trial** (Jev, OpenAI Decisions API): branch
  `decision-models`, its own session, brief in
  `docs/research/decision-models-jev-handoff-2026-10-16.md`. Merge only if the
  results on iOSWorld justify it.
- [ ] **Check the restructured agent on the real phone** before deploying it: the
  live server still runs the pre-restructure agent; the app list on a phone comes
  from the built-in list until pymobiledevice3 is on the service PATH.
- [ ] **`caltrack-001` double entry.** The agent tapped Add Food twice because it saw
  no confirmation (`app-state/` of the pilot shows entries 175 and 176). Decide
  whether the agent should verify the list after a save, or the prompt should
  say so.
