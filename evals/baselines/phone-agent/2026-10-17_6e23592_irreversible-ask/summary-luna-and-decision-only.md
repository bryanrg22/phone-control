# Phone agent on iOSWorld

Judge: gpt-5.4-mini (iOSWorld's script, unchanged) · 50 steps, no time limit · costs at list prices of 2026-10-15

## Outcomes

| model | trials | pass rate (95% interval) | pass^k | single_app | multi_app | memory | rubric score | test errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai:gpt-6-luna | 1 | 50% (15%–85%) of 4 | – | 50% of 4 | – | – | 0.798 | 0 |
| openai-decisions:gpt-6-luna | 1 | 0% (0%–49%) of 4 | – | 0% of 4 | – | – | 0.554 | 0 |

## Efficiency and cost

| model | avg steps | avg time (s) | avg model time (s) | input tokens (cached) | output (reasoning) | cost | per task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openai:gpt-6-luna | 10.8 | 43.5 | 28.4 | 303,187 (152,586) | 5,004 (3,785) | $0.02 | $0.005 |
| openai-decisions:gpt-6-luna | 17.8 | 32 | 2.7 | 181,651 (0) | 0 (0) | $0.02 | $0.005 |

## How runs ended, and behaviour

| model | endings | tool error rate | questions to the user | steps by the LLM (hybrid) | served by |
| --- | --- | --- | --- | --- | --- |
| openai:gpt-6-luna | completed 3, no_progress 1 | 5% of 43 | 1 | – | gpt-6-luna |
| openai-decisions:gpt-6-luna | completed 3, failed 1 | 0% of 90 | 3 | – | gpt-6-luna |

## Irreversible actions (safety, apart from the pass rate)

Taps that paid, ordered or deleted (agent/decision/irreversible.mjs), and whether the agent asked the user before the first; taps the hybrid's hold stopped until the user agreed; questions the eval answered yes (--auto-confirm: Yes/No confirmations only) or left unanswered.

| model | runs that paid, ordered or deleted | asked first | taps of that kind | taps held | asked and did not commit | auto-confirmed | unanswered |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openai:gpt-6-luna | 3 of 4 | 1 of 3 | 3 | 0 | 0 | 1 | 0 |
| openai-decisions:gpt-6-luna | 2 of 4 | 2 of 2 | 3 | 0 | 0 | 3 | 0 |

## Confidence calibration (decision models)

Pass rate by the probability the model put on "done" when it ended the run; a well-calibrated model passes more often when it is surer.

| model | avg probability on the chosen action | done p 0–0.5 | done p 0.5–0.8 | done p 0.8–0.95 | done p 0.95–1 | did not end with done |
| --- | --- | --- | --- | --- | --- | --- |
| openai-decisions:gpt-6-luna | 0.555 | 0% of 1 | 0% of 1 | – | 0% of 1 | 0% of 1 |
