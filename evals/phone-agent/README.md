# Phone-agent evals: iOSWorld

Does the agent that operates the phone complete real tasks? Measured on [iOSWorld](https://github.com/ljang0/iOSWorld) (Jang et al., [arXiv:2606.09764](https://arxiv.org/abs/2606.09764), Apache-2.0): 26 purpose-built iOS apps sharing one fictional user's data, 133 tasks with rubrics, and a judge validated against human labels. We use the benchmark as published and swap in only the agent, so our numbers sit next to the paper's.

## What is iOSWorld's, unchanged

| | |
| --- | --- |
| Apps and data | The 26 apps and Jordan Avery's seeded data, built and installed by iOSWorld's own bootstrap |
| Tasks | `tasks.json`: 27 single-app, 60 multi-app, 46 memory tasks, each with rubric criteria |
| Start state | Before every task, iOSWorld's reset (`scripts/appium_agent.py`: status bar pinned, every app's data wiped and reseeded, the OpenAI key given to the apps that generate replies), then Home. `iosworld_reset.py` calls their functions; nothing is copied |
| Budget | 50 steps, no time limit (paper §4; `scripts/bootstrap_release.sh`) |
| Scoring | Their judge, `scripts/judge_trajectories.py`, run unchanged with its default model, GPT-5.4 Mini (κ = 0.77 against human labels on 128 trajectories). A task **passes** when every rubric criterion holds; the **rubric score** is the share of criteria that hold |

## What is ours

The agent, `agent/agent.mjs`, run as the server runs it on a real iPhone: the same tools, prompt and loop, every action through the same XCTest runner. Four things differ from a run on a phone, each recorded in `run_info.json`:

- **The device is a simulator**, driven through the same runner the phone uses.
- **Nobody answers the agent's questions.** iOSWorld has no user, so `askUser` returns "no answer" after a second (`--askuser-timeout 1`), as in an unattended run. Each result counts how often a model asked.
- **No web search** (`--no-web-search`). On a phone the agent has the provider's own web search; iOSWorld's weather and sports apps hold a fictional user's data that the open web would contradict, and the paper's agents had no search.
- **Reasoning effort high** (`--effort high`), as the paper's runs (effort high; max for Opus 4.6). On a phone the product uses the provider's default.

The agent's observation is closest to the paper's **vision + XML** mode (a screenshot plus the accessibility elements, and launching apps by name), so that is the row of the paper's table to compare with. The models differ anyway (the paper: Opus 4.6, Sonnet 4.6, GPT-5.4; here the 2026-10 models), so the comparison is of harnesses on the same benchmark, not a leaderboard entry.

### What the judge sees, and how it differs from the paper's trajectories

iOSWorld's judge reads one screenshot per step, the actions of each step, a final screenshot and the agent's answer. `trajectory.mjs` builds that from the agent's record:

- **One screen per step.** The agent observes the screen only after an action that can change it; a step that only read the element list or asked the user gets the latest screen again, marked `screenshot_reused` (the screen did not change). iOSWorld captures a fresh one every step.
- **Failed actions carry their error**, as iOSWorld's `recoverable_error` entries do: a failed `tapText("Save")` is not a tap on Save.
- **Arguments only, no narrative.** The model's free-text `description` of a tap is dropped; what it typed, asked or waited for stays, as iOSWorld keeps the `type` text and `stop` answer.
- **Screenshots are the 768-pixel-wide JPEGs the model saw** (the judge script resizes to 706×1536 again); the paper's judge got one resize from a full-resolution PNG. The final screenshot is a full-resolution PNG captured after the run.
- **The answer** is the `taskComplete` summary, or the `taskFailed` reason when the agent gave up; iOSWorld's is the `stop` answer. At the 50th step our agent is forced to conclude with one of the two, so a budget run always has an answer; iOSWorld's may have none.

## Setting up

```bash
git clone https://github.com/ljang0/iOSWorld ~/iOSWorld
cd ~/iOSWorld && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd -   # back to this repository
evals/phone-agent/prepare-simulator.sh ~/iOSWorld          # ~15 minutes; erases only the simulator it names
evals/phone-agent/start-runner.sh <UDID it printed>         # leave running
```

`prepare-simulator.sh` creates a simulator called "iOSWorld iPhone 17 Pro" (iOS 26), runs iOSWorld's bootstrap on it, removes the home-screen widgets (see below), and installs our runner on port 22187.

## Running

```bash
export OPENAI_API_KEY=…   ANTHROPIC_API_KEY=…    # the judge and the apps need OpenAI; each model needs its own key
node evals/phone-agent/run.mjs --udid <UDID> --models openai:gpt-6-luna --tasks clock-001        # one task first
node evals/phone-agent/run.mjs --udid <UDID> --models anthropic:claude-opus-5-5,openai:gpt-6-astra --tasks all
node evals/phone-agent/run.mjs --udid <UDID> --models … --tasks single_app --trials 3              # a category, repeated
node evals/phone-agent/run.mjs --judge-only evals/results/phone-agent/<run>                       # re-score
```

`--iosworld <dir>` if the checkout is not at `~/dev/GitHub/iOSWorld`; `--judge-model` to judge with another model (the paper's numbers use the default). **Every run costs money**: the model under test, the judge, and the apps' own replies.

## What a run leaves

`evals/results/phone-agent/<run>/` (git-ignored; copy a run into a test record to keep it):

| | |
| --- | --- |
| `run_info.json` | this repository's release and commit, iOSWorld's commit and a hash of its `tasks.json`, the simulator and Xcode, the judge, the agent settings, the models |
| `summary.json`, `summary.md` | per model: pass rate with its 95% interval, by category, rubric score, average steps, test errors, cost at list prices |
| `<provider>_<model>/trial-<k>/` | an iOSWorld run folder: their `summary.json` and the judge's log |
| `…/<NN>-<task>/task.json`, `trajectory.json` | iOSWorld's format, with the judge's verdict and per-criterion reasons written into `task.json` |
| `…/<NN>-<task>/agent-trace/` | the agent's full record (`agent/README.md`): every model request and response exactly, every tool call, every screen it was shown, a readable transcript |
| `…/<NN>-<task>/final.png`, `app-state/` | the screen when the run ended, and every app's saved data: the outcome as the apps recorded it |
| `…/<NN>-<task>/agent.log`, `record.json` | the agent's own output; how it ended, steps, tokens, cost, time, exit code |

A run the infrastructure broke (the model API failing for good, the runner dying, a hang) is a **test error**: not judged and not counted, but reported.

## Known differences from the paper's setup

Each item is from reading iOSWorld's `scripts/appium_agent.py` and `llm_action_generator.py` beside ours (2026-10-16), not from the paper alone. The κ = 0.77 judge validation and the 50-step protocol are the paper's statements; the repository itself says only "paper's pass-rate definition" and "paper uses 50 steps".

**Observation and context**
- **768 px wide JPEG** per step (the paper: longest edge 1536 px), with our element list: label, value, placeholder, centre in percent, size in points, on-screen elements only, at most 150 (the paper's tree: type, name, label, value, identifier, hidden and disabled flags, centre in 0–1000, at most 200). Only the newest screen stays in the model's context; the paper's harness keeps every screenshot.
- The system prompt lists **every installed app** and the real date; iOSWorld's first turn lists only the task's apps' bundle IDs and no date.

**Reset and timing**
- **No simulator reboot between tasks.** iOSWorld's `reset_device` shuts the simulator down and boots it before every task; our runner session would not survive that. We run their app-data wipe, reseed and status-bar pin, then press Home. State a reboot clears that we do not: the app switcher, the pasteboard, keyboard suggestions, delivered notifications, and anything changed in Apple's Settings.
- Waits: 1 s after Home before the first observation (theirs 2 s); 350 ms after a tap, swipe, scroll or drag and none after typing (theirs 2 s after every action).

**Actions**
- Ours adds `tapText`, `replaceText`, `typeAndSubmit`, `waitForText`, `hideKeyboard`, `drag`, keyboard keys and `askUser`; theirs has an explicit long press (`hover`), `terminate_app` and `open_url`, which ours lacks (a long press is approximated by `drag` with the same start and end).
- A reply with text and no tool call is nudged to use a tool; iOSWorld's computer-use path treats it as `stop`.

**Endings**
- Our agent stops on its own after 8 steps without progress (a product feature kept as shipped) and after 4 consecutive device failures (a test error); iOSWorld's runs to `stop` or step 50. A hang past 45 minutes is a test error.
- A first-launch "Would Like to Send You Notifications" prompt during steps 1–4 is answered Allow by the harness without a model step (iOSWorld pre-grants them with `applesimutils`, which we did not install); a prompt from an app opened later costs the model a step.

**Environment**
- **iOS 26.4** simulator runtime (the paper: iOS 26).
- **Widgets.** iOSWorld's bootstrap removes the home-screen widgets while the simulator runs; on iOS 26.4 the home screen writes its layout back, so the widgets stayed. `prepare-simulator.sh` applies the same removal with the simulator shut down.
- **Same-family judging.** GPT-5.4 Mini judges every model, as in the paper, including the OpenAI models. Kept for comparability with the paper's table.

**Status.** A pilot on the committed tree (`c808997`, GPT-6.1 Sol, `clock-001` and `caltrack-001`, 2026-10-16) ran the whole chain: reset, agent with search off and effort high, trajectory, iOSWorld's judge unchanged, report. `clock-001` passed every criterion; `caltrack-001` ended in the no-progress stop and failed 4 of 8. The three older result folders predate the agent's restructure and are not results. No model has been run on the full task set yet.

**What the pilot showed about judging.** The judge sees screens and the answer, not the apps' data. In `caltrack-001` it failed "confirm and save the food log entry", but the app's saved data, which every run captures (`app-state/`), shows the oatmeal entry was saved — twice (new entries 175 and 176 against 174 after the reset): the agent tapped Add Food, could not see a confirmation, and added it again, then never reported the calories. The task verdict is right (the report never came); the per-criterion score undercounts the save and misses the duplicate. The captured app state is the ground truth a reviewer can check a verdict against, and a way to catch side effects the judge cannot see.
