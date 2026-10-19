# Results

How well each way of driving the phone does on a public benchmark, what it
costs, how long it takes, and how sure we are. Every number here comes from a
recorded run in [`evals/baselines/phone-agent/`](../evals/baselines/phone-agent/);
none are estimates.

**In one line:** over three trials, with every run checked by hand (the
judge's passes and its fails), GPT-6 Luna alone completed the task in **74%**
of its runs on the 27 tasks and the sticky hybrid (OpenAI's Decisions API
choosing, Luna taking over the hard steps) in **67%**: not a significant difference. The hybrid is about a fifth faster and 10% cheaper a
task, but it paid a $50 transfer twice in every run of the payment task, so
it is not yet safe to spend money. The one-trial result published before this
(24 of 27 against 20) did not hold up (see [How sure we are](#how-sure-we-are)).

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
| Pass | The judge finds **every** rubric criterion met **and** the pass holds up when checked by hand (see [Are the tests themselves right?](#are-the-tests-themselves-right)) |
| Trials | 3 for Luna alone and both sticky hybrids; 1 for the other agents |
| Model settings | Provider-default reasoning effort; web search offered to the LLM, in every trial. These runs predate the current protocol in `evals/phone-agent/run.mjs`, which sets effort `high` and no web search, so new runs are compared with each other, not with these |
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
| The harness | Screen reading (the screenshot and the element list), the actions, the 50-step budget and the stop rules are the same for every agent within a trial. The decision models are offered the same options in every run; a hybrid adds only its hand-off (a "write into this field" option and the rules for when the LLM takes over) |
| The judge | iOSWorld's own judging script, unmodified, with the same model for every run; it sees the same kind of record for every agent (the screens and the final answer) |
| The hand check | Every run of the three agents run three times, and of the step hybrid, was checked against the screens, the saved app data and the seed, whether the judge passed it or failed it, by one written bar, with the borderline cases ruled the same way for every agent ([the bar and the rulings](../evals/baselines/phone-agent/2026-10-17_7625741_luna-and-sticky-hybrids_trials-2-3_single-app/README.md#how-each-pass-was-checked)) |
| The rules | The hand-off threshold and limits were set before the first run and never tuned on these tasks. A finished task counts as it finished: tasks interrupted by the machine (a full disk, a power loss) were run afterwards on the same code, and none was re-run to improve its result |
| The accounting | Tokens come from each API's own usage report on every call, priced at the provider's list price; time is measured by the harness around each call and each task |
| The record | Every run stores its commit (with a clean working tree), the benchmark's version, the simulator and Xcode versions and every setting, in `run_info.json` beside its results |

**Not controlled, and said so:** a model can answer differently on the same
screen, which is why there are three trials; the decision APIs are previews
whose models can change behind the same name; runs happened at different times
of day against live APIs, and some app content (the weather forecast, a sports
scoreboard) is live; trials 2 and 3 ran on a harness with three fixes that
trial 1 did not have (see [Other limits](#how-sure-we-are)).

## Results

### The three leading agents, three trials

iOSWorld's 27 single-app tasks, three trials each (81 runs per agent).

| Agent | Real passes, trial 1 / 2 / 3 | Mean pass rate (95% interval) | pass^3 (95% interval) | Judged passes | Steps / task | Model time / task | Wall time / task | Cost / task | Cost per real pass |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Luna alone** | 18 / 21 / 21 | **74%** (59–88%) | **16** of 27 (41–76%) | 63 | 13.6 | 41.5 s | 65 s | $0.0083 | **$0.0112** |
| Sticky hybrid, Decisions | 20 / 18 / 16 | 67% (53–80%) | 13 of 27 (31–66%) | 67 | 13.8 | **30.4 s** | **53 s** | $0.0075 | $0.0113 |
| Sticky hybrid, Jev | 15 / 16 / 16 | 58% (42–74%) | 12 of 27 (28–63%) | 61 | 13.9 | 30.9 s | 53 s | **$0.0069** | $0.0119 |

- **Real passes** are the runs that hold up when checked by hand, whichever
  way the judge went (next section): 38 of these agents' 191 judged passes
  (20%) did not hold up, and 8 of their 52 judged fails (15%) did.
- **Mean pass rate** is real passes over the 81 runs. Its 95% interval
  resamples tasks, each with its three runs (10,000 resamples), because the
  runs of one task are not independent of each other.
- **pass^3** is the tasks passed in all three trials: what someone relying on
  the agent gets every time ([τ-bench](https://arxiv.org/abs/2406.12045)'s
  pass^k). Wilson interval over 27 tasks.
- **Model time** is time spent waiting on model APIs; **wall time** is the whole
  task, including the phone's own time to act and settle. Both are means over
  the 81 runs.
- **Cost** is each call's recorded tokens at the provider's list price
  (cached input at the cached rate). **Cost per real pass** is total cost
  divided by real passes: what one completed task costs.

### Every agent

The other agents ran once. The step hybrid's runs were all checked by hand,
passes and fails; the writer hybrids' and the decision models' judged passes
were checked, their judged fails were not (see the note below the table).

| Agent | Trials | Judged passes | Real passes | 95% interval | Steps / task | Model time / task | Wall time / task | Cost / task |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Luna alone | 3 | 63 of 81 | **60 of 81** (74%) | 59–88% | 13.6 | 41.5 s | 65 s | $0.0083 |
| Sticky hybrid, Decisions | 3 | 67 of 81 | 54 of 81 (67%) | 53–80% | 13.8 | 30.4 s | 53 s | $0.0075 |
| Sticky hybrid, Jev | 3 | 61 of 81 | 47 of 81 (58%) | 42–74% | 13.9 | 30.9 s | 53 s | $0.0069 |
| Step hybrid, Decisions | 1 | 21 of 27 | 14 of 27 (52%) | 34–69% | 15.1 | 31.1 s | 54 s | $0.0099 |
| Writer hybrid, Decisions | 1 | 10 of 27 | 7 of 27 | 13–45% | 17.1 | 9.6 s | 47 s | $0.0052 |
| Writer hybrid, Jev | 1 | 8 of 27 | 5 of 27 | 8–37% | 13.8 | 7.3 s | 40 s | $0.0029 |
| Decisions alone | 1 | 3 of 27 | 0 of 27 | 0–12% | 15.4 | 17.7 s | 45 s | $0.0049 |
| Jev alone | 1 | 2 of 27 | 0 of 27 | 0–12% | 15.4 | 2.2 s | 25 s | $0.0025 |

A decision model alone writes no answer ("The decision model judged the task
complete on the current screen"), so on tasks that ask a question it passes
only when the judge reads the answer off the screen itself; none of its five
judged passes holds up. The single-trial intervals are Wilson intervals over
27 tasks. The step hybrid's 21 judged passes came down to 13 that hold up
(two answers with a wrong time or price, trailblaze-004, a damaged slide
title, salmon added twice, three with no answer or not the one asked), and
one of its 6 judged fails holds up, so 14; it also sent mybank-003's $50 three
times without asking ([its check](../evals/baselines/phone-agent/2026-10-16_487f174_hybrid_single-app/hand-check.md)).
Luna alone's trial 1, checked the same way, has 18, so the step hybrid's "21,
the same as Luna" was the judge's count. The writer hybrids' and the decision
models' judged fails were not checked; on the agents whose fails were, 8 of 52
(15%) held up, so their real counts may be a little higher, not lower.

### Tokens

| Agent | Model calls / task | Input tokens / task | Of which cached | Output tokens / task |
| --- | :---: | :---: | :---: | :---: |
| Luna alone (3 trials) | 13.6 | 172,488 | 63% | 1,808 |
| Sticky hybrid, Decisions (3 trials) | 16.2 | 149,925 | 61% | 1,536 |
| Sticky hybrid, Jev (3 trials) | 16.5 | 158,452 | 60% | 4,264 |
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

| Run (27 tasks; three-trial mean where marked) | Decision calls | Decision cost | Luna calls | Luna cost | Total |
| --- | :---: | :---: | :---: | :---: | :---: |
| Luna alone (3 trials) | – | – | 367 | $0.224 | $0.224 |
| Step hybrid, Decisions | 408 | $0.111 | 233 | $0.156 | $0.267 |
| Sticky hybrid, Decisions (3 trials) | 162 | $0.044 | 277 | $0.159 | $0.203 |
| Sticky hybrid, Jev (3 trials) | 159 | $0.024 | 287 | $0.162 | $0.186 |

The step hybrid was faster than Luna but cost more: 232 of its 408 decision
calls were handed to Luna anyway, so both were paid for. Keeping Luna in
control (sticky) cut decision calls to about 160; Luna still takes about three
in four steps, so a sticky hybrid costs a little less than Luna alone, not much less.

### Per task

Each cell is trials 1, 2, 3: ✓ judged a pass and holds up, † judged a pass
but does not hold up, ‡ judged a fail but holds up (the judge under-credited
it), ✗ judged a fail and is one; real passes in brackets. The single-trial agents
are in their baselines ([step hybrid](../evals/baselines/phone-agent/2026-10-16_487f174_hybrid_single-app/),
[writer hybrids](../evals/baselines/phone-agent/2026-10-16_75c3f2c_writer-hybrids_single-app/per-task.md),
[decision models alone](../evals/baselines/phone-agent/2026-10-16_c4d73d2_jev_single-app/hand-check.md)).

| task | Luna | Sticky · Decisions | Sticky · Jev |
| --- | :---: | :---: | :---: |
| caltrack-001 | ✗✗✗ (0) | †✗✗ (0) | ✗✗✗ (0) |
| cinephile-001 | ✓✓✓ (3) | ✓✓† (2) | ✓✓✓ (3) |
| cityride-001 | ✓✗✓ (2) | ✓‡✗ (2) | ✓✓‡ (3) |
| clock-001 | ✓✓✓ (3) | ✓✓✓ (3) | ✓✗✓ (2) |
| clouddocs-004 | ✓✓✓ (3) | ✓✓✓ (3) | ✓✓✓ (3) |
| clouddrive-001 | ✓✓✓ (3) | ✓✓✓ (3) | ✓✓✓ (3) |
| cloudsheets-003 | ‡✓‡ (3) | ✓✓✓ (3) | ✓✓‡ (3) |
| cloudslides-002 | †✓✓ (2) | ✓†✓ (2) | ††✗ (0) |
| dinespot-001 | ✓✓✓ (3) | ✓✓✓ (3) | ✓✓✗ (2) |
| freshcart-001 | ✗✓‡ (2) | ✓✓✓ (3) | ††✓ (1) |
| lockedin-003 | ✓✓✓ (3) | ✓✓✓ (3) | ✓‡✓ (3) |
| lockedin-004 | ✓✗✗ (1) | ✓✗✗ (1) | ✗✓† (1) |
| mail-002 | †✓† (1) | †✓† (1) | †✗† (0) |
| megamart-001 | ✓✓✓ (3) | ✓†✓ (2) | ✓✓✓ (3) |
| mybank-003 | ✗✗✗ (0) | ✗✗✗ (0) | ✗✗✗ (0) |
| notes-001 | ✓✓✓ (3) | ✓✓✓ (3) | ✓✓† (2) |
| quickbite-001 | ✗✗✗ (0) | ✗✓✗ (1) | ✗✗✓ (1) |
| quickchat-003 | ✓✓✓ (3) | ✓✓✓ (3) | ✓✓✓ (3) |
| scorezone-003 | ✓✓✓ (3) | †✓† (1) | ✓✓✓ (3) |
| skytrip-002 | ✓✓✓ (3) | ✓†✗ (1) | ✗†† (0) |
| splitpay-001 | ✓✓✓ (3) | ✓✓✓ (3) | †✓✗ (1) |
| stayfinder-001 | ✓✓✓ (3) | ✓✓✓ (3) | ✓✓✓ (3) |
| tasterank-001 | ✓✓✓ (3) | ✓✓✓ (3) | ✓✓✓ (3) |
| teamchat-003 | ✓✓✓ (3) | ✓✓✓ (3) | ✓✓✓ (3) |
| ticketbox-004 | ††† (0) | ††✓ (1) | ††† (0) |
| trailblaze-004 | †✓✓ (2) | ††† (0) | ††✓ (1) |
| weather-004 | ✗✓‡ (2) | ✓✗✗ (1) | ✗†✗ (0) |
| **total** | **60** of 81 | **54** of 81 | **47** of 81 |

The evidence for every mark is in the baselines' `hand-check.md` files.

## Are the tests themselves right?

A benchmark score is only as good as its tasks and its judge, so both were
checked against the recorded evidence rather than taken on trust.

**Every run of the three leading agents was checked by hand**, the 191 the
judge passed and the 52 it failed: the actions and the screen after each one, the screenshots of the
decisive screens, the app's saved data where it keeps any, and iOSWorld's seed
data where a pass depended on what was there before. A pass holds only if what
the task asked for really happened, once, to the right item, with nothing else
damaged, and the answer is true. **38 (20%) did not hold up**, and they were
not spread evenly: 79% of the Decisions hybrid's judged passes hold up against
89% of Luna's, so the judge alone ranks the hybrid first and the hand check
ranks Luna first. What the judge gets wrong, by count:

| What happened | Times | Where |
| --- | :---: | --- |
| A "price range" that is only the four visible section prices ($116–$168; the 28 listings run from $101 to $333) | 8 | ticketbox-004, every agent |
| The same action done more than once (two receipts archived, two controllers or two salmon added, a payment sent two or three times, three meals logged and no answer) | 10 | mail-002 (6), freshcart-001, megamart-001, splitpay-001, caltrack-001 |
| Kudos that changed nothing, undid an existing like, or went to the user's own run | 6 | trailblaze-004 |
| Existing content damaged ("Agenda" turned into "• Agenda", a bullet split in two) | 5 | cloudslides-002, notes-001 |
| No answer, a wrong answer, or a feed alert reported as the article read | 7 | skytrip-002 (3), scorezone-003 (2), lockedin-004, weather-004 |
| An item never added, with the answer saying it was | 1 | cinephile-001 |
| An item nobody asked for added to the cart | 1 | freshcart-001 |

**trailblaze-004 can be passed.** Earlier passes on it were all false (the
friend's run is already liked in the seed), and this page said no agent could
pass it honestly. Three runs did: Luna twice and the Jev hybrid once gave kudos
to another friend's indoor ride that was not yet liked (17 to 18).

**Strict calls, applied to every agent alike.** ticketbox-004 counts only if
the answer gives the listings' real range (one run did: $101–$333); the
section prices alone do not. Archiving a second receipt counts as doing the
task twice. A conclusion that does not follow from the numbers given (the
"warmer" city) does not count. Each ruling and the cells it decides are in
[the baseline](../evals/baselines/phone-agent/2026-10-17_7625741_luna-and-sticky-hybrids_trials-2-3_single-app/README.md#how-each-pass-was-checked).

**The judge also under-credits, less often.** The 52 judged fails were held to
the same bar, against the task's goal rather than the judge's rubric (which
sometimes asks for more, like mybank-003's memo): **8 (15%) were really done**,
4 of Luna's, 3 of the Jev hybrid's, 1 of the Decisions hybrid's. The judge
could not tie a spreadsheet edit to the volunteer's name once the sheet had
scrolled sideways (cloudsheets-003, three runs), did not accept the app's
"Home" as the 410 Brannan St pickup the task names (cityride-001, two runs; it
passed other runs showing the same screen), read next weekend's forecast rows
(weather-004), failed a store-selection step that is only procedure
(freshcart-001), and took the user's own name in a reply for the person
messaged (lockedin-003). The other 44 do not count: 36 real fails, and 8
done twice or more or with a question left unanswered. With the fails checked, every
run of these three agents counts as the hand check found it, not as the judge
did; the counts above are those. Checking only passes had put the three agents
at 56, 53 and 44; checking both ways gives 60, 54 and 47, and the ranking is
the same ([every fail, with its evidence](../evals/baselines/phone-agent/2026-10-17_7625741_luna-and-sticky-hybrids_trials-2-3_single-app/fails-check.md)).

**Spending money.** mybank-003 asks to send $50 by Zelle and quickbite-001 to
place an order. **Luna alone failed both because it asks for confirmation
before spending money**: it asked in all three mybank-003 runs and in two of
the three quickbite-001 runs (the third stalled), and with the benchmark leaving
the question unanswered it sent and ordered nothing. **Both sticky hybrids
sent the $50 without asking, and sent it at least twice in every one of their
six runs** (three times in one), each a separate transaction in MyBank's saved
data. In the Decisions hybrid, Luna, handed the step, sent the first payment;
when control went back to the decision model (in the run traced step by step,
at the 5-step sticky limit), it went through the transfer again and sent a
second (it chose "Send now" at p = 0.87–0.88).
In the Jev hybrid, Jev chose "Send now" twice. The judge failed all six runs for
a missing memo, so the scores above do not show this. The step hybrid (one
trial) sent it three times, the decision model choosing "Send now" each time. A fix (the hybrid asking
before it pays) is in progress and not measured here.

**mybank-003** is passed by no agent here: Luna alone asked and sent nothing,
and every run of the sticky and step hybrids sent the money more than once. The judge's rubric also asks
for a memo, which the goal does not mention and no agent added; the hand
check holds runs to the goal, so the memo decides nothing.

**The judge's reliability.** For the connector evals below, every verdict was
graded again by a judge from another company: 648 of 648 agreed (Cohen's
κ = 1.00). The iOSWorld judge's verdicts are now checked by hand for every run of
the three leading agents (it is wrong on 20% of its passes and 15% of its
fails) and of the step hybrid; the writer hybrids' and the decision models'
fails have not been, and no second human labeller has graded the same runs, so
there is no agreement figure for the hand check itself.

## How sure we are

**Paired comparison.** The agents ran the same 27 tasks in the same three
trials, so the fair test compares them run by run (81 pairs): the exact
McNemar test on the runs only one of the two passed. The three runs of one task
are related, so the same comparison is also made task by task (a sign test over
the tasks on which one agent passed more of its runs), the more conservative
test.

| Comparison | Runs only the first passed | Runs only the second passed | McNemar p | Tasks first ahead / second ahead | Sign test p |
| --- | :---: | :---: | :---: | :---: | :---: |
| Luna vs Sticky · Decisions | 12 | 6 | 0.24 | 6 / 3 | 0.51 |
| Luna vs Sticky · Jev | 16 | 3 | **0.0044** | 10 / 2 | **0.039** |
| Sticky · Decisions vs Sticky · Jev | 15 | 8 | 0.21 | 10 / 5 | 0.30 |

What this says, plainly:

- **Luna alone and the Decisions hybrid: no significant difference** in how
  often they complete a task (p = 0.24). The one-trial claim that the hybrid
  passed every task Luna passed and four more did not survive: over three trials
  each agent passed runs the other failed (12 and 6), and 5 of the hybrid's 25
  trial-1 passes were not real. What does hold: the hybrid is faster (53 s
  against 65 s a task, a quarter less time waiting on models) and slightly
  cheaper ($0.0075 against $0.0083 a task).
- **Luna alone beats the Jev hybrid**: p = 0.0044 run by run, which holds
  after correcting for the three comparisons made here (Holm, 0.0167 needed),
  and 0.039 task by task, the more conservative test, which is below 0.05 on
  its own but not after the correction. Good evidence; the task-level test is
  the weaker link. (Before the judged fails were checked, the run-by-run p was
  0.017 and just missed the correction; the fails the judge under-credited were
  more often Luna's.)
- **Decisions vs Jev as the chooser in a hybrid: not significant** (p = 0.21),
  though the Decisions hybrid is ahead on 10 tasks against 5.
- **How large a difference these 81 runs can detect:** an interval of about
  ±14 points on each agent's mean pass rate. Differences of a few points, like
  Luna's 7 over the Decisions hybrid, need more tasks, not more trials: running
  all 133 tasks would cover multi-app work too.

**Other limits.**

- **Simulator only.** The same harness drives a real iPhone (the product), but
  these numbers are from the simulator. Real apps can lay out their screens
  differently.
- **Trials 2 and 3 ran on newer code.** Trial 1 used commits `4888b67` (Luna,
  decision models) and `dbc720b` (sticky hybrids); trials 2 and 3 used
  `7625741`, which adds three harness fixes found by reading trial 1 (a scroll
  waits for the screen to settle, so the next tap is not swallowed; a field is a
  search field only if its name says Search; a multi-line field is appended
  to). Within each trial all three agents ran the same code, so the paired
  tests compare like with like, but the three-trial means mix the two versions.
  The agents' settings, tools and hand-off rules are the same in all three
  trials; the system prompt differs only in its date. The other agents' single
  runs used `487f174` (step hybrid) and `75c3f2c` (writer).
- **The apps are not frozen.** The weather forecast and some scoreboards come
  from live data, so weather-004 and scorezone-003 had different right answers
  on different days.
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

1. **Stop the hybrids paying twice, and make them ask before spending money**,
   then measure mybank-003, quickbite-001 and splitpay-001 again.
2. **Check the writer hybrids' and the decision models' judged fails by
   hand**, the last runs checked only one way, and have a second person
   re-grade a sample of the hand check to measure its own agreement.
3. **More tasks rather than more trials**: the 60 multi-app and 46 memory tasks,
   which is what it would take to tell apart agents a few points apart.
4. **Other LLMs inside the hybrid** (GPT-6.1 Sol, Claude Sonnet 5.5), to see
   whether the hybrid's speed holds with a stronger, costlier model.
5. **The real phone**: the hybrids are deployed and choosable ("use Decisions",
   "use Jev"), but not yet measured there.

## Reproducing a run

```bash
evals/phone-agent/prepare-simulator.sh <iOSWorld checkout>   # once: erases a simulator, installs iOSWorld's apps and the runner
evals/phone-agent/start-runner.sh <simulator UDID>            # leave running
node evals/phone-agent/run.mjs --udid <udid> \
  --models openai:gpt-6-luna,hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna \
  --escalation-mode sticky --tasks single_app --trials 3
```

Needs `OPENAI_API_KEY` (agent and judge) and, for Jev, `TYPESAFE_API_KEY`.
The runs above used provider-default effort and offered web search; to repeat
them exactly, check out `7625741`, whose `run.mjs` predates the current
protocol. [`evals/phone-agent/README.md`](../evals/phone-agent/README.md) has
the full procedure; each baseline folder has the run's settings
(`run_info*.json`), its summary and its hand check.
