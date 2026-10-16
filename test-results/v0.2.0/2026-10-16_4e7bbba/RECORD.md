# phone-control 0.2.0 — test record

- **Commit:** `4e7bbbaad20c4291d1bed336ebae484acc68a98d`
- **Recorded:** 2026-10-16T08:50:59.035Z on darwin 25.6.0 arm64, Node v23.9.0, Xcode 26.4
- **Tools an assistant sees:** `87d59cb607e1` (full list in `tools.json`) — unchanged since the previous record
- **Result:** every suite passed
- **Note:** Audit of every test layer against the standards (2026-10-16): five defects fixed with tests, the iOSWorld harness brought in line with the paper's judging inputs and its deviations documented, the connector judge's reliability measured (756 judgments, 100% agreement, kappa 1.00), and a committed-tree pilot of the phone-agent evals (GPT-6.1 Sol, clock-001 pass, caltrack-001 fail).

## Suites

| suite | result | counts | time | full output |
| --- | --- | --- | --- | --- |
| lint | PASS |  | 1s | [suites/lint.log](suites/lint.log) |
| unit | PASS | 24 passed, 0 failed | 11s | [suites/unit.log](suites/unit.log) |
| lifecycle | PASS | 26 passed, 0 failed, 2 skipped | 229s | [suites/lifecycle.log](suites/lifecycle.log) |
| e2e | PASS | 13 passed, 0 failed, 0 skipped | 33s | [suites/e2e.log](suites/e2e.log) |
| conformance | PASS | 5 passed, 0 failed, 25 expected failures | 52s | [suites/conformance.log](suites/conformance.log) |
| eval-harness-self-test | PASS | oracle assistant: 100% of 19 trials passed, null assistant: 0% of 19 trials passed | 187s | [suites/eval-harness-self-test.log](suites/eval-harness-self-test.log) |

## Not verified by this record

These scenarios were skipped on this machine, so nothing here vouches for them:

- lifecycle: suspend on one phone leaves another phone's session alone
- lifecycle: network label: Wi-Fi, cellular and UNREACHABLE are three different answers

## Evals

| run | assistant | judge | pass@1 (95% interval) | pass^k | trials | ran on commit |
| --- | --- | --- | --- | --- | --- | --- |
| [pilot-2026-10-16_c808997_gpt-6.1-sol](evals/pilot-2026-10-16_c808997_gpt-6.1-sol/summary.md) | phone agent on iOSWorld: openai:gpt-6.1-sol | openai gpt-5.4-mini | 50% (9%–91%) | n/a | 2 judged of 2 (2 tasks × 1), 0 test errors | `c808997` (earlier; since then: 10 files changed, 21944 insertions(+), 3 deletions(-)) |

## Changed since the previous record

Previous record: 0.2.0 at `89692a9c0f89` (2026-10-16T07:41:48.815Z).

- `4e7bbba` test record: describe phone-agent runs too, and never leave a half-written record
- `b5695aa` evals: the judge's reliability measured, and the pilot's findings written down
- `6c9035a` judge-agreement: an absent flag no longer drops the first run folder
- `c808997` evals: judge agreement (a second judge, Cohen's kappa) and a labelling sheet
- `f22f182` phone-agent evals: what the judge sees matches iOSWorld, and the deviations are written down
- `e21565e` Fix five defects found by auditing the tests against the code
- `dd44746` docs: handoff brief for the decision-model trial (Jev, OpenAI Decisions API)
- `867a9b4` test record 2026-10-16 at 89692a9: every suite, and the seven-model baseline with caching
