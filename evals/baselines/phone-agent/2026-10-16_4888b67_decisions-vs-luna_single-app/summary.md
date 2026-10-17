# Phone agent on iOSWorld

Judge: gpt-5.4-mini (iOSWorld's script, unchanged) · 50 steps, no time limit · costs at list prices of 2026-10-15

## Outcomes

| model | trials | pass rate (95% interval) | pass^k | single_app | multi_app | memory | rubric score | test errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai-decisions:gpt-6-luna | 1 | 11% (4%–28%) of 27 | – | 11% of 27 | – | – | 0.607 | 0 |
| openai:gpt-6-luna | 1 | 78% (59%–89%) of 27 | – | 78% of 27 | – | – | 0.89 | 0 |

## Efficiency and cost

| model | avg steps | avg time (s) | avg model time (s) | input tokens (cached) | output (reasoning) | cost | per task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openai-decisions:gpt-6-luna | 15.4 | 45.2 | 17.7 | 1,319,092 (0) | 0 (0) | $0.13 | $0.005 |
| openai:gpt-6-luna | 14.1 | 67.1 | 41.9 | 4,719,817 (3,067,740) | 45,213 (34,021) | $0.22 | $0.008 |

## How runs ended, and behaviour

| model | endings | tool error rate | questions to the user | served by |
| --- | --- | --- | --- | --- |
| openai-decisions:gpt-6-luna | completed 16, failed 1, no_progress 10 | 0% of 466 | 0 | gpt-6-luna |
| openai:gpt-6-luna | completed 22, failed 2, no_progress 3 | 1% of 383 | 2 | gpt-6-luna |

## Confidence calibration (decision models)

Pass rate by the probability the model put on "done" when it ended the run; a well-calibrated model passes more often when it is surer.

| model | avg probability on the chosen action | done p 0–0.5 | done p 0.5–0.8 | done p 0.8–0.95 | done p 0.95–1 | did not end with done |
| --- | --- | --- | --- | --- | --- | --- |
| openai-decisions:gpt-6-luna | 0.544 | 14% of 7 | 0% of 4 | 100% of 1 | 25% of 4 | 0% of 11 |
