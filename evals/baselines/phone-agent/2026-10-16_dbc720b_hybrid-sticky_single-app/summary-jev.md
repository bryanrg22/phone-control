# Phone agent on iOSWorld

Judge: gpt-5.4-mini (iOSWorld's script, unchanged) · 50 steps, no time limit · costs at list prices of 2026-10-15

## Outcomes

| model | trials | pass rate (95% interval) | pass^k | single_app | multi_app | memory | rubric score | test errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid:typesafe:jev-latest+openai:gpt-6-luna | 1 | 78% (59%–89%) of 27 | – | 78% of 27 | – | – | 0.917 | 0 |

## Efficiency and cost

| model | avg steps | avg time (s) | avg model time (s) | input tokens (cached) | output (reasoning) | cost | per task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid:typesafe:jev-latest+openai:gpt-6-luna | 15.2 | 59 | 36.1 | 4,838,716 (2,811,400) | 126,534 (37,015) | $0.00 | $0.000 |

## How runs ended, and behaviour

| model | endings | tool error rate | questions to the user | steps by the LLM (hybrid) | served by |
| --- | --- | --- | --- | --- | --- |
| hybrid:typesafe:jev-latest+openai:gpt-6-luna | completed 22, failed 1, no_progress 4 | 1% of 424 | 0 | 65% (318) | jev-1.13.0, gpt-6-luna |

## Confidence calibration (decision models)

Pass rate by the probability the model put on "done" when it ended the run; a well-calibrated model passes more often when it is surer.

| model | avg probability on the chosen action | done p 0–0.5 | done p 0.5–0.8 | done p 0.8–0.95 | done p 0.95–1 | did not end with done |
| --- | --- | --- | --- | --- | --- | --- |
| hybrid:typesafe:jev-latest+openai:gpt-6-luna | 0.602 | – | 80% of 5 | 100% of 3 | 100% of 3 | 69% of 16 |
