# Phone agent on iOSWorld

Judge: gpt-5.4-mini (iOSWorld's script, unchanged) · 50 steps, no time limit · costs at list prices of 2026-10-15

## Outcomes

| model | trials | pass rate (95% interval) | pass^k | single_app | multi_app | memory | rubric score | test errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | 1 | 69% (42%–87%) of 13 | – | 69% of 13 | – | – | 0.917 | 0 |

## Efficiency and cost

| model | avg steps | avg time (s) | avg model time (s) | input tokens (cached) | output (reasoning) | cost | per task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | 14 | 54.4 | 32.3 | 1,916,490 (920,322) | 21,628 (17,909) | $0.12 | $0.009 |

## How runs ended, and behaviour

| model | endings | tool error rate | questions to the user | steps by the LLM (hybrid) | served by |
| --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | completed 11, no_progress 2 | 0% of 193 | 0 | 39% (115) | gpt-6-luna |

## Confidence calibration (decision models)

Pass rate by the probability the model put on "done" when it ended the run; a well-calibrated model passes more often when it is surer.

| model | avg probability on the chosen action | done p 0–0.5 | done p 0.5–0.8 | done p 0.8–0.95 | done p 0.95–1 | did not end with done |
| --- | --- | --- | --- | --- | --- | --- |
| hybrid:openai-decisions:gpt-6-luna+openai:gpt-6-luna | 0.538 | 60% of 5 | 100% of 2 | 100% of 2 | 100% of 1 | 33% of 3 |
