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

The agent, `agent/agent.mjs`, run as the server runs it on a real iPhone: the same tools, prompt and loop, every action through the same XCTest runner, a screenshot plus the on-screen element list each step, the model's default reasoning setting. Two things differ from a run on a phone, both forced by the benchmark:

- **The device is a simulator**, driven through the same runner the phone uses.
- **Nobody answers the agent's questions.** iOSWorld has no user, so `askUser` returns "no answer" after a second (`--askuser-timeout 1`), as in an unattended run. Each result counts how often a model asked.

The agent's observation is closest to the paper's **vision + XML** mode (a screenshot plus the accessibility elements, and launching apps by name), so that is the row of the paper's table to compare with.

Our agent stops on its own after 8 steps without progress (its no-progress stop, a product feature kept as shipped); iOSWorld's agent always runs to 50 steps. Both count as an unsuccessful ending only if the judge says so.

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

`--models openai-decisions:gpt-6-luna,typesafe:jev-latest,hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna` runs the agent's decision mode and its hybrid (`agent/README.md`): a decision model picks among the actions the harness enumerates, instead of an LLM conversing with the tools. The report then adds a calibration table (pass rate by the probability the model put on "done").

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

- **iOS 26.4** simulator runtime (the paper: iOS 26).
- **Widgets.** iOSWorld's bootstrap removes the home-screen widgets while the simulator runs; on iOS 26.4 the home screen writes its layout back, so the widgets stayed. `prepare-simulator.sh` applies the same removal with the simulator shut down.
- **Notification permission prompts.** iOSWorld pre-approves notifications with `applesimutils` from the `wix/brew` Homebrew tap; we did not trust that tap on the evaluation machine. All other permissions are granted, and our agent dismisses a notification prompt on its own if one appears.
- **Same-family judging.** GPT-5.4 Mini judges every model, as in the paper, including the OpenAI models. Kept for comparability with the paper's table.
