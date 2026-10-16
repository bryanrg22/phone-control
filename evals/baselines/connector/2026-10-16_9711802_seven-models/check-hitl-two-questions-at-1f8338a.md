# Connector eval: models compared

7 runs · 3 graded trials each · costs at list prices of 2026-10-15 · judges from the other company

| model | pass@1 (95% interval) | pass^k | model calls / task | tool calls / task | model s / task (median) | total s / task | output tokens / task | input read from cache | cost / task | cost / passed task |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-6.1-sol | 100.0% (43.8%–100.0%) | 100.0% | 9.3 | 6.0 | 18.5 (16.0) | 44.5 | 405 | 93.6% | $0.0088 | $0.0088 |
| claude-opus-5-5 | 100.0% (43.8%–100.0%) | 100.0% | 7.3 | 6.0 | 13.9 (14.5) | 29.2 | 781 | 89.8% | $0.035 | $0.035 |
| gpt-6-astra | 100.0% (43.8%–100.0%) | 100.0% | 9.7 | 6.3 | 43.7 (48.5) | 65.2 | 548 | 93.2% | $0.064 | $0.064 |
| claude-fable-5-1 | 100.0% (43.8%–100.0%) | 100.0% | 9.0 | 6.0 | 16.6 (16.5) | 33.1 | 817 | 94.2% | $0.076 | $0.076 |
| claude-haiku-5-5 | 66.7% (20.8%–93.9%) | 0.0% | 7.7 | 6.0 | 8.9 (8.7) | 27.0 | 1098 | 88.9% | $0.0013 | $0.0019 |
| claude-sonnet-5-5 | 66.7% (20.8%–93.9%) | 0.0% | 9.7 | 6.7 | 13.5 (13.5) | 31.4 | 706 | 92.0% | $0.018 | $0.028 |
| gpt-6-luna | 33.3% (6.1%–79.2%) | 0.0% | 10.0 | 7.0 | 15.0 (14.8) | 42.0 | 403 | 93.9% | $0.0006 | $0.0017 |

Total time includes the scripted phone, the same for every model; model time is the part the model controls.

## Per task: tool calls · model seconds

| case | gpt-6.1-sol | claude-opus-5-5 | gpt-6-astra | claude-fable-5-1 | claude-haiku-5-5 | claude-sonnet-5-5 | gpt-6-luna |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hitl-two-questions | 6.0 · 18.5s | 6.0 · 13.9s | 6.3 · 43.7s | 6.0 · 16.6s | 6.0 · 8.9s (2/3 passed) | 6.7 · 13.5s (2/3 passed) | 7.0 · 15.0s (1/3 passed) |

Runs: `2026-10-16_1f8338a_gpt-6.1-sol_high`, `2026-10-16_1f8338a_claude-opus-5-5_high`, `2026-10-16_1f8338a_gpt-6-astra_high`, `2026-10-16_1f8338a_claude-fable-5-1_high`, `2026-10-16_1f8338a_claude-haiku-5-5_high`, `2026-10-16_1f8338a_claude-sonnet-5-5_high`, `2026-10-16_1f8338a_gpt-6-luna_high`
