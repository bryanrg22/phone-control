# Phone agent on iOSWorld

Judge: gpt-5.4-mini (iOSWorld's script, unchanged) · 50 steps, no time limit · costs at list prices of 2026-10-15

## Outcomes

| model | trials | pass rate (95% interval) | pass^k | single_app | multi_app | memory | rubric score | test errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | 1 | 86% (60%–96%) of 14 | – | 86% of 14 | – | – | 0.966 | 0 |

## Efficiency and cost

| model | avg steps | avg time (s) | avg model time (s) | input tokens (cached) | output (reasoning) | cost | per task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | 16.2 | 53.3 | 29.9 | 2,218,208 (936,468) | 19,372 (15,571) | $0.15 | $0.011 |

## How runs ended, and behaviour

| model | endings | tool error rate | questions to the user | steps by the LLM (hybrid) | served by |
| --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | completed 12, failed 1, no_progress 1 | 0% of 234 | 0 | 34% (118) | gpt-6-luna |

## Confidence calibration (decision models)

Pass rate by the probability the model put on "done" when it ended the run; a well-calibrated model passes more often when it is surer.

| model | avg probability on the chosen action | done p 0–0.5 | done p 0.5–0.8 | done p 0.8–0.95 | done p 0.95–1 | did not end with done |
| --- | --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | 0.622 | 100% of 2 | 100% of 3 | – | 50% of 2 | 86% of 7 |
