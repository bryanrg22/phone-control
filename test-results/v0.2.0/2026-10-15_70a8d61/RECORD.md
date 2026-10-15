# phone-control 0.2.0 — test record

- **Commit:** `70a8d61baeee5efbdc0834acb100c48f448b5705`
- **Recorded:** 2026-10-15T16:06:48.845Z on darwin 25.6.0 arm64, Node v23.9.0, Xcode 26.4
- **Tools an assistant sees:** `6f649e06e1fc` (full list in `tools.json`)
- **Result:** every suite passed
- **Note:** First record. Release 0.2.0 as deployed. The eval runs were made earlier the same day, on the commits shown, before versioning existed.

## Suites

| suite | result | counts | time | full output |
| --- | --- | --- | --- | --- |
| lint | PASS |  | 1s | [suites/lint.log](suites/lint.log) |
| unit | PASS | 17 passed, 0 failed | 1s | [suites/unit.log](suites/unit.log) |
| lifecycle | PASS | 26 passed, 0 failed, 2 skipped | 228s | [suites/lifecycle.log](suites/lifecycle.log) |
| e2e | PASS | 13 passed, 0 failed, 0 skipped | 36s | [suites/e2e.log](suites/e2e.log) |
| conformance | PASS | 5 passed, 0 failed, 25 expected failures | 1s | [suites/conformance.log](suites/conformance.log) |
| eval-harness-self-test | PASS | oracle assistant: 100% of 14 trials passed, null assistant: 0% of 14 trials passed | 151s | [suites/eval-harness-self-test.log](suites/eval-harness-self-test.log) |

## Not verified by this record

These scenarios were skipped on this machine, so nothing here vouches for them:

- lifecycle: suspend on one phone leaves another phone's session alone
- lifecycle: network label: Wi-Fi, cellular and UNREACHABLE are three different answers

## Evals

| run | assistant | judge | pass@1 (95% interval) | pass^k | trials | ran on commit |
| --- | --- | --- | --- | --- | --- | --- |
| [full-opus-5-5-high-1](evals/full-opus-5-5-high-1/summary.md) | claude-opus-5-5 (high) | openai gpt-6-luna | 100% (92%–100%) | 100% | 42 graded, 0 test errors | `2648bc9` (earlier; since then: 13 files changed, 347 insertions(+), 19 deletions(-)) |
| [locked-after-fix](evals/locked-after-fix/summary.md) | claude-opus-5-5 (high) | openai gpt-6-luna | 100% (44%–100%) | 100% | 3 graded, 0 test errors | `2c96319+dirty` (earlier; since then: 9 files changed, 117 insertions(+), 20 deletions(-)) |
| [smoke-task-simple](evals/smoke-task-simple/summary.md) | claude-opus-5-5 (high) | openai gpt-6-luna | 100% (21%–100%) | 100% | 1 graded, 0 test errors | `2648bc9` (earlier; since then: 13 files changed, 347 insertions(+), 19 deletions(-)) |

## Changed since the previous record

This is the first record; the most recent commits are listed.

- `70a8d61` Version 0.2.0: report release, commit and tool fingerprint; add test records
- `04bac3a` Keep a failed start on record through the clean-up suspend
- `2c96319` Record the first connector-eval baseline: Claude Opus 5.5 passes 42 of 42
- `2648bc9` Add connector evals: real Claude against the real server, simulated phone
- `96964aa` Add MCP conformance and tool-snapshot checks; refuse foreign Host headers
- `b8a0ea1` Phone Control: ask Claude to do something on your iPhone
