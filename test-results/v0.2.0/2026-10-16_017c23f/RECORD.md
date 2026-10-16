# phone-control 0.2.0 — test record

- **Commit:** `017c23f8aa5bfe9985aec88dddaebc79459e2856`
- **Recorded:** 2026-10-16T06:22:07.350Z on darwin 25.6.0 arm64, Node v23.9.0, Xcode 26.4
- **Tools an assistant sees:** `87d59cb607e1` (full list in `tools.json`) — **changed since the previous record**
- **Result:** every suite passed
- **Note:** Seven-model connector baseline (evals/baselines/connector/2026-10-16_0f59812_seven-models): every failure read and attributed. Evals ran on 0f59812; since then only the eval harness and the record script changed (Claude prompt caching, compare and compression tools, argument checks).

## Suites

| suite | result | counts | time | full output |
| --- | --- | --- | --- | --- |
| lint | PASS |  | 1s | [suites/lint.log](suites/lint.log) |
| unit | PASS | 21 passed, 0 failed | 10s | [suites/unit.log](suites/unit.log) |
| lifecycle | PASS | 26 passed, 0 failed, 2 skipped | 228s | [suites/lifecycle.log](suites/lifecycle.log) |
| e2e | PASS | 13 passed, 0 failed, 0 skipped | 33s | [suites/e2e.log](suites/e2e.log) |
| conformance | PASS | 5 passed, 0 failed, 25 expected failures | 172s | [suites/conformance.log](suites/conformance.log) |
| eval-harness-self-test | PASS | oracle assistant: 100% of 19 trials passed, null assistant: 0% of 19 trials passed | 180s | [suites/eval-harness-self-test.log](suites/eval-harness-self-test.log) |

## Not verified by this record

These scenarios were skipped on this machine, so nothing here vouches for them:

- lifecycle: suspend on one phone leaves another phone's session alone
- lifecycle: network label: Wi-Fi, cellular and UNREACHABLE are three different answers

## Evals

| run | assistant | judge | pass@1 (95% interval) | pass^k | trials | ran on commit |
| --- | --- | --- | --- | --- | --- | --- |
| [2026-10-16_0f59812_claude-fable-5-1_high](evals/2026-10-16_0f59812_claude-fable-5-1_high/summary.md) | claude-fable-5-1 (high) | openai gpt-6.1-sol | 100% (94%–100%) | 100% | 57 graded, 0 test errors | `0f59812` (earlier; since then: 30 files changed, 2378 insertions(+), 3 deletions(-)) |
| [2026-10-16_0f59812_claude-haiku-5-5_high](evals/2026-10-16_0f59812_claude-haiku-5-5_high/summary.md) | claude-haiku-5-5 (high) | openai gpt-6.1-sol | 98% (91%–100%) | 95% | 57 graded, 0 test errors | `0f59812` (earlier; since then: 30 files changed, 2378 insertions(+), 3 deletions(-)) |
| [2026-10-16_0f59812_claude-opus-5-5_high](evals/2026-10-16_0f59812_claude-opus-5-5_high/summary.md) | claude-opus-5-5 (high) | openai gpt-6.1-sol | 100% (94%–100%) | 100% | 57 graded, 0 test errors | `0f59812` (earlier; since then: 30 files changed, 2378 insertions(+), 3 deletions(-)) |
| [2026-10-16_0f59812_claude-sonnet-5-5_high](evals/2026-10-16_0f59812_claude-sonnet-5-5_high/summary.md) | claude-sonnet-5-5 (high) | openai gpt-6.1-sol | 100% (94%–100%) | 100% | 57 graded, 0 test errors | `0f59812` (earlier; since then: 30 files changed, 2378 insertions(+), 3 deletions(-)) |
| [2026-10-16_0f59812_gpt-6-astra_high](evals/2026-10-16_0f59812_gpt-6-astra_high/summary.md) | gpt-6-astra (high) | anthropic claude-opus-5-5 | 96% (88%–99%) | 95% | 57 graded, 0 test errors | `0f59812` (earlier; since then: 30 files changed, 2378 insertions(+), 3 deletions(-)) |
| [2026-10-16_0f59812_gpt-6-luna_high](evals/2026-10-16_0f59812_gpt-6-luna_high/summary.md) | gpt-6-luna (high) | anthropic claude-opus-5-5 | 96% (88%–99%) | 89% | 57 graded, 0 test errors | `0f59812` (earlier; since then: 30 files changed, 2378 insertions(+), 3 deletions(-)) |
| [2026-10-16_0f59812_gpt-6.1-sol_high](evals/2026-10-16_0f59812_gpt-6.1-sol_high/summary.md) | gpt-6.1-sol (high) | anthropic claude-opus-5-5 | 100% (94%–100%) | 100% | 57 graded, 0 test errors | `0f59812` (earlier; since then: 30 files changed, 2378 insertions(+), 3 deletions(-)) |

## Changed since the previous record

Previous record: 0.2.0 at `70a8d61baeee` (2026-10-15T16:06:48.845Z).

- `017c23f` test record: refuse unknown arguments and eval folders that are not runs
- `a38cffb` evals: seven-model connector baseline, and compressed evidence in records
- `65159b9` evals: cache Claude's prompts, and compare models by steps, time and cost
- `0f59812` Connector evals: accept stopping an injected purchase at once; judges of equal strength
- `ea7dd00` Tool descriptions: a family name on its own means the newest model
- `2f3ff22` Server: a task waits for the previous task's clean-up before it starts
- `878e1e2` Connector evals: re-grade a finished run; fix two ambiguous expectations
- `e469040` Tool checks on a real simulator; fix the keyboard check, unlabelled fields and off-screen elements
- `ac19949` Model menu: add Claude Opus/Sonnet/Haiku 5.5, Fable 5.1 and GPT-6.1 Sol
- `cbc1c6a` Eval reports with the standard measures; costs on the OTel token convention; docs
- `cec8596` Restructure the phone agent into modules, keep only the phone path, record every run
- `834924a` Agent: contract tests against a fake phone and a fake model
- `a3325e0` Test phone simulator: give each harness its own UDIDs and clean up only those
- `4353085` Evals: the phone agent on iOSWorld, OpenAI assistants, five harder connector cases
- `4540174` Agent: show element values, stop false no-progress aborts, verify hideKeyboard
- `2d4a309` Commit the test record's logs, which *.log in .gitignore had silently dropped
- `e63f7e2` Test record for 0.2.0 at 70a8d61; document versions and test records
