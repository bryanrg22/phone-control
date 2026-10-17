# Phone agent on iOSWorld

Judge: gpt-5.4-mini (iOSWorld's script, unchanged) · 50 steps, no time limit · costs at list prices of 2026-10-15

## Outcomes

| model | trials | pass rate (95% interval) | pass^k | single_app | multi_app | memory | rubric score | test errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typesafe:jev-latest+openai:gpt-6-luna | 1 | 30% (16%–48%) of 27 | – | 30% of 27 | – | – | 0.646 | 0 |
| openai-decisions:gpt-6-luna+openai:gpt-6-luna | 1 | 37% (22%–56%) of 27 | – | 37% of 27 | – | – | 0.703 | 0 |

## Efficiency and cost

| model | avg steps | avg time (s) | avg model time (s) | input tokens (cached) | output (reasoning) | cost | per task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| typesafe:jev-latest+openai:gpt-6-luna | 13.8 | 40.4 | 7.3 | 1,578,582 (0) | 179,771 (8,230) | $0.08 | $0.003 |
| openai-decisions:gpt-6-luna+openai:gpt-6-luna | 17.1 | 46.6 | 9.6 | 1,355,692 (0) | 10,920 (8,725) | $0.14 | $0.005 |

## How runs ended, and behaviour

| model | endings | tool error rate | questions to the user | served by |
| --- | --- | --- | --- | --- |
| typesafe:jev-latest+openai:gpt-6-luna | completed 13, failed 1, no_progress 13 | 0% of 418 | 0 | jev-1.13.0, gpt-6-luna |
| openai-decisions:gpt-6-luna+openai:gpt-6-luna | completed 15, step_budget 2, no_progress 10 | 0% of 517 | 0 | gpt-6-luna |

## Confidence calibration (decision models)

Pass rate by the probability the model put on "done" when it ended the run; a well-calibrated model passes more often when it is surer.

| model | avg probability on the chosen action | done p 0–0.5 | done p 0.5–0.8 | done p 0.8–0.95 | done p 0.95–1 | did not end with done |
| --- | --- | --- | --- | --- | --- | --- |
| typesafe:jev-latest+openai:gpt-6-luna | 0.541 | 67% of 3 | 25% of 4 | 67% of 3 | 100% of 3 | 0% of 14 |
| openai-decisions:gpt-6-luna+openai:gpt-6-luna | 0.554 | 67% of 9 | 100% of 1 | 100% of 1 | 50% of 4 | 0% of 12 |
