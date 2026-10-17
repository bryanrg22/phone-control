# Results

How well each way of driving the phone does on a public benchmark, what it
costs, how long it takes, and how sure we are. Every number here comes from a
recorded run in [`evals/baselines/phone-agent/`](../evals/baselines/phone-agent/);
none are estimates.

**In one line:** the sticky hybrid (OpenAI's Decisions API choosing, GPT-6 Luna
taking over the hard steps) passed **24 of 27** tasks, against **20** for GPT-6
Luna alone, at the **same cost per task** and **13% less time**. That is the
best result so far, from one trial; it is not yet a statistically proven
difference (see [How sure we are](#how-sure-we-are)).

## The benchmark

[iOSWorld](https://github.com/ljang0/iOSWorld) ([arXiv:2606.09764](https://arxiv.org/abs/2606.09764))
is a benchmark for agents that operate an iPhone: 133 tasks on purpose-built
apps (a bank, a food-delivery app, mail, notes, a fitness tracker, …) running in
the iOS Simulator, each with a written rubric. We ran its **27 single-app
tasks**, the subset that stays inside one app.

| Setting | Value |
| --- | --- |
| Device | iOS Simulator, iPhone 17 Pro, iOS 26.4, Xcode 26.4 |
| Start of each task | Home screen; every app reset and reseeded (iOSWorld's own reset) |
| Step budget | 50 steps, no time limit; a run also stops after 8 steps with no screen change |
| Questions to the user | Left unanswered (1 s timeout), so a task cannot be passed by asking |
| Judge | iOSWorld's own script, `scripts/judge_trajectories.py`, unchanged, with `gpt-5.4-mini` |
| Pass | The judge finds **every** rubric criterion met |
| Trials | 1 per agent per task |
| Model settings | Provider-default reasoning effort; web search offered to the LLM. These runs predate the current protocol in `evals/phone-agent/run.mjs`, which sets effort `high` and no web search, so new runs are compared with each other, not with these |
| iOSWorld version | commit `c59287b`, tasks file sha256 `42c0b5558fde0e71` |

Each run keeps everything needed to check it: every screenshot, every model
request and response (OpenTelemetry GenAI spans), the app's saved data after
the run where the app keeps any, and the judge's verdict per criterion.

## The agents

The phone is driven by the same harness in every row: it reads the screen
(a screenshot and the list of on-screen elements from the accessibility tree),
chooses one action, does it through the runner, and repeats. What differs is
who chooses.

| Agent | Who chooses each step |
| --- | --- |
| **Luna alone** | GPT-6 Luna, an LLM. It sees the screenshot and the element list and writes the next action as a tool call, such as `tapText("Save")`. |
| **Jev alone** / **Decisions alone** | A decision model: TypeSafe's Jev, or OpenAI's Decisions API on GPT-6 Luna. These answer a multiple-choice question with a probability per option and write no arguments, so the harness turns the screen into options (tap each element, type each phrase from the task into each field, scroll, go back, open an app, done, blocked) and the model picks one. Text only, no screenshot. |
| **Writer hybrid** | A decision model chooses every step; Luna, with no tools, only writes the text to type and the final answer. |
| **Step hybrid** | A decision model chooses; Luna (screenshot, full tools) takes a step when the choice is done or blocked, typing, below probability 0.5, or the screen has not changed for 3 steps. Then the decision model chooses again. |
| **Sticky hybrid** | As the step hybrid, but once Luna takes over it **keeps control**, with no decision calls, until it calls `handBack`, finishes, or has taken 5 steps in a row. |

The 0.5 threshold and the 3-step and 5-step limits were fixed before any run
and not tuned on these tasks.

## How the comparison was controlled

The point of every comparison below is that **the only thing that differs
between two rows is who chooses each step**. Everything else was held fixed:

| Held fixed | How |
| --- | --- |
| The tasks | The same 27 iOSWorld tasks for every agent, from one pinned copy of the benchmark (commit and task-file hash above) |
| The starting state | One simulator; before **every** task, every app is reset and reseeded and the phone returns to the home screen, so no task inherits another's data |
| The harness | Screen reading (the screenshot and the element list), the actions, the 50-step budget and the stop rules are the same for every agent. The decision models are offered the same options in every run; a hybrid adds only its hand-off (a "write into this field" option and the rules for when the LLM takes over) |
| The judge | iOSWorld's own judging script, unmodified, with the same model for every run; it sees the same kind of record for every agent (the screens and the final answer) |
| The rules | The hand-off threshold and limits were set before the first run and never tuned on these tasks. A finished task counts as it finished: tasks interrupted by the machine (a full disk, a power loss) were run afterwards on the same code, and none was re-run to improve its result |
| The accounting | Tokens come from each API's own usage report on every call, priced at the provider's list price; time is measured by the harness around each call and each task |
| The record | Every run stores its commit (with a clean working tree), the benchmark's version, the simulator and Xcode versions and every setting, in `run_info.json` beside its results |

**Not controlled, and said so:** a model can answer differently on the same
screen, which is why one trial is not enough (see [How sure we are](#how-sure-we-are));
the decision APIs are previews whose models can change behind the same name;
runs happened at different times of day against live APIs.

## Results

iOSWorld's 27 single-app tasks, one trial each.

| Agent | Passes | 95% interval | Steps / task | Model time / task | Wall time / task | Cost / task | Cost per pass |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Sticky hybrid, Decisions** | **24** | 72–96% | 14.3 | 35.7 s | **58 s** | $0.0081 | **$0.0091** |
| Luna alone | 20 | 55–87% | 14.1 | 41.9 s | 67 s | $0.0081 | $0.0109 |
| Sticky hybrid, Jev | 20 | 55–87% | 15.2 | 36.1 s | 59 s | $0.0081 | $0.0109 |
| Step hybrid, Decisions | 20 | 55–87% | 15.1 | 31.1 s | 54 s | $0.0099 | $0.0133 |
| Writer hybrid, Decisions | 7 | 13–45% | 17.1 | 9.6 s | 47 s | $0.0052 | $0.0201 |
| Writer hybrid, Jev | 5 | 8–37% | 13.8 | 7.3 s | 40 s | $0.0029 | $0.0157 |
| Decisions alone | 2 | 2–23% | 15.4 | 17.7 s | 45 s | $0.0049 | $0.0660 |
| Jev alone | 2 | 2–23% | 15.4 | 2.2 s | 25 s | $0.0025 | $0.0332 |

- **Passes** are the judge's passes with known false ones removed (next section).
- **95% interval** is the Wilson score interval for the pass rate: with 27
  tasks it is about ±15 points.
- **Model time** is time spent waiting on model APIs; **wall time** is the whole
  task, including the phone's own time to act and settle.
- **Cost** is each call's recorded tokens at the provider's list price
  (cached input at the cached rate). **Cost per pass** is total cost divided by
  passes: what one completed task costs.

### Tokens

| Agent | Model calls / task | Input tokens / task | Of which cached | Output tokens / task |
| --- | :---: | :---: | :---: | :---: |
| Sticky hybrid, Decisions | 16.8 | 157,615 | 60% | 1,569 |
| Luna alone | 14.1 | 174,808 | 65% | 1,675 |
| Sticky hybrid, Jev | 18.0 | 179,212 | 58% | 4,686 |
| Step hybrid, Decisions | 23.7 | 153,137 | 45% | 1,519 |
| Writer hybrid, Decisions | 18.5 | 50,211 | 0% | 404 |
| Writer hybrid, Jev | 15.1 | 58,466 | 0% | 6,658 |
| Decisions alone | 15.4 | 48,855 | 0% | 0 |
| Jev alone | 15.4 | 58,476 | 0% | 6,555 |

Luna's calls carry the screenshot and the conversation so far, so most of their
input is read back from the provider's cache. Decision calls are text only and
not cached. Jev reports output tokens but does not bill them; the Decisions API
reports none.

### Where the money goes in a hybrid

| Run (27 tasks) | Decision calls | Decision cost | Luna calls | Luna cost | Total |
| --- | :---: | :---: | :---: | :---: | :---: |
| Luna alone | – | – | 381 | $0.218 | $0.218 |
| Step hybrid, Decisions | 408 | $0.111 | 233 | $0.156 | $0.267 |
| Sticky hybrid, Decisions | 166 | $0.047 | 288 | $0.171 | $0.218 |
| Sticky hybrid, Jev | 169 | $0.026 | 318 | $0.193 | $0.219 |

The step hybrid was faster than Luna but cost more: 232 of its 408 decision
calls were handed to Luna anyway, so both were paid for. Keeping Luna in
control (sticky) cut decision calls to 166, which brought the cost back to
Luna's. Jev's calls are cheaper, but its weaker choices sent 30 more steps to
Luna, which cost the difference back.

### Per task

✓ pass · ✗ fail · ✗† judged a pass, but not a real one (see below).
The two writer hybrids' per-task results, with each pass checked by hand, are in
[their baseline](../evals/baselines/phone-agent/2026-10-16_75c3f2c_writer-hybrids_single-app/per-task.md).

| task | Luna | Jev | Decisions | Step hybrid | Sticky · Jev | Sticky · Decisions |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| caltrack-001 | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |
| cinephile-001 | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| cityride-001 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| clock-001 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| clouddocs-004 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| clouddrive-001 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| cloudsheets-003 | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ |
| cloudslides-002 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| dinespot-001 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| freshcart-001 | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ |
| lockedin-003 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| lockedin-004 | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| mail-002 | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ |
| megamart-001 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| mybank-003 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| notes-001 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| quickbite-001 | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| quickchat-003 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| scorezone-003 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| skytrip-002 | ✓ | ✗ | ✗ | ✓ | ✗ | ✓ |
| splitpay-001 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| stayfinder-001 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| tasterank-001 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| teamchat-003 | ✓ | ✗ | ✗ | ✓ | ✓ | ✓ |
| ticketbox-004 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| trailblaze-004 | ✗† | ✗ | ✗† | ✗† | ✗† | ✗† |
| weather-004 | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ |

## Are the tests themselves right?

A benchmark score is only as good as its tasks and its judge, so both were
checked against the recorded evidence rather than taken on trust.

**"Passes" are judged passes with known false ones removed.** The judge reads
the screens and the agent's final answer. Reading runs by hand turned up
passes that did not happen:

- **trailblaze-004 cannot be passed honestly.** The task asks the agent to give
  a friend's run kudos, but in iOSWorld's seed data that run is *already*
  liked. Every judged pass, for every agent, was a tap that changed nothing, an
  unlike, or kudos to the user's own run (read from the like count and colour
  before and after each tap). It is counted as a fail for everyone.
- **The writer hybrids' answers fooled the judge.** Twice, the final answer
  described work that had not been done ("Logged 1 serving of oatmeal" with
  nothing logged), and the judge believed it. Every judged pass of both writer
  hybrids was checked by hand: 8 → 5 and 10 → 7.

**What has and has not been checked by hand.** The writer hybrids: every pass.
trailblaze-004: every agent. The other agents' remaining passes are the judge's,
not yet checked one by one. That check is the first item under
[What comes next](#what-comes-next).

**Things the tasks do not catch.** mybank-003 asks for a payment memo that no
agent added; cloudslides-002's slide scrolls, so the judge can read a full
agenda as overwritten from the last screenshot. Both are noted in the
baselines.

**The judge's reliability.** For the connector evals below, every verdict was
graded again by a judge from another company: 648 of 648 agreed (Cohen's
κ = 1.00). The iOSWorld judge has not been through that check here; a
human-labelled sample is pending.

## How sure we are

**Paired comparison.** All agents ran the same 27 tasks, so the fair test
compares them task by task (exact McNemar test), leaving out trailblaze-004:

| Comparison | Only the first passed | Only the second passed | p |
| --- | --- | --- | :---: |
| Sticky · Decisions vs Luna alone | 4: caltrack, cloudsheets, freshcart, weather | 0 | 0.125 |
| Sticky · Decisions vs Sticky · Jev | 4: caltrack, lockedin-004, skytrip, weather | 0 | 0.125 |
| Sticky · Decisions vs Step hybrid | 5 | 1: quickbite | 0.219 |
| Sticky · Jev vs Luna alone | 2 | 2 | 1.000 |

The sticky Decisions hybrid **passed every task Luna passed, and four more**.
Four tasks are too few to rule out luck at the usual 5% level, so the
honest reading is: *very likely at least as good as Luna, at the same cost and
faster; better is promising but not proven.*

**What a firm answer needs.** Three trials per agent on the 27 tasks (each run
is about an hour and $0.22). If the same pattern held over three trials, 12
tasks won and none lost, it would be clearly significant (p < 0.001). Running
all 133 tasks would cover multi-app work too.

**Other limits.**

- **Simulator only.** The same harness drives a real iPhone (the product), but
  these numbers are from the simulator. Real apps can lay out their screens
  differently.
- **The code has moved since.** The runs used commits `4888b67` (Luna,
  decision models), `487f174` (step hybrid), `dbc720b` (sticky) and `75c3f2c`
  (writer). Screen reading is unchanged across them, and so are the decision
  models' options apart from each hybrid's hand-off; the LLM loop was
  refactored in `487f174` to share its action code with the hybrid, its tools
  and prompt unchanged. Three harness fixes found
  by reading these runs (a tap right after a scroll, a field wrongly treated as
  a search box, appending to multi-line fields) came after, so the current code
  should do at least as well; that is not yet measured.
- **One model family per role.** Every hybrid used GPT-6 Luna as its LLM.

## Connector evals: how Claude uses the tools

A separate suite measures the other half: the assistant you chat with calling
this server's tools well (asking before acting, relaying the phone's questions,
reporting failures honestly). 19 scenarios × 3 trials per model, 399 trials,
0 test errors, each graded by a judge from the other company:

| Model as the assistant | Pass rate (95% interval) | Cost / task |
| --- | :---: | :---: |
| GPT-6.1 Sol | 100% (94–100) | $0.0035 |
| Claude Sonnet 5.5 | 100% (94–100) | $0.0069 |
| Claude Opus 5.5 | 100% (94–100) | $0.016 |
| GPT-6 Astra | 100% (94–100) | $0.023 |
| Claude Fable 5.1 | 100% (94–100) | $0.033 |
| Claude Haiku 5.5 | 96.5% (88–99) | $0.0005 |
| GPT-6 Luna | 94.7% (86–98) | $0.0003 |

Details: [`evals/baselines/connector/`](../evals/baselines/connector/2026-10-16_9711802_seven-models/README.md).

## What comes next

1. **Check every remaining pass by hand**, as was done for the writer hybrids.
2. **Three trials** of the sticky hybrids and Luna, then the paired test again.
3. **Other LLMs inside the hybrid** (GPT-6.1 Sol, Claude Sonnet 5.5), to see
   whether the hybrid's saving holds with a stronger, costlier model.
4. **The real phone**: the hybrids are deployed and choosable ("use Decisions",
   "use Jev"), but not yet measured there.

## Reproducing a run

```bash
evals/phone-agent/prepare-simulator.sh <iOSWorld checkout>   # once: erases a simulator, installs iOSWorld's apps and the runner
evals/phone-agent/start-runner.sh <simulator UDID>            # leave running
node evals/phone-agent/run.mjs --udid <udid> \
  --models hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna \
  --escalation-mode sticky --tasks single_app
```

Needs `OPENAI_API_KEY` (agent and judge) and, for Jev, `TYPESAFE_API_KEY`.
[`evals/phone-agent/README.md`](../evals/phone-agent/README.md) has the full
procedure; each baseline folder has the run's settings (`run_info*.json`) and
summary.
