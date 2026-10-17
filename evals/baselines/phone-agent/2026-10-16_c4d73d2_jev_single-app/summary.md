# Phone agent on iOSWorld

Judge: gpt-5.4-mini (iOSWorld's script, unchanged) · 50 steps, no time limit · costs at list prices of 2026-10-15

## Outcomes

| model | trials | pass rate (95% interval) | pass^k | single_app | multi_app | memory | rubric score | test errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typesafe:jev-latest | 1 | 7% (2%–23%) of 27 | – | 7% of 27 | – | – | 0.528 | 0 |

## Efficiency and cost

| model | avg steps | avg time (s) | avg model time (s) | input tokens (cached) | output (reasoning) | cost | per task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| typesafe:jev-latest | 15.4 | 25.4 | 2.2 | 1,578,852 (0) | 176,981 (0) | $0.07 | $0.002 |

## How runs ended, and behaviour

| model | endings | tool error rate | questions to the user | served by |
| --- | --- | --- | --- | --- |
| typesafe:jev-latest | completed 11, failed 3, no_progress 13 | 0% of 468 | 0 | jev-1.13.0 |

## Confidence calibration (decision models)

Pass rate by the probability the model put on "done" when it ended the run; a well-calibrated model passes more often when it is surer.

| model | avg probability on the chosen action | done p 0–0.5 | done p 0.5–0.8 | done p 0.8–0.95 | done p 0.95–1 | did not end with done |
| --- | --- | --- | --- | --- | --- | --- |
| typesafe:jev-latest | 0.519 | 0% of 1 | 17% of 6 | 0% of 2 | 50% of 2 | 0% of 16 |
