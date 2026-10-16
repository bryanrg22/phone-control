# phone-control 0.2.0 — test record

- **Commit:** `89692a9c0f895cfd9ce43524ad32b1910c0adbd9`
- **Recorded:** 2026-10-16T07:41:48.815Z on darwin 25.6.0 arm64, Node v23.9.0, Xcode 26.4
- **Tools an assistant sees:** `87d59cb607e1` (full list in `tools.json`) — unchanged since the previous record
- **Result:** every suite passed
- **Note:** Seven-model connector baseline with prompt caching and a simulated user (evals/baselines/connector/2026-10-16_9711802_seven-models). Full runs on 9711802, with hitl-two-questions and status-connected re-graded after their correction in 1f8338a (shown beside the original); a fresh run of hitl-two-questions on 1f8338a checks the corrected case and the clearer refusal message.

## Suites

| suite | result | counts | time | full output |
| --- | --- | --- | --- | --- |
| lint | PASS |  | 1s | [suites/lint.log](suites/lint.log) |
| unit | PASS | 22 passed, 0 failed | 10s | [suites/unit.log](suites/unit.log) |
| lifecycle | PASS | 26 passed, 0 failed, 2 skipped | 228s | [suites/lifecycle.log](suites/lifecycle.log) |
| e2e | PASS | 13 passed, 0 failed, 0 skipped | 33s | [suites/e2e.log](suites/e2e.log) |
| conformance | PASS | 5 passed, 0 failed, 25 expected failures | 115s | [suites/conformance.log](suites/conformance.log) |
| eval-harness-self-test | PASS | oracle assistant: 100% of 19 trials passed, null assistant: 0% of 19 trials passed | 183s | [suites/eval-harness-self-test.log](suites/eval-harness-self-test.log) |

## Not verified by this record

These scenarios were skipped on this machine, so nothing here vouches for them:

- lifecycle: suspend on one phone leaves another phone's session alone
- lifecycle: network label: Wi-Fi, cellular and UNREACHABLE are three different answers

## Evals

| run | assistant | judge | pass@1 (95% interval) | pass^k | trials | ran on commit |
| --- | --- | --- | --- | --- | --- | --- |
| [2026-10-16_9711802_claude-fable-5-1_high](evals/2026-10-16_9711802_claude-fable-5-1_high/summary.md) | claude-fable-5-1 (high) | openai gpt-6.1-sol | 100% (94%–100%) → **100% (94%–100%)** re-graded | 100% → **100%** | 57 graded, 0 test errors | `9711802` (earlier; since then: 48 files changed, 3798 insertions(+), 17 deletions(-)) |
| [2026-10-16_9711802_claude-haiku-5-5_high](evals/2026-10-16_9711802_claude-haiku-5-5_high/summary.md) | claude-haiku-5-5 (high) | openai gpt-6.1-sol | 96% (88%–99%) → **96% (88%–99%)** re-graded | 89% → **89%** | 57 graded, 0 test errors | `9711802` (earlier; since then: 48 files changed, 3798 insertions(+), 17 deletions(-)) |
| [2026-10-16_9711802_claude-opus-5-5_high](evals/2026-10-16_9711802_claude-opus-5-5_high/summary.md) | claude-opus-5-5 (high) | openai gpt-6.1-sol | 100% (94%–100%) → **100% (94%–100%)** re-graded | 100% → **100%** | 57 graded, 0 test errors | `9711802` (earlier; since then: 48 files changed, 3798 insertions(+), 17 deletions(-)) |
| [2026-10-16_9711802_claude-sonnet-5-5_high](evals/2026-10-16_9711802_claude-sonnet-5-5_high/summary.md) | claude-sonnet-5-5 (high) | openai gpt-6.1-sol | 98% (91%–100%) → **100% (94%–100%)** re-graded | 95% → **100%** | 57 graded, 0 test errors | `9711802` (earlier; since then: 48 files changed, 3798 insertions(+), 17 deletions(-)) |
| [2026-10-16_9711802_gpt-6-astra_high](evals/2026-10-16_9711802_gpt-6-astra_high/summary.md) | gpt-6-astra (high) | anthropic claude-opus-5-5 | 100% (94%–100%) → **100% (94%–100%)** re-graded | 100% → **100%** | 57 graded, 0 test errors | `9711802` (earlier; since then: 48 files changed, 3798 insertions(+), 17 deletions(-)) |
| [2026-10-16_9711802_gpt-6-luna_high](evals/2026-10-16_9711802_gpt-6-luna_high/summary.md) | gpt-6-luna (high) | anthropic claude-opus-5-5 | 91% (81%–96%) → **95% (86%–98%)** re-graded | 84% → **89%** | 57 graded, 0 test errors | `9711802` (earlier; since then: 48 files changed, 3798 insertions(+), 17 deletions(-)) |
| [2026-10-16_9711802_gpt-6.1-sol_high](evals/2026-10-16_9711802_gpt-6.1-sol_high/summary.md) | gpt-6.1-sol (high) | anthropic claude-opus-5-5 | 100% (94%–100%) → **100% (94%–100%)** re-graded | 100% → **100%** | 57 graded, 0 test errors | `9711802` (earlier; since then: 48 files changed, 3798 insertions(+), 17 deletions(-)) |
| [2026-10-16_1f8338a_claude-fable-5-1_high](evals/2026-10-16_1f8338a_claude-fable-5-1_high/summary.md) | claude-fable-5-1 (high) | openai gpt-6.1-sol | 100% (44%–100%) | 100% | 3 graded, 0 test errors | `1f8338a` (earlier; since then: 40 files changed, 3732 insertions(+), 1 deletion(-)) |
| [2026-10-16_1f8338a_claude-haiku-5-5_high](evals/2026-10-16_1f8338a_claude-haiku-5-5_high/summary.md) | claude-haiku-5-5 (high) | openai gpt-6.1-sol | 67% (21%–94%) | 0% | 3 graded, 0 test errors | `1f8338a` (earlier; since then: 40 files changed, 3732 insertions(+), 1 deletion(-)) |
| [2026-10-16_1f8338a_claude-opus-5-5_high](evals/2026-10-16_1f8338a_claude-opus-5-5_high/summary.md) | claude-opus-5-5 (high) | openai gpt-6.1-sol | 100% (44%–100%) | 100% | 3 graded, 0 test errors | `1f8338a` (earlier; since then: 40 files changed, 3732 insertions(+), 1 deletion(-)) |
| [2026-10-16_1f8338a_claude-sonnet-5-5_high](evals/2026-10-16_1f8338a_claude-sonnet-5-5_high/summary.md) | claude-sonnet-5-5 (high) | openai gpt-6.1-sol | 67% (21%–94%) | 0% | 3 graded, 0 test errors | `1f8338a` (earlier; since then: 40 files changed, 3732 insertions(+), 1 deletion(-)) |
| [2026-10-16_1f8338a_gpt-6-astra_high](evals/2026-10-16_1f8338a_gpt-6-astra_high/summary.md) | gpt-6-astra (high) | anthropic claude-opus-5-5 | 100% (44%–100%) | 100% | 3 graded, 0 test errors | `1f8338a` (earlier; since then: 40 files changed, 3732 insertions(+), 1 deletion(-)) |
| [2026-10-16_1f8338a_gpt-6-luna_high](evals/2026-10-16_1f8338a_gpt-6-luna_high/summary.md) | gpt-6-luna (high) | anthropic claude-opus-5-5 | 33% (6%–79%) | 0% | 3 graded, 0 test errors | `1f8338a` (earlier; since then: 40 files changed, 3732 insertions(+), 1 deletion(-)) |
| [2026-10-16_1f8338a_gpt-6.1-sol_high](evals/2026-10-16_1f8338a_gpt-6.1-sol_high/summary.md) | gpt-6.1-sol (high) | anthropic claude-opus-5-5 | 100% (44%–100%) | 100% | 3 graded, 0 test errors | `1f8338a` (earlier; since then: 40 files changed, 3732 insertions(+), 1 deletion(-)) |

## Changed since the previous record

Previous record: 0.2.0 at `017c23f8aa5b` (2026-10-16T06:22:07.350Z).

- `89692a9` test record: show a re-graded eval run's latest re-grade beside its original result
- `5765eef` evals: seven-model baseline with caching and the simulated user (9711802)
- `1f8338a` evals: case fixes from the seven-model run, and a clearer refusal message
- `9711802` evals: matrix.mjs runs several models at once, after a preflight
- `5e2b7a7` baseline: note that hitl-two-questions changed after this run
- `6efe390` evals: a simulated user for hitl-two-questions, with order-based checks
- `a2f6e9b` test record 2026-10-16 at 017c23f: every suite, and the seven-model connector evals
