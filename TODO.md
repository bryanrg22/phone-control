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
- [x] **The decision-model trial** (Jev, OpenAI Decisions API): done, merged
  2026-10-17. The decision models alone passed 2 of 27; the sticky hybrid with
  the Decisions API passed 24 (Luna alone 20). [docs/results.md](docs/results.md).
- [ ] **Firm up the iOSWorld results:** check every remaining pass by hand and run
  two more trials of the three leading agents (in progress in its own session).
- [ ] **Other LLMs inside the hybrid** (GPT-6.1 Sol, Claude Sonnet 5.5).
- [ ] **Check the agent on the real phone.** Deployed to the server on
  2026-10-17 (commit `586dc6c`, with "Jev" and "Decisions" choosable); not yet
  measured there. The app list on a phone comes from the built-in list until
  pymobiledevice3 is on the service PATH.
- [ ] **`caltrack-001` double entry.** The agent tapped Add Food twice because it saw
  no confirmation (`app-state/` of the pilot shows entries 175 and 176). Decide
  whether the agent should verify the list after a save, or the prompt should
  say so.
