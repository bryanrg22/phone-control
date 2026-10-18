# Phone agent on iOSWorld

Judge: gpt-5.4-mini (iOSWorld's script, unchanged) · 50 steps, no time limit · costs at list prices of 2026-10-15

## Outcomes

| model | trials | pass rate (95% interval) | pass^k | single_app | multi_app | memory | rubric score | test errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | 1 | 60% (31%–83%) of 10 | – | 60% of 10 | – | – | 0.888 | 0 |
| hybrid:typesafe:jev-latest+openai:gpt-6-luna | 1 | 90% (60%–98%) of 10 | – | 90% of 10 | – | – | 0.986 | 0 |

## Efficiency and cost

| model | avg steps | avg time (s) | avg model time (s) | input tokens (cached) | output (reasoning) | cost | per task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | 13.7 | 52.5 | 32.1 | 971,084 (459,566) | 17,579 (14,488) | $0.06 | $0.006 |
| hybrid:typesafe:jev-latest+openai:gpt-6-luna | 15.4 | 59.2 | 37 | 1,242,790 (543,537) | 52,319 (17,580) | $0.07 | $0.007 |

## How runs ended, and behaviour

| model | endings | tool error rate | questions to the user | steps by the LLM (hybrid) | served by |
| --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | completed 8, no_progress 2 | 2% of 145 | 3 | 63% (100) | gpt-6-luna |
| hybrid:typesafe:jev-latest+openai:gpt-6-luna | completed 10 | 3% of 158 | 4 | 67% (121) | jev-1.13.0, gpt-6-luna |

## Irreversible actions (safety, apart from the pass rate)

Taps that paid, ordered or deleted (agent/decision/irreversible.mjs), and whether the agent asked the user before the first; taps the hybrid's hold stopped until the user agreed; questions the eval answered yes (--auto-confirm: Yes/No confirmations only) or left unanswered.

| model | runs that paid, ordered or deleted | asked first | taps of that kind | taps held | asked and did not commit | auto-confirmed | unanswered |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | 3 of 10 | 3 of 3 | 3 | 0 | 0 | 3 | 0 |
| hybrid:typesafe:jev-latest+openai:gpt-6-luna | 4 of 10 | 4 of 4 | 5 | 0 | 0 | 4 | 0 |

## Confidence calibration (decision models)

Pass rate by the probability the model put on "done" when it ended the run; a well-calibrated model passes more often when it is surer.

| model | avg probability on the chosen action | done p 0–0.5 | done p 0.5–0.8 | done p 0.8–0.95 | done p 0.95–1 | did not end with done |
| --- | --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | 0.661 | – | 100% of 2 | 100% of 1 | – | 43% of 7 |
| hybrid:typesafe:jev-latest+openai:gpt-6-luna | 0.599 | – | – | 100% of 1 | 100% of 1 | 88% of 8 |
