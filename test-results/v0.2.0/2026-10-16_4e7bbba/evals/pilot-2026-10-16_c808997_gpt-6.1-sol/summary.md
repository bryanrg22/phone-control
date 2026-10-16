# Phone agent on iOSWorld

Judge: gpt-5.4-mini (iOSWorld's script, unchanged) · 50 steps, no time limit · costs at list prices of 2026-10-15

## Outcomes

| model | trials | pass rate (95% interval) | pass^k | single_app | multi_app | memory | rubric score | test errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openai:gpt-6.1-sol | 1 | 50% (9%–91%) of 2 | – | 50% of 2 | – | – | 0.75 | 0 |

## Efficiency and cost

| model | avg steps | avg time (s) | avg model time (s) | input tokens (cached) | output (reasoning) | cost | per task |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openai:gpt-6.1-sol | 15 | 69 | 47.7 | 203,887 (105,357) | 1,743 (719) | $0.23 | $0.113 |

## How runs ended, and behaviour

| model | endings | tool error rate | questions to the user | served by |
| --- | --- | --- | --- | --- |
| openai:gpt-6.1-sol | completed 1, no_progress 1 | 0% of 30 | 0 | gpt-6.1-sol |
