<div align="center">

# Phone Control

### Ask Claude to do something on your iPhone, and it happens on the real phone.

From the Claude app, from anywhere. No Mac, no cable, no app of ours to keep open.

[![CI](https://github.com/bryanrg22/phone-control/actions/workflows/ci.yml/badge.svg)](https://github.com/bryanrg22/phone-control/actions/workflows/ci.yml)
![iPhone](https://img.shields.io/badge/iPhone-iOS%2017%2B-000000?logo=apple&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)
[![iOSWorld](https://img.shields.io/badge/iOSWorld-74%25_single--app,_3_trials-8250DF)](docs/results.md)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[When to use it](#when-to-use-it-and-when-not-to) · [How it works](#how-it-works) · [How the AI drives the phone](#how-the-ai-drives-the-phone) · [Results](#results) · [Set it up](#set-it-up) · [Tests](#tests)

</div>

<!-- A screen recording of a task running on the phone goes here. -->

<p align="center">
  <img src="docs/media/hero.png" alt="Left: the Claude iOS app answering “is my phone connected?” with “Yes — your iPhone is linked, connected, and ready for tasks.” Right: Claude on the desktop asked to open Settings and read the iOS version; it drives the phone and answers “Your phone is on iOS 27.0, per Settings › General › About.”" width="860">
</p>

Phone Control is a server you run yourself, for your own iPhone. You add it to Claude as a custom connector. When you ask for something to be done on your phone, the server starts an automation session on the phone over your VPN, an AI agent looks at the screen and taps, types and swipes until the job is done, and the answer comes back to your chat.

> **Where this comes from.** This continues [Agentic Automation on iOS](https://github.com/bryanrg22/ios-agent_automation_info), which took 3rd place at the Claude Builder Hackathon at UCLA. That version drove the iPhone from a Mac it was plugged into and needed its own app on the phone. This one needs neither: a small Linux server drives the phone over the network, and Claude's own app is the interface.

## What you can ask

- *"Is my phone connected?"*
- *"Open Settings and tell me which iOS version I'm on."*
- *"Open Messages and read me the last thing Sam sent."*
- *"Use Sonnet for this one: open Maps and find the nearest coffee shop."*
- *"From now on use Decisions."* (the [hybrid agent](#how-the-ai-drives-the-phone))
- *"Stop."*

The agent can use any app on the phone, because it operates the phone the way a person does: it looks at the screen and touches it.

## When to use it, and when not to

Phone Control works the way a person does: it looks at the screen and taps, about five seconds a step. A ten-step task takes a little over a minute. That makes it the slowest way to get something done, so use it only when nothing faster can reach what you need.

| You want to… | Better to use | Why |
| --- | --- | --- |
| ❌ Read, search or send email, check your calendar, find a file | A Claude connector (Gmail, Calendar, Drive, …) | Seconds instead of a minute, and it returns everything, not just what fits on a screen |
| ❌ One quick action or question: text someone, set a timer, today's weather | Siri | A single step in Apple's own apps, done instantly |
| ❌ Something on your computer, while you're at it | A desktop agent (Claude's computer use) | A bigger screen, faster, and it sees more at once |
| ❌ Typing a password, a 2FA code or a card number | You | The agent stops and hands these to you, on purpose |
| ✅ Several screens deep in iOS Settings | **Phone Control** | No connector reaches Settings, and Siri changes one switch at a time |
| ✅ An app with no connector: a social app, a bank or shop app, a transit app | **Phone Control** | The app is the only way in |
| ✅ Check something first, then act only if it is true | **Phone Control** | Siri cannot do "if" |
| ✅ You're away from your computer, and it can only be done on a phone | **Phone Control** | It runs from the Claude app, wherever you are |

Requests that fit:

- *"Turn off notifications for every game on my phone."* Many screens of Settings, one app at a time.
- *"Set up a Focus that only lets my family's calls through after 10 pm."*
- *"My work account won't sign in to the Microsoft app; it keeps picking my personal one. Sign out of every Microsoft account on the phone and take me back to the sign-in screen."* The agent does the clicking and stops where your password goes. Claude can work out the fix in the chat first, then the phone carries it out.
- *"Open Instagram and check my follower count. If it's over 1,000, message a friend; otherwise don't send anything."*

The best everyday uses are still being found. The rule of thumb: **it has to happen on the phone, it takes more than one step, and you are not at your computer.**

## How it works

<p align="center"><img src="docs/media/how-it-works.svg" alt="The Claude app talks to your server over MCP and HTTPS, published by Tailscale Funnel. The server has three parts: server (the tools Claude calls), device (starts and stops automation) and agent (looks, decides, taps and types). It reaches the runner, an XCTest app on the iPhone, over the Tailscale VPN." width="900"></p>

1. You ask Claude to do something on your phone. Claude calls the `run_phone_task` tool on your server and immediately gets a run id back.
2. The server starts automation on the phone, checks it is unlocked, and swipes away another app's banner if one covers the top of the screen.
3. The agent loops: read the screen, decide the next action, do it.
4. Claude keeps asking how the task is going. Each check waits on the server for up to ten seconds, so progress shows up promptly.
5. When the agent is done, the server brings the Claude app back to the front, ends the automation session, and the answer appears in your chat.

<p align="center"><img src="docs/media/task-lifecycle.svg" alt="One task in six steps: you ask Claude; Claude calls your server; the server starts automation; the agent looks, decides and acts; the server sends the answer back; the server stops automation. The Automation Running banner shows only from step 3 to step 6." width="900"></p>

## How the AI drives the phone

Each step, the agent reads the screen (a screenshot, plus the list of on-screen elements from iOS's accessibility tree), chooses one action, and does it. Three kinds of model can do the choosing:

<p align="center"><img src="docs/media/agent-modes.svg" alt="Three ways to drive the phone. LLM (GPT, Claude, Gemini): gets the screenshot and element list and writes the next action itself; 74% of iOSWorld tasks. Decision model (Jev, OpenAI Decisions API): the agent lists every possible action and the model picks one with a probability; 0%. Hybrid, sticky: the decision model takes the clear steps and the LLM takes over when it is unsure, typing, done or stuck, until it hands back; 67%. Checked by hand (every run for the LLM and the hybrid); three trials for the LLM and the hybrid, one for the decision model." width="900"></p>

**An LLM** (GPT, Claude or Gemini) sees the screenshot and the element list and writes the next action as a tool call, like `tapText("Save")` or `inputText("Gym")`. It is the most capable chooser and the slowest.

**A decision model** ([TypeSafe's Jev](https://typesafe.ai), [OpenAI's Decisions API](https://platform.openai.com)) is a different kind of model: it cannot write anything. You send it a question, a description of the situation and a fixed list of answers, and it returns a probability for every answer. Both are fast and cheap compared with an LLM, and here they are sent text only, no screenshot. To use one on a phone, the agent turns each screen into a multiple-choice question:

- **The situation** is the task, the actions so far (and whether each changed the screen), the app in front, and the element list.
- **The answers** are every action the agent could take right now: tap each element, type each phrase from the task into each text field, search, scroll, go back, hide the keyboard, open an app, or say *done* or *blocked*. A screen gives a median of 41 answers (25 to 95 on most screens, measured over 166 decisions).
- **The model picks one**, say "Tap *Alarm* (button at 39%, 94%)" with probability 0.99, and the agent carries it out.

On its own this completes none of the 27 benchmark tasks: it cannot write text the task does not spell out, it never writes an answer to a question, and it repeats taps that change nothing.

**The hybrid** gives each step to whichever model suits it. The decision model chooses, and GPT-6 Luna (with the screenshot and the full tool set) takes over when the decision model:

| Picks or meets | Why the LLM takes over |
| --- | --- |
| *done* or *blocked* | To check the screen really shows it, and to write the answer |
| "write into this field" | The text is not in the task, so something has to compose it |
| a Pay, Place Order, Delete or priced Request button | So the LLM asks you first, **whatever the probability** (see below) |
| a best answer below 50% probability | The decision model is unsure |
| a screen unchanged for 3 steps | It is stuck |
| the last step of the budget | Someone has to conclude |

These are checked in that order, every step, and the thresholds were fixed before any test and never tuned on it ([`agent/decision/escalate.mjs`](agent/decision/escalate.mjs)). In the **sticky** version, once Luna takes over it keeps control until it hands back with a `handBack` tool, finishes, or has taken 5 steps in a row, and it never hands back in the middle of a payment. Say "Jev" or "Decisions" in the chat to choose which decision model does the choosing.

### Is this a standard design?

Partly. Sending easy work to a cheap model and escalating the rest to a stronger one is an established idea, usually called a **model cascade** or **confidence-based routing** (FrugalGPT, 2023, is the well-known example for LLMs). The hybrid follows two specific precedents:

- **JEV-as-a-Judge** (arXiv 2609.26550) for the rule itself: accept a decision model's answer when it is confident, escalate when it is not.
- **Browser Use's jev-ultrafast** demo for handing text-writing to an LLM while Jev picks the clicks.

What we found no published version of, and built and measured here: a hybrid driving a **phone** from iOS's accessibility tree, the **sticky** hand-over, and hard rules for **irreversible actions** that override the confidence check.

### What testing taught us

Every claim below comes from runs on [iOSWorld](https://github.com/ljang0/iOSWorld), with each run checked by hand ([docs/results.md](docs/results.md)):

- **Handing over one step at a time backfired.** The decision model, confident and wrong, undid Luna's plan on the next step, and 232 of its 408 calls were handed to Luna anyway, so the first hybrid cost more than Luna alone. Keeping Luna in control (sticky) fixed both, and cut the decision calls by 60%.
- **Confidence catches an unsure model, not a confidently wrong one.** The decision model tapped *Send now* on a $50 transfer at 87% probability, without asking. That is why payment buttons go to the LLM regardless of probability.
- **One word in a hand-off can switch off a safeguard.** Told it could pay "unless the user has already confirmed it in this task", Luna treated the task itself as consent and asked 0 times in 10. Without that phrase it asked 10 times in 10.
- **The hybrid matched Luna, it did not beat it.** One trial, scored by the benchmark's judge alone, showed the hybrid ahead (24 against 20). Over three trials, checked by hand, it was 67% against Luna's 74%, not a significant difference, while about 20% faster and 10% cheaper per task. Jev as the chooser did worse (58%, significantly below Luna): its calls are cheaper, but its weaker choices sent more steps to Luna.
- **The judge needed checking.** 20% of the passes it gave did not hold up, and 15% of the fails it gave were really done. The judge alone would have ranked the hybrid first.

Say which one to use in the chat:

| Say | What drives the phone | Needs |
| --- | --- | --- |
| "Luna", "Sol", "Sonnet", "Opus", "Gemini", … | That LLM alone | That provider's API key |
| "Decisions" | Hybrid: OpenAI's Decisions API + GPT-6 Luna, sticky | `OPENAI_API_KEY` |
| "Jev" | Hybrid: TypeSafe's Jev + GPT-6 Luna, sticky | `OPENAI_API_KEY`, `TYPESAFE_API_KEY` |

The model that drives the phone is separate from the model you chat with, and can be set per task or as your default.

## Results

Measured on [iOSWorld](https://github.com/ljang0/iOSWorld)'s 27 single-app tasks, a public benchmark of iPhone tasks run in the iOS Simulator and graded by its own judge, with the runs then checked by hand against the screens and the apps' saved data (for the first three agents every run, whether the judge passed it or failed it; for the decision models alone, the runs it passed):

| Agent | Trials | Tasks completed (95% interval) | Every trial | Wall time / task | Cost / task | Input tokens / task | Output tokens / task |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **GPT-6 Luna alone** | 3 | **74%** (59–88%) | 16 / 27 | 65 s | $0.0083 | 172k (63% cached) | 1.8k |
| Hybrid, sticky (Decisions + Luna) | 3 | 67% (53–80%) | 13 / 27 | **53 s** | $0.0075 | 150k (61% cached) | 1.5k |
| Hybrid, sticky (Jev + Luna) | 3 | 58% (42–74%) | 12 / 27 | 53 s | $0.0069 | 158k (60% cached) | 4.3k |
| OpenAI Decisions API alone | 1 | 0% (0–12%) | – | 45 s | $0.0049 | 49k | 0 |
| Jev alone | 1 | 0% (0–12%) | – | 25 s | $0.0025 | 58k | 6.6k |

Luna alone and the Decisions hybrid are not significantly different (paired test, p = 0.24); the hybrid is about a fifth faster and 10% cheaper a task. In these runs it sent the payment task's transfer twice without asking; a fix measured since makes both hybrids ask first and pay once (7 of 7 paying runs), and the same hold for Luna alone, which also paid without asking on two tasks, is in progress. The judge's verdicts alone would have put the hybrid ahead: 20% of judged passes did not hold up when checked, more of the hybrid's than of Luna's, and 15% of judged fails were really done, more of Luna's. **[docs/results.md](docs/results.md)** has the method, every agent tried, per-task results, how the tests themselves were checked, and how sure each comparison is.

## Why each piece exists

Apple's UI automation is built for a phone plugged into a Mac running Xcode. Each part of this project removes one piece of that assumption.

<p align="center"><img src="docs/media/layers.svg" alt="Four layers: the runner (an XCTest app on the iPhone), the session (go-ios, patched), the tunnel (pymobiledevice3) and the network (Tailscale). The top two end with each task; the bottom two stay up." width="900"></p>

**A server, because Claude calls tools from the cloud.** Claude's tool calls come from Anthropic's servers, not from your phone, so something must be reachable on the public internet over HTTPS. Tailscale Funnel gives your server that address without opening anything else.

**Tailscale, because the phone moves.** The server needs to reach the phone at home, at work and on cellular. With Tailscale on both, the phone keeps one address on every network.

**A tunnel, because iOS's developer services only exist inside one.** [`device/tunnel.py`](device/tunnel.py) builds the encrypted CoreDevice tunnel to the phone's VPN address with [pymobiledevice3](https://github.com/doronz88/pymobiledevice3). iOS only accepts a *new* tunnel while the phone is on Wi-Fi, but an existing one keeps working on cellular.

**A patched go-ios, because the session assumes a cable.** [go-ios](https://github.com/danielpaulus/go-ios) starts the XCTest session, but first insists on finding the phone over USB. [A patch](device/patches/go-ios-cableout.patch) removes that assumption ([details](docs/architecture.md#how-a-session-reaches-an-unplugged-phone)).

**A runner, because something on the phone has to do the tapping.** [`runner/`](runner/) is an XCTest app, derived from [Maestro](https://github.com/mobile-dev-inc/Maestro)'s, that taps, types, swipes and takes screenshots on request. While it runs, iOS shows an "Automation Running" banner, so the server ends the session after every task and keeps only the tunnel warm.

[docs/architecture.md](docs/architecture.md) goes deeper: warm and cold starts, the developer disk image, sign-in, and how the server tells Wi-Fi, cellular, locked and unreachable apart.

## What you need

- An iPhone you own, on iOS 17 or later (built and tested on an iPhone 15 Pro with iOS 27), and an Apple developer account (a free one works, but its signing lasts 7 days).
- A Mac with Xcode, once, to build the runner and pair the phone.
- A small Linux server that stays on. A $6/month VPS is enough.
- A [Tailscale](https://tailscale.com) account, with the phone and the server on it.
- An API key for the model that drives the phone: OpenAI, Anthropic or Google, plus TypeSafe for the Jev hybrid.

## Set it up

1. **[Set up the server](docs/install-server.md)**: dependencies, this repository, the service, a public HTTPS address.
2. **[Set up the phone](docs/install-phone.md)**: build and install the runner, pair the phone with your server, first start.
3. **[Connect Claude](docs/connect-claude.md)**: add the custom connector and enter a one-time connect code.

Then, in the Claude app: *"Is my phone connected?"*

## What to expect

<img src="docs/media/ios-passcode-prompt.png" alt="iOS prompt: Enter iPhone Passcode for “XCTest” — Enable UI Automation" width="220" align="right">

- **The phone must be unlocked** when a task starts. After a restart, iOS asks once for the passcode to allow automation (right).
- **Wi-Fi to start, not to continue.** The first task after the phone has been idle for a while needs Wi-Fi. While the connection stays warm, later tasks also work on cellular.
- **Asking never touches the phone.** "Is my phone connected?" only looks.
- **Stopping**: say *stop* in the chat, or hold both volume buttons on the phone (instant). The Stop button in the Claude app also ends the task, within 30 seconds.
- **Every state has its own answer.** Locked, on cellular, unreachable, restarted, waiting for the passcode: the server tells Claude which, and what to do. [docs/operations.md](docs/operations.md) lists them.
- **The connector's icon will be Tailscale's** if your server uses a Tailscale address. [Why, and how to change it](docs/connect-claude.md#the-connectors-icon).

<br clear="right">

## Status

| | |
| --- | --- |
| The whole path, Claude app → server → iPhone → answer | Working on an iPhone 15 Pro (iOS 27) driven from a 1 GB Ubuntu 24.04 server |
| The agent on a benchmark | [Measured on iOSWorld](docs/results.md) in the iOS Simulator |
| The hybrid agents on the real phone | Deployed and choosable from the chat; not yet measured there |
| Tests without a phone | Unit, simulated-phone lifecycle, whole-path and MCP conformance tests, in CI on every push |
| The setup guides | Written from a working setup; not yet followed start to finish on a fresh machine |
| Limits on what the agent may do | None. It can do anything you could do by tapping. Use it on your own phone, and read [SECURITY.md](SECURITY.md) |

## Tests

Two kinds: **tests** that check the code does what it should, and **evals** that measure how well the AI does the job.

| Command | What it checks | Needs |
| --- | --- | --- |
| `npm test` | Server, agent and eval-harness unit tests (about 600 checks), against fake phones and fake model APIs | Nothing |
| `npm run test:lifecycle` | The real device code against a simulated phone: Wi-Fi and cellular, lock, restart, the passcode prompt (~4 min) | Nothing |
| `npm run test:e2e` | The real server and device code end to end, simulated phone, stand-in model | Nothing |
| `npm run test:conformance` | The MCP server against the official MCP conformance suite | Nothing |
| `npm run lint` | ESLint | Nothing |
| `npm run evals:phone-agent` | The agent on [iOSWorld](https://github.com/ljang0/iOSWorld)'s tasks in the iOS Simulator, graded by iOSWorld's judge ([results](docs/results.md)) | A Mac, a simulator, model keys |
| `npm run evals:connector` | How well the assistant you chat with uses this server's tools, graded by a judge from another company ([results](evals/baselines/connector/)) | Model keys |

CI runs the first five on every push, plus a build of the runner. `npm run test:record` runs every test and files the results under the version tested, in [test-results/](test-results/). [docs/development.md](docs/development.md) says what the simulated phone covers and what it does not.

## Repository layout

| Directory | What it is |
| --- | --- |
| [`server/`](server/) | The MCP server: sign-in (OAuth 2.1), the tools Claude calls, which model drives the phone, the task lifecycle |
| [`device/`](device/) | Everything the server does *to* the phone: tunnel, session start and stop, lock and network state |
| [`agent/`](agent/) | The loop that drives the phone, with every kind of model: LLMs, decision models, hybrids |
| [`runner/`](runner/) | The XCTest app on the iPhone that performs the taps (derived from Maestro, Apache-2.0) |
| [`evals/`](evals/) | The iOSWorld harness, the connector evals, and every filed result |
| [`deploy/`](deploy/) | systemd unit, settings templates, pinned Python requirements |
| [`e2e/`](e2e/) | The whole path against a simulated phone, and a guided check for a real one |
| [`docs/`](docs/) | Architecture, setup, operations, development, results |

## Third-party code

- `runner/` is derived from [Maestro](https://github.com/mobile-dev-inc/Maestro)'s iOS XCTest runner (Apache-2.0); [runner/README.md](runner/README.md) lists the changes.
- `device/patches/go-ios-cableout.patch` is a patch against [go-ios](https://github.com/danielpaulus/go-ios) (MIT), which `scripts/build-go-ios.sh` fetches and builds.
- `device/tunnel.py` uses [pymobiledevice3](https://github.com/doronz88/pymobiledevice3) (GPL-3.0), installed separately and not included here.
- The agent is evaluated on [iOSWorld](https://github.com/ljang0/iOSWorld), which is not included here.

## License

[MIT](LICENSE), except `runner/`, which keeps Maestro's Apache-2.0 license.
